import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * 機密のテキストを 0600 の一時ファイルへ書き、rename で置き換える。
 *
 * 書き込み途中のファイルを読ませず、umask に依存せずに権限を固定する。
 * 書き込み先が同じでも一時ファイル名は呼び出しごとに変える。
 */
export async function writePrivateText(
  path: string,
  text: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'w', 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (error) {
    // 元の書き込みエラーを隠さないよう、一時ファイルの削除失敗は無視する。
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
