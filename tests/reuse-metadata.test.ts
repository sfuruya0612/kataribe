/**
 * 音声強調のメタデータの schema、書き込み、再構築を検証する。
 * 対応する要求: REQ-ENHANCE-001、REQ-ENHANCE-002、共通基盤
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  EnhancementAudioSource,
  EnhancementFile,
  MeetingSummary,
} from '../src/shared/types';
import { hashFile } from '../src/main/asset-download';
import {
  createEnhancementFile,
  loadEnhancementFile,
  metaEnhancementFromFile,
  readEnhancementFile,
  rebuildEnhancementFile,
  updateMetaEnhancement,
  validateEnhancementFile,
  writeEnhancementFile,
} from '../src/main/reuse-metadata';
import type { MeetingMeta } from '../src/main/meeting-meta';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-reuse-metadata-'));
  roots.push(root);
  return root;
}

function source(sha = 'a'.repeat(64)): EnhancementAudioSource {
  return {
    path: 'audio.mp3',
    sha256: sha,
    sample_rate: 44_100,
    channels: 1,
  };
}

function sampleFile(): EnhancementFile {
  const file = createEnhancementFile(source());
  file.saved_audio.nemotronlabs = {
    state: 'succeeded',
    model_sha256: 'b'.repeat(64),
    input: source(),
    output: {
      path: 'audio.enhanced.nemotronlabs.mp3',
      sha256: 'c'.repeat(64),
    },
    settings: {
      chunk_seconds: 5,
      hop_seconds: 2.5,
      crossfade_seconds: 0.5,
    },
    started_at: '2026-11-03T00:00:00.000Z',
    finished_at: '2026-11-03T00:01:00.000Z',
    elapsed_seconds: 60,
    error: null,
  };
  file.transcription.source_input_sha256 = 'd'.repeat(64);
  file.transcription.raw = {
    state: 'succeeded',
    path: 'transcript.raw.md',
    input_sha256: 'd'.repeat(64),
    output_sha256: 'e'.repeat(64),
    model: 'small',
    model_sha256: null,
    settings: {
      engine: 'whisper-cpp',
      whisper_model: 'small',
      chunk_seconds: null,
      hop_seconds: null,
      crossfade_seconds: null,
    },
    chars: 12,
    started_at: '2026-11-03T00:00:00.000Z',
    finished_at: '2026-11-03T00:02:00.000Z',
    elapsed_seconds: 120,
    error: null,
  };
  file.transcription.models.nemotronlabs = {
    ...file.transcription.raw,
    path: 'transcript.nemotronlabs.md',
    model_sha256: 'b'.repeat(64),
    input_sha256: 'f'.repeat(64),
    output_sha256: '1'.repeat(64),
    settings: {
      engine: 'whisper-cpp',
      whisper_model: 'small',
      chunk_seconds: 5,
      hop_seconds: 2.5,
      crossfade_seconds: 0.5,
    },
  };
  file.transcription.primary = {
    source: 'nemotronlabs',
    path: 'transcript.md',
  };
  return file;
}

function metaFixture(): MeetingMeta {
  return {
    schema_version: 1,
    id: '00000000-0000-4000-8000-0000000000cc',
    status: 'enhancing',
    title: '音声強調のテスト',
    started_at: '2026-11-03T00:00:00.000Z',
    duration: 60,
    source: { input: 'both' },
    sample_rate: 48_000,
    channels: 1,
    bits_per_sample: 16,
    chunks: [],
    expected_samples: 0,
    actual_samples: 0,
    app_version: '0.1.0',
    audio_path: 'audio.mp3',
  };
}

describe('enhancement.json', () => {
  it('round-trips the schema with saved audio and transcription hashes', async () => {
    const root = await createRoot();
    const file = sampleFile();
    await writeEnhancementFile(root, file);
    const read = await readEnhancementFile(root);
    expect(read).toEqual({ state: 'ok', file });
    expect(read.state === 'ok' ? read.file.saved_audio.nemotronlabs?.output : null)
      .toEqual({
        path: 'audio.enhanced.nemotronlabs.mp3',
        sha256: 'c'.repeat(64),
      });
  });

  it('distinguishes a missing file and a broken file', async () => {
    const root = await createRoot();
    expect(await readEnhancementFile(root)).toEqual({ state: 'missing' });
    await writeFile(join(root, 'enhancement.json'), '{broken');
    expect((await readEnhancementFile(root)).state).toBe('broken');
    await writeFile(join(root, 'enhancement.json'), JSON.stringify({ schema_version: 99 }));
    expect((await readEnhancementFile(root)).state).toBe('broken');
  });

  it('keeps the previous file when a write fails', async () => {
    const root = await createRoot();
    await writeEnhancementFile(root, sampleFile());
    const before = await readFile(join(root, 'enhancement.json'), 'utf8');
    await mkdir(join(root, 'enhancement.json.tmp'));
    await expect(
      writeEnhancementFile(root, sampleFile()),
    ).rejects.toThrow();
    expect(await readFile(join(root, 'enhancement.json'), 'utf8')).toBe(before);
  });

  it('rejects an unknown schema version', () => {
    expect(() =>
      validateEnhancementFile({ schema_version: 2 }),
    ).toThrow(/schema version/u);
  });

  it('regenerates the meta summary from the enhancement file', () => {
    const file = sampleFile();
    const meta = metaFixture();
    updateMetaEnhancement(meta, file);
    expect(meta.enhancement).toEqual({
      savedAudioModels: ['nemotronlabs'],
      savedAudioState: 'succeeded',
      hasRawTranscript: true,
      transcriptModels: ['nemotronlabs'],
      primarySource: 'nemotronlabs',
    });
    expect(metaEnhancementFromFile(file)).toEqual(meta.enhancement);
  });
});

describe('rebuilding enhancement.json', () => {
  it('rebuilds saved audio and comparison transcripts from the meeting folder', async () => {
    const root = await createRoot();
    await writeFile(join(root, 'audio.mp3'), 'audio bytes');
    await writeFile(
      join(root, 'audio.enhanced.nemotronlabs.mp3'),
      'enhanced bytes',
    );
    await writeFile(
      join(root, 'transcript.raw.md'),
      '---\ntitle: test\nmodel: small\n---\n生の文字起こし\n',
    );
    await writeFile(
      join(root, 'transcript.nemotronlabs.md'),
      '---\ntitle: test\nmodel: small\n---\n強調した文字起こし\n',
    );
    const audioSource: EnhancementAudioSource = {
      path: 'audio.mp3',
      sha256: await hashFile(join(root, 'audio.mp3')),
      sample_rate: 44_100,
      channels: 1,
    };
    const rebuilt = await rebuildEnhancementFile(root, audioSource);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt?.saved_audio.nemotronlabs?.output?.path).toBe(
      'audio.enhanced.nemotronlabs.mp3',
    );
    expect(rebuilt?.transcription.raw.state).toBe('succeeded');
    expect(rebuilt?.transcription.models.nemotronlabs?.state).toBe(
      'succeeded',
    );
    expect(rebuilt?.transcription.primary).toEqual({
      source: 'nemotronlabs',
      path: 'transcript.md',
    });
  });

  it('rewrites a broken file from the derivatives and keeps the meeting data', async () => {
    const root = await createRoot();
    await writeFile(join(root, 'audio.mp3'), 'audio bytes');
    await writeFile(
      join(root, 'transcript.raw.md'),
      '---\ntitle: test\nmodel: small\n---\n生の文字起こし\n',
    );
    await writeFile(join(root, 'enhancement.json'), '{broken');
    const audioSource: EnhancementAudioSource = {
      path: 'audio.mp3',
      sha256: await hashFile(join(root, 'audio.mp3')),
      sample_rate: 44_100,
      channels: 1,
    };
    const loaded = await loadEnhancementFile(root, audioSource);
    expect(loaded.warning).toBeNull();
    expect(loaded.file?.transcription.raw.state).toBe('succeeded');
    expect((await readEnhancementFile(root)).state).toBe('ok');
  });

  it('returns a warning without deleting files when rebuilding is impossible', async () => {
    const root = await createRoot();
    await writeFile(join(root, 'enhancement.json'), '{broken');
    await writeFile(join(root, 'audio.mp3'), 'audio bytes');
    const loaded = await loadEnhancementFile(root, {
      path: 'audio.mp3',
      sha256: await hashFile(join(root, 'audio.mp3')),
      sample_rate: 44_100,
      channels: 1,
    });
    expect(loaded.file).toBeNull();
    expect(loaded.warning).toContain('could not be rebuilt');
    expect(await readFile(join(root, 'enhancement.json'), 'utf8')).toBe(
      '{broken',
    );
  });
});

describe('MeetingSummary enhancement fields', () => {
  it('are represented from the meta summary', () => {
    const meta = metaFixture();
    updateMetaEnhancement(meta, sampleFile());
    const summary: Pick<
      MeetingSummary,
      | 'enhancedModels'
      | 'hasRawTranscript'
      | 'transcriptModels'
      | 'enhancementState'
    > = {
      enhancedModels: meta.enhancement?.savedAudioModels ?? [],
      hasRawTranscript: meta.enhancement?.hasRawTranscript === true,
      transcriptModels: meta.enhancement?.transcriptModels ?? [],
      enhancementState: meta.enhancement?.savedAudioState ?? null,
    };
    expect(summary).toEqual({
      enhancedModels: ['nemotronlabs'],
      hasRawTranscript: true,
      transcriptModels: ['nemotronlabs'],
      enhancementState: 'succeeded',
    });
  });
});
