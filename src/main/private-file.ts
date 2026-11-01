import { chmod, mkdir, open, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * 機密のテキストを 0600 の一時ファイルへ書き、rename で置き換える。
 *
 * 書き込み途中のファイルを読ませず、umask に依存せずに権限を固定する。
 */
export async function writePrivateText(
  path: string,
  text: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  const handle = await open(temporary, 'w', 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}
