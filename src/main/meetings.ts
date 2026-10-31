import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  detectSummaryLanguage,
  frontMatterString,
  parseFrontMatter,
  stringifyFrontMatter,
  type FrontMatterValue,
} from '../shared/markdown';
import { sanitizeMeetingTitle } from '../shared/title';
import type {
  MeetingDetail,
  MeetingSearchHit,
  MeetingSearchResult,
  MeetingStatus,
  MeetingSummary,
  MeetingWaveform,
  SummaryDocument,
  SummaryLanguage,
  TranscriptDocument,
  TranscriptTranslation,
} from '../shared/types';
import {
  readMeetingMeta,
  updateMeetingMeta,
  writeMeetingMeta,
  type MeetingMeta,
} from './meeting-meta';
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
const TRANSLATION_FILES: Array<{ language: SummaryLanguage; file: string }> = [
  { language: 'ja', file: 'transcript.ja.md' },
  { language: 'en', file: 'transcript.en.md' },
];

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

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writePrivateMarkdown(path: string, markdown: string): Promise<void> {
  const tempPath = `${path}.tmp`;
  const handle = await open(tempPath, 'w', 0o600);
  try {
    await handle.writeFile(markdown);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, path);
}

async function replaceFrontMatterTitle(
  path: string,
  title: string,
): Promise<void> {
  let markdown: string;
  try {
    markdown = await readFile(path, 'utf8');
  } catch {
    return;
  }
  const parsed = parseFrontMatter(markdown);
  if (!parsed.hasFrontMatter) {
    return;
  }
  await writePrivateMarkdown(
    path,
    stringifyFrontMatter({ ...parsed.frontMatter, title }, parsed.body),
  );
}

