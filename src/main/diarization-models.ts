import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  DiarizationModelProgress,
  DiarizationModelState,
  DiarizationModelStatus,
} from '../shared/types';
import { downloadAsset, fileSize, hashFile } from './asset-download';
import { runProcess } from './process';

export type DiarizationAssetDefinition = {
  kind: 'segmentation' | 'embedding';
  url: string;
  downloadName: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  finalSizeBytes: number;
  finalSha256: string;
  archiveEntry?: string;
};

export type DiarizationModelPaths = {
  segmentation: string;
  embedding: string;
};

export type DiarizationModelManagerOptions = {
  modelsDir: string;
  fetch?: typeof fetch;
  freeBytes?: (path: string) => Promise<number>;
  onProgress?: (progress: DiarizationModelProgress) => void;
  onChange?: () => void;
  definitions?: readonly DiarizationAssetDefinition[];
};

const SEGMENTATION_ARCHIVE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2';
const EMBEDDING_MODEL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx';

export const DIARIZATION_ASSETS: readonly DiarizationAssetDefinition[] = [
  {
    kind: 'segmentation',
    url: SEGMENTATION_ARCHIVE,
    downloadName: 'sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
    fileName: 'segmentation.onnx',
    sizeBytes: 6958444,
    sha256: '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488',
    finalSizeBytes: 5992913,
    finalSha256: '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079',
    archiveEntry: 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx',
  },
  {
    kind: 'embedding',
    url: EMBEDDING_MODEL,
    downloadName: 'embedding.onnx',
    fileName: 'embedding.onnx',
    sizeBytes: 39593761,
    sha256: '1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b',
    finalSizeBytes: 39593761,
    finalSha256: '1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b',
  },
];

type ActiveDownload = {
  promise: Promise<DiarizationModelPaths>;
  controller: AbortController;
  listeners: Set<(progress: DiarizationModelProgress) => void>;
};

function totalBytes(definitions: readonly DiarizationAssetDefinition[]): number {
  return definitions.reduce((sum, definition) => sum + definition.sizeBytes, 0);
}

/**
 * 話者分離モデルの取得、展開、状態管理を行う。
 */
export class DiarizationModelManager {
  private readonly modelsDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly freeBytes: ((path: string) => Promise<number>) | undefined;
  private readonly onProgress: (progress: DiarizationModelProgress) => void;
  private readonly onChange: () => void;
  private readonly definitions: readonly DiarizationAssetDefinition[];
  private active: ActiveDownload | null = null;
  private state: DiarizationModelState = 'missing';
  private lastError: string | null = null;
  private downloadedBytes = 0;

  constructor(options: DiarizationModelManagerOptions) {
    this.modelsDir = options.modelsDir;
    this.fetchImpl = options.fetch ?? fetch;
    this.freeBytes = options.freeBytes;
    this.onProgress = options.onProgress ?? (() => undefined);
    this.onChange = options.onChange ?? (() => undefined);
    this.definitions = options.definitions ?? DIARIZATION_ASSETS;
  }

  async status(): Promise<DiarizationModelStatus> {
    const installed = await this.installedPaths();
    const total = totalBytes(this.definitions);
    const downloadedBytes = installed
      ? total
      : this.active !== null
        ? this.downloadedBytes
        : await this.partialBytes();
    const state: DiarizationModelState =
      installed !== null
        ? 'installed'
        : this.state === 'installed'
          ? 'missing'
          : this.state;
    return {
      installed: installed !== null,
      state,
      downloadedBytes,
      totalBytes: total,
      progress: total > 0 ? Math.min(1, downloadedBytes / total) : null,
      error: installed !== null ? null : this.lastError,
      modelsDir: this.modelsDir,
    };
  }

  modelHashes(): { segmentation: string; embedding: string } {
    const segmentation = this.definitions.find(
      (definition) => definition.kind === 'segmentation',
    );
    const embedding = this.definitions.find(
      (definition) => definition.kind === 'embedding',
    );
    if (!segmentation || !embedding) {
      throw new Error('speaker diarization model definitions are incomplete');
    }
    return {
      segmentation: segmentation.finalSha256,
      embedding: embedding.finalSha256,
    };
  }

