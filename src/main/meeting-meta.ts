import { chmod, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ClippingConfig } from '../shared/clipping';
import type { SilenceConfig } from '../shared/silence';
import type {
  InputSource,
  MeetingStatus,
  RecordingCaptureStats,
  RecordingErrorInfo,
  RecordingEvent,
  SummaryLanguage,
} from '../shared/types';
import { WAV_BITS_PER_SAMPLE, WAV_CHANNELS } from './wav';

export const MEETING_META_SCHEMA_VERSION = 1;
const MAX_RECORDING_ERROR_MESSAGE_LENGTH = 2000;

export type MeetingMetaChunk = {
  sequence: number;
  file: string;
  frames: number;
  expected_frames: number;
};

export type MeetingMetaCaptureStats = {
  frames: number;
  expected_frames: number;
  gaps: number;
  max_gap_frames: number;
  missed_frames: number;
  sample_rate: number;
  channels: number;
  current_time: number;
};

export type MeetingMetaEncoding = {
  state: 'running' | 'completed' | 'failed';
  started_at: string;
  finished_at?: string;
  mp3_bitrate_kbps: number;
  error?: string;
};

export type MeetingMetaTranscription = {
  state:
    | 'running'
    | 'partial'
    | 'cancelled'
    | 'interrupted'
    | 'failed'
    | 'completed';
  started_at?: string;
  finished_at?: string;
  model?: string;
  language?: string;
  last_segment_end?: number;
  resume_count?: number;
  error?: string;
  partial?: boolean;
};

export type MeetingMetaSummary = {
  state: 'running' | 'completed' | 'failed';
  provider?: string;
  model?: string;
  language?: string;
  generated_at?: string;
  error?: string;
  usage?: {
    input_tokens: number | null;
    output_tokens: number | null;
  };
};

export type MeetingMetaTranslation = {
  state: 'running' | 'completed' | 'failed';
  provider?: string;
  model?: string;
  language?: SummaryLanguage;
  source_language?: string;
  generated_at?: string;
  partial?: boolean;
  error?: string;
};

export type MeetingMeta = {
  schema_version: typeof MEETING_META_SCHEMA_VERSION;
  id: string;
  status: MeetingStatus;
  title: string;
  started_at: string;
  ended_at?: string;
  duration: number;
  source: {
    input: InputSource;
    microphone?: string;
    system?: string;
  };
  sample_rate: number;
  channels: number;
  bits_per_sample: number;
  chunks: MeetingMetaChunk[];
  expected_samples: number;
  actual_samples: number;
  gap_samples?: number;
  events?: RecordingEvent[];
  clipping_config?: ClippingConfig;
  silence_config?: SilenceConfig;
  capture_stats?: MeetingMetaCaptureStats;
  audio_path?: string;
  app_version: string;
  waveform?: number[];
  encoding?: MeetingMetaEncoding;
  transcription?: MeetingMetaTranscription;
  summary?: MeetingMetaSummary;
  translations?: Partial<Record<SummaryLanguage, MeetingMetaTranslation>>;
  summary_language?: SummaryLanguage;
  pinned?: boolean;
  pinned_at?: string;
  error?: string;
  recording_error?: RecordingErrorInfo;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidMeetingId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function toMeetingMetaStats(stats: RecordingCaptureStats): MeetingMetaCaptureStats {
  return {
    frames: stats.frames,
    expected_frames: stats.expectedFrames,
    gaps: stats.gaps,
    max_gap_frames: stats.maxGapFrames,
    missed_frames: stats.missedFrames,
    sample_rate: stats.sampleRate,
    channels: stats.channels,
    current_time: stats.currentTime,
  };
}

export function validateMeetingMeta(meta: MeetingMeta): void {
  if (meta.schema_version !== MEETING_META_SCHEMA_VERSION) {
    throw new Error('unsupported meta schema version');
  }
  if (!isValidMeetingId(meta.id)) {
    throw new Error('invalid meeting id in meta');
  }
  if (!Number.isFinite(meta.sample_rate) || meta.sample_rate <= 0) {
    throw new Error('invalid sample rate in meta');
  }
  if (meta.channels !== WAV_CHANNELS || meta.bits_per_sample !== WAV_BITS_PER_SAMPLE) {
    throw new Error('unsupported audio format in meta');
  }
  if (!Number.isFinite(meta.duration) || meta.duration < 0) {
    throw new Error('invalid duration in meta');
  }
}

export function createRecordingError(
  message: string,
  at: Date | string,
): RecordingErrorInfo {
  return {
    message: message.trim().slice(0, MAX_RECORDING_ERROR_MESSAGE_LENGTH),
    at: typeof at === 'string' ? at : at.toISOString(),
  };
}

export function normalizeRecordingError(value: unknown): RecordingErrorInfo | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as { message?: unknown; at?: unknown };
  if (typeof candidate.message !== 'string') {
    return null;
  }
  const message = candidate.message.trim().slice(0, MAX_RECORDING_ERROR_MESSAGE_LENGTH);
  if (message.length === 0) {
    return null;
  }
  return {
    message,
    at: typeof candidate.at === 'string' ? candidate.at : '',
  };
}

export function recordingErrorFromMeta(meta: MeetingMeta): RecordingErrorInfo | null {
  const stored = normalizeRecordingError(meta.recording_error);
  if (stored) {
    return stored;
  }

  const events = Array.isArray(meta.events) ? meta.events : [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (typeof event !== 'object' || event === null) {
      continue;
    }
    const candidate = event as { severity?: unknown; message?: unknown; at?: unknown };
    if (candidate.severity !== 'error' || typeof candidate.message !== 'string') {
      continue;
    }
    const message = candidate.message
      .trim()
      .slice(0, MAX_RECORDING_ERROR_MESSAGE_LENGTH);
    if (message.length === 0) {
      continue;
    }
    return {
      message,
      at:
        typeof candidate.at === 'string' && candidate.at.length > 0
          ? candidate.at
          : meta.ended_at ?? meta.started_at,
    };
  }

  if (meta.status === 'error' && typeof meta.audio_path !== 'string') {
    return {
      message:
        '録音データが保存されなかったため、音声ファイルを作成できませんでした。入力デバイスと権限を確認して、もう一度録音してください。',
      at: meta.ended_at ?? meta.started_at,
    };
  }

  return null;
}

export async function readMeetingMeta(path: string): Promise<MeetingMeta> {
  const meta = JSON.parse(await readFile(path, 'utf8')) as MeetingMeta;
  validateMeetingMeta(meta);
  return meta;
}

export async function writeMeetingMeta(path: string, meta: MeetingMeta): Promise<void> {
  validateMeetingMeta(meta);
  const tempPath = `${path}.tmp`;
  const handle = await open(tempPath, 'w', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(meta, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(tempPath, 0o600);
  await rename(tempPath, path);
  await syncDirectory(dirname(path));
}

export async function updateMeetingMeta(
  path: string,
  updater: (meta: MeetingMeta) => void | Promise<void>,
): Promise<MeetingMeta> {
  const meta = await readMeetingMeta(path);
  await updater(meta);
  await writeMeetingMeta(path, meta);
  return meta;
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch {
    // Some file systems do not support fsync on a directory.
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
  }
}
