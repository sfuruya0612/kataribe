import type {
  EnhancementCancelMessage,
  EnhancementStartMessage,
} from '../../../shared/reuse';
import type { ReuseModel } from '../../../shared/types';
import { enhanceSegment, fitChunkSeconds } from './enhance.js';
import { ReuseGPU } from './model.js';
import {
  ChunkCrossfader,
  chunkByteRange,
  mixPcm16ToMono,
  planEnhancementChunks,
  type EnhancementChunkPlan,
} from './chunking';

type StartRequest = {
  type: 'start';
  payload: EnhancementStartMessage;
};

type CancelRequest = {
  type: 'cancel';
  requestId: string;
};

type ChunkAck = {
  type: 'chunk-ack';
  index: number;
};

type WorkerRequest = StartRequest | CancelRequest | ChunkAck;

type WorkerResponse =
  | { type: 'progress'; requestId: string; progress: number }
  | { type: 'chunk'; requestId: string; index: number; samples: Float32Array }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; message: string; cancelled: boolean };

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};

// Worker のグローバルは DOM の Window と型が異なるため、入口で専用の形へ合わせる。
const scope = globalThis as unknown as WorkerScope;

const modelCache = new Map<ReuseModel, Promise<ReuseGPU>>();
let activeController: AbortController | null = null;
let activeRequestId: string | null = null;
const ackResolvers = new Map<number, () => void>();
const ackRejecters = new Map<number, (error: unknown) => void>();

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

function abortError(): DOMException {
  return new DOMException('enhancement was cancelled', 'AbortError');
}

async function loadModel(model: ReuseModel, modelUrl: string): Promise<ReuseGPU> {
  const cached = modelCache.get(model);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    const response = await fetch(modelUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`model download failed: HTTP ${response.status}`);
    }
    const weights = await response.arrayBuffer();
    return ReuseGPU.create(weights);
  })();
  modelCache.set(model, promise);
  promise.catch(() => {
    modelCache.delete(model);
  });
  return promise;
}

async function readRange(
  url: string,
  startByte: number,
  endByte: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { Range: `bytes=${startByte}-${endByte}` },
    signal,
    cache: 'no-store',
  });
  if (response.status !== 206 && response.status !== 200) {
    throw new Error(`audio chunk request failed: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  if (response.status === 200) {
    return new Uint8Array(buffer.slice(startByte, endByte + 1));
  }
  return new Uint8Array(buffer);
}

function waitForAck(index: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      ackResolvers.delete(index);
      ackRejecters.delete(index);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    ackResolvers.set(index, () => {
      cleanup();
      resolve();
    });
    ackRejecters.set(index, (error) => {
      cleanup();
      reject(error);
    });
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function resolveOutstanding(error: unknown): void {
  for (const reject of ackRejecters.values()) {
    reject(error);
  }
  ackRejecters.clear();
  ackResolvers.clear();
}

function effectivePlan(payload: EnhancementStartMessage, model: ReuseGPU): EnhancementChunkPlan {
  const available = fitChunkSeconds(model, payload.sampleRate, payload.chunkSeconds);
  if (available < 1) {
    throw new Error(
      `this GPU is too limited for the speech enhancement model (largest buffer ${Math.round(model.maxBufferBytes / 2 ** 20)} MB)`,
    );
  }
  const chunkSeconds = Math.min(payload.chunkSeconds, available);
  const hopSeconds = Math.min(payload.hopSeconds, chunkSeconds / 2);
  const crossfadeSeconds = Math.min(payload.crossfadeSeconds, hopSeconds / 2);
  return planEnhancementChunks(payload.totalFrames, payload.sampleRate, {
    chunkSeconds,
    hopSeconds,
    crossfadeSeconds,
  });
}

async function run(payload: EnhancementStartMessage, signal: AbortSignal): Promise<void> {
  const model = await loadModel(payload.model, payload.modelUrl);
  const plan = effectivePlan(payload, model);
  const crossfader = new ChunkCrossfader(plan.crossfadeFrames);
  const info = {
    dataOffset: payload.dataOffset,
    dataSize: payload.dataSize,
    channels: payload.channels,
  };
  for (const chunk of plan.chunks) {
    if (signal.aborted) {
      throw abortError();
    }
    const range = chunkByteRange(info, chunk);
    const bytes = await readRange(payload.tempUrl, range.startByte, range.endByte, signal);
    const wav = mixPcm16ToMono(bytes, payload.channels);
    const enhanced = await enhanceSegment(model, wav, payload.sampleRate);
    const relativeStart = chunk.outputStartFrame - chunk.startFrame;
    const relativeEnd = chunk.outputEndFrame - chunk.startFrame;
    if (
      relativeStart < 0 ||
      relativeEnd > enhanced.wav.length ||
      relativeEnd <= relativeStart
    ) {
      throw new Error('enhancement chunk range is outside the model output');
    }
    const samples = crossfader.blend(
      enhanced.wav.subarray(relativeStart, relativeEnd),
    );
    post(
      {
        type: 'chunk',
        requestId: payload.requestId,
        index: chunk.index,
        samples,
      },
      [samples.buffer],
    );
    await waitForAck(chunk.index, signal);
    post({
      type: 'progress',
      requestId: payload.requestId,
      progress: chunk.outputEndFrame / Math.max(1, payload.totalFrames),
    });
  }
  model.release();
  post({ type: 'done', requestId: payload.requestId });
}

async function handleStart(payload: EnhancementStartMessage): Promise<void> {
  if (activeController !== null) {
    post({
      type: 'error',
      requestId: payload.requestId,
      message: 'another enhancement job is running',
      cancelled: false,
    });
    return;
  }
  const controller = new AbortController();
  activeController = controller;
  activeRequestId = payload.requestId;
  post({ type: 'progress', requestId: payload.requestId, progress: 0 });
  try {
    await run(payload, controller.signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({
      type: 'error',
      requestId: payload.requestId,
      message,
      cancelled: controller.signal.aborted,
    });
  } finally {
    resolveOutstanding(abortError());
    if (activeController === controller) {
      activeController = null;
      activeRequestId = null;
    }
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'start') {
    void handleStart(message.payload);
    return;
  }
  if (message.type === 'chunk-ack') {
    ackResolvers.get(message.index)?.();
    return;
  }
  if (message.type === 'cancel') {
    if (activeRequestId === message.requestId) {
      activeController?.abort();
    }
    return;
  }
};
