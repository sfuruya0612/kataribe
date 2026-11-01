import { createHash } from 'node:crypto';
import { chmod, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  parseFrontMatter,
  parseTranscriptBody,
} from '../shared/markdown';
import type {
  MeetingDetail,
  MeetingSearchHit,
  MeetingSearchResult,
  MeetingStatus,
  MeetingSummary,
  SummaryLanguage,
} from '../shared/types';
import type { MeetingStore } from './meetings';

function indexFileName(saveRoot: string): string {
  const digest = createHash('sha256').update(saveRoot).digest('hex').slice(0, 24);
  return `${digest}.sqlite`;
}

type MeetingRow = {
  id: string;
  title: string;
  meeting_dir: string;
  started_at: string;
  duration: number;
  status: string;
  input_source: string | null;
  sample_rate: number;
  audio_url: string | null;
  chunk_count: number;
  has_transcript: number;
  has_summary: number;
  transcript_partial: number;
  translation_languages: string;
  summary_language: string | null;
  pinned: number;
};

function rowToMeeting(row: MeetingRow): MeetingSummary {
  let translations: SummaryLanguage[] = [];
  try {
    const parsed = JSON.parse(row.translation_languages) as unknown;
    if (Array.isArray(parsed)) {
      translations = parsed.filter(
        (value): value is SummaryLanguage => value === 'ja' || value === 'en',
      );
    }
  } catch {
    translations = [];
  }
  return {
    id: row.id,
    title: row.title,
    meetingDir: row.meeting_dir,
    startedAt: row.started_at,
    duration: row.duration,
    status: row.status as MeetingStatus,
    inputSource:
      row.input_source === 'microphone' ||
      row.input_source === 'system' ||
      row.input_source === 'both'
        ? row.input_source
        : null,
    sampleRate: row.sample_rate,
    audioUrl: row.audio_url,
    chunkCount: row.chunk_count,
    hasTranscript: row.has_transcript === 1,
    hasSummary: row.has_summary === 1,
    transcriptPartial: row.transcript_partial === 1,
    translationLanguages: translations,
    summaryLanguage:
      row.summary_language === 'ja' || row.summary_language === 'en'
        ? row.summary_language
        : null,
    pinned: row.pinned === 1,
  };
}

export class MeetingSearchIndex {
  private readonly dbPath: string;
  private readonly saveRoot: string;
  private db: DatabaseSync;
  private ready = false;

  private constructor(dbPath: string, saveRoot: string, db: DatabaseSync) {
    this.dbPath = dbPath;
    this.saveRoot = saveRoot;
    this.db = db;
  }

