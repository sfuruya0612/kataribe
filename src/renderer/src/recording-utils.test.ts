import { describe, expect, it } from 'vitest';
import type { RecordingCaptureStats } from '../../shared/types';
import {
  buildAudioConstraints,
  deviceLabel,
  formatDuration,
  formatLevel,
  frameClockDeltaSeconds,
  inputSourceLabel,
  isBlackHoleDevice,
  isClipping,
  levelPercent,
  pickDeviceId,
  splitInputDevices,
} from './recording-utils';

const stats: RecordingCaptureStats = {
  frames: 48000,
  expectedFrames: 48128,
  gaps: 1,
  maxGapFrames: 128,
  missedFrames: 128,
  sampleRate: 48000,
  channels: 1,
  currentTime: 1.01,
};

describe('isBlackHoleDevice', () => {
  it('matches BlackHole labels case-insensitively', () => {
    expect(isBlackHoleDevice('BlackHole 2ch')).toBe(true);
    expect(isBlackHoleDevice('blackhole 16ch')).toBe(true);
  });

  it('does not match other input devices', () => {
    expect(isBlackHoleDevice('FIFINE K670')).toBe(false);
    expect(isBlackHoleDevice('')).toBe(false);
  });
});

describe('splitInputDevices', () => {
  it('separates microphones and BlackHole devices', () => {
    const result = splitInputDevices([
      { deviceId: 'default', label: 'Default' },
      { deviceId: 'mic-1', label: 'FIFINE K670' },
      { deviceId: 'bh-1', label: 'BlackHole 2ch' },
      { deviceId: 'mic-1', label: 'FIFINE K670' },
    ]);

    expect(result.microphones).toEqual([{ deviceId: 'mic-1', label: 'FIFINE K670' }]);
    expect(result.systemDevices).toEqual([{ deviceId: 'bh-1', label: 'BlackHole 2ch' }]);
  });

  it('keeps unlabeled physical devices as microphones', () => {
    const result = splitInputDevices([{ deviceId: 'mic-1', label: '' }]);

    expect(result.microphones).toHaveLength(1);
    expect(result.systemDevices).toHaveLength(0);
  });
});

describe('pickDeviceId', () => {
  it('keeps the current id when it is still available', () => {
    expect(
      pickDeviceId([{ deviceId: 'a', label: 'A' }, { deviceId: 'b', label: 'B' }], 'b'),
    ).toBe('b');
  });

  it('falls back to the first device', () => {
    expect(pickDeviceId([{ deviceId: 'a', label: 'A' }], 'missing')).toBe('a');
  });

  it('returns an empty string when there is no device', () => {
    expect(pickDeviceId([], 'missing')).toBe('');
  });
});

describe('deviceLabel', () => {
  it('uses the label or the fallback', () => {
    expect(deviceLabel({ deviceId: 'a', label: 'Mic' }, 'fallback')).toBe('Mic');
    expect(deviceLabel({ deviceId: 'a', label: '' }, 'fallback')).toBe('fallback');
    expect(deviceLabel(undefined, 'fallback')).toBe('fallback');
  });
});

describe('buildAudioConstraints', () => {
  it('disables microphone processing and pins the device', () => {
    expect(buildAudioConstraints('mic-1', 2)).toEqual({
      audio: {
        deviceId: { exact: 'mic-1' },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
      video: false,
    });
  });
});

describe('formatDuration', () => {
  it('formats seconds and hours', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65.9)).toBe('01:05');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('treats invalid values as zero', () => {
    expect(formatDuration(Number.NaN)).toBe('00:00');
    expect(formatDuration(-5)).toBe('00:00');
  });
});

describe('level helpers', () => {
  it('maps the level to a 60 dB meter scale', () => {
    expect(levelPercent(0)).toBe(0);
    expect(levelPercent(0.001)).toBeCloseTo(0, 5);
    expect(levelPercent(1)).toBe(100);
    expect(levelPercent(0.1)).toBeCloseTo(66.666, 2);
  });

  it('formats levels in dB', () => {
    expect(formatLevel(0)).toBe('-inf dB');
    expect(formatLevel(1)).toBe('0.0 dB');
    expect(formatLevel(0.5)).toBe('-6.0 dB');
  });

  it('detects clipping', () => {
    expect(isClipping(0.99)).toBe(true);
    expect(isClipping(0.989)).toBe(false);
  });
});

describe('frameClockDeltaSeconds', () => {
  it('compares the frame count with the audio context clock', () => {
    expect(frameClockDeltaSeconds(stats)).toBeCloseTo(0.01, 5);
    expect(frameClockDeltaSeconds({ ...stats, currentTime: 0.99 })).toBeCloseTo(0.01, 5);
  });

  it('returns zero for an invalid sample rate', () => {
    expect(frameClockDeltaSeconds({ ...stats, sampleRate: 0 })).toBe(0);
  });
});

describe('inputSourceLabel', () => {
  it('labels every input source', () => {
    expect(inputSourceLabel('microphone')).toBe('マイク');
    expect(inputSourceLabel('system')).toBe('システム音声');
    expect(inputSourceLabel('both')).toBe('マイク + システム音声');
  });
});
