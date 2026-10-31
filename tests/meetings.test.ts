import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeWavMono16 } from '../src/main/wav';
import { MeetingStore } from '../src/main/meetings';
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

afterEach(async () => {
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
});
