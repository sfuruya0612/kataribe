export type GpuReason = 'no-api' | 'no-adapter' | 'limits';

export const NEEDED_WORKGROUP_STORAGE: number;

export const GPU_ERRORS: Record<GpuReason, string>;

export type AdapterResult =
  | { adapter: GPUAdapter; reason?: undefined }
  | { adapter: null; reason: GpuReason };

/** WebGPU のアダプタを取得し、利用できない理由を返す。 */
export function findAdapter(): Promise<AdapterResult>;
