import { describe, expect, it } from 'vitest';
import {
  computeWindowRms,
  DEFAULT_SILENCE_CONFIG,
  normalizeSilenceConfig,
  shouldWarnSilence,
} from '../src/shared/silence';

describe('normalizeSilenceConfig', () => {
  it('clamps values to supported ranges', () => {
    expect(
      normalizeSilenceConfig({
        windowSeconds: 0,
        rmsThreshold: 2,
        graceSeconds: 1000,
      }),
    ).toEqual({
      windowSeconds: 1,
      rmsThreshold: 1,
      graceSeconds: 600,
    });
  });

  it('falls back to defaults for invalid values', () => {
    expect(normalizeSilenceConfig(null)).toEqual(DEFAULT_SILENCE_CONFIG);
    expect(normalizeSilenceConfig({ windowSeconds: Number.NaN })).toEqual(
      DEFAULT_SILENCE_CONFIG,
    );
  });
});

describe('computeWindowRms', () => {
  it('returns zero for an empty window', () => {
    expect(computeWindowRms([])).toBe(0);
  });

  it('combines per-interval RMS values', () => {
    expect(computeWindowRms([0.1, 0.1, 0.1, 0.1])).toBeCloseTo(0.1, 6);
    expect(computeWindowRms([0.3, 0])).toBeCloseTo(Math.sqrt(0.045), 6);
  });

  it('ignores invalid values', () => {
    expect(computeWindowRms([Number.NaN, 0.1])).toBeCloseTo(0.1, 6);
  });
});

describe('shouldWarnSilence', () => {
  it('does not warn during the grace period', () => {
    expect(shouldWarnSilence(29.9, 0, DEFAULT_SILENCE_CONFIG)).toBe(false);
  });

  it('warns after the grace period when the window is silent', () => {
    expect(shouldWarnSilence(30, 0.001, DEFAULT_SILENCE_CONFIG)).toBe(true);
    expect(shouldWarnSilence(60, 0, DEFAULT_SILENCE_CONFIG)).toBe(true);
  });

  it('does not warn when the window has audio', () => {
    expect(shouldWarnSilence(60, 0.01, DEFAULT_SILENCE_CONFIG)).toBe(false);
  });

  it('uses a custom config', () => {
    const config = { windowSeconds: 1, rmsThreshold: 0.01, graceSeconds: 2 };
    expect(shouldWarnSilence(2, 0.005, config)).toBe(true);
    expect(shouldWarnSilence(2, 0.02, config)).toBe(false);
  });
});