const SEARCH_FILES: Array<{
  file: string;
  kind: MeetingSearchHit['kind'];
  kindLabel: string;
}> = [
  { file: 'transcript.md', kind: 'transcript', kindLabel: '文字起こし' },
  {
    file: 'transcript.ja.md',
    kind: 'translation-ja',
    kindLabel: '文字起こし（日本語訳）',
  },
  {
    file: 'transcript.en.md',
    kind: 'translation-en',
    kindLabel: '文字起こし（English）',
  },
  { file: 'summary.md', kind: 'summary', kindLabel: '要約' },
];

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
  private saveRoot: string;

  constructor(saveRoot: string) {
    this.saveRoot = resolve(saveRoot);
  }

  getSaveRoot(): string {
    return this.saveRoot;
  }

  setSaveRoot(saveRoot: string): void {
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
          const translationLanguages: SummaryLanguage[] = [];
          for (const translation of TRANSLATION_FILES) {
            if (await fileExists(join(meetingDir, translation.file))) {
              translationLanguages.push(translation.language);
            }
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
            audioUrl:
              audio === null
                ? null
                : `kataribe-audio://meeting/${encodeURIComponent(id)}`,
            chunkCount: Array.isArray(meta.chunks) ? meta.chunks.length : 0,
            hasTranscript,
            hasSummary,
            transcriptPartial:
              meta.transcription?.partial === true || meta.transcription?.state === 'partial',
            translationLanguages,
            summaryLanguage:
              meta.summary_language === 'ja' || meta.summary_language === 'en'
                ? meta.summary_language
                : null,
            pinned: meta.pinned === true,
          });
        } catch {
          // Ignore folders without a readable meta.json.
        }
      }
    }

    meetings.sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        right.startedAt.localeCompare(left.startedAt),
    );
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
    const translations: Partial<Record<SummaryLanguage, TranscriptTranslation>> = {};
    for (const entry of TRANSLATION_FILES) {
      const translation = await this.readTranslation(meeting, entry.language);
      if (translation) {
        translations[entry.language] = translation;
      }
    }
    return {
      meeting,
      transcript: await this.readTranscript(meeting),
      summary: await this.readSummary(meeting),
      translations,
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

  async readTranslation(
    meeting: MeetingSummary,
    language: SummaryLanguage,
  ): Promise<TranscriptTranslation | null> {
    const entry = TRANSLATION_FILES.find((item) => item.language === language);
    if (!entry) {
      return null;
    }
    const path = join(meeting.meetingDir, entry.file);
    let markdown: string;
    try {
      markdown = await readFile(path, 'utf8');
    } catch {
      return null;
    }
    const parsed = parseFrontMatter(markdown);
    return {
      language,
      sourceLanguage: frontMatterString(parsed, 'source_language'),
      markdown,
      body: parsed.body,
      provider: frontMatterString(parsed, 'provider'),
      model: asString(parsed.frontMatter.model),
      generatedAt: frontMatterString(parsed, 'generated_at'),
      updatedAt: await fileUpdatedAt(path),
      partial: asBoolean(parsed.frontMatter.partial),
    };
  }

  async search(query: string, limit = 100): Promise<MeetingSearchResult> {
    const normalizedQuery = query
      .normalize('NFKC')
      .toLocaleLowerCase('ja-JP')
      .trim();
    if (normalizedQuery.length < 2) {
      return { query, hits: [], truncated: false };
    }
    const meetings = await this.list();
    const hits: MeetingSearchHit[] = [];
    let truncated = false;

    outer: for (const meeting of meetings) {
      if (
        meeting.title
          .normalize('NFKC')
          .toLocaleLowerCase('ja-JP')
          .includes(normalizedQuery)
      ) {
        hits.push({
          meetingId: meeting.id,
          title: meeting.title,
          startedAt: meeting.startedAt,
          kind: 'title',
          kindLabel: 'タイトル',
          lineNumber: null,
          timestamp: null,
          text: meeting.title,
        });
        if (hits.length >= limit) {
          truncated = true;
          break;
        }
      }

      for (const entry of SEARCH_FILES) {
        if (!(await fileExists(join(meeting.meetingDir, entry.file)))) {
          continue;
        }
        let markdown: string;
        try {
          markdown = await readFile(join(meeting.meetingDir, entry.file), 'utf8');
        } catch {
          continue;
        }
        const body = parseFrontMatter(markdown).body;
        const lines = body.replaceAll('\r\n', '\n').split('\n');
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          if (
            !line
              .normalize('NFKC')
              .toLocaleLowerCase('ja-JP')
              .includes(normalizedQuery)
          ) {
            continue;
          }
          const timestamp = line.match(/^\[(\d{2}:\d{2}:\d{2})\]/u)?.[1] ?? null;
          hits.push({
            meetingId: meeting.id,
            title: meeting.title,
            startedAt: meeting.startedAt,
            kind: entry.kind,
            kindLabel: entry.kindLabel,
            lineNumber: index + 1,
            timestamp,
            text: line.trim().slice(0, 500),
          });
          if (hits.length >= limit) {
            truncated = true;
            break outer;
          }
        }
      }
    }

    return { query, hits, truncated };
  }

  async importAudio(
    sourcePath: string,
    appVersion: string,
  ): Promise<MeetingSummary> {
    const extension = extname(sourcePath).toLowerCase();
    if (extension !== '.mp3' && extension !== '.wav') {
      throw new Error('mp3 または wav を選択してください。');
    }
    const info = await stat(sourcePath);
    if (!info.isFile() || info.size <= 0) {
      throw new Error('音声ファイルが空です。');
    }
    const title = sanitizeMeetingTitle(
      basename(sourcePath, extension),
      '取り込んだ音声',
    );
    const now = new Date();
    const year = String(now.getFullYear());
    const date = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const base = `${date}_${time}_${title}`;
    const yearRoot = join(this.saveRoot, year);
    await mkdir(yearRoot, { recursive: true, mode: 0o700 });
    let meetingDir = join(yearRoot, base);
    let index = 2;
    while (await pathExists(meetingDir)) {
      meetingDir = join(yearRoot, `${base}_${index}`);
      index += 1;
    }
    await mkdir(meetingDir, { mode: 0o700 });
    await chmod(meetingDir, 0o700);

    const fileName = extension === '.mp3' ? 'audio.mp3' : 'audio.wav';
    const meetingId = randomUUID();
    const meta: MeetingMeta = {
      schema_version: 1,
      id: meetingId,
      status: 'encoding',
      title,
      started_at: now.toISOString(),
      duration: 0,
      source: { input: 'both' },
      sample_rate: 48000,
      channels: 1,
      bits_per_sample: 16,
      chunks: [],
      expected_samples: 0,
      actual_samples: 0,
      app_version: appVersion,
      audio_path: fileName,
    };
    try {
      const target = join(meetingDir, fileName);
      await copyFile(sourcePath, target);
      await chmod(target, 0o600);
      await writeMeetingMeta(join(meetingDir, 'meta.json'), meta);
    } catch (error) {
      await rm(meetingDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    const imported = await this.find(meetingId);
    if (!imported) {
      throw new Error('取り込んだ会議が見つかりません。');
    }
    return imported;
  }

  async setPinned(meetingId: string, pinned: boolean): Promise<MeetingSummary> {
    const meeting = await this.find(meetingId);
    if (!meeting) {
      throw new Error('会議が見つかりません。');
    }
    await updateMeetingMeta(join(meeting.meetingDir, 'meta.json'), (meta) => {
      if (pinned) {
        meta.pinned = true;
        meta.pinned_at = new Date().toISOString();
      } else {
        delete meta.pinned;
        delete meta.pinned_at;
      }
    });
    const updated = await this.find(meetingId);
    if (!updated) {
      throw new Error('会議の更新後に会議が見つかりません。');
    }
    return updated;
  }

  async delete(meetingId: string): Promise<void> {
    const meeting = await this.find(meetingId);
    if (!meeting) {
      throw new Error('会議が見つかりません。');
    }
    if (!isInside(this.saveRoot, meeting.meetingDir)) {
      throw new Error('会議フォルダが保存先の外にあります。');
    }
    await rm(meeting.meetingDir, { recursive: true, force: true });
  }

  async setSummaryLanguage(
    meetingId: string,
    language: SummaryLanguage | null,
  ): Promise<MeetingSummary> {
    const meeting = await this.find(meetingId);
    if (!meeting) {
      throw new Error('会議が見つかりません。');
    }
    if (language !== null && language !== 'ja' && language !== 'en') {
      throw new Error('summary language is invalid');
    }
    await updateMeetingMeta(join(meeting.meetingDir, 'meta.json'), (meta) => {
      if (language === null) {
        delete meta.summary_language;
      } else {
        meta.summary_language = language;
      }
    });
    const updated = await this.find(meetingId);
    if (!updated) {
      throw new Error('会議の更新後に会議が見つかりません。');
    }
    return updated;
  }

  async updateTitle(meetingId: string, rawTitle: string): Promise<MeetingSummary> {    const meeting = await this.find(meetingId);
    if (!meeting) {
      throw new Error('会議が見つかりません。');
    }
    const title = sanitizeMeetingTitle(rawTitle);
    const parent = dirname(meeting.meetingDir);
    const currentName = basename(meeting.meetingDir);
    const prefixMatch = currentName.match(/^(\d{4}-\d{2}-\d{2}_\d{4})_/u);
    const prefix = prefixMatch?.[1] ?? currentName.replace(/_.*$/u, '');
    const baseName = `${prefix}_${title}`;

    let targetDir = join(parent, baseName);
    let index = 2;
    while (targetDir !== meeting.meetingDir && (await pathExists(targetDir))) {
      targetDir = join(parent, `${baseName}_${index}`);
      index += 1;
    }
    if (!isInside(this.saveRoot, targetDir)) {
      throw new Error('会議フォルダのパスが保存先の外になります。');
    }

    const renamed = targetDir !== meeting.meetingDir;
    if (renamed) {
      await rename(meeting.meetingDir, targetDir);
    }

    try {
      const metaPath = join(targetDir, 'meta.json');
      await updateMeetingMeta(metaPath, (meta) => {
        meta.title = title;
      });
      for (const name of [
        'transcript.md',
        'transcript.ja.md',
        'transcript.en.md',
        'summary.md',
        'summary.previous.md',
      ]) {
        await replaceFrontMatterTitle(join(targetDir, name), title);
      }
    } catch (error) {
      if (renamed) {
        await rename(targetDir, meeting.meetingDir).catch((rollbackError: unknown) => {
          console.error(
            `failed to roll back meeting folder rename: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          );
        });
      }
      throw error;
    }

    const updated = await this.find(meetingId);
    if (!updated) {
      throw new Error('会議の更新後に会議が見つかりません。');
    }
    return updated;
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
