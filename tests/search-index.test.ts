import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MeetingStore } from '../src/main/meetings';
import { MeetingSearchIndex } from '../src/main/search-index';
import { writeMeetingMeta, type MeetingMeta } from '../src/main/meeting-meta';
import {
  formatTranscriptMarkdown,
  formatTranslationMarkdown,
  stringifyFrontMatter,
} from '../src/shared/markdown';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-index-'));
  roots.push(root);
  const saveRoot = join(root, 'Kataribe');
  const meetingId = '00000000-0000-4000-8000-0000000000bb';
  const meetingDir = join(saveRoot, '2026', '2026-10-31_1200_検索テスト');
  await mkdir(meetingDir, { recursive: true });
  const meta: MeetingMeta = {
    schema_version: 1,
    id: meetingId,
    status: 'summarized',
    title: '検索テスト',
    started_at: '2026-10-31T03:00:00.000Z',
    duration: 60,
    source: { input: 'both' },
    sample_rate: 48000,
    channels: 1,
    bits_per_sample: 16,
    chunks: [],
    expected_samples: 0,
    actual_samples: 0,
    app_version: '0.1.0',
    audio_path: 'audio.mp3',
    summary_language: 'en',
  };
  await writeMeetingMeta(join(meetingDir, 'meta.json'), meta);
  await writeFile(
    join(meetingDir, 'transcript.md'),
    formatTranscriptMarkdown({
      title: meta.title,
      startedAt: meta.started_at,
      durationSeconds: 60,
      source: 'mic+system',
      model: 'small',
      language: 'ja',
      segments: [{ startSeconds: 5, text: 'キャッシュ設定の障害を直しました。' }],
    }),
  );
  await writeFile(
    join(meetingDir, 'transcript.en.md'),
    formatTranslationMarkdown({
      title: meta.title,
      startedAt: meta.started_at,
      durationSeconds: 60,
      source: 'mic+system',
      model: 'small',
      sourceLanguage: 'ja',
      targetLanguage: 'en',
      provider: 'chatgpt',
      generatedAt: '2026-10-31T04:00:00.000Z',
      segments: [{ startSeconds: 5, text: 'We fixed the cache configuration.' }],
    }),
  );
  await writeFile(
    join(meetingDir, 'summary.md'),
    stringifyFrontMatter(
      {
        title: meta.title,
        date: '2026-10-31',
        provider: 'chatgpt',
        generated_at: '2026-10-31T04:00:00.000Z',
        language: 'ja',
      },
      '## 要約\n\nリリースの準備を進めます。\n',
    ),
  );
  const store = new MeetingStore(saveRoot);
  const index = await MeetingSearchIndex.open(join(root, 'index'), saveRoot);
  await index.rebuild(store);
  return { root, saveRoot, meetingId, meetingDir, store, index };
}

describe('MeetingSearchIndex', () => {
  it('lists meetings and searches across title, transcript, translation, and summary', async () => {
    const { index, meetingId } = await setup();
    const list = index.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: meetingId,
      title: '検索テスト',
      translationLanguages: ['en'],
      summaryLanguage: 'en',
    });

    expect(index.search('キャッシュ').hits[0]).toMatchObject({
      kind: 'transcript',
      timestamp: '00:00:05',
    });
    expect(index.search('cache').hits[0]).toMatchObject({
      kind: 'translation-en',
    });
    expect(index.search('リリース').hits[0]).toMatchObject({ kind: 'summary' });
    expect(index.search('検索').hits[0]).toMatchObject({ kind: 'title' });
    expect(index.search('x').hits).toEqual([]);
    index.close();
  });

  it('refreshes a meeting after its transcript changes', async () => {
    const { index, store, meetingId, meetingDir } = await setup();
    await writeFile(
      join(meetingDir, 'transcript.md'),
      formatTranscriptMarkdown({
        title: '検索テスト',
        startedAt: '2026-10-31T03:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        language: 'ja',
        segments: [{ startSeconds: 8, text: '新しいキーワードを追加しました。' }],
      }),
    );
    await index.refresh(store, meetingId);
    expect(index.search('キャッシュ').hits).toEqual([]);
    expect(index.search('新しいキーワード').hits[0]).toMatchObject({
      kind: 'transcript',
      timestamp: '00:00:08',
    });
    index.close();
  });

  it('removes a deleted meeting from the index', async () => {
    const { index, store, meetingId, meetingDir } = await setup();
    await rm(meetingDir, { recursive: true, force: true });
    await index.refresh(store, meetingId);
    expect(index.list()).toEqual([]);
    expect(index.search('キャッシュ').hits).toEqual([]);
    index.close();
  });
});