  async ensureInstalled(
    signal?: AbortSignal,
    onProgress?: (progress: DiarizationModelProgress) => void,
  ): Promise<DiarizationModelPaths> {
    const installed = await this.installedPaths();
    if (installed !== null && (await this.verifyInstalled(installed))) {
      this.state = 'installed';
      this.lastError = null;
      return installed;
    }
    if (installed !== null) {
      await this.removeInvalidFiles();
    }
    if (this.active !== null) {
      return this.waitForActive(signal, onProgress);
    }

    const controller = new AbortController();
    const listeners = new Set<(progress: DiarizationModelProgress) => void>();
    if (onProgress) {
      listeners.add(onProgress);
    }
    const download: ActiveDownload = {
      controller,
      listeners,
      promise: Promise.resolve({
        segmentation: '',
        embedding: '',
      }),
    };
    this.active = download;
    download.promise = Promise.resolve()
      .then(() => this.runDownload(controller.signal, listeners))
      .finally(() => {
        if (this.active === download) {
          this.active = null;
        }
      });

    const onCallerAbort = () => controller.abort();
    signal?.addEventListener('abort', onCallerAbort, { once: true });
    try {
      return await download.promise;
    } finally {
      signal?.removeEventListener('abort', onCallerAbort);
      if (onProgress) {
        listeners.delete(onProgress);
      }
    }
  }

  cancel(): boolean {
    if (this.active === null) {
      return false;
    }
    this.active.controller.abort();
    return true;
  }

