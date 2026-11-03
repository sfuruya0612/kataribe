/** STFT と iSTFT のパラメータ。 */
export type StftParams = {
  nFft: number;
  hop: number;
};

/** 片側スペクトル。`re` と `im` は `[F, T]` の行優先で並ぶ。 */
export type StftResult = {
  re: Float32Array;
  im: Float32Array;
  F: number;
  T: number;
};

/** サンプルレートに応じた FFT 長とホップ長を返す。 */
export function stftParams(sampleRate: number): StftParams;

/** 周期ハン窓を返す。 */
export function hann(size: number): Float64Array;

/** 中心を reflect で埋めた STFT を返す。 */
export function stft(
  samples: Float32Array,
  nFft: number,
  hop: number,
): StftResult;

/** STFT の片側スペクトルから波形を復元する。 */
export function istft(
  re: Float32Array,
  im: Float32Array,
  F: number,
  T: number,
  nFft: number,
  hop: number,
): Float32Array;
