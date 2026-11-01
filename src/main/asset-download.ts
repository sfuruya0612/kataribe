import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  open,
  rename,
  rm,
  stat,
  statfs,
} from 'node:fs/promises';
import { basename, dirname } from 'node:path';

export type AssetProgress = {
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
};

export type AssetState = 'downloading' | 'verifying';

export type AssetDownloadOptions = {
  url: string;
  destinationPath: string;
  sizeBytes: number;
  sha256: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  freeBytes?: (directory: string) => Promise<number>;
  onProgress?: (progress: AssetProgress) => void;
  onState?: (state: AssetState) => void;
  now?: () => number;
  reportIntervalMs?: number;
  verifyExisting?: boolean;
};

const MINIMUM_FREE_BYTES = 64 * 1024 * 1024;
const HASH_BUFFER_BYTES = 1024 * 1024;

export async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(HASH_BUFFER_BYTES);
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead <= 0) {
        break;
      }
      hash.update(buffer.subarray(0, result.bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

async function defaultFreeBytes(path: string): Promise<number> {
  const info = await statfs(path);
  return info.bavail * info.bsize;
}

function progressValue(downloadedBytes: number, totalBytes: number): number {
  return totalBytes > 0 ? Math.min(1, downloadedBytes / totalBytes) : 0;
}

/**
 * HTTPS で 1 つの資産を取得し、サイズと SHA-256 を照合して保存する。
 */
export async function downloadAsset(options: AssetDownloadOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const freeBytes = options.freeBytes ?? defaultFreeBytes;
  const now = options.now ?? (() => Date.now());
  const reportIntervalMs = options.reportIntervalMs ?? 200;
  const directory = dirname(options.destinationPath);
  const partPath = `${options.destinationPath}.part`;
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const installedSize = await fileSize(options.destinationPath);
  if (installedSize === options.sizeBytes) {
    const installedDigest = options.verifyExisting
      ? await hashFile(options.destinationPath)
      : null;
    if (installedDigest === null || installedDigest === options.sha256) {
      options.onProgress?.({
        downloadedBytes: options.sizeBytes,
        totalBytes: options.sizeBytes,
        progress: 1,
      });
      return;
    }
  }
  if (installedSize !== null) {
    await rm(options.destinationPath, { force: true });
  }

  const existingPart = (await fileSize(partPath)) ?? 0;
  if (existingPart > options.sizeBytes) {
    await rm(partPath, { force: true });
  }
  const startBytes = Math.min((await fileSize(partPath)) ?? 0, options.sizeBytes);
  const required = Math.max(0, options.sizeBytes - startBytes) + MINIMUM_FREE_BYTES;
  const available = await freeBytes(directory);
  if (available < required) {
    throw new Error(
      `not enough disk space for ${basename(options.destinationPath)}: need ${required} bytes, have ${available}`,
    );
  }

  let downloadedBytes = startBytes;
  let lastReportAt = 0;
  const report = (force: boolean) => {
    const timestamp = now();
    if (!force && timestamp - lastReportAt < reportIntervalMs) {
      return;
    }
    lastReportAt = timestamp;
    options.onProgress?.({
      downloadedBytes,
      totalBytes: options.sizeBytes,
      progress: progressValue(downloadedBytes, options.sizeBytes),
    });
  };

  options.onState?.('downloading');
  report(true);
  if (options.signal?.aborted) {
    throw new DOMException('download was cancelled', 'AbortError');
  }

  const headers: Record<string, string> = {};
  if (startBytes > 0) {
    headers.Range = `bytes=${startBytes}-`;
  }
  const response = await fetchImpl(options.url, {
    headers,
    signal: options.signal,
    redirect: 'follow',
  });
  if (response.status === 416 && startBytes === options.sizeBytes) {
    // The part file is already complete; verify it below.
  } else if (!response.ok) {
    throw new Error(
      `download failed: HTTP ${response.status} ${response.statusText}`,
    );
  }

  if (response.status !== 416) {
    const append = response.status === 206 && startBytes > 0;
    if (!append) {
      downloadedBytes = 0;
    }
    const handle = await open(partPath, append ? 'a' : 'w', 0o600);
    try {
      if (!response.body) {
        throw new Error('download returned an empty body');
      }
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (options.signal?.aborted) {
          throw new DOMException('download was cancelled', 'AbortError');
        }
        if (value && value.byteLength > 0) {
          await handle.write(Buffer.from(value));
          downloadedBytes += value.byteLength;
          report(false);
        }
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  options.onState?.('verifying');
  options.onProgress?.({
    downloadedBytes: options.sizeBytes,
    totalBytes: options.sizeBytes,
    progress: 1,
  });

  const downloadedSize = await fileSize(partPath);
  if (downloadedSize !== options.sizeBytes) {
    throw new Error(
      `download is incomplete: expected ${options.sizeBytes} bytes, got ${downloadedSize ?? 0}`,
    );
  }
  const digest = await hashFile(partPath);
  if (digest !== options.sha256) {
    await rm(partPath, { force: true });
    throw new Error(
      `checksum mismatch: expected ${options.sha256}, got ${digest}`,
    );
  }
  await chmod(partPath, 0o600);
  await rename(partPath, options.destinationPath);
}
