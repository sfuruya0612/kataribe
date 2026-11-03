import type { ReuseGPU } from './model';

/** STFT、モデル、iSTFT の処理時間 (ms)。 */
export type EnhanceTiming = {
  stft: number;
  model: number;
  istft: number;
};

/** 強調した波形と処理時間。 */
export type EnhancedAudio = {
  wav: Float32Array;
  t: EnhanceTiming;
};

/** 1 つのチャンクを STFT、モデル、iSTFT の順に処理する。 */
export function enhanceSegment(
  model: ReuseGPU,
  wav: Float32Array,
  sampleRate: number,
): Promise<EnhancedAudio>;

/** この GPU で扱える最大のチャンク長 (秒) を返す。 */
export function fitChunkSeconds(
  model: ReuseGPU,
  sampleRate: number,
  max?: number,
): number;

/** 長い波形をチャンクに分け、重なりをクロスフェードして強調する。 */
export function enhance(
  model: ReuseGPU,
  wav: Float32Array,
  sampleRate: number,
  options?: {
    chunkSeconds?: number;
    overlapSeconds?: number;
    onProgress?: ((progress: number) => void) | null;
  },
): Promise<EnhancedAudio>;
