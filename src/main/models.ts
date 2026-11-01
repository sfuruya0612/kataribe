import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { downloadAsset, fileSize } from './asset-download';
import type {
  ModelDownloadProgress,
  WhisperModel,
  WhisperModelInfo,
  WhisperModelList,
} from '../shared/types';

export type WhisperModelDefinition = {
  model: WhisperModel;
  fileName: string;
  url: string;
  sizeBytes: number;
  sha256: string;
};

export const WHISPER_MODEL_DEFINITIONS: WhisperModelDefinition[] = [
  {
    model: 'large-v3-turbo',
    fileName: 'ggml-large-v3-turbo.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
    sizeBytes: 1624555275,
    sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
  },
  {
    model: 'medium',
    fileName: 'ggml-medium.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
    sizeBytes: 1533763059,
    sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208',
  },
  {
    model: 'small',
    fileName: 'ggml-small.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    sizeBytes: 487601967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
  },
];

export function getWhisperModelDefinition(
  model: WhisperModel,
): WhisperModelDefinition {
  const definition = WHISPER_MODEL_DEFINITIONS.find(
    (entry) => entry.model === model,
  );
  if (!definition) {
    throw new Error(`unsupported whisper model: ${model}`);
  }
  return definition;
}

type DownloadState = {
  controller: AbortController;
  downloadedBytes: number;
  totalBytes: number;
  progress: number | null;
  state: 'downloading' | 'verifying' | 'error';
  error: string | null;
  lastReportAt: number;
};

export type ModelManagerOptions = {
  modelsDir: string;
  fetch?: typeof fetch;
  now?: () => number;
  freeBytes?: (path: string) => Promise<number>;
  onProgress?: (progress: ModelDownloadProgress) => void;
  definitions?: WhisperModelDefinition[];
};

export class ModelManager {
  private readonly modelsDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly freeBytes: ((path: string) => Promise<number>) | undefined;
  private readonly onProgress: (progress: ModelDownloadProgress) => void;
  private readonly definitions: WhisperModelDefinition[];
  private readonly downloads = new Map<WhisperModel, DownloadState>();
  private readonly errors = new Map<WhisperModel, string>();

  constructor(options: ModelManagerOptions) {
    this.modelsDir = options.modelsDir;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.freeBytes = options.freeBytes;
    this.onProgress = options.onProgress ?? (() => undefined);
    this.definitions = options.definitions ?? WHISPER_MODEL_DEFINITIONS;
  }

  private definition(model: WhisperModel): WhisperModelDefinition {
    const found = this.definitions.find((entry) => entry.model === model);
    if (!found) {
      throw new Error(`unsupported whisper model: ${model}`);
    }
    return found;
  }

  async list(): Promise<WhisperModelList> {
    const models = await Promise.all(
      this.definitions.map(async (definition) => {
        const finalPath = join(this.modelsDir, definition.fileName);
        const partPath = `${finalPath}.part`;
        const installedBytes = await fileSize(finalPath);
        const partBytes = await fileSize(partPath);
        const download = this.downloads.get(definition.model);
        const installed = installedBytes === definition.sizeBytes;
        const model: WhisperModelInfo = {
          model: definition.model,
          fileName: definition.fileName,
          sizeBytes: definition.sizeBytes,
          installed,
          installedBytes,
          downloadedBytes: download?.downloadedBytes ?? partBytes,
          progress: download?.progress ?? null,
          state: installed
            ? 'installed'
            : download?.state === 'verifying'
              ? 'verifying'
              : download
                ? 'downloading'
                : this.errors.has(definition.model)
                  ? 'error'
                  : 'missing',
          error: download?.error ?? this.errors.get(definition.model) ?? null,
        };
        return model;
      }),
    );
    return { models, modelsDir: this.modelsDir };
  }

  async installedPath(model: WhisperModel): Promise<string | null> {
    const definition = this.definition(model);
    const path = join(this.modelsDir, definition.fileName);
    const size = await fileSize(path);
    return size === definition.sizeBytes ? path : null;
  }

  isDownloading(model: WhisperModel): boolean {
    return this.downloads.has(model);
  }

  async download(model: WhisperModel, signal?: AbortSignal): Promise<void> {
    const definition = this.definition(model);
    if (this.downloads.has(model)) {
      throw new Error(`${model} is already downloading`);
    }
    const installed = await this.installedPath(model);
    if (installed) {
      return;
    }

    const finalPath = join(this.modelsDir, definition.fileName);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.errors.delete(model);
    const state: DownloadState = {
      controller,
      downloadedBytes: 0,
      totalBytes: definition.sizeBytes,
      progress: 0,
      state: 'downloading',
      error: null,
      lastReportAt: 0,
    };
    this.downloads.set(model, state);
    this.report(model, state, true);

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
        onProgress: (progress) => {
          state.downloadedBytes = progress.downloadedBytes;
          state.totalBytes = progress.totalBytes;
          state.progress = progress.progress;
          this.report(model, state, false);
        },
        onState: (next) => {
          state.state = next;
          this.report(model, state, true);
        },
      });
      state.state = 'downloading';
      state.progress = 1;
      state.downloadedBytes = definition.sizeBytes;
      this.report(model, state, true);
    } catch (error) {
      if (!controller.signal.aborted) {
        state.state = 'error';
        state.error = error instanceof Error ? error.message : String(error);
        this.errors.set(model, state.error);
        this.report(model, state, true);
      }
      throw error;
    } finally {
      this.downloads.delete(model);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  cancel(model: WhisperModel): boolean {
    const state = this.downloads.get(model);
    if (!state) {
      return false;
    }
    state.controller.abort();
    return true;
  }

  async delete(model: WhisperModel): Promise<void> {
    const definition = this.definition(model);
    this.cancel(model);
    this.errors.delete(model);
    await rm(join(this.modelsDir, definition.fileName), { force: true });
    await rm(join(this.modelsDir, `${definition.fileName}.part`), { force: true });
  }

  private report(
    model: WhisperModel,
    state: DownloadState,
    force: boolean,
  ): void {
    const now = this.now();
    if (!force && now - state.lastReportAt < 200) {
      return;
    }
    state.lastReportAt = now;
    this.onProgress({
      model,
      downloadedBytes: state.downloadedBytes,
      totalBytes: state.totalBytes,
      progress:
        state.totalBytes > 0
          ? Math.min(1, state.downloadedBytes / state.totalBytes)
          : 0,
    });
  }
}
