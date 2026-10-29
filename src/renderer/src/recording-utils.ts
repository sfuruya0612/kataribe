import type { InputSource, RecordingCaptureStats } from '../../shared/types';

export type InputDevice = {
  deviceId: string;
  label: string;
};

const BLACKHOLE_PATTERN = /blackhole/i;
const BLACKHOLE_CHANNEL_PATTERN = /\b(2|16|64)ch\b/i;
const AGGREGATE_DEVICE_IDS = new Set(['default', 'communications']);

export function isBlackHoleDevice(label: string): boolean {
  return BLACKHOLE_PATTERN.test(label);
}

export function blackHolePriority(label: string): number {
  const match = label.match(BLACKHOLE_CHANNEL_PATTERN);
  if (!match) {
    return 3;
  }
  switch (match[1]) {
    case '2':
      return 0;
    case '16':
      return 1;
    case '64':
      return 2;
    default:
      return 3;
  }
}

export function splitInputDevices(devices: InputDevice[]): {
  microphones: InputDevice[];
  systemDevices: InputDevice[];
} {
  const seen = new Set<string>();
  const microphones: InputDevice[] = [];
  const systemDevices: InputDevice[] = [];

  for (const device of devices) {
    if (!device.deviceId || AGGREGATE_DEVICE_IDS.has(device.deviceId)) {
      continue;
    }
    if (seen.has(device.deviceId)) {
      continue;
    }
    seen.add(device.deviceId);
    if (isBlackHoleDevice(device.label)) {
      systemDevices.push(device);
    } else {
      microphones.push(device);
    }
  }

  systemDevices.sort((left, right) => {
    const priority = blackHolePriority(left.label) - blackHolePriority(right.label);
    return priority !== 0 ? priority : left.label.localeCompare(right.label);
  });

  return { microphones, systemDevices };
}

export function pickDeviceId(devices: InputDevice[], currentId: string): string {
  if (currentId && devices.some((device) => device.deviceId === currentId)) {
    return currentId;
  }
  return devices[0]?.deviceId ?? '';
}

export function deviceLabel(device: InputDevice | undefined, fallback: string): string {
  if (!device) {
    return fallback;
  }
  return device.label || fallback;
}

export function buildAudioConstraints(
  deviceId: string,
  channelCount: number,
): MediaStreamConstraints {
  return {
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: channelCount },
    },
    video: false,
  };
}

export function formatDuration(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(remainder).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function levelPercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  const db = 20 * Math.log10(Math.min(1, value));
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

export function formatLevel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '-inf dB';
  }
  return `${(20 * Math.log10(Math.min(1, value))).toFixed(1)} dB`;
}

export function frameClockDeltaSeconds(stats: RecordingCaptureStats): number {
  if (!Number.isFinite(stats.sampleRate) || stats.sampleRate <= 0) {
    return 0;
  }
  return Math.abs(stats.currentTime - stats.frames / stats.sampleRate);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function inputSourceLabel(source: InputSource): string {
  switch (source) {
    case 'microphone':
      return 'マイク';
    case 'system':
      return 'システム音声';
    case 'both':
      return 'マイク + システム音声';
  }
}

export function isClipping(peak: number): boolean {
  return Number.isFinite(peak) && peak >= 0.99;
}

export function deviceLossAction(
  role: 'microphone' | 'system',
  source: InputSource,
): 'continue' | 'stop' {
  if (role === 'system') {
    return 'stop';
  }
  return source === 'microphone' ? 'stop' : 'continue';
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function recordingErrorText(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return 'マイクの使用が許可されていません。システム設定の「プライバシーとセキュリティ」>「マイク」で Kataribe を許可してください。';
      case 'NotFoundError':
        return '選択した入力デバイスが見つかりません。デバイスを接続してから再試行してください。';
      case 'NotReadableError':
        return '入力デバイスを開けませんでした。他のアプリが使用していないか確認してください。';
      case 'OverconstrainedError':
        return '選択した入力デバイスの設定に対応できません。別のデバイスを選んでください。';
      default:
        break;
    }
  }
  return errorText(error);
}
