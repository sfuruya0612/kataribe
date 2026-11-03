/** GEMM と畳み込みの WGSL を返す。`inplace` は入力と出力を同じバッファにする。 */
export function gemmSource(options?: { inplace?: boolean }): string;

export const IN_PARTIAL: string;
export const IN_FINAL: string;
export const IN_APPLY: string;
export const PREP: string;
export const MAMBA_CORE: string;
export const COPY: string;
export const HEAD: string;
