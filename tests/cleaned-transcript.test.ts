/**
 * 相槌と擬音を除いた文字起こしの保存、読み込み、削除を検証する。
 * 対応する要求: REQ-CHAT-003
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLEANED_TRANSCRIPT_FILE,
  hashTranscriptBody,
  readCleanedTranscript,
  removeCleanedTranscript,
  writeCleanedTranscript,
} from '../src/main/cleaned-transcript';

const roots: string[] = [];

async function createDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-cleaned-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('cleaned transcript', () => {
  it('writes the source hash, state, and provider', async () => {
    const dir = await createDir();
    const sourceBody = '[00:00:01] 話者A: あー、今日はリリース計画です。';
    const body = '[00:00:01] 話者A: 今日はリリース計画です。';
    await writeCleanedTranscript(dir, {
      title: '週次定例',
      startedAt: '2026-11-16T00:00:00.000Z',
      durationSeconds: 60,
      language: 'ja',
      sourceBody,
      body,
      state: 'completed',
      provider: 'claude',
      model: 'claude-test',
      generatedAt: '2026-11-16T01:00:00.000Z',
    });

    const document = await readCleanedTranscript(dir);
    expect(document).toMatchObject({
      body,
      sourceHash: hashTranscriptBody(sourceBody),
      state: 'completed',
      provider: 'claude',
      model: 'claude-test',
      generatedAt: '2026-11-16T01:00:00.000Z',
    });
    expect(document?.markdown).toContain(`source: transcript.md`);
    expect(document?.updatedAt).not.toBeNull();
  });

  it('returns null when the file does not exist', async () => {
    const dir = await createDir();
    await expect(readCleanedTranscript(dir)).resolves.toBeNull();
  });

  it('removes the cleaned transcript', async () => {
    const dir = await createDir();
    await writeCleanedTranscript(dir, {
      title: '週次定例',
      startedAt: '2026-11-16T00:00:00.000Z',
      durationSeconds: 60,
      language: null,
      sourceBody: 'source',
      body: 'cleaned',
      state: 'partial',
      provider: 'claude',
      model: 'claude-test',
      generatedAt: '2026-11-16T01:00:00.000Z',
    });
    expect(
      await readCleanedTranscript(dir),
    ).not.toBeNull();
    await removeCleanedTranscript(dir);
    await expect(readCleanedTranscript(dir)).resolves.toBeNull();
    expect(join(dir, CLEANED_TRANSCRIPT_FILE)).toContain(
      'transcript.cleaned.md',
    );
  });
});
