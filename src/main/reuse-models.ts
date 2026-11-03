import { stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ReuseModel,
  ReuseModelInfo,
  ReuseModelList,
  ReuseModelProgress,
} from '../shared/types';
import { downloadAsset, fileSize, hashFile } from './asset-download';

export type ReuseModelDefinition = {
  id: ReuseModel;
  label: string;
  license: string;
  fileName: string;
  url: string;
  sizeBytes: number;
  sha256: string;
};

export const REUSE_MODEL_DEFINITIONS: readonly ReuseModelDefinition[] = [
  {
    id: 'nemotronlabs',
    label: 'NVIDIA NemotronLabs RE-USE',
    license: 'OpenMDW-1.1',
    fileName: 'nemotronlabs.safetensors',
    url: 'https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE/resolve/31f82f2efad1095034492f236e8dac9239ba713b/model.safetensors',
    sizeBytes: 38_592_940,
    sha256:
      '06badaf4029b297f97f7fe48d62990b48d5482608210df577354e0d4e0ed70e1',
  },
];

export function isReuseModel(value: unknown): value is ReuseModel {
  return value === 'nemotronlabs';
}

export function getReuseModelDefinition(id: ReuseModel): ReuseModelDefinition {
  const definition = REUSE_MODEL_DEFINITIONS.find((entry) => entry.id === id);
  if (!definition) {
    throw new Error(`unsupported reuse model: ${id}`);
  }
  return definition;
}

type DownloadState = {
  controller: AbortController;
  downloadedBytes: number;
  totalBytes: number;
  progress: number | null;
  error: string | null;
  lastReportAt: number;
};

type VerifiedFile = {
  size: number;
  mtimeMs: number;
};

export type ReuseModelManagerOptions = {
  modelsDir: string;
  fetch?: typeof fetch;
  now?: () => number;
  freeBytes?: (path: string) => Promise<number>;
  onProgress?: (progress: ReuseModelProgress) => void;
  onChange?: () => void;
  definitions?: readonly ReuseModelDefinition[];
};

/**
 * 音声強調モデルの取得、SHA-256 の照合、利用中の削除拒否を管理する。
 */
export class ReuseModelManager {
  private readonly modelsDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly freeBytes: ((path: string) => Promise<number>) | undefined;
  private readonly onProgress: (progress: ReuseModelProgress) => void;
  private readonly onChange: () => void;
  private readonly definitions: readonly ReuseModelDefinition[];
  private readonly downloads = new Map<ReuseModel, DownloadState>();
  private readonly errors = new Map<ReuseModel, string>();
  private readonly verified = new Map<ReuseModel, VerifiedFile>();
  private readonly useCounts = new Map<ReuseModel, number>();

  constructor(options: ReuseModelManagerOptions) {
    this.modelsDir = options.modelsDir;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.freeBytes = options.freeBytes;
    this.onProgress = options.onProgress ?? (() => undefined);
    this.onChange = options.onChange ?? (() => undefined);
    this.definitions = options.definitions ?? REUSE_MODEL_DEFINITIONS;
  }

  private definition(id: ReuseModel): ReuseModelDefinition {
    const found = this.definitions.find((entry) => entry.id === id);
    if (!found) {
      throw new Error(`unsupported reuse model: ${id}`);
    }
    return found;
  }

  modelPath(id: ReuseModel): string {
    return join(this.modelsDir, this.definition(id).fileName);
  }

  async list(): Promise<ReuseModelList> {
    const models: ReuseModelInfo[] = [];
    for (const definition of this.definitions) {
      const installed = (await this.installedPath(definition.id)) !== null;
      const download = this.downloads.get(definition.id);
      models.push({
        id: definition.id,
        label: definition.label,
        license: definition.license,
        sizeBytes: definition.sizeBytes,
        installed,
        downloading: download !== undefined,
        progress: installed ? null : download?.progress ?? null,
        error: download?.error ?? this.errors.get(definition.id) ?? null,
      });
    }
    return { models, modelsDir: this.modelsDir };
  }