  static async open(indexRoot: string, saveRoot: string): Promise<MeetingSearchIndex> {
    await mkdir(indexRoot, { recursive: true, mode: 0o700 });
    await chmod(indexRoot, 0o700);
    const dbPath = join(indexRoot, indexFileName(saveRoot));
    let db = new DatabaseSync(dbPath);
    try {
      db.exec('PRAGMA quick_check');
    } catch {
      db.close();
      await rename(dbPath, `${dbPath}.broken-${Date.now()}`).catch(() => undefined);
      db = new DatabaseSync(dbPath);
    }
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        meeting_dir TEXT NOT NULL,
        started_at TEXT NOT NULL,
        duration REAL NOT NULL,
        status TEXT NOT NULL,
        input_source TEXT,
        sample_rate INTEGER NOT NULL,
        audio_url TEXT,
        chunk_count INTEGER NOT NULL,
        has_transcript INTEGER NOT NULL,
        has_summary INTEGER NOT NULL,
        transcript_partial INTEGER NOT NULL,
        translation_languages TEXT NOT NULL,
        summary_language TEXT,
        pinned INTEGER NOT NULL DEFAULT 0
      )
    `);
    const columns = db
      .prepare('PRAGMA table_info(meetings)')
      .all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'pinned')) {
      db.exec('ALTER TABLE meetings ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
    }
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_entries USING fts5(
        meeting_id UNINDEXED,
        kind UNINDEXED,
        line_number UNINDEXED,
        timestamp UNINDEXED,
        body,
        tokenize = 'trigram'
      )
    `);
    const index = new MeetingSearchIndex(dbPath, saveRoot, db);
    await index.secureFiles();
    return index;
  }

  isReady(): boolean {
    return this.ready;
  }

  private async secureFiles(): Promise<void> {
    await chmod(this.dbPath, 0o600).catch(() => undefined);
    await chmod(`${this.dbPath}-wal`, 0o600).catch(() => undefined);
    await chmod(`${this.dbPath}-shm`, 0o600).catch(() => undefined);
    await chmod(dirname(this.dbPath), 0o700).catch(() => undefined);
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // The database may already be closed.
    }
  }

  async rebuild(store: MeetingStore): Promise<void> {
    const meetings = await store.list();
    const detailEntries: Array<{ meeting: MeetingSummary; detail: MeetingDetail | null }> = [];
    for (const meeting of meetings) {
      detailEntries.push({
        meeting,
        detail: await store.detail(meeting.id),
      });
    }
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM meetings');
      this.db.exec('DELETE FROM search_entries');
      for (const entry of detailEntries) {
        this.upsert(entry.meeting, entry.detail);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.ready = true;
    await this.secureFiles();
  }

  async refresh(store: MeetingStore, meetingId: string): Promise<void> {
    const meeting = await store.find(meetingId);
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM meetings WHERE id = ?').run(meetingId);
      this.db.prepare('DELETE FROM search_entries WHERE meeting_id = ?').run(meetingId);
      if (meeting) {
        this.upsert(meeting, await store.detail(meetingId));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    await this.secureFiles();
  }

  list(): MeetingSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM meetings ORDER BY pinned DESC, started_at DESC')
      .all() as unknown as MeetingRow[];
    return rows.map(rowToMeeting);
  }

  search(query: string, limit = 100): MeetingSearchResult {
    const normalized = query.normalize('NFKC').trim();
    if (normalized.length < 2) {
      return { query, hits: [], truncated: false };
    }
    const fetchLimit = Math.max(1, Math.min(500, limit)) + 1;
    let rows: Array<{
      meeting_id: string;
      title: string;
      started_at: string;
      kind: MeetingSearchHit['kind'];
      line_number: number | null;
      timestamp: string | null;
      body: string;
    }>;
    if ([...normalized].length >= 3) {
      const match = `"${normalized.replaceAll('"', '""')}"`;
      rows = this.db
        .prepare(
          `SELECT search_entries.meeting_id, m.title, m.started_at,
                  search_entries.kind, search_entries.line_number,
                  search_entries.timestamp, search_entries.body
           FROM search_entries JOIN meetings m ON m.id = search_entries.meeting_id
           WHERE search_entries MATCH ?
           ORDER BY m.started_at DESC
           LIMIT ?`,
        )
        .all(match, fetchLimit) as unknown as typeof rows;
    } else {
      rows = this.db
        .prepare(
          `SELECT search_entries.meeting_id, m.title, m.started_at,
                  search_entries.kind, search_entries.line_number,
                  search_entries.timestamp, search_entries.body
           FROM search_entries JOIN meetings m ON m.id = search_entries.meeting_id
           WHERE search_entries.body LIKE ?
           ORDER BY m.started_at DESC
           LIMIT ?`,
        )
        .all(`%${normalized}%`, fetchLimit) as unknown as typeof rows;
    }

    const truncated = rows.length > limit;
    return {
      query,
      hits: rows.slice(0, limit).map((row) => ({
        meetingId: row.meeting_id,
        title: row.title,
        startedAt: row.started_at,
        kind: row.kind,
        lineNumber: row.line_number,
        timestamp: row.timestamp,
        text: row.body,
      })),
      truncated,
    };
  }

  private upsert(meeting: MeetingSummary, detail: MeetingDetail | null): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO meetings
         (id, title, meeting_dir, started_at, duration, status, input_source,
          sample_rate, audio_url, chunk_count, has_transcript, has_summary,
          transcript_partial, translation_languages, summary_language, pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        meeting.id,
        meeting.title,
        meeting.meetingDir,
        meeting.startedAt,
        meeting.duration,
        meeting.status,
        meeting.inputSource,
        meeting.sampleRate,
        meeting.audioUrl,
        meeting.chunkCount,
        meeting.hasTranscript ? 1 : 0,
        meeting.hasSummary ? 1 : 0,
        meeting.transcriptPartial ? 1 : 0,
        JSON.stringify(meeting.translationLanguages),
        meeting.summaryLanguage,
        meeting.pinned ? 1 : 0,
      );

    const insert = this.db.prepare(
      `INSERT INTO search_entries
       (meeting_id, kind, line_number, timestamp, body)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run(meeting.id, 'title', null, null, meeting.title);

    const addDocument = (
      kind: MeetingSearchHit['kind'],
      markdown: string,
    ) => {
      const body = parseFrontMatter(markdown).body;
      for (const line of parseTranscriptBody(body)) {
        const trimmed = line.text.trim();
        if (!trimmed) {
          continue;
        }
        insert.run(
          meeting.id,
          kind,
          line.lineNumber,
          line.startSeconds === null ? null : formatTimestamp(line.startSeconds),
          trimmed,
        );
      }
    };

    if (detail?.transcript) {
      addDocument('transcript', detail.transcript.markdown);
    }
    if (detail?.translations.ja) {
      addDocument('translation-ja', detail.translations.ja.markdown);
    }
    if (detail?.translations.en) {
      addDocument('translation-en', detail.translations.en.markdown);
    }
    if (detail?.summary) {
      addDocument('summary', detail.summary.markdown);
    }
  }
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return [hours, minutes, remainder]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}
