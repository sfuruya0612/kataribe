export type SilenceConfig = {
  windowSeconds: number;
  rmsThreshold: number;
  graceSeconds: number;
};

export const DEFAULT_SILENCE_CONFIG: SilenceConfig = {
  windowSeconds: 5,
  rmsThreshold: 0.003,
  graceSeconds: 30,
};

export function normalizeSilenceConfig(
  input: Partial<SilenceConfig> | null | undefined,
): SilenceConfig {
  const windowSeconds = Number(input?.windowSeconds);
  const rmsThreshold = Number(input?.rmsThreshold);
  const graceSeconds = Number(input?.graceSeconds);
  return {
    windowSeconds: Number.isFinite(windowSeconds)
      ? Math.min(60, Math.max(1, windowSeconds))
      : DEFAULT_SILENCE_CONFIG.windowSeconds,
    rmsThreshold: Number.isFinite(rmsThreshold)
      ? Math.min(1, Math.max(0, rmsThreshold))
      : DEFAULT_SILENCE_CONFIG.rmsThreshold,
    graceSeconds: Number.isFinite(graceSeconds)
      ? Math.min(600, Math.max(0, graceSeconds))
      : DEFAULT_SILENCE_CONFIG.graceSeconds,
  };
}

export function computeWindowRms(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let sumSquares = 0;
  let count = 0;
  for (const value of values) {
    if (Number.isFinite(value)) {
      sumSquares += value * value;
      count += 1;
    }
  }
  return count > 0 ? Math.sqrt(sumSquares / count) : 0;
}

export function shouldWarnSilence(
  elapsedSeconds: number,
  windowRms: number,
  config: SilenceConfig,
): boolean {
  const normalized = normalizeSilenceConfig(config);
  return (
    elapsedSeconds >= normalized.graceSeconds &&
    windowRms < normalized.rmsThreshold
  );
}
