/** safetensors の 1 テンソル。 */
export type Safetensor = {
  data: Float32Array;
  shape: number[];
};

/** スペクトログラム 1 枚分のモデル出力。 */
export type ReuseRunResult = {
  mag: Float32Array;
  pha: Float32Array;
  timings: Record<string, number> | null;
};

/** safetensors をテンソル名ごとの Float32Array へ復元する。 */
export function parseSafetensors(
  buffer: ArrayBuffer,
): Record<string, Safetensor>;

/** 重みを WGSL カーネルのレイアウトへ詰め替える。 */
export function packWeights(
  weights: Record<string, Safetensor>,
): Record<string, unknown>;

/** 指定したスペクトログラムで必要な最大バッファサイズを返す。 */
export function largestBufferBytes(F: number, T: number): number;

/** RE-USE の WebGPU 推論器。 */
export class ReuseGPU {
  static create(
    weightsBuffer: ArrayBuffer,
    options?: { profile?: boolean },
  ): Promise<ReuseGPU>;

  readonly device: GPUDevice;
  readonly maxBufferBytes: number;

  run(
    mag: Float32Array,
    pha: Float32Array,
    F: number,
    T: number,
    options?: { stopAt?: 'enc' | 'blk0' | 'blk29' | null },
  ): Promise<ReuseRunResult>;

  release(): void;

  readBuffer(buffer: GPUBuffer, floats: number): Promise<Float32Array>;
}
