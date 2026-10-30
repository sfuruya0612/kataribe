import { open, readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type {
  InputSource,
  MeetingStatus,
  MeetingSummary,
  MeetingWaveform,
} from '../shared/types';

const MEETING_STATUSES: MeetingStatus[] = [
  'recording',
  'encoding',
  'transcribing',
  'transcribed',
  'summarized',
  'error',
];
const INPUT_SOURCES: InputSource[] = ['microphone', 'system', 'both'];

type Meta = {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  started_at?: unknown;
  duration?: unknown;
  sample_rate?: unknown;
  source?: { input?: unknown };
  chunks?: unknown;
  audio_path?: unknown;
};

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function toStatus(value: unknown): MeetingStatus {
  return MEETING_STATUSES.includes(value as MeetingStatus)
    ? (value as MeetingStatus)
    : 'error';
}

function toInputSource(value: unknown): InputSource | null {
  return INPUT_SOURCES.includes(value as InputSource)
    ? (value as InputSource)
    : null;
}

export class MeetingStore {
  private readonly saveRoot: string;

  constructor(saveRoot: string) {
    this.saveRoot = resolve(saveRoot);
  }

  async list(): Promise<MeetingSummary[]> {
    let years;
    try {
      years = await readdir(this.saveRoot, { withFileTypes: true });
    } catch {
      return [];
    }

    const meetings: MeetingSummary[] = [];
    for (const yearEntry of years) {
      if (!yearEntry.isDirectory() || !/^\d{4}$/.test(yearEntry.name)) {
        continue;
      }
      const yearRoot = join(this.saveRoot, yearEntry.name);
      let entries;
      try {
        entries = await readdir(yearRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const meetingDir = join(yearRoot, entry.name);
        try {
          const meta = JSON.parse(
            await readFile(join(meetingDir, 'meta.json'), 'utf8'),
          ) as Meta;
          const id = typeof meta.id === 'string' && meta.id.length > 0
            ? meta.id
            : entry.name;
          const sampleRate =
            typeof meta.sample_rate === 'number' && meta.sample_rate > 0
              ? meta.sample_rate
              : 48000;
          const actualSamples =
            typeof meta.duration === 'number' && Number.isFinite(meta.duration)
              ? meta.duration * sampleRate
              : 0;
          const duration =
            typeof meta.duration === 'number' && Number.isFinite(meta.duration)
              ? Math.max(0, meta.duration)
              : actualSamples / sampleRate;
          const audioPath = join(meetingDir, 'audio.wav');
          let hasAudio = false;
          try {
            hasAudio = (await stat(audioPath)).isFile();
          } catch {
            hasAudio = false;
          }
          meetings.push({
            id,
            title:
              typeof meta.title === 'string' && meta.title.length > 0
                ? meta.title
                : 'タイトル未入力',
            meetingDir,
            startedAt:
              typeof meta.started_at === 'string' ? meta.started_at : '',
            duration,
            status: toStatus(meta.status),
            inputSource: toInputSource(meta.source?.input),
            sampleRate,
            audioUrl: hasAudio
              ? `kataribe-audio://meeting/${encodeURIComponent(id)}`
              : null,
            chunkCount: Array.isArray(meta.chunks) ? meta.chunks.length : 0,
          });
        } catch {
          // Ignore folders without a readable meta.json.
        }
      }
    }

    meetings.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    return meetings;
  }

  async find(meetingId: string): Promise<MeetingSummary | null> {
    const meetings = await this.list();
    return meetings.find((meeting) => meeting.id === meetingId) ?? null;
  }

  async audioPath(meetingId: string): Promise<string | null> {
    const meeting = await this.find(meetingId);
    if (!meeting) {
      return null;
    }
    const audioPath = join(meeting.meetingDir, 'audio.wav');
    if (!isInside(this.saveRoot, audioPath)) {
      return null;
    }
    try {
      return (await stat(audioPath)).isFile() ? audioPath : null;
    } catch {
      return null;
    }
  }

  async waveform(meetingId: string, bars = 96): Promise<MeetingWaveform> {
    const audioPath = await this.audioPath(meetingId);
    if (!audioPath) {
      return { peaks: [], duration: 0 };
    }

    const handle = await open(audioPath, 'r');
    try {
      const header = Buffer.alloc(44);
      await handle.read(header, 0, 44, 0);
      if (
        header.toString('ascii', 0, 4) !== 'RIFF' ||
        header.toString('ascii', 8, 12) !== 'WAVE' ||
        header.toString('ascii', 36, 40) !== 'data'
      ) {
        return { peaks: [], duration: 0 };
      }
      const channels = header.readUInt16LE(22);
      const sampleRate = header.readUInt32LE(24);
      const bitsPerSample = header.readUInt16LE(34);
      const dataSize = header.readUInt32LE(40);
      if (
        channels !== 1 ||
        bitsPerSample !== 16 ||
        sampleRate <= 0 ||
        dataSize <= 0
      ) {
        return { peaks: [], duration: 0 };
      }

      const frames = Math.floor(dataSize / 2);
      const barCount = Math.min(160, Math.max(24, Math.round(bars)));
      const framesPerBar = Math.max(1, Math.floor(frames / barCount));
      const readFrames = Math.min(8192, framesPerBar);
      const peaks: number[] = [];
      const buffer = Buffer.alloc(readFrames * 2);

      for (let index = 0; index < barCount; index += 1) {
        const startFrame = index * framesPerBar;
        const result = await handle.read(
          buffer,
          0,
          readFrames * 2,
          44 + startFrame * 2,
        );
        let peak = 0;
        for (let offset = 0; offset + 1 < result.bytesRead; offset += 2) {
          peak = Math.max(peak, Math.abs(buffer.readInt16LE(offset)) / 32768);
        }
        peaks.push(peak);
      }

      const maxPeak = Math.max(...peaks);
      return {
        peaks:
          maxPeak > 0.0001
            ? peaks.map((peak) => Math.min(1, peak / maxPeak))
            : peaks,
        duration: frames / sampleRate,
      };
    } finally {
      await handle.close();
    }
  }
}
