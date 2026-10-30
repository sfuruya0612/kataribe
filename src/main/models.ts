import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  open,
  rename,
  rm,
  stat,
  statfs,
} from 'node:fs/promises';
import { join } from 'node:path';
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

async function defaultFreeBytes(path: string): Promise<number> {
  const info = await statfs(path);
  return info.bavail * info.bsize;
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead <= 0) {
        break;
      }
      hash.update(buffer.subarray(0, result.bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

export class ModelManager {
  private readonly modelsDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly freeBytes: (path: string) => Promise<number>;
  private readonly onProgress: (progress: ModelDownloadProgress) => void;
  private readonly definitions: WhisperModelDefinition[];
  private readonly downloads = new Map<WhisperModel, DownloadState>();
  private readonly errors = new Map<WhisperModel, string>();

  constructor(options: ModelManagerOptions) {
    this.modelsDir = options.modelsDir;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.freeBytes = options.freeBytes ?? defaultFreeBytes;
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

    await mkdir(this.modelsDir, { recursive: true, mode: 0o700 });
    const finalPath = join(this.modelsDir, definition.fileName);
    const partPath = `${finalPath}.part`;
    const partBytes = (await fileSize(partPath)) ?? 0;
    if (partBytes > definition.sizeBytes) {
      await rm(partPath, { force: true });
    }
    const startBytes = Math.min(partBytes, definition.sizeBytes);
    const required = Math.max(0, definition.sizeBytes - startBytes) + 64 * 1024 * 1024;
    const available = await this.freeBytes(this.modelsDir);
    if (available < required) {
      throw new Error(
        `not enough disk space for ${definition.fileName}: need ${required} bytes, have ${available}`,
      );
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.errors.delete(model);
    const state: DownloadState = {
      controller,
      downloadedBytes: startBytes,
      totalBytes: definition.sizeBytes,
      progress: definition.sizeBytes > 0 ? startBytes / definition.sizeBytes : 0,
      state: 'downloading',
      error: null,
      lastReportAt: 0,
    };
    this.downloads.set(model, state);
    this.report(model, state, true);

    try {
      const headers: Record<string, string> = {};
      if (startBytes > 0) {
        headers.Range = `bytes=${startBytes}-`;
      }
      const response = await this.fetchImpl(definition.url, {
        headers,
        signal: controller.signal,
        redirect: 'follow',
      });
      if (response.status === 416 && startBytes === definition.sizeBytes) {
        // The file is already complete; verify below.
      } else if (!response.ok) {
        throw new Error(
          `model download failed: HTTP ${response.status} ${response.statusText}`,
        );
      }

      const append = response.status === 206 && startBytes > 0;
      if (response.status === 200 && startBytes > 0) {
        state.downloadedBytes = 0;
      }
      const contentLength = Number(response.headers.get('content-length') ?? '');
      if (Number.isFinite(contentLength) && contentLength > 0) {
        state.totalBytes = append ? startBytes + contentLength : contentLength;
      }
      if (state.totalBytes !== definition.sizeBytes) {
        state.totalBytes = definition.sizeBytes;
      }

      if (response.status !== 416) {
        const handle = await open(partPath, append ? 'a' : 'w', 0o600);
        try {
          if (!response.body) {
            throw new Error('model download returned an empty body');
          }
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            if (controller.signal.aborted) {
              throw new DOMException('download was cancelled', 'AbortError');
            }
            if (value && value.byteLength > 0) {
              await handle.write(Buffer.from(value));
              state.downloadedBytes += value.byteLength;
              state.progress =
                definition.sizeBytes > 0
                  ? Math.min(1, state.downloadedBytes / definition.sizeBytes)
                  : null;
              this.report(model, state, false);
            }
          }
          await handle.sync();
        } finally {
          await handle.close();
        }
      }

      state.state = 'verifying';
      state.progress = 1;
      this.report(model, state, true);

      const size = await fileSize(partPath);
      if (size !== definition.sizeBytes) {
        throw new Error(
          `model download is incomplete: expected ${definition.sizeBytes} bytes, got ${size ?? 0}`,
        );
      }
      const digest = await hashFile(partPath);
      if (digest !== definition.sha256) {
        await rm(partPath, { force: true });
        throw new Error(
          `model checksum mismatch: expected ${definition.sha256}, got ${digest}`,
        );
      }
      await chmod(partPath, 0o600);
      await rename(partPath, finalPath);
      this.errors.delete(model);
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
