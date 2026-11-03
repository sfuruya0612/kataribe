/**
 * 会議フォルダの読み書き、検索、話者名、保存済みデータの不変条件を検証する。
 * 対応する要求: REQ-DIAR-001、REQ-DIAR-002、REQ-UI-001 (保存済みデータの不変)、REQ-TODO-001
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeWavMono16 } from '../src/main/wav';
import {
  DIARIZATION_CACHE_SCHEMA_VERSION,
  diarizationCachePath,
  readDiarizationCache,
  writeDiarizationCache,
  type DiarizationCache,
} from '../src/main/diarization-cache';
import { MeetingStore } from '../src/main/meetings';
import {
  createEnhancementFile,
  writeEnhancementFile,
} from '../src/main/reuse-metadata';
import { listMeetingTodos, setMeetingTodoChecked } from '../src/main/todos';
import { setUiLanguage } from '../src/main/i18n';
import {
  formatTranscriptMarkdown,
  formatTranslationMarkdown,
  stringifyFrontMatter,
} from '../src/shared/markdown';

const roots: string[] = [];

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-meetings-'));
  roots.push(root);
  return { root, store: new MeetingStore(root) };
}

async function createMeeting(
  root: string,
  id: string,
  overrides: Record<string, unknown> = {},
  audio?: Buffer,
) {
  const meetingDir = join(root, '2026', `2026-10-29_1400_${id}`);
  await mkdir(meetingDir, { recursive: true });
  const meta = {
    schema_version: 1,
    id,
    status: 'encoding',
    title: '週次定例',
    started_at: '2026-10-29T05:00:00.000Z',
    duration: 0.1,
    source: { input: 'both' },
    sample_rate: 48000,
    channels: 1,
    bits_per_sample: 16,
    chunks: [{ sequence: 1, file: '000001.wav', frames: 4800 }],
    actual_samples: 4800,
    expected_samples: 4800,
    audio_path: 'audio.wav',
    ...overrides,
  };
  await writeFile(join(meetingDir, 'meta.json'), JSON.stringify(meta));
  if (audio) {
    await writeFile(join(meetingDir, 'audio.wav'), audio);
  }
  return meetingDir;
}

async function writeSummaryTodo(
  meetingDir: string,
  title: string,
  todoLines: readonly string[],
): Promise<void> {
  await writeFile(
    join(meetingDir, 'summary.md'),
    stringifyFrontMatter(
      { title, date: '2026-10-29', provider: 'claude', language: 'ja' },
      ['## 要約', '本文です。', '## ToDo', ...todoLines, '## 未決事項'].join(
        '\n',
      ),
    ),
  );
}

afterEach(async () => {
  setUiLanguage('ja');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('MeetingStore', () => {
  it('lists meetings from meta.json and generates audio URLs', async () => {
    const { root, store } = await createStore();
    await createMeeting(root, '00000000-0000-4000-8000-000000000001', {}, Buffer.alloc(44));

    const meetings = await store.list();
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      title: '週次定例',
      status: 'encoding',
      inputSource: 'both',
      sampleRate: 48000,
      duration: 0.1,
      chunkCount: 1,
    });
    expect(meetings[0].audioUrl).toContain('kataribe-audio://meeting/');
  });

  it('returns the enhancing status and the enhancement summary', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-0000000000e1';
    const meetingDir = await createMeeting(root, id, {
      status: 'enhancing',
      enhancement: {
        savedAudioModels: ['nemotronlabs'],
        savedAudioState: 'succeeded',
        hasRawTranscript: true,
        transcriptModels: ['nemotronlabs'],
        primarySource: 'nemotronlabs',
      },
    });
    const source = {
      path: 'audio.mp3',
      sha256: 'a'.repeat(64),
      sample_rate: 48_000,
      channels: 1,
    };
    await writeEnhancementFile(meetingDir, createEnhancementFile(source));

    const meetings = await store.list();
    expect(meetings[0]).toMatchObject({
      id,
      status: 'enhancing',
      enhancedModels: ['nemotronlabs'],
      hasRawTranscript: true,
      transcriptModels: ['nemotronlabs'],
      enhancementState: 'succeeded',
    });
    const detail = await store.detail(id);
    expect(detail?.enhancement?.source).toEqual(source);
    expect(detail?.enhancementWarning).toBeNull();
    const enhancedPath = join(meetingDir, 'audio.enhanced.nemotronlabs.mp3');
    await writeFile(enhancedPath, 'enhanced');
    expect(await store.enhancedAudioPath(id, 'nemotronlabs')).toBe(enhancedPath);
  });

  it('returns null when audio.wav is missing', async () => {
    const { root, store } = await createStore();
    const meetingDir = await createMeeting(
      root,
      '00000000-0000-4000-8000-000000000002',
    );
    await rm(join(meetingDir, 'audio.wav'), { force: true });

    const meetings = await store.list();
    expect(meetings[0].audioUrl).toBeNull();
    expect(await store.audioPath(meetings[0].id)).toBeNull();
  });

  it('computes a waveform from the wav file', async () => {
    const { root, store } = await createStore();
    const samples = new Float32Array(4800);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = index < 2400 ? 0.8 : 0.1;
    }
    const meetingDir = await createMeeting(
      root,
      '00000000-0000-4000-8000-000000000003',
      {},
      encodeWavMono16(samples, 48000),
    );

    const waveform = await store.waveform(
      '00000000-0000-4000-8000-000000000003',
      24,
    );
    expect(waveform.peaks).toHaveLength(24);
    expect(waveform.duration).toBeCloseTo(0.1, 5);
    expect(Math.max(...waveform.peaks)).toBeCloseTo(1, 5);
    expect(waveform.peaks[0]).toBeGreaterThan(waveform.peaks.at(-1) ?? 0);

    expect(await store.audioPath('00000000-0000-4000-8000-000000000003')).toBe(
      join(meetingDir, 'audio.wav'),
    );
  });

  it('ignores folders without a readable meta.json', async () => {
    const { root, store } = await createStore();
    await mkdir(join(root, '2026', 'broken'), { recursive: true });
    expect(await store.list()).toEqual([]);
  });

  it('returns an empty waveform for an unknown meeting', async () => {
    const { store } = await createStore();
    expect(await store.waveform('missing')).toEqual({ peaks: [], duration: 0 });
  });

  it('returns the recording error stored in meta.json', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000030';
    await createMeeting(root, id, {
      recording_error: {
        message: '録音データの保存に失敗しました。',
        at: '2026-10-29T05:01:00.000Z',
      },
    });

    const detail = await store.detail(id);
    expect(detail?.recordingError).toEqual({
      message: '録音データの保存に失敗しました。',
      at: '2026-10-29T05:01:00.000Z',
    });
  });

  it('req_ui_001_keeps_the_stored_recording_error_message_when_the_ui_language_is_english', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000032';
    await createMeeting(root, id, {
      status: 'error',
      recording_error: {
        message: '録音データの保存に失敗しました。',
        at: '2026-10-29T05:01:00.000Z',
      },
    });
    setUiLanguage('en');

    const detail = await store.detail(id);
    expect(detail?.recordingError).toEqual({
      message: '録音データの保存に失敗しました。',
      at: '2026-10-29T05:01:00.000Z',
    });
  });

  it('req_ui_001_keeps_meeting_content_when_the_ui_language_is_english', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000033';
    const meetingDir = await createMeeting(root, id, {
      status: 'transcribed',
      speakers: ['話者A'],
    });
    await writeFile(
      join(meetingDir, 'transcript.md'),
      formatTranscriptMarkdown({
        title: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        language: 'ja',
        segments: [
          { startSeconds: 1, text: 'こんにちは', speaker: '話者A' },
        ],
      }),
    );
    await writeFile(
      join(meetingDir, 'transcript.en.md'),
      formatTranslationMarkdown({
        title: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        provider: 'claude',
        generatedAt: '2026-10-29T05:01:00.000Z',
        segments: [{ startSeconds: 1, text: 'Keep this translation' }],
      }),
    );
    await writeFile(
      join(meetingDir, 'summary.md'),
      stringifyFrontMatter({ title: '週次定例' }, '## 要約\n\nKeep this summary'),
    );
    setUiLanguage('en');

    const detail = await store.detail(id);
    expect(detail?.meeting.title).toBe('週次定例');
    expect(detail?.meeting.meetingDir).toBe(meetingDir);
    expect(detail?.transcript?.body).toContain('話者A: こんにちは');
    expect(detail?.translations.en?.body).toContain('Keep this translation');
    expect(detail?.summary?.body).toContain('Keep this summary');
    expect(detail?.speakers).toEqual(['話者A']);
  });

  it('falls back to the last error severity event for older recordings', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000031';
    await createMeeting(root, id, {
      status: 'error',
      events: [
        {
          at: '2026-10-29T05:00:30.000Z',
          kind: 'device-lost',
          device: 'system',
          severity: 'warning',
          message: 'システム音声が途切れました。',
        },
        {
          at: '2026-10-29T05:01:00.000Z',
          kind: 'device-lost',
          device: 'system',
          severity: 'error',
          message: 'BlackHole 2ch が切断されました。',
        },
      ],
    });

    const detail = await store.detail(id);
    expect(detail?.recordingError).toEqual({
      message: 'BlackHole 2ch が切断されました。',
      at: '2026-10-29T05:01:00.000Z',
    });
  });

  it('uses a generic message for an older recording without audio', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000033';
    await createMeeting(root, id, {
      status: 'error',
      chunks: [],
      actual_samples: 0,
      expected_samples: 0,
      audio_path: undefined,
      ended_at: '2026-10-29T05:00:10.000Z',
    });

    const detail = await store.detail(id);
    expect(detail?.recordingError).toMatchObject({
      at: '2026-10-29T05:00:10.000Z',
      message: expect.stringContaining('録音データが保存されなかった'),
    });
  });

  it('returns null when the recording has no usable error', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000032';
    await createMeeting(root, id, {
      recording_error: { message: 42, at: null },
      events: [
        {
          at: '2026-10-29T05:00:30.000Z',
          kind: 'clipping',
          device: 'microphone',
          severity: 'warning',
          message: 'マイク入力がクリップしています。',
        },
      ],
    });

    const detail = await store.detail(id);
    expect(detail?.recordingError).toBeNull();
  });

  it('renames the folder and updates front matter when the title changes', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000010';
    const meetingDir = await createMeeting(root, id);
    const transcript = formatTranscriptMarkdown({
      title: '週次定例',
      startedAt: '2026-10-29T05:00:00.000Z',
      durationSeconds: 60,
      source: 'mic+system',
      model: 'small',
      language: 'ja',
      segments: [{ startSeconds: 1, text: 'こんにちは' }],
    });
    const translation = formatTranslationMarkdown({
      title: '週次定例',
      startedAt: '2026-10-29T05:00:00.000Z',
      durationSeconds: 60,
      source: 'mic+system',
      model: 'small',
      sourceLanguage: 'ja',
      targetLanguage: 'en',
      provider: 'chatgpt',
      generatedAt: '2026-10-29T06:00:00.000Z',
      segments: [{ startSeconds: 1, text: 'Hello' }],
    });
    const summary = stringifyFrontMatter(
      {
        title: '週次定例',
        date: '2026-10-29',
        provider: 'chatgpt',
        generated_at: '2026-10-29T06:00:00.000Z',
        language: 'ja',
      },
      '## 要約\n\n内容\n',
    );
    await writeFile(join(meetingDir, 'transcript.md'), transcript);
    await writeFile(join(meetingDir, 'transcript.en.md'), translation);
    await writeFile(join(meetingDir, 'summary.md'), summary);

    const updated = await store.updateTitle(id, '新しい 会議/タイトル');
    expect(updated.title).toBe('新しい 会議_タイトル');
    expect(updated.meetingDir).not.toBe(meetingDir);
    expect(updated.meetingDir).toContain('2026-10-29_1400_新しい 会議_タイトル');
    expect(await readFile(join(updated.meetingDir, 'transcript.md'), 'utf8')).toContain(
      'title: 新しい 会議_タイトル',
    );
    expect(await readFile(join(updated.meetingDir, 'transcript.en.md'), 'utf8')).toContain(
      'title: 新しい 会議_タイトル',
    );
    expect(await readFile(join(updated.meetingDir, 'summary.md'), 'utf8')).toContain(
      'title: 新しい 会議_タイトル',
    );
    await expect(readFile(join(meetingDir, 'meta.json'), 'utf8')).rejects.toThrow();
  });

  it('searches transcripts, translations, summaries, and titles', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000011';
    const meetingDir = await createMeeting(root, id, { title: '週次定例' });    const transcript = formatTranscriptMarkdown({
      title: '週次定例',
      startedAt: '2026-10-29T05:00:00.000Z',
      durationSeconds: 60,
      source: 'mic+system',
      model: 'small',
      language: 'ja',
      segments: [{ startSeconds: 12, text: 'キャッシュ設定の障害を直しました。' }],
    });
    const translation = formatTranslationMarkdown({
      title: '週次定例',
      startedAt: '2026-10-29T05:00:00.000Z',
      durationSeconds: 60,
      source: 'mic+system',
      model: 'small',
      sourceLanguage: 'ja',
      targetLanguage: 'en',
      provider: 'chatgpt',
      generatedAt: '2026-10-29T06:00:00.000Z',
      segments: [{ startSeconds: 12, text: 'We fixed the cache configuration.' }],
    });
    const summary = stringifyFrontMatter(
      {
        title: '週次定例',
        date: '2026-10-29',
        provider: 'chatgpt',
        generated_at: '2026-10-29T06:00:00.000Z',
        language: 'ja',
      },
      '## 要約\n\nリリースの準備を進めます。\n',
    );
    await writeFile(join(meetingDir, 'transcript.md'), transcript);
    await writeFile(join(meetingDir, 'transcript.en.md'), translation);
    await writeFile(join(meetingDir, 'summary.md'), summary);

    const transcriptHit = await store.search('キャッシュ');
    expect(transcriptHit.hits[0]).toMatchObject({
      meetingId: id,
      kind: 'transcript',
      timestamp: '00:00:12',
      lineNumber: 1,
    });
    const translationHit = await store.search('CACHE');
    expect(translationHit.hits[0]).toMatchObject({
      kind: 'translation-en',
      lineNumber: 1,
    });
    const summaryHit = await store.search('リリース');
    expect(summaryHit.hits[0]).toMatchObject({ kind: 'summary' });
    const titleHit = await store.search('週次');
    expect(titleHit.hits[0]).toMatchObject({ kind: 'title' });
    expect(await store.search('x')).toEqual({
      query: 'x',
      hits: [],
      truncated: false,
    });
  });

  it('switches the save root at runtime', async () => {
    const { root, store } = await createStore();
    const next = join(root, 'next');
    await mkdir(join(next, '2026'), { recursive: true });
    store.setSaveRoot(next);
    expect(store.getSaveRoot()).toBe(next);
    expect(await store.list()).toEqual([]);
  });

  it('imports an audio file into a new meeting folder', async () => {
    const { root, store } = await createStore();
    const source = join(root, '取り込みテスト.mp3');
    await writeFile(source, Buffer.from('not a real mp3'));
    const imported = await store.importAudio(source, '0.1.0');
    expect(imported.title).toBe('取り込みテスト');
    expect(imported.status).toBe('encoding');
    expect(imported.audioUrl).toContain('kataribe-audio://meeting/');
    const meta = JSON.parse(
      await readFile(join(imported.meetingDir, 'meta.json'), 'utf8'),
    );
    expect(meta.audio_path).toBe('audio.mp3');
    expect(meta.id).toBe(imported.id);
    expect(
      await readFile(join(imported.meetingDir, 'audio.mp3'), 'utf8'),
    ).toBe('not a real mp3');
  });

  it('pins meetings and sorts pinned meetings first', async () => {
    const { root, store } = await createStore();
    const older = '00000000-0000-4000-8000-000000000020';
    const newer = '00000000-0000-4000-8000-000000000021';
    await createMeeting(root, older, { started_at: '2026-10-01T00:00:00.000Z' });
    await createMeeting(root, newer, { started_at: '2026-10-02T00:00:00.000Z' });
    expect((await store.list()).map((meeting) => meeting.id)).toEqual([
      newer,
      older,
    ]);
    await store.setPinned(older, true);
    const list = await store.list();
    expect(list.map((meeting) => meeting.id)).toEqual([older, newer]);
    expect(list[0].pinned).toBe(true);
    await store.setPinned(older, false);
    expect((await store.list()).map((meeting) => meeting.id)).toEqual([
      newer,
      older,
    ]);
  });

  it('deletes a meeting folder', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000022';
    const meetingDir = await createMeeting(root, id);
    await store.delete(id);
    await expect(stat(meetingDir)).rejects.toThrow();
    expect(await store.list()).toEqual([]);
  });

  it('req_diar_001_returns_the_diarization_error_from_meta', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000027';
    const meetingDir = await createMeeting(root, id, {
      status: 'transcribed',
      diarization: { state: 'failed', error: 'synthetic failure' },
    });
    await writeFile(
      join(meetingDir, 'transcript.md'),
      formatTranscriptMarkdown({
        title: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        language: 'ja',
        segments: [
          { startSeconds: 1, endSeconds: 2, speaker: '話者A', text: 'A です。' },
        ],
      }),
    );

    const detail = await store.detail(id);

    expect(detail?.diarizationError).toBe('synthetic failure');
  });

  it('req_diar_001_does_not_treat_an_unlabeled_sentence_as_a_speaker', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000028';
    const meetingDir = await createMeeting(root, id, { status: 'transcribed' });
    await writeFile(
      join(meetingDir, 'transcript.md'),
      formatTranscriptMarkdown({
        title: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        language: 'en',
        segments: [
          {
            startSeconds: 1,
            endSeconds: 2,
            text: 'We will start with the agenda: budget, hiring.',
          },
        ],
      }),
    );

    const detail = await store.detail(id);

    expect(detail?.speakers).toEqual([]);
    await expect(
      store.renameSpeakers(id, ['We will start with the agenda']),
    ).rejects.toThrow(/話者数/u);
    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toContain(
      'We will start with the agenda: budget, hiring.',
    );
  });

  it('req_diar_001_recovers_speaker_names_when_meta_is_stale', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000029';
    const meetingDir = await createMeeting(root, id, {
      status: 'transcribed',
      speakers: ['話者A', '話者B'],
    });
    await writeFile(
      join(meetingDir, 'transcript.md'),
      formatTranscriptMarkdown({
        title: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        language: 'ja',
        segments: [
          { startSeconds: 1, endSeconds: 2, speaker: '田中', text: '一つ目です。' },
          { startSeconds: 2, endSeconds: 3, speaker: '佐藤', text: '二つ目です。' },
        ],
      }),
    );

    const detail = await store.detail(id);
    expect(detail?.speakers).toEqual(['田中', '佐藤']);

    const updated = await store.renameSpeakers(id, ['鈴木', '高橋']);

    expect(updated.speakers).toEqual(['鈴木', '高橋']);
    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toContain(
      '[00:00:01] 鈴木: 一つ目です。',
    );
    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toContain(
      '[00:00:02] 高橋: 二つ目です。',
    );
    const meta = JSON.parse(await readFile(join(meetingDir, 'meta.json'), 'utf8'));
    expect(meta.speakers).toEqual(['鈴木', '高橋']);
  });

  it('req_diar_002_renames_speakers_in_the_diarization_cache', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000030';
    const meetingDir = await createMeeting(root, id, { status: 'transcribed' });
    await writeFile(
      join(meetingDir, 'transcript.md'),
      formatTranscriptMarkdown({
        title: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        language: 'ja',
        segments: [
          { startSeconds: 1, endSeconds: 2, speaker: '田中', text: '一つ目です。' },
          { startSeconds: 2, endSeconds: 3, speaker: '話者A', text: '二つ目です。' },
        ],
      }),
    );
    const cache: DiarizationCache = {
      schema_version: DIARIZATION_CACHE_SCHEMA_VERSION,
      key: {
        audio_sha256: 'a'.repeat(64),
        segmentation_sha256: 'b'.repeat(64),
        embedding_sha256: 'c'.repeat(64),
        speaker_count: 'auto',
        cluster_threshold: 0.9,
        threads: 4,
      },
      turns: [
        { start: 1, end: 2, cluster: 'speaker_00' },
        { start: 2, end: 3, cluster: 'speaker_01' },
      ],
      names: { speaker_00: '田中' },
      labels: { 田中: 'speaker_00', 話者A: 'speaker_01' },
    };
    const cachePath = diarizationCachePath(meetingDir);
    await writeDiarizationCache(cachePath, cache);

    const detail = await store.detail(id);
    expect(detail?.speakers).toEqual(['田中', '話者A']);

    const updated = await store.renameSpeakers(id, ['鈴木', '佐藤']);

    expect(updated.speakers).toEqual(['鈴木', '佐藤']);
    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toContain(
      '[00:00:01] 鈴木: 一つ目です。',
    );
    const saved = await readDiarizationCache(cachePath);
    expect(saved?.names).toEqual({ speaker_00: '鈴木', speaker_01: '佐藤' });
    expect(saved?.labels).toEqual({
      鈴木: 'speaker_00',
      佐藤: 'speaker_01',
    });
    const meta = JSON.parse(await readFile(join(meetingDir, 'meta.json'), 'utf8'));
    expect(meta.speakers).toEqual(['鈴木', '佐藤']);

    const swapped = await store.renameSpeakers(id, ['佐藤', '鈴木']);
    expect(swapped.speakers).toEqual(['佐藤', '鈴木']);
    const swappedCache = await readDiarizationCache(cachePath);
    expect(swappedCache?.names).toEqual({ speaker_00: '佐藤', speaker_01: '鈴木' });
    expect(swappedCache?.labels).toEqual({
      佐藤: 'speaker_00',
      鈴木: 'speaker_01',
    });
  });

  it('req_diar_002_recovers_when_saving_the_cache_fails', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000033';
    const meetingDir = await createMeeting(root, id, { status: 'transcribed' });
    await writeFile(
      join(meetingDir, 'transcript.md'),
      formatTranscriptMarkdown({
        title: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        language: 'ja',
        segments: [
          { startSeconds: 1, endSeconds: 2, speaker: '田中', text: '一つ目です。' },
          { startSeconds: 2, endSeconds: 3, speaker: '話者A', text: '二つ目です。' },
        ],
      }),
    );
    const cachePath = diarizationCachePath(meetingDir);
    await writeDiarizationCache(cachePath, {
      schema_version: DIARIZATION_CACHE_SCHEMA_VERSION,
      key: {
        audio_sha256: 'a'.repeat(64),
        segmentation_sha256: 'b'.repeat(64),
        embedding_sha256: 'c'.repeat(64),
        speaker_count: 'auto',
        cluster_threshold: 0.9,
        threads: 4,
      },
      turns: [
        { start: 1, end: 2, cluster: 'speaker_00' },
        { start: 2, end: 3, cluster: 'speaker_01' },
      ],
      names: { speaker_00: '田中' },
      labels: { 田中: 'speaker_00', 話者A: 'speaker_01' },
    });
    await mkdir(`${cachePath}.tmp`);

    const updated = await store.renameSpeakers(id, ['鈴木', '佐藤']);

    expect(updated.speakers).toEqual(['鈴木', '佐藤']);
    await expect(stat(cachePath)).rejects.toThrow();
    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toContain(
      '[00:00:02] 佐藤: 二つ目です。',
    );

    const second = await store.renameSpeakers(id, ['高橋', '伊藤']);
    expect(second.speakers).toEqual(['高橋', '伊藤']);
    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toContain(
      '[00:00:02] 伊藤: 二つ目です。',
    );
  });

  it('req_diar_002_keeps_the_diarization_cache_after_a_partial_transcript', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000031';
    const meetingDir = await createMeeting(root, id, { status: 'transcribing' });
    await writeFile(
      join(meetingDir, 'transcript.md'),
      formatTranscriptMarkdown({
        title: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        language: 'ja',
        segments: [{ startSeconds: 1, endSeconds: 2, text: '途中です。' }],
        partial: true,
      }),
    );
    const cachePath = diarizationCachePath(meetingDir);
    await writeDiarizationCache(cachePath, {
      schema_version: DIARIZATION_CACHE_SCHEMA_VERSION,
      key: {
        audio_sha256: 'a'.repeat(64),
        segmentation_sha256: 'b'.repeat(64),
        embedding_sha256: 'c'.repeat(64),
        speaker_count: 'auto',
        cluster_threshold: 0.9,
        threads: 4,
      },
      turns: [
        { start: 1, end: 2, cluster: 'speaker_00' },
        { start: 2, end: 3, cluster: 'speaker_01' },
      ],
      names: { speaker_00: '田中' },
      labels: { 田中: 'speaker_00', 話者A: 'speaker_01' },
    });

    const detail = await store.detail(id);

    expect(detail?.speakers).toEqual([]);
    expect(await readDiarizationCache(cachePath)).not.toBeNull();
  });

  it('req_diar_002_deletes_the_diarization_cache_with_the_meeting', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000032';
    const meetingDir = await createMeeting(root, id, { status: 'transcribed' });
    const cachePath = diarizationCachePath(meetingDir);
    await writeDiarizationCache(cachePath, {
      schema_version: DIARIZATION_CACHE_SCHEMA_VERSION,
      key: {
        audio_sha256: 'a'.repeat(64),
        segmentation_sha256: 'b'.repeat(64),
        embedding_sha256: 'c'.repeat(64),
        speaker_count: 'auto',
        cluster_threshold: 0.9,
        threads: 4,
      },
      turns: [
        { start: 1, end: 2, cluster: 'speaker_00' },
        { start: 2, end: 3, cluster: 'speaker_01' },
      ],
      names: {},
      labels: { 話者A: 'speaker_00', 話者B: 'speaker_01' },
    });

    await store.delete(id);

    await expect(stat(cachePath)).rejects.toThrow();
  });

  it('req_diar_001_renames_speakers_in_the_transcript_and_translations', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000023';
    const meetingDir = await createMeeting(root, id, { status: 'transcribed' });
    const segments = [
      { startSeconds: 1, endSeconds: 2, speaker: '話者A', text: '一つ目です。' },
      { startSeconds: 2, endSeconds: 3, speaker: '話者B', text: '二つ目です。' },
      { startSeconds: 3, endSeconds: 4, speaker: '話者A', text: '三つ目です。' },
    ];
    await writeFile(
      join(meetingDir, 'transcript.md'),
      formatTranscriptMarkdown({
        title: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        language: 'ja',
        segments,
      }),
    );
    await writeFile(
      join(meetingDir, 'transcript.ja.md'),
      formatTranslationMarkdown({
        title: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        provider: 'test',
        generatedAt: '2026-10-29T05:01:00.000Z',
        segments,
      }),
    );

    const detail = await store.detail(id);
    expect(detail?.speakers).toEqual(['話者A', '話者B']);

    const updated = await store.renameSpeakers(id, ['田中', '佐藤']);

    expect(updated.speakers).toEqual(['田中', '佐藤']);
    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toContain(
      '[00:00:01] 田中: 一つ目です。',
    );
    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toContain(
      '[00:00:02] 佐藤: 二つ目です。',
    );
    expect(await readFile(join(meetingDir, 'transcript.ja.md'), 'utf8')).toContain(
      '[00:00:01] 田中: 一つ目です。',
    );
    const meta = JSON.parse(await readFile(join(meetingDir, 'meta.json'), 'utf8'));
    expect(meta.speakers).toEqual(['田中', '佐藤']);
  });

  it('req_diar_001_swaps_speaker_names_in_one_pass', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000024';
    const meetingDir = await createMeeting(root, id, { status: 'transcribed' });
    await writeFile(
      join(meetingDir, 'transcript.md'),
      formatTranscriptMarkdown({
        title: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        language: 'ja',
        segments: [
          { startSeconds: 1, endSeconds: 2, speaker: '話者A', text: 'A です。' },
          { startSeconds: 2, endSeconds: 3, speaker: '話者B', text: 'B です。' },
        ],
      }),
    );

    await store.renameSpeakers(id, ['話者B', '話者A']);

    const transcript = await readFile(join(meetingDir, 'transcript.md'), 'utf8');
    expect(transcript).toContain('[00:00:01] 話者B: A です。');
    expect(transcript).toContain('[00:00:02] 話者A: B です。');
  });

  it('req_diar_001_rejects_a_speaker_count_mismatch', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000025';
    const meetingDir = await createMeeting(root, id, { status: 'transcribed' });
    await writeFile(
      join(meetingDir, 'transcript.md'),
      formatTranscriptMarkdown({
        title: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        language: 'ja',
        segments: [
          { startSeconds: 1, endSeconds: 2, speaker: '話者A', text: 'A です。' },
        ],
      }),
    );

    await expect(store.renameSpeakers(id, ['田中', '佐藤'])).rejects.toThrow(
      /話者数/u,
    );
  });

  it('req_diar_001_rejects_invalid_speaker_names', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000026';
    const meetingDir = await createMeeting(root, id, { status: 'transcribed' });
    await writeFile(
      join(meetingDir, 'transcript.md'),
      formatTranscriptMarkdown({
        title: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        language: 'ja',
        segments: [
          { startSeconds: 1, endSeconds: 2, speaker: '話者A', text: 'A です。' },
        ],
      }),
    );

    await expect(store.renameSpeakers(id, ['田中: 営業'])).rejects.toThrow(
      /コロン/u,
    );
  });
});

describe('req_todo_001_meeting_todos', () => {
  it('lists todos in meeting order and skips meetings without a summary or todo', async () => {
    const { root, store } = await createStore();
    const meetingA = await createMeeting(
      root,
      '00000000-0000-4000-8000-000000000031',
      { status: 'summarized', title: '定例A' },
    );
    await writeSummaryTodo(meetingA, '定例A', [
      '- [ ] A の資料',
      '- [x] A の公開',
    ]);
    await createMeeting(root, '00000000-0000-4000-8000-000000000032', {
      status: 'transcribed',
      title: '定例B',
      started_at: '2026-10-29T06:00:00.000Z',
    });
    const meetingC = await createMeeting(
      root,
      '00000000-0000-4000-8000-000000000033',
      { status: 'summarized', title: '定例C', started_at: '2026-10-29T04:00:00.000Z' },
    );
    await writeSummaryTodo(meetingC, '定例C', ['- ただのメモ']);
    const meetingD = await createMeeting(
      root,
      '00000000-0000-4000-8000-000000000034',
      {
        status: 'summarized',
        title: '定例D',
        started_at: '2026-10-29T03:00:00.000Z',
        pinned: true,
      },
    );
    await writeSummaryTodo(meetingD, '定例D', ['- [ ] D の確認']);

    expect(await listMeetingTodos(store)).toEqual([
      {
        meetingId: '00000000-0000-4000-8000-000000000034',
        meetingTitle: '定例D',
        startedAt: '2026-10-29T03:00:00.000Z',
        lineNumber: 3,
        checked: false,
        text: 'D の確認',
      },
      {
        meetingId: '00000000-0000-4000-8000-000000000031',
        meetingTitle: '定例A',
        startedAt: '2026-10-29T05:00:00.000Z',
        lineNumber: 3,
        checked: false,
        text: 'A の資料',
      },
      {
        meetingId: '00000000-0000-4000-8000-000000000031',
        meetingTitle: '定例A',
        startedAt: '2026-10-29T05:00:00.000Z',
        lineNumber: 4,
        checked: true,
        text: 'A の公開',
      },
    ]);
  });

  it('saves the checked state and reads it back from a new store', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000035';
    const meetingDir = await createMeeting(root, id, {
      status: 'summarized',
    });
    await writeSummaryTodo(meetingDir, '週次定例', ['- [ ] 資料をまとめる']);

    await setMeetingTodoChecked(store, id, 3, '資料をまとめる', true);

    const saved = await readFile(join(meetingDir, 'summary.md'), 'utf8');
    expect(saved).toContain('- [x] 資料をまとめる');
    expect(saved).toContain('title: 週次定例');
    expect(saved).toContain('language: ja');

    const restarted = new MeetingStore(root);
    expect(await listMeetingTodos(restarted)).toEqual([
      {
        meetingId: id,
        meetingTitle: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        lineNumber: 3,
        checked: true,
        text: '資料をまとめる',
      },
    ]);

    await setMeetingTodoChecked(restarted, id, 3, '資料をまとめる', false);
    expect(await readFile(join(meetingDir, 'summary.md'), 'utf8')).toContain(
      '- [ ] 資料をまとめる',
    );
  });

  it('serializes concurrent toggles for the same meeting', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000038';
    const meetingDir = await createMeeting(root, id, {
      status: 'summarized',
    });
    await writeSummaryTodo(meetingDir, '週次定例', [
      '- [ ] 資料をまとめる',
      '- [ ] 公開する',
    ]);

    await Promise.all([
      setMeetingTodoChecked(store, id, 3, '資料をまとめる', true),
      setMeetingTodoChecked(store, id, 4, '公開する', true),
    ]);

    const saved = await readFile(join(meetingDir, 'summary.md'), 'utf8');
    expect(saved).toContain('- [x] 資料をまとめる');
    expect(saved).toContain('- [x] 公開する');
    expect(await listMeetingTodos(new MeetingStore(root))).toEqual([
      {
        meetingId: id,
        meetingTitle: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        lineNumber: 3,
        checked: true,
        text: '資料をまとめる',
      },
      {
        meetingId: id,
        meetingTitle: '週次定例',
        startedAt: '2026-10-29T05:00:00.000Z',
        lineNumber: 4,
        checked: true,
        text: '公開する',
      },
    ]);
  });

  it('continues the write queue after a rejected operation', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000039';
    const meetingDir = await createMeeting(root, id, {
      status: 'summarized',
    });
    await writeSummaryTodo(meetingDir, '週次定例', ['- [ ] 資料をまとめる']);

    const rejected = setMeetingTodoChecked(store, id, 3, '別の項目', true);
    const following = setMeetingTodoChecked(
      store,
      id,
      3,
      '資料をまとめる',
      true,
    );
    await expect(rejected).rejects.toThrow(
      '要約の ToDo が変更されました。一覧を再読み込みしてください。',
    );
    await following;

    expect(await readFile(join(meetingDir, 'summary.md'), 'utf8')).toContain(
      '- [x] 資料をまとめる',
    );
  });

  it('rejects a text or line mismatch without writing the summary', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000036';
    const meetingDir = await createMeeting(root, id, {
      status: 'summarized',
    });
    await writeSummaryTodo(meetingDir, '週次定例', ['- [ ] 資料をまとめる']);
    const original = await readFile(join(meetingDir, 'summary.md'), 'utf8');

    await expect(
      setMeetingTodoChecked(store, id, 3, '別の項目', true),
    ).rejects.toThrow(
      '要約の ToDo が変更されました。一覧を再読み込みしてください。',
    );
    await expect(
      setMeetingTodoChecked(store, id, 0, '要約', true),
    ).rejects.toThrow(
      '要約の ToDo が変更されました。一覧を再読み込みしてください。',
    );
    expect(await readFile(join(meetingDir, 'summary.md'), 'utf8')).toBe(
      original,
    );
  });

  it('rejects a checkbox outside the ToDo section without writing the summary', async () => {
    const { root, store } = await createStore();
    const id = '00000000-0000-4000-8000-000000000037';
    const meetingDir = await createMeeting(root, id, {
      status: 'summarized',
    });
    const original = stringifyFrontMatter(
      { title: '週次定例', date: '2026-10-29', provider: 'claude', language: 'ja' },
      [
        '## 要約',
        '- [ ] 要約の項目',
        '## ToDo',
        '- [ ] 資料をまとめる',
        '## 未決事項',
      ].join('\n'),
    );
    await writeFile(join(meetingDir, 'summary.md'), original);

    await expect(
      setMeetingTodoChecked(store, id, 1, '要約の項目', true),
    ).rejects.toThrow(
      '要約の ToDo が変更されました。一覧を再読み込みしてください。',
    );
    expect(await readFile(join(meetingDir, 'summary.md'), 'utf8')).toBe(
      original,
    );
  });
});
