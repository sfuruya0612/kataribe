import { describe, expect, it } from 'vitest';
import {
  advanceClipping,
  DEFAULT_CLIPPING_CONFIG,
  INITIAL_CLIPPING_TRACKER,
  normalizeClippingConfig,
  type ClippingTracker,
} from '../src/shared/clipping';

function feed(
  peaks: number[],
  initial: ClippingTracker = INITIAL_CLIPPING_TRACKER,
  config = DEFAULT_CLIPPING_CONFIG,
) {
  let tracker = initial;
  const transitions: Array<'started' | 'recovered'> = [];
  for (const peak of peaks) {
    const next = advanceClipping(tracker, peak, config);
    tracker = next.tracker;
    if (next.transition) {
      transitions.push(next.transition);
    }
  }
  return { tracker, transitions };
}

describe('advanceClipping', () => {
  it('does not warn for normal meeting levels', () => {
    const { tracker, transitions } = feed(new Array(60).fill(0.2));
    expect(tracker.active).toBe(false);
    expect(transitions).toEqual([]);
  });

  it('does not warn for a single clipping spike', () => {
    const { tracker, transitions } = feed([
      DEFAULT_CLIPPING_CONFIG.peakThreshold,
      0.1,
      0.1,
      0.1,
    ]);
    expect(tracker.active).toBe(false);
    expect(transitions).toEqual([]);
  });

  it('warns after the configured number of consecutive intervals', () => {
    const peaks = new Array(DEFAULT_CLIPPING_CONFIG.intervalsToWarn).fill(1);
    const { tracker, transitions } = feed(peaks);

    expect(tracker.active).toBe(true);
    expect(tracker.peak).toBe(1);
    expect(transitions).toEqual(['started']);
  });

  it('recovers after enough quiet intervals', () => {
    const { tracker: active } = feed(
      new Array(DEFAULT_CLIPPING_CONFIG.intervalsToWarn).fill(1),
    );
    const { tracker, transitions } = feed(
      new Array(DEFAULT_CLIPPING_CONFIG.recoveryIntervals).fill(0.1),
      active,
    );

    expect(tracker.active).toBe(false);
    expect(tracker.consecutive).toBe(0);
    expect(tracker.recovery).toBe(0);
    expect(transitions).toEqual(['recovered']);
  });

  it('keeps the warning active when clipping returns during recovery', () => {
    const { tracker: active } = feed(
      new Array(DEFAULT_CLIPPING_CONFIG.intervalsToWarn).fill(1),
    );
    const quiet = feed(
      new Array(DEFAULT_CLIPPING_CONFIG.recoveryIntervals - 1).fill(0.1),
      active,
    );
    expect(quiet.tracker.active).toBe(true);

    const loud = advanceClipping(quiet.tracker, 1);
    expect(loud.tracker.active).toBe(true);
    expect(loud.tracker.recovery).toBe(0);
    expect(loud.transition).toBeNull();
  });

  it('clamps invalid peaks to silence', () => {
    const { tracker } = feed([Number.NaN, Number.POSITIVE_INFINITY, -1]);
    expect(tracker.active).toBe(false);
    expect(tracker.peak).toBe(0);
  });

  it('uses a custom threshold and duration', () => {
    const config = { peakThreshold: 0.9, intervalsToWarn: 2, recoveryIntervals: 2 };
    const started = feed([0.95, 0.95], INITIAL_CLIPPING_TRACKER, config);
    expect(started.transitions).toEqual(['started']);

    const recovered = feed([0.1, 0.1], started.tracker, config);
    expect(recovered.transitions).toEqual(['recovered']);
  });
});

describe('normalizeClippingConfig', () => {
  it('clamps values to the supported ranges', () => {
    expect(
      normalizeClippingConfig({
        peakThreshold: 1.5,
        intervalsToWarn: 0,
        recoveryIntervals: 100,
      }),
    ).toEqual({
      peakThreshold: 1,
      intervalsToWarn: 1,
      recoveryIntervals: 50,
    });
  });

  it('falls back to defaults for invalid values', () => {
    expect(normalizeClippingConfig({ peakThreshold: Number.NaN })).toEqual(
      DEFAULT_CLIPPING_CONFIG,
    );
    expect(normalizeClippingConfig(null)).toEqual(DEFAULT_CLIPPING_CONFIG);
  });
});
