/**
 * RE-USE エンジンの STFT / iSTFT のラウンドトリップを検証する。
 * 対応する要求: REQ-ENHANCE-001、共通基盤
 */
import { describe, expect, it } from 'vitest';
import { hann, istft, stft, stftParams } from './dsp.js';

describe('dsp', () => {
  it('uses an even FFT size and a hop proportional to the sample rate', () => {
    expect(stftParams(16_000)).toEqual({ nFft: 640, hop: 80 });
    expect(stftParams(44_100)).toEqual({ nFft: 1764, hop: 220 });
    expect(stftParams(48_000)).toEqual({ nFft: 1920, hop: 240 });
    for (const rate of [16_000, 44_100, 48_000]) {
      expect(stftParams(rate).nFft % 2).toBe(0);
      expect(stftParams(rate).hop % 2).toBe(0);
    }
  });

  it('round-trips a sine wave through the STFT and iSTFT', () => {
    const sampleRate = 16_000;
    const length = 16_000;
    const samples = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      samples[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    }
    const { nFft, hop } = stftParams(sampleRate);
    const { re, im, F, T } = stft(samples, nFft, hop);
    const restored = istft(re, im, F, T, nFft, hop);
    expect(F).toBe(nFft / 2 + 1);
    expect(restored.length).toBeGreaterThan(length - nFft);
    let maxError = 0;
    for (let index = nFft; index < length - nFft; index += 1) {
      maxError = Math.max(maxError, Math.abs(restored[index] - samples[index]));
    }
    expect(maxError).toBeLessThan(0.01);
  });

  it('returns a periodic Hann window whose peak is one', () => {
    const window = hann(8);
    expect(window[0]).toBe(0);
    expect(window[4]).toBe(1);
    expect(window[7]).toBeLessThan(1);
  });
});
