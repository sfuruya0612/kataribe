/**
 * 機密ファイルの一時ファイル経由の書き込みを検証する。
 * 対応する要求: なし (内部のファイル書き込みの不変条件)
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writePrivateText } from '../src/main/private-file';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('writePrivateText', () => {
  it('writes concurrently to the same path without a temporary file race', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kataribe-private-file-'));
    roots.push(root);
    const path = join(root, 'summary.md');

    await Promise.all([
      writePrivateText(path, 'A'),
      writePrivateText(path, 'B'),
    ]);

    expect(['A', 'B']).toContain(await readFile(path, 'utf8'));
    expect(await readdir(root)).toEqual(['summary.md']);
  });
});
