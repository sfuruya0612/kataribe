/**
 * 話者分離キャッシュの読み書き、検証、キー比較を検証する。
 * 対応する要求: REQ-DIAR-002
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DIARIZATION_CACHE_SCHEMA_VERSION,
  buildLabelMapping,
  diarizationCachePath,
  matchesCacheKey,
  readDiarizationCache,
  writeDiarizationCache,
  type DiarizationCache,
  type DiarizationCacheKey,
} from '../src/main/diarization-cache';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-diarization-cache-'));
  roots.push(root);
  return root;
}

function cacheKey(overrides: Partial<DiarizationCacheKey> = {}): DiarizationCacheKey {
  return {
    audio_sha256: 'a'.repeat(64),
    segmentation_sha256: 'b'.repeat(64),
    embedding_sha256: 'c'.repeat(64),
    speaker_count: 'auto',
    cluster_threshold: 0.9,
    threads: 4,
    ...overrides,
  };
}

function cache(overrides: Partial<DiarizationCache> = {}): DiarizationCache {
  return {
    schema_version: DIARIZATION_CACHE_SCHEMA_VERSION,
    key: cacheKey(),
    turns: [
      { start: 0.318, end: 6.865, cluster: 'speaker_00' },
      { start: 7.017, end: 10.747, cluster: 'speaker_01' },
    ],
    names: { speaker_00: '田中' },
    labels: { 田中: 'speaker_00', 話者A: 'speaker_01' },
    ...overrides,
  };
}

describe('diarizationCachePath', () => {
  it('places diarization.json in the meeting folder', () => {
    expect(diarizationCachePath('/meetings/example')).toBe(
      '/meetings/example/diarization.json',
    );
  });
});

describe('readDiarizationCache and writeDiarizationCache', () => {
  it('round-trips a cache with private permissions', async () => {
    const root = await createRoot();
    const path = join(root, 'meeting', 'diarization.json');
    const expected = cache();

    await writeDiarizationCache(path, expected);

    expect(await readDiarizationCache(path)).toEqual(expected);
    expect(await readFile(path, 'utf8')).toContain('"schema_version": 1');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('returns null for a missing cache', async () => {
    const root = await createRoot();
    expect(await readDiarizationCache(join(root, 'missing.json'))).toBeNull();
  });

  it('returns null for broken JSON', async () => {
    const root = await createRoot();
    const path = join(root, 'diarization.json');
    await writeFile(path, '{broken');

    expect(await readDiarizationCache(path)).toBeNull();
  });

  it('returns null for an unsupported schema', async () => {
    const root = await createRoot();
    const path = join(root, 'diarization.json');
    await writeFile(
      path,
      JSON.stringify({ ...cache(), schema_version: 2 }),
    );

    expect(await readDiarizationCache(path)).toBeNull();
  });

  it('returns null for invalid key and turns', async () => {
    const root = await createRoot();
    const path = join(root, 'diarization.json');
    const cases = [
      { ...cache(), key: { ...cacheKey(), audio_sha256: 'short' } },
      { ...cache(), key: { ...cacheKey(), speaker_count: 11 } },
      { ...cache(), key: { ...cacheKey(), threads: 0 } },
      { ...cache(), key: { ...cacheKey(), cluster_threshold: 2 } },
      { ...cache(), turns: [{ start: 2, end: 1, cluster: 'speaker_00' }] },
      { ...cache(), turns: [{ start: 0, end: 1, cluster: '' }] },
      { ...cache(), names: { speaker_00: '' } },
      { ...cache(), labels: { '': 'speaker_00' } },
    ];

    for (const value of cases) {
      await writeFile(path, JSON.stringify(value));
      expect(await readDiarizationCache(path)).toBeNull();
    }
  });

  it('rejects a write when the cache path cannot be created', async () => {
    const root = await createRoot();
    const blockingFile = join(root, 'blocking');
    await writeFile(blockingFile, 'not a directory');

    await expect(
      writeDiarizationCache(join(blockingFile, 'diarization.json'), cache()),
    ).rejects.toThrow();
  });
});

describe('buildLabelMapping', () => {
  it('maps the previous display names to the new names by cluster', () => {
    const previous = cache({
      labels: { 田中: 'speaker_00', 話者A: 'speaker_01' },
    });
    const next = cache({
      labels: { 鈴木: 'speaker_00', 佐藤: 'speaker_01' },
    });

    expect([...buildLabelMapping(previous, next)]).toEqual([
      ['田中', '鈴木'],
      ['話者A', '佐藤'],
    ]);
  });

  it('returns an empty mapping when the display names are unchanged', () => {
    expect(buildLabelMapping(cache(), cache())).toEqual(new Map());
  });
});

describe('matchesCacheKey', () => {
  it('matches identical keys and rejects each changed field', () => {
    const key = cacheKey();
    expect(matchesCacheKey(key, { ...key })).toBe(true);

    const variants: DiarizationCacheKey[] = [
      cacheKey({ audio_sha256: 'd'.repeat(64) }),
      cacheKey({ segmentation_sha256: 'd'.repeat(64) }),
      cacheKey({ embedding_sha256: 'd'.repeat(64) }),
      cacheKey({ speaker_count: 5 }),
      cacheKey({ cluster_threshold: 0.8 }),
      cacheKey({ threads: 3 }),
    ];
    for (const variant of variants) {
      expect(matchesCacheKey(key, variant)).toBe(false);
    }
  });
});