  private async waitForActive(
    signal: AbortSignal | undefined,
    onProgress: ((progress: DiarizationModelProgress) => void) | undefined,
  ): Promise<DiarizationModelPaths> {
    const active = this.active;
    if (active === null) {
      throw new Error('speaker diarization model download is not running');
    }
    if (onProgress) {
      active.listeners.add(onProgress);
    }
    if (signal?.aborted) {
      if (onProgress) {
        active.listeners.delete(onProgress);
      }
      throw new DOMException('speaker diarization model download was cancelled', 'AbortError');
    }
    return new Promise<DiarizationModelPaths>((resolve, reject) => {
      const onAbort = () => {
        if (onProgress) {
          active.listeners.delete(onProgress);
        }
        reject(
          new DOMException(
            'speaker diarization model download was cancelled',
            'AbortError',
          ),
        );
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      active.promise.then(resolve, reject).finally(() => {
        signal?.removeEventListener('abort', onAbort);
        if (onProgress) {
          active.listeners.delete(onProgress);
        }
      });
    });
  }

  private async runDownload(
    signal: AbortSignal,
    listeners: Set<(progress: DiarizationModelProgress) => void>,
  ): Promise<DiarizationModelPaths> {
    const total = totalBytes(this.definitions);
    let completedBytes = 0;
    let current = 0;
    this.state = 'downloading';
    this.lastError = null;
    this.downloadedBytes = 0;
    this.notifyState();
    this.report(listeners, {
      state: 'downloading',
      downloadedBytes: 0,
      totalBytes: total,
      progress: 0,
    });

    try {
      for (const definition of this.definitions) {
        if (signal.aborted) {
          throw new DOMException('speaker diarization model download was cancelled', 'AbortError');
        }
        const finalPath = join(this.modelsDir, definition.fileName);
        const existing = await this.verifyFile(
          finalPath,
          definition.finalSizeBytes,
          definition.finalSha256,
        );
        if (existing) {
          completedBytes += definition.sizeBytes;
          this.downloadedBytes = completedBytes;
          this.state = 'downloading';
          this.report(listeners, {
            state: 'downloading',
            downloadedBytes: completedBytes,
            totalBytes: total,
            progress: total > 0 ? completedBytes / total : 0,
          });
          continue;
        }

        const downloadPath =
          definition.archiveEntry === undefined
            ? finalPath
            : join(this.modelsDir, definition.downloadName);
        await downloadAsset({
          url: definition.url,
          destinationPath: downloadPath,
          sizeBytes: definition.sizeBytes,
          sha256: definition.sha256,
          signal,
          fetchImpl: this.fetchImpl,
          freeBytes: this.freeBytes,
          reportIntervalMs: 0,
          verifyExisting: true,
          onProgress: (progress) => {
            current = progress.downloadedBytes;
            this.downloadedBytes = completedBytes + current;
            this.report(listeners, {
              state: this.state === 'verifying' ? 'verifying' : 'downloading',
              downloadedBytes: completedBytes + current,
              totalBytes: total,
              progress: total > 0 ? (completedBytes + current) / total : 0,
            });
          },
          onState: (state) => {
            this.state = state;
            this.notifyState();
          },
        });
        if (definition.archiveEntry !== undefined) {
          await this.extractAsset(definition, downloadPath, finalPath);
          await rm(downloadPath, { force: true });
        }

        completedBytes += definition.sizeBytes;
        current = 0;
        this.downloadedBytes = completedBytes;
        this.state = 'downloading';
        this.report(listeners, {
          state: 'downloading',
          downloadedBytes: completedBytes,
          totalBytes: total,
          progress: total > 0 ? completedBytes / total : 0,
        });
      }

      if (signal.aborted) {
        throw new DOMException(
          'speaker diarization model download was cancelled',
          'AbortError',
        );
      }
      const paths = await this.installedPaths();
      if (paths === null) {
        throw new Error('speaker diarization models are incomplete after download');
      }
      this.state = 'installed';
      this.lastError = null;
      this.downloadedBytes = total;
      this.notifyState();
      return paths;
    } catch (error) {
      if (signal.aborted) {
        this.state = 'missing';
        this.lastError = null;
        this.downloadedBytes = 0;
        this.notifyState();
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.state = 'error';
      this.lastError = message;
      this.notifyState();
      throw error;
    }
  }

  private async extractAsset(
    definition: DiarizationAssetDefinition,
    archivePath: string,
    finalPath: string,
  ): Promise<void> {
    if (definition.archiveEntry === undefined) {
      return;
    }
    const tempDir = join(this.modelsDir, `extract-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true, mode: 0o700 });
    try {
      const result = await runProcess({
        command: '/usr/bin/tar',
        args: [
          '-xjf',
          archivePath,
          '-C',
          tempDir,
          '--strip-components=1',
          definition.archiveEntry,
        ],
      });
      if (result.code !== 0) {
        throw new Error(
          `speaker diarization model extraction failed: ${result.stderr.trim() || `exit code ${result.code ?? 'unknown'}`}`,
        );
      }
      const extractedPath = join(tempDir, basename(definition.archiveEntry));
      if (
        !(await this.verifyFile(
          extractedPath,
          definition.finalSizeBytes,
          definition.finalSha256,
        ))
      ) {
        throw new Error('speaker diarization model checksum mismatch after extraction');
      }
      await chmod(extractedPath, 0o600);
      await rename(extractedPath, finalPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async installedPaths(): Promise<DiarizationModelPaths | null> {
    const segmentation = this.definitions.find(
      (definition) => definition.kind === 'segmentation',
    );
    const embedding = this.definitions.find(
      (definition) => definition.kind === 'embedding',
    );
    if (!segmentation || !embedding) {
      return null;
    }
    const segmentationPath = join(this.modelsDir, segmentation.fileName);
    const embeddingPath = join(this.modelsDir, embedding.fileName);
    const segmentationSize = await fileSize(segmentationPath);
    const embeddingSize = await fileSize(embeddingPath);
    if (
      segmentationSize !== segmentation.finalSizeBytes ||
      embeddingSize !== embedding.finalSizeBytes
    ) {
      return null;
    }
    return { segmentation: segmentationPath, embedding: embeddingPath };
  }

  private async verifyInstalled(paths: DiarizationModelPaths): Promise<boolean> {
    const segmentation = this.definitions.find(
      (definition) => definition.kind === 'segmentation',
    );
    const embedding = this.definitions.find(
      (definition) => definition.kind === 'embedding',
    );
    if (!segmentation || !embedding) {
      return false;
    }
    return (
      (await this.verifyFile(
        paths.segmentation,
        segmentation.finalSizeBytes,
        segmentation.finalSha256,
      )) &&
      (await this.verifyFile(
        paths.embedding,
        embedding.finalSizeBytes,
        embedding.finalSha256,
      ))
    );
  }

  private async verifyFile(
    path: string,
    expectedSize: number,
    expectedSha256: string,
  ): Promise<boolean> {
    if ((await fileSize(path)) !== expectedSize) {
      return false;
    }
    return (await hashFile(path)) === expectedSha256;
  }

  private async removeInvalidFiles(): Promise<void> {
    for (const definition of this.definitions) {
      const path = join(this.modelsDir, definition.fileName);
      if ((await fileSize(path)) !== null) {
        await rm(path, { force: true });
      }
    }
  }

  private async partialBytes(): Promise<number> {
    let total = 0;
    for (const definition of this.definitions) {
      const finalSize = await fileSize(join(this.modelsDir, definition.fileName));
      if (finalSize === definition.finalSizeBytes) {
        total += definition.sizeBytes;
        continue;
      }
      const downloadSize = await fileSize(join(this.modelsDir, definition.downloadName));
      if (downloadSize !== null) {
        total += Math.min(downloadSize, definition.sizeBytes);
        continue;
      }
      const partSize = await fileSize(
        join(this.modelsDir, `${definition.downloadName}.part`),
      );
      total += Math.min(partSize ?? 0, definition.sizeBytes);
    }
    return total;
  }

  private report(
    listeners: Set<(progress: DiarizationModelProgress) => void>,
    progress: DiarizationModelProgress,
  ): void {
    this.onProgress(progress);
    for (const listener of listeners) {
      listener(progress);
    }
  }

  private notifyState(): void {
    this.onChange();
  }
}
