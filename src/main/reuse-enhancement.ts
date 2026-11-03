import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, chmod } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  EnhancementCancelMessage,
  EnhancementStartMessage,
} from '../shared/reuse';
import type { ReuseModel } from '../shared/types';
import type { ReuseModelManager } from './reuse-models';
import type { ReuseTempTokenStore } from './reuse-protocol';
import {
  createWavHeader,
  encodePcm16,
  readWavInfo,
  WAV_HEADER_BYTES,
  type WavInfo,
} from './wav';

export type ReuseEnhancementRequest = {
  inputPath: string;
  outputPath: string;
  model: ReuseModel;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

export type ReuseEnhancementServiceOptions = {
  tempTokens: ReuseTempTokenStore;
  modelManager: ReuseModelManager;
  sendStart: (message: EnhancementStartMessage) => boolean;
  sendCancel: (message: EnhancementCancelMessage) => void;
  timeoutMs?: number;
  createRequestId?: () => string;
};

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const CHUNK_SECONDS = 5;
const HOP_SECONDS = 2.5;
const CROSSFADE_SECONDS = 0.5;

type ActiveEnhancement = {
  requestId: string;
  model: ReuseModel;
  outputPath: string;
  tempPath: string;
  handle: FileHandle;
  info: WavInfo;
  totalFrames: number;
  expectedChunkIndex: number;
  writtenFrames: number;
  token: string;
  releaseModel: () => void;
  timeout: NodeJS.Timeout;
  onProgress: ((progress: number) => void) | undefined;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | null;
  writeQueue: Promise<void>;
  settled: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
};

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

/**
 * メインウィンドウの Worker に音声強調を依頼し、返ってきた PCM から WAV を組み立てる。
 */
export class ReuseEnhancementService {
  private readonly tempTokens: ReuseTempTokenStore;
  private readonly modelManager: ReuseModelManager;
  private readonly sendStart: (message: EnhancementStartMessage) => boolean;
  private readonly sendCancel: (message: EnhancementCancelMessage) => void;
  private readonly timeoutMs: number;
  private readonly createRequestId: () => string;
  private active: ActiveEnhancement | null = null;

  constructor(options: ReuseEnhancementServiceOptions) {
    this.tempTokens = options.tempTokens;
    this.modelManager = options.modelManager;
    this.sendStart = options.sendStart;
    this.sendCancel = options.sendCancel;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.createRequestId = options.createRequestId ?? (() => randomUUID());
  }

  isBusy(): boolean {
    return this.active !== null;
  }

  async cancel(): Promise<boolean> {
    const active = this.active;
    if (!active) {
      return false;
    }
    this.sendCancel({ requestId: active.requestId });
    await this.fail(active, abortError('enhancement was cancelled'));
    return true;
  }

  async enhance(request: ReuseEnhancementRequest): Promise<void> {
    if (this.active) {
      throw new Error('another enhancement job is running');
    }
    const info = await readWavInfo(request.inputPath);
    if (info.bitsPerSample !== 16) {
      throw new Error('only 16-bit PCM WAV is supported');
    }
    if (info.channels !== 1 && info.channels !== 2) {
      throw new Error('only mono or stereo WAV is supported');
    }
    const totalFrames = Math.floor(info.dataSize / (info.channels * 2));
    if (totalFrames <= 0) {
      throw new Error('the input WAV has no audio frames');
    }
    const modelPath = await this.modelManager.installedPath(request.model);
    if (!modelPath) {
      throw new Error(`${request.model} is not installed`);
    }
    const releaseModel = this.modelManager.acquire(request.model);
    const requestId = this.createRequestId();
    const token = this.tempTokens.issue(request.inputPath);
    const tempPath = `${request.outputPath}.part`;
    let handle: FileHandle | null = null;
    try {
      await mkdir(dirname(request.outputPath), { recursive: true, mode: 0o700 });
      handle = await open(tempPath, 'w', 0o600);
      await handle.write(Buffer.alloc(WAV_HEADER_BYTES), 0, WAV_HEADER_BYTES, 0);
      await handle.sync();
    } catch (error) {
      await handle?.close().catch(() => undefined);
      this.tempTokens.revoke(token);
      releaseModel();
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }

    const promise = new Promise<void>((resolve, reject) => {
      const active: ActiveEnhancement = {
        requestId,
        model: request.model,
        outputPath: request.outputPath,
        tempPath,
        handle,
        info,
        totalFrames,
        expectedChunkIndex: 0,
        writtenFrames: 0,
        token,
        releaseModel,
        timeout: setTimeout(() => {
          void this.fail(active, new Error('enhancement timed out'));
        }, this.timeoutMs),
        onProgress: request.onProgress,
        signal: request.signal,
        onAbort: null,
        writeQueue: Promise.resolve(),
        settled: false,
        resolve,
        reject,
      };
      if (request.signal) {
        const onAbort = () => {
          this.sendCancel({ requestId });
          void this.fail(active, abortError('enhancement was cancelled'));
        };
        active.onAbort = onAbort;
        if (request.signal.aborted) {
          onAbort();
        } else {
          request.signal.addEventListener('abort', onAbort, { once: true });
        }
      }
      this.active = active;
      if (active.settled) {
        return;
      }
      const sent = this.sendStart({
        requestId,
        model: request.model,
        tempUrl: `kataribe-temp://enhance/${token}`,
        modelUrl: `kataribe-model://reuse/${request.model}`,
        sampleRate: info.sampleRate,
        channels: info.channels,
        bitsPerSample: info.bitsPerSample,
        dataOffset: info.dataOffset,
        dataSize: info.dataSize,
        totalFrames,
        chunkSeconds: CHUNK_SECONDS,
        hopSeconds: HOP_SECONDS,
        crossfadeSeconds: CROSSFADE_SECONDS,
      });
      if (!sent) {
        void this.fail(active, new Error('main window is not available'));
      }
    });
    return promise;
  }

  handleProgress(requestId: string, progress: number): void {
    const active = this.active;
    if (!active || active.requestId !== requestId || active.settled) {
      return;
    }
    if (!Number.isFinite(progress)) {
      return;
    }
    const value = Math.max(0, Math.min(1, progress));
    active.onProgress?.(value);
  }

  async handleChunk(
    requestId: string,
    index: number,
    samples: Float32Array,
  ): Promise<void> {
    const active = this.active;
    if (!active || active.requestId !== requestId || active.settled) {
      return;
    }
    if (!(samples instanceof Float32Array) || samples.length === 0) {
      throw new Error('enhancement chunk is empty');
    }
    if (index !== active.expectedChunkIndex) {
      const error = new Error(
        `enhancement chunk is out of order: expected ${active.expectedChunkIndex}, got ${index}`,
      );
      await this.fail(active, error);
      throw error;
    }
    const data = encodePcm16(samples);
    const offset = WAV_HEADER_BYTES + active.writtenFrames * 2;
    active.expectedChunkIndex += 1;
    active.writtenFrames += samples.length;
    active.writeQueue = active.writeQueue.then(async () => {
      let written = 0;
      while (written < data.length) {
        const result = await active.handle.write(
          data,
          written,
          data.length - written,
          offset + written,
        );
        if (result.bytesWritten <= 0) {
          throw new Error('failed to write the enhanced WAV');
        }
        written += result.bytesWritten;
      }
    });
    try {
      await active.writeQueue;
    } catch (error) {
      await this.fail(active, error);
      throw error;
    }
  }

  async handleDone(requestId: string): Promise<void> {
    const active = this.active;
    if (!active || active.requestId !== requestId || active.settled) {
      return;
    }
    try {
      await active.writeQueue;
      if (active.writtenFrames !== active.totalFrames) {
        throw new Error(
          `enhancement wrote ${active.writtenFrames} frames, expected ${active.totalFrames}`,
        );
      }
      const header = createWavHeader(active.writtenFrames * 2, active.info.sampleRate);
      await active.handle.write(header, 0, header.length, 0);
      await active.handle.sync();
      await active.handle.close();
      await chmod(active.tempPath, 0o600);
      await rename(active.tempPath, active.outputPath);
      this.settle(active);
      active.resolve();
    } catch (error) {
      await this.fail(active, error);
    }
  }

  handleError(requestId: string, message: string): void {
    const active = this.active;
    if (!active || active.requestId !== requestId || active.settled) {
      return;
    }
    void this.fail(active, new Error(message));
  }

  private settle(active: ActiveEnhancement): void {
    if (active.settled) {
      return;
    }
    active.settled = true;
    clearTimeout(active.timeout);
    if (active.onAbort && active.signal) {
      active.signal.removeEventListener('abort', active.onAbort);
    }
    this.tempTokens.revoke(active.token);
    active.releaseModel();
    if (this.active === active) {
      this.active = null;
    }
  }

  private async fail(active: ActiveEnhancement, error: unknown): Promise<void> {
    if (active.settled) {
      return;
    }
    this.settle(active);
    await active.writeQueue.catch(() => undefined);
    await active.handle.close().catch(() => undefined);
    await rm(active.tempPath, { force: true }).catch(() => undefined);
    active.reject(error);
  }
}
