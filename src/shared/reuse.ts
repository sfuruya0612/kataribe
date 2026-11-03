import type { ReuseModel } from './types';

export type ReuseLicenseKind = 'engine' | 'model';

/** Main から Renderer の Worker へ渡す音声強調の開始要求。 */
export type EnhancementStartMessage = {
  requestId: string;
  model: ReuseModel;
  tempUrl: string;
  modelUrl: string;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
  totalFrames: number;
  chunkSeconds: number;
  hopSeconds: number;
  crossfadeSeconds: number;
};

/** Main から Renderer の Worker へ渡すキャンセル要求。 */
export type EnhancementCancelMessage = {
  requestId: string;
};

/** Worker が処理したフレームの割合。 */
export type EnhancementProgressReport = {
  requestId: string;
  progress: number;
};

/** Worker が生成した PCM のチャンク。 */
export type EnhancementChunkReport = {
  requestId: string;
  index: number;
  samples: Float32Array;
};

/** Worker の完了通知。 */
export type EnhancementDoneReport = {
  requestId: string;
};

/** Worker の失敗通知。 */
export type EnhancementErrorReport = {
  requestId: string;
  message: string;
};

export const ENHANCEMENT_START_CHANNEL = 'enhancement:start';
export const ENHANCEMENT_CANCEL_CHANNEL = 'enhancement:cancel';
