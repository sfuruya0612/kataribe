import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileSize } from '../src/main/asset-download';
import {
  DiarizationModelManager,
  type DiarizationAssetDefinition,
} from '../src/main/diarization-models';

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
  const root = await mkdtemp(join(tmpdir(), 'kataribe-diarization-models-'));
  roots.push(root);
  return root;
}

function digest(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

type Fixture = {
  archive: Buffer;
  segmentation: Buffer;
  embedding: Buffer;
  definitions: DiarizationAssetDefinition[];
};

async function createFixture(root: string, options: { wrongChecksum?: boolean } = {}): Promise<Fixture> {
  const packageDir = join(root, 'package', 'sherpa-test-1.0');
  await mkdir(packageDir, { recursive: true });
  const segmentation = Buffer.alloc(1024 * 1024, 3);
  const embedding = Buffer.from('embedding model bytes');
  await writeFile(join(packageDir, 'model.onnx'), segmentation);
  const archivePath = join(root, 'segmentation.tar.bz2');
  execFileSync('/usr/bin/tar', ['-cjf', archivePath, '-C', join(root, 'package'), 'sherpa-test-1.0']);
  const archive = await readFile(archivePath);

  return {
    archive,
    segmentation,
    embedding,
    definitions: [
      {
        kind: 'segmentation',
        url: 'http://127.0.0.1/segmentation.tar.bz2',
        downloadName: 'segmentation.tar.bz2',
        fileName: 'segmentation.onnx',
        sizeBytes: archive.length,
        sha256: options.wrongChecksum ? '0'.repeat(64) : digest(archive),
        finalSizeBytes: segmentation.length,
        finalSha256: digest(segmentation),
        archiveEntry: 'sherpa-test-1.0/model.onnx',
      },
      {
        kind: 'embedding',
        url: 'http://127.0.0.1/embedding.onnx',
        downloadName: 'embedding.onnx',
        fileName: 'embedding.onnx',
        sizeBytes: embedding.length,
        sha256: options.wrongChecksum ? '1'.repeat(64) : digest(embedding),
        finalSizeBytes: embedding.length,
        finalSha256: digest(embedding),
      },
    ],
  };
}

async function startServer(fixture: Fixture, options: { stallSegmentation?: boolean } = {}) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    requests.push(url);
    const data = url.includes('segmentation')
      ? fixture.archive
      : fixture.embedding;
    if (url.includes('segmentation') && options.stallSegmentation) {
      response.writeHead(200, { 'Content-Length': String(data.length) });
      response.write(data.subarray(0, 4096));
      return;
    }
    const range = request.headers.range ?? null;
    if (range !== null) {
      const start = Number(range.match(/^bytes=(\d+)-$/u)?.[1] ?? 0);
      if (start >= data.length) {
        response.writeHead(416);
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
    response.end(data);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('test server did not bind to a port');
  }
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    requests,
    definitions: fixture.definitions.map((definition) => ({
      ...definition,
      url: `${base}${new URL(definition.url).pathname}`,
    })),
  };
}

describe('DiarizationModelManager', () => {
  it('downloads, extracts, and installs both models', async () => {
    const root = await createRoot();
    const fixture = await createFixture(root);
    const server = await startServer(fixture);
    const modelsDir = join(root, 'models');
    const progress: string[] = [];
    const manager = new DiarizationModelManager({
      modelsDir,
      definitions: server.definitions,
      onProgress: (value) => progress.push(`${value.state}:${value.progress}`),
    });

    expect(await manager.status()).toMatchObject({
      installed: false,
      state: 'missing',
      progress: 0,
    });

    const paths = await manager.ensureInstalled();

    expect(await readFile(paths.segmentation)).toEqual(fixture.segmentation);
    expect(await readFile(paths.embedding)).toEqual(fixture.embedding);
    expect(await fileSize(join(modelsDir, 'segmentation.tar.bz2'))).toBeNull();
    expect(await manager.status()).toMatchObject({
      installed: true,
      state: 'installed',
      downloadedBytes: server.definitions.reduce((sum, item) => sum + item.sizeBytes, 0),
      totalBytes: server.definitions.reduce((sum, item) => sum + item.sizeBytes, 0),
      progress: 1,
      error: null,
    });
    expect(progress.at(0)).toMatch(/^downloading:/u);
  });

  it('reuses validated installed files without another request', async () => {
    const root = await createRoot();
    const fixture = await createFixture(root);
    const server = await startServer(fixture);
    const manager = new DiarizationModelManager({
      modelsDir: join(root, 'models'),
      definitions: server.definitions,
    });

    await manager.ensureInstalled();
    const requestsAfterFirst = server.requests.length;
    await manager.ensureInstalled();

    expect(server.requests.length).toBe(requestsAfterFirst);
  });

  it('resumes a partial download with a Range request', async () => {
    const root = await createRoot();
    const fixture = await createFixture(root);
    const server = await startServer(fixture);
    const modelsDir = join(root, 'models');
    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, 'segmentation.tar.bz2.part'), fixture.archive.subarray(0, 10));
    const manager = new DiarizationModelManager({
      modelsDir,
      definitions: server.definitions,
    });

    await manager.ensureInstalled();

    expect(
      server.requests.some((request) => request.includes('segmentation')),
    ).toBe(true);
    expect(await readFile(join(modelsDir, 'segmentation.onnx'))).toEqual(fixture.segmentation);
  });

  it('records a checksum mismatch and leaves the final file absent', async () => {
    const root = await createRoot();
    const fixture = await createFixture(root, { wrongChecksum: true });
    const server = await startServer(fixture);
    const manager = new DiarizationModelManager({
      modelsDir: join(root, 'models'),
      definitions: server.definitions,
    });

    await expect(manager.ensureInstalled()).rejects.toThrow(/checksum mismatch/u);
    const status = await manager.status();
    expect(status.installed).toBe(false);
    expect(status.state).toBe('error');
    expect(status.error).toContain('checksum mismatch');
    expect(await fileSize(join(root, 'models', 'segmentation.onnx'))).toBeNull();
  });

  it('deduplicates concurrent downloads', async () => {
    const root = await createRoot();
    const fixture = await createFixture(root);
    const server = await startServer(fixture);
    const manager = new DiarizationModelManager({
      modelsDir: join(root, 'models'),
      definitions: server.definitions,
    });

    const [left, right] = await Promise.all([
      manager.ensureInstalled(),
      manager.ensureInstalled(),
    ]);

    expect(left).toEqual(right);
    expect(server.requests.length).toBe(2);
  });

  it('cancels an active download and keeps the partial file', async () => {
    const root = await createRoot();
    const fixture = await createFixture(root);
    const server = await startServer(fixture, { stallSegmentation: true });
    const modelsDir = join(root, 'models');
    const manager = new DiarizationModelManager({
      modelsDir,
      definitions: server.definitions,
      onProgress: (value) => {
        if (value.downloadedBytes > 0) {
          manager.cancel();
        }
      },
    });

    await expect(manager.ensureInstalled()).rejects.toThrow();
    expect(await fileSize(join(modelsDir, 'segmentation.tar.bz2.part'))).toBeGreaterThan(0);
    const status = await manager.status();
    expect(status.state).toBe('missing');
    expect(status.error).toBeNull();
  });
});
