import { describe, expect, it } from 'vitest';
import type { RecordingCaptureStats } from '../../shared/types';
import {
  buildAudioConstraints,
  deviceLabel,
  deviceLossAction,
  errorText,
  formatDateTime,
  formatMeetingDate,
  formatMonthLabel,
  meetingStatusClass,
  meetingStatusLabel,
  recordingErrorText,
  formatDuration,
  formatLevel,
  frameClockDeltaSeconds,
  inputSourceLabel,
  blackHolePriority,
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

  it('prioritizes BlackHole 2ch over 16ch and 64ch', () => {
    const result = splitInputDevices([
      { deviceId: 'bh-64', label: 'BlackHole 64ch' },
      { deviceId: 'bh-16', label: 'BlackHole 16ch' },
      { deviceId: 'bh-2', label: 'BlackHole 2ch' },
    ]);

    expect(result.systemDevices.map((device) => device.deviceId)).toEqual([
      'bh-2',
      'bh-16',
      'bh-64',
    ]);
  });

  it('excludes the default and communications pseudo devices', () => {
    const result = splitInputDevices([
      { deviceId: 'default', label: 'BlackHole 2ch' },
      { deviceId: 'communications', label: 'BlackHole 2ch' },
      { deviceId: 'bh-2', label: 'BlackHole 2ch' },
    ]);

    expect(result.systemDevices).toEqual([{ deviceId: 'bh-2', label: 'BlackHole 2ch' }]);
  });
});

describe('blackHolePriority', () => {
  it('orders the channel counts used by BlackHole', () => {
    expect(blackHolePriority('BlackHole 2ch')).toBe(0);
    expect(blackHolePriority('BlackHole 16ch')).toBe(1);
    expect(blackHolePriority('BlackHole 64ch')).toBe(2);
    expect(blackHolePriority('BlackHole')).toBe(3);
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

  it('req_ui_001_labels_every_input_source_in_english', () => {
    expect(inputSourceLabel('microphone', 'en')).toBe('Microphone');
    expect(inputSourceLabel('system', 'en')).toBe('System audio');
    expect(inputSourceLabel('both', 'en')).toBe('Microphone + system audio');
  });
});

describe('formatMeetingDate', () => {
  it('formats a meeting timestamp for the table', () => {
    expect(formatMeetingDate('2026-10-29T05:05:00.000Z')).toMatch(/^10-29 \d{2}:\d{2}$/);
    expect(formatMeetingDate('not a date')).toBe('not a date');
  });

  it('req_ui_001_uses_the_english_date_separator', () => {
    expect(formatMeetingDate('2026-10-29T05:05:00.000Z', 'en')).toMatch(
      /^10\/29 \d{2}:\d{2}$/,
    );
  });
});

describe('formatMonthLabel', () => {
  it('labels months in Japanese and English', () => {
    expect(formatMonthLabel(2026, 10)).toBe('10 月');
    expect(formatMonthLabel(2026, 10, 'en')).toBe('Oct');
  });
});

describe('meeting status helpers', () => {
  it('labels every meeting status', () => {
    expect(meetingStatusLabel('recording')).toBe('録音中');
    expect(meetingStatusLabel('encoding')).toBe('変換中');
    expect(meetingStatusLabel('transcribing')).toBe('文字起こし中');
    expect(meetingStatusLabel('transcribed')).toBe('文字起こし済み');
    expect(meetingStatusLabel('summarized')).toBe('要約済み');
    expect(meetingStatusLabel('error')).toBe('エラー');
  });

  it('req_ui_001_labels_every_meeting_status_in_english', () => {
    expect(meetingStatusLabel('recording', 'en')).toBe('Recording');
    expect(meetingStatusLabel('encoding', 'en')).toBe('Encoding');
    expect(meetingStatusLabel('transcribing', 'en')).toBe('Transcribing');
    expect(meetingStatusLabel('transcribed', 'en')).toBe('Transcribed');
    expect(meetingStatusLabel('summarized', 'en')).toBe('Summarized');
    expect(meetingStatusLabel('error', 'en')).toBe('Error');
  });

  it('builds a CSS status class', () => {
    expect(meetingStatusClass('encoding')).toBe('status-encoding');
  });
});

describe('formatDateTime', () => {
  it('formats a valid ISO timestamp and preserves invalid values', () => {
    expect(formatDateTime('2026-10-29T05:05:00.000Z')).toContain('2026');
    expect(formatDateTime('not a date')).toBe('not a date');
  });
});

describe('deviceLossAction', () => {
  it('stops for system audio loss and microphone-only loss', () => {
    expect(deviceLossAction('system', 'both')).toBe('stop');
    expect(deviceLossAction('system', 'system')).toBe('stop');
    expect(deviceLossAction('microphone', 'microphone')).toBe('stop');
  });

  it('continues with system audio when the microphone is lost', () => {
    expect(deviceLossAction('microphone', 'both')).toBe('continue');
  });
});

describe('errorText', () => {
  it('extracts an error message or stringifies a value', () => {
    expect(errorText(new Error('failed'))).toBe('failed');
    expect(errorText('failed')).toBe('failed');
  });
});

describe('recordingErrorText', () => {
  it('maps microphone permission errors to a user message', () => {
    expect(
      recordingErrorText(new DOMException('denied', 'NotAllowedError')),
    ).toContain('マイクの使用が許可されていません');
  });

  it('maps missing devices and unreadable devices', () => {
    expect(recordingErrorText(new DOMException('missing', 'NotFoundError'))).toContain(
      '入力デバイスが見つかりません',
    );
    expect(recordingErrorText(new DOMException('busy', 'NotReadableError'))).toContain(
      '入力デバイスを開けませんでした',
    );
  });

  it('falls back to the original message', () => {
    expect(recordingErrorText(new Error('custom failure'))).toBe('custom failure');
  });
});