  async installedPath(id: ReuseModel): Promise<string | null> {
    const definition = this.definition(id);
    const path = this.modelPath(id);
    let info;
    try {
      info = await stat(path);
    } catch {
      return null;
    }
    if (!info.isFile() || info.size !== definition.sizeBytes) {
      return null;
    }
    const cached = this.verified.get(id);
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
      return path;
    }
    if ((await hashFile(path)) !== definition.sha256) {
      return null;
    }
    this.verified.set(id, { size: info.size, mtimeMs: info.mtimeMs });
    return path;
  }

  isDownloading(id: ReuseModel): boolean {
    return this.downloads.has(id);
  }

  isInUse(id: ReuseModel): boolean {
    return (this.useCounts.get(id) ?? 0) > 0;
  }

  /**
   * 強調ジョブがモデルを使っている間、削除を拒否するための参照を取る。
   */
  acquire(id: ReuseModel): () => void {
    this.definition(id);
    this.useCounts.set(id, (this.useCounts.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = Math.max(0, (this.useCounts.get(id) ?? 1) - 1);
      if (next === 0) {
        this.useCounts.delete(id);
      } else {
        this.useCounts.set(id, next);
      }
    };
  }

  async download(id: ReuseModel, signal?: AbortSignal): Promise<void> {
    const definition = this.definition(id);
    if (this.downloads.has(id)) {
      throw new Error(`${id} is already downloading`);
    }
    if (await this.installedPath(id)) {
      return;
    }

    const finalPath = this.modelPath(id);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.errors.delete(id);
    const state: DownloadState = {
      controller,
      downloadedBytes: 0,
      totalBytes: definition.sizeBytes,
      progress: 0,
      error: null,
      lastReportAt: 0,
    };
    this.downloads.set(id, state);
    this.report(id, state, true);
    this.onChange();

    try {
      await downloadAsset({
        url: definition.url,
        destinationPath: finalPath,
        sizeBytes: definition.sizeBytes,
        sha256: definition.sha256,
        signal: controller.signal,
        fetchImpl: this.fetchImpl,
        freeBytes: this.freeBytes,
        now: this.now,
        reportIntervalMs: 0,
        verifyExisting: true,
        onProgress: (progress) => {
          state.downloadedBytes = progress.downloadedBytes;
          state.totalBytes = progress.totalBytes;
          state.progress = progress.progress;
          this.report(id, state, false);
        },
      });
      state.progress = 1;
      state.downloadedBytes = definition.sizeBytes;
      this.verified.delete(id);
      this.report(id, state, true);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        state.error = message;
        this.errors.set(id, message);
        this.report(id, state, true);
      }
      throw error;
    } finally {
      this.downloads.delete(id);
      signal?.removeEventListener('abort', onAbort);
      this.onChange();
    }
  }

  cancel(id: ReuseModel): boolean {
    const state = this.downloads.get(id);
    if (!state) {
      return false;
    }
    state.controller.abort();
    return true;
  }

  async delete(id: ReuseModel): Promise<void> {
    this.definition(id);
    if (this.isInUse(id)) {
      throw new Error(`${id} is in use by an enhancement job`);
    }
    this.cancel(id);
    this.errors.delete(id);
    this.verified.delete(id);
    await rm(this.modelPath(id), { force: true });
    await rm(`${this.modelPath(id)}.part`, { force: true });
    this.onChange();
  }

  private report(id: ReuseModel, state: DownloadState, force: boolean): void {
    const now = this.now();
    if (!force && now - state.lastReportAt < 200) {
      return;
    }
    state.lastReportAt = now;
    this.onProgress({
      id,
      downloadedBytes: state.downloadedBytes,
      totalBytes: state.totalBytes,
      progress:
        state.totalBytes > 0
          ? Math.min(1, state.downloadedBytes / state.totalBytes)
          : 0,
    });
  }
}
