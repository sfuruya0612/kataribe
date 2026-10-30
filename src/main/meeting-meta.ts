import { chmod, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ClippingConfig } from '../shared/clipping';
import type { SilenceConfig } from '../shared/silence';
import type {
  InputSource,
  MeetingStatus,
  RecordingCaptureStats,
  RecordingEvent,
} from '../shared/types';
import { WAV_BITS_PER_SAMPLE, WAV_CHANNELS } from './wav';

export const MEETING_META_SCHEMA_VERSION = 1;

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
  error?: string;
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
