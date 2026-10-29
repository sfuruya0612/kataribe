export type ClippingConfig = {
  peakThreshold: number;
  intervalsToWarn: number;
  recoveryIntervals: number;
};

export const DEFAULT_CLIPPING_CONFIG: ClippingConfig = {
  peakThreshold: 0.985,
  intervalsToWarn: 3,
  recoveryIntervals: 5,
};

export function normalizeClippingConfig(
  input: Partial<ClippingConfig> | null | undefined,
): ClippingConfig {
  const threshold = Number(input?.peakThreshold);
  const warn = Number(input?.intervalsToWarn);
  const recovery = Number(input?.recoveryIntervals);
  return {
    peakThreshold: Number.isFinite(threshold)
      ? Math.min(1, Math.max(0.5, threshold))
      : DEFAULT_CLIPPING_CONFIG.peakThreshold,
    intervalsToWarn: Number.isFinite(warn)
      ? Math.round(Math.min(50, Math.max(1, warn)))
      : DEFAULT_CLIPPING_CONFIG.intervalsToWarn,
    recoveryIntervals: Number.isFinite(recovery)
      ? Math.round(Math.min(50, Math.max(1, recovery)))
      : DEFAULT_CLIPPING_CONFIG.recoveryIntervals,
  };
}

export type ClippingTracker = {
  active: boolean;
  consecutive: number;
  recovery: number;
  peak: number;
};

export type ClippingTransition = 'started' | 'recovered' | null;

export const INITIAL_CLIPPING_TRACKER: ClippingTracker = {
  active: false,
  consecutive: 0,
  recovery: 0,
  peak: 0,
};

export function advanceClipping(
  tracker: ClippingTracker,
  peak: number,
  config: ClippingConfig = DEFAULT_CLIPPING_CONFIG,
): { tracker: ClippingTracker; transition: ClippingTransition } {
  const next = { ...tracker };
  const safePeak = Number.isFinite(peak) ? Math.max(0, Math.min(1, peak)) : 0;
  const normalized = normalizeClippingConfig(config);

  if (safePeak >= normalized.peakThreshold) {
    next.recovery = 0;
    next.peak = Math.max(next.peak, safePeak);
    if (next.active) {
      return { tracker: next, transition: null };
    }
    next.consecutive += 1;
    if (next.consecutive >= normalized.intervalsToWarn) {
      next.active = true;
      return { tracker: next, transition: 'started' };
    }
    return { tracker: next, transition: null };
  }

  if (!next.active) {
    return {
      tracker: { ...INITIAL_CLIPPING_TRACKER },
      transition: null,
    };
  }

  next.recovery += 1;
  if (next.recovery >= normalized.recoveryIntervals) {
    return {
      tracker: { ...INITIAL_CLIPPING_TRACKER },
      transition: 'recovered',
    };
  }
  return { tracker: next, transition: null };
}
