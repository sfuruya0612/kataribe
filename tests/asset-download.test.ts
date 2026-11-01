import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  downloadAsset,
  fileSize,
  hashFile,
  type AssetProgress,
} from '../src/main/asset-download';

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-asset-'));
  roots.push(root);
  return root;
}

type ServerOptions = {
  status?: number;
  ignoreRange?: boolean;
  stallAfterBytes?: number;
};

async function startServer(data: Buffer, options: ServerOptions = {}) {
  const requests: Array<string | null> = [];
  const server = createServer((request, response) => {
    const range = request.headers.range ?? null;
    requests.push(range);
    if (options.status !== undefined) {
      response.writeHead(options.status);
      response.end('failed');
      return;
    }
    if (range !== null && !options.ignoreRange) {
      const match = range.match(/^bytes=(\d+)-$/u);
      const start = match ? Number(match[1]) : 0;
      if (start >= data.length) {
        response.writeHead(416, { 'Content-Range': `bytes */${data.length}` });
        response.end();
        return;
      }
      response.writeHead(206, {
        'Content-Length': String(data.length - start),
        'Content-Range': `bytes ${start}-${data.length - 1}/${data.length}`,
      });
      response.end(data.subarray(start));
      return;
    }
    response.writeHead(200, { 'Content-Length': String(data.length) });
    if (options.stallAfterBytes !== undefined) {
      response.write(data.subarray(0, options.stallAfterBytes));
      return;
    }
    response.end(data);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('test server did not bind to a port');
  }
  return {
    url: `http://127.0.0.1:${address.port}/asset.bin`,
    requests,
  };
}

function digest(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

describe('downloadAsset', () => {
  it('downloads a complete file and reports progress', async () => {
    const data = Buffer.from('asset payload');
    const root = await createRoot();
    const destination = join(root, 'models', 'asset.bin');
    const { url, requests } = await startServer(data);
    const progress: AssetProgress[] = [];
    const states: string[] = [];

    await downloadAsset({
      url,
      destinationPath: destination,
      sizeBytes: data.length,
      sha256: digest(data),
      onProgress: (value) => progress.push(value),
      onState: (state) => states.push(state),
    });

    expect(await readFile(destination)).toEqual(data);
    expect(requests).toEqual([null]);
    expect(progress.at(-1)).toEqual({
      downloadedBytes: data.length,
      totalBytes: data.length,
      progress: 1,
    });
    expect(states).toEqual(['downloading', 'verifying']);
  });

  it('replaces a corrupted existing file when verification is requested', async () => {
    const data = Buffer.from('fresh bytes');
    const root = await createRoot();
    const destination = join(root, 'asset.bin');
    await writeFile(destination, Buffer.alloc(data.length, 1));
    const { url, requests } = await startServer(data);

    await downloadAsset({
      url,
      destinationPath: destination,
      sizeBytes: data.length,
      sha256: digest(data),
      verifyExisting: true,
    });

    expect(requests).toEqual([null]);
    expect(await readFile(destination)).toEqual(data);
  });

  it('resumes from a partial file with a Range request', async () => {
    const data = Buffer.from('0123456789abcdef');
    const split = 7;
    const root = await createRoot();
    const destination = join(root, 'asset.bin');
    await writeFile(`${destination}.part`, data.subarray(0, split));
    const { url, requests } = await startServer(data);

    await downloadAsset({
      url,
      destinationPath: destination,
      sizeBytes: data.length,
      sha256: digest(data),
    });

    expect(requests).toEqual([`bytes=${split}-`]);
    expect(await readFile(destination)).toEqual(data);
    expect(await fileSize(`${destination}.part`)).toBeNull();
  });

  it('restarts from zero when the server ignores the Range header', async () => {
    const data = Buffer.from('abcdefghij');
    const root = await createRoot();
    const destination = join(root, 'asset.bin');
    await writeFile(`${destination}.part`, data.subarray(0, 4));
    const { url } = await startServer(data, { ignoreRange: true });

    await downloadAsset({
      url,
      destinationPath: destination,
      sizeBytes: data.length,
      sha256: digest(data),
    });

    expect(await readFile(destination)).toEqual(data);
  });

  it('accepts a complete partial file from a 416 response', async () => {
    const data = Buffer.from('complete partial');
    const root = await createRoot();
    const destination = join(root, 'asset.bin');
    await writeFile(`${destination}.part`, data);
    const { url, requests } = await startServer(data);

    await downloadAsset({
      url,
      destinationPath: destination,
      sizeBytes: data.length,
      sha256: digest(data),
    });

    expect(requests).toEqual([`bytes=${data.length}-`]);
    expect(await readFile(destination)).toEqual(data);
  });

  it('removes the partial file on a checksum mismatch', async () => {
    const data = Buffer.from('checksum payload');
    const root = await createRoot();
    const destination = join(root, 'asset.bin');
    const { url } = await startServer(data);

    await expect(
      downloadAsset({
        url,
        destinationPath: destination,
        sizeBytes: data.length,
        sha256: '0'.repeat(64),
      }),
    ).rejects.toThrow(/checksum mismatch/u);
    expect(await fileSize(`${destination}.part`)).toBeNull();
    expect(await fileSize(destination)).toBeNull();
  });

  it('rejects an HTTP error', async () => {
    const root = await createRoot();
    const { url } = await startServer(Buffer.from('x'), { status: 503 });

    await expect(
      downloadAsset({
        url,
        destinationPath: join(root, 'asset.bin'),
        sizeBytes: 1,
        sha256: '0'.repeat(64),
      }),
    ).rejects.toThrow(/HTTP 503/u);
  });

  it('rejects a download when free space is insufficient', async () => {
    const data = Buffer.from('space');
    const root = await createRoot();
    const { url } = await startServer(data);

    await expect(
      downloadAsset({
        url,
        destinationPath: join(root, 'asset.bin'),
        sizeBytes: data.length,
        sha256: digest(data),
        freeBytes: async () => 1,
      }),
    ).rejects.toThrow(/not enough disk space/u);
  });

  it('keeps the partial file when the download is aborted', async () => {
    const data = Buffer.alloc(1024 * 1024, 7);
    const root = await createRoot();
    const destination = join(root, 'asset.bin');
    const { url } = await startServer(data, { stallAfterBytes: 4096 });
    const controller = new AbortController();

    await expect(
      downloadAsset({
        url,
        destinationPath: destination,
        sizeBytes: data.length,
        sha256: digest(data),
        signal: controller.signal,
        reportIntervalMs: 0,
        onProgress: (progress) => {
          if (progress.downloadedBytes > 0) {
            controller.abort();
          }
        },
      }),
    ).rejects.toThrow();
    expect(await fileSize(`${destination}.part`)).toBeGreaterThan(0);
    expect(await fileSize(destination)).toBeNull();
  });
});

describe('file helpers', () => {
  it('returns null for a missing file', async () => {
    expect(await fileSize(join(tmpdir(), 'kataribe-no-such-file'))).toBeNull();
  });

  it('hashes a file with SHA-256', async () => {
    const root = await createRoot();
    const path = join(root, 'data.bin');
    await writeFile(path, 'hash me');
    expect(await hashFile(path)).toBe(digest(Buffer.from('hash me')));
  });
});
