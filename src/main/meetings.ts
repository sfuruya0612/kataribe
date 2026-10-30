import { open, readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  detectSummaryLanguage,
  frontMatterString,
  parseFrontMatter,
  type FrontMatterValue,
} from '../shared/markdown';
import type {
  MeetingDetail,
  MeetingStatus,
  MeetingSummary,
  MeetingWaveform,
  SummaryDocument,
  TranscriptDocument,
} from '../shared/types';
import { readMeetingMeta, type MeetingMeta } from './meeting-meta';
import { readWavInfo } from './wav';

const MEETING_STATUSES: MeetingStatus[] = [
  'recording',
  'encoding',
  'transcribing',
  'transcribed',
  'summarized',
  'error',
];
const INPUT_SOURCES = ['microphone', 'system', 'both'] as const;

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function toStatus(value: unknown): MeetingStatus {
  return MEETING_STATUSES.includes(value as MeetingStatus)
    ? (value as MeetingStatus)
    : 'error';
}

function toInputSource(value: unknown): MeetingSummary['inputSource'] {
  return INPUT_SOURCES.includes(value as (typeof INPUT_SOURCES)[number])
    ? (value as MeetingSummary['inputSource'])
    : null;
}

function asString(value: FrontMatterValue | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asBoolean(value: FrontMatterValue | undefined): boolean {
  return value === true;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function fileUpdatedAt(path: string): Promise<string | null> {
  try {
    return (await stat(path)).mtime.toISOString();
  } catch {
    return null;
  }
}

function audioCandidate(meta: MeetingMeta, name: string): string | null {
  if (
    name === 'audio.mp3' ||
    name === 'audio.wav' ||
    (typeof meta.audio_path === 'string' &&
      /^audio[\w.-]*\.(mp3|wav)$/i.test(meta.audio_path) &&
      name === meta.audio_path)
  ) {
    return name;
  }
  return null;
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
          const meta = await readMeetingMeta(join(meetingDir, 'meta.json'));
          const id =
            typeof meta.id === 'string' && meta.id.length > 0 ? meta.id : entry.name;
          const sampleRate =
            typeof meta.sample_rate === 'number' && meta.sample_rate > 0
              ? meta.sample_rate
              : 48000;
          const duration =
            typeof meta.duration === 'number' && Number.isFinite(meta.duration)
              ? Math.max(0, meta.duration)
              : 0;
          const audio = await this.locateAudio(meta, meetingDir);
          const transcriptPath = join(meetingDir, 'transcript.md');
          const summaryPath = join(meetingDir, 'summary.md');
          const hasTranscript = await fileExists(transcriptPath);
          const hasSummary = await fileExists(summaryPath);
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
            audioUrl:
              audio === null
                ? null
                : `kataribe-audio://meeting/${encodeURIComponent(id)}`,
            chunkCount: Array.isArray(meta.chunks) ? meta.chunks.length : 0,
            hasTranscript,
            hasSummary,
            transcriptPartial:
              meta.transcription?.partial === true || meta.transcription?.state === 'partial',
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

  async detail(meetingId: string): Promise<MeetingDetail | null> {
    const meeting = await this.find(meetingId);
    if (!meeting) {
      return null;
    }
    return {
      meeting,
      transcript: await this.readTranscript(meeting),
      summary: await this.readSummary(meeting),
    };
  }

  async readTranscript(
    meeting: MeetingSummary,
  ): Promise<TranscriptDocument | null> {
    const path = join(meeting.meetingDir, 'transcript.md');
    let markdown: string;
    try {
      markdown = await readFile(path, 'utf8');
    } catch {
      return null;
    }
    const parsed = parseFrontMatter(markdown);
    return {
      markdown,
      body: parsed.body,
      language: frontMatterString(parsed, 'language'),
      model: frontMatterString(parsed, 'model'),
      partial: asBoolean(parsed.frontMatter.partial) || meeting.transcriptPartial,
      updatedAt: await fileUpdatedAt(path),
    };
  }

  async readSummary(meeting: MeetingSummary): Promise<SummaryDocument | null> {
    const path = join(meeting.meetingDir, 'summary.md');
    let markdown: string;
    try {
      markdown = await readFile(path, 'utf8');
    } catch {
      return null;
    }
    const parsed = parseFrontMatter(markdown);
    return {
      markdown,
      body: parsed.body,
      language:
        frontMatterString(parsed, 'language') ?? detectSummaryLanguage(markdown),
      provider: frontMatterString(parsed, 'provider'),
      model: asString(parsed.frontMatter.model),
      generatedAt: frontMatterString(parsed, 'generated_at'),
      updatedAt: await fileUpdatedAt(path),
    };
  }

  async audioPath(meetingId: string): Promise<string | null> {
    const meeting = await this.find(meetingId);
    if (!meeting) {
      return null;
    }
    const meta = await readMeetingMeta(join(meeting.meetingDir, 'meta.json'));
    const audio = await this.locateAudio(meta, meeting.meetingDir);
    return audio?.path ?? null;
  }

  async waveform(meetingId: string, bars = 96): Promise<MeetingWaveform> {
    const meeting = await this.find(meetingId);
    if (!meeting) {
      return { peaks: [], duration: 0 };
    }
    let meta: MeetingMeta;
    try {
      meta = await readMeetingMeta(join(meeting.meetingDir, 'meta.json'));
    } catch {
      return { peaks: [], duration: 0 };
    }
    if (Array.isArray(meta.waveform) && meta.waveform.length >= 8) {
      const peaks = meta.waveform.filter(
        (value) => typeof value === 'number' && Number.isFinite(value),
      );
      if (peaks.length >= 8) {
        return {
          peaks: resamplePeaks(peaks, bars),
          duration: meta.duration,
        };
      }
    }
    const audio = await this.locateAudio(meta, meeting.meetingDir);
    if (!audio || !audio.path.toLowerCase().endsWith('.wav')) {
      return { peaks: [], duration: meta.duration };
    }
    return this.waveformFromWav(audio.path, meta.duration, bars);
  }

  private async locateAudio(
    meta: MeetingMeta,
    meetingDir: string,
  ): Promise<{ path: string; name: string } | null> {
    const candidates = [
      typeof meta.audio_path === 'string' ? meta.audio_path : null,
      'audio.mp3',
      'audio.wav',
    ];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      if (!audioCandidate(meta, candidate)) {
        continue;
      }
      const path = join(meetingDir, candidate);
      if (!isInside(this.saveRoot, path)) {
        continue;
      }
      if (await fileExists(path)) {
        return { path, name: candidate };
      }
    }
    return null;
  }

  private async waveformFromWav(
    audioPath: string,
    fallbackDuration: number,
    bars: number,
  ): Promise<MeetingWaveform> {
    let info;
    try {
      info = await readWavInfo(audioPath);
    } catch {
      return { peaks: [], duration: fallbackDuration };
    }
    if (
      info.channels !== 1 ||
      info.bitsPerSample !== 16 ||
      info.sampleRate <= 0 ||
      info.dataSize <= 0
    ) {
      return { peaks: [], duration: fallbackDuration };
    }

    const handle = await open(audioPath, 'r');
    try {
      const frames = Math.floor(info.dataSize / 2);
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
          info.dataOffset + startFrame * 2,
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
        duration: frames / info.sampleRate,
      };
    } finally {
      await handle.close();
    }
  }
}

function resamplePeaks(peaks: number[], bars: number): number[] {
  const count = Math.min(160, Math.max(24, Math.round(bars)));
  if (peaks.length === count) {
    return peaks;
  }
  const result: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor((index / count) * peaks.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / count) * peaks.length));
    const slice = peaks.slice(start, end);
    result.push(slice.length > 0 ? Math.max(...slice) : 0);
  }
  return result;
}
