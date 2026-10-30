import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ModelManager,
  WHISPER_MODEL_DEFINITIONS,
  type WhisperModelDefinition,
} from '../src/main/models';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createManager(
  data: Buffer,
  overrides: Partial<WhisperModelDefinition> = {},
  fetchImpl?: typeof fetch,
) {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-models-'));
  roots.push(root);
  const definition: WhisperModelDefinition = {
    model: 'small',
    fileName: 'ggml-test.bin',
    url: 'https://example.com/ggml-test.bin',
    sizeBytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    ...overrides,
  };
  const manager = new ModelManager({
    modelsDir: join(root, 'models'),
    definitions: [definition],
    freeBytes: async () => 1024 * 1024 * 1024,
    fetch: fetchImpl,
  });
  return { root, definition, manager };
}

function streamResponse(data: Buffer, status = 200, headers: Record<string, string> = {}) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(data));
      controller.close();
    },
  });
  return new Response(body, { status, headers });
}

describe('whisper model catalog', () => {
  it('contains the three supported models with sha256 digests', () => {
    expect(WHISPER_MODEL_DEFINITIONS.map((entry) => entry.model)).toEqual([
      'large-v3-turbo',
      'medium',
      'small',
    ]);
    for (const entry of WHISPER_MODEL_DEFINITIONS) {
      expect(entry.url).toMatch(/^https:\/\//);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.sizeBytes).toBeGreaterThan(0);
    }
  });
});

describe('ModelManager', () => {
  it('downloads, verifies, and lists an installed model', async () => {
    const data = Buffer.from('test model bytes');
    let receivedRange: string | null = null;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      receivedRange = new Headers(init?.headers).get('range');
      return streamResponse(data, 200, { 'content-length': String(data.length) });
    });
    const { manager } = await createManager(data, {}, fetchImpl as unknown as typeof fetch);
    await manager.download('small');
    expect(receivedRange).toBeNull();
    const list = await manager.list();
    expect(list.models[0]).toMatchObject({
      installed: true,
      state: 'installed',
      installedBytes: data.length,
      progress: null,
    });
    expect(await manager.installedPath('small')).toContain('ggml-test.bin');
  });

  it('resumes a partial download with a Range request', async () => {
    const data = Buffer.from('0123456789abcdef');
    const split = 7;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('range')).toBe(`bytes=${split}-`);
      return streamResponse(data.subarray(split), 206, {
        'content-length': String(data.length - split),
      });
    });
    const { root, manager } = await createManager(data, {}, fetchImpl as unknown as typeof fetch);
    const partPath = join(root, 'models', 'ggml-test.bin.part');
    await rm(join(root, 'models'), { recursive: true, force: true });
    await (await import('node:fs/promises')).mkdir(join(root, 'models'), { recursive: true });
    await writeFile(partPath, data.subarray(0, split));

    await manager.download('small');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readFile(join(root, 'models', 'ggml-test.bin'))).toEqual(data);
  });

  it('rejects a checksum mismatch and records the error', async () => {
    const data = Buffer.from('expected bytes');
    const wrong = Buffer.from('wrong bytes!!!');
    const fetchImpl = vi.fn(async () => streamResponse(wrong, 200, {
      'content-length': String(wrong.length),
    }));
    const { manager } = await createManager(data, {}, fetchImpl as unknown as typeof fetch);
    await expect(manager.download('small')).rejects.toThrow(/checksum mismatch/);
    const list = await manager.list();
    expect(list.models[0].installed).toBe(false);
    expect(list.models[0].state).toBe('error');
    expect(list.models[0].error).toContain('checksum mismatch');
  });

  it('deletes installed and partial files', async () => {
    const data = Buffer.from('delete me');
    const fetchImpl = vi.fn(async () => streamResponse(data, 200, {
      'content-length': String(data.length),
    }));
    const { root, manager } = await createManager(data, {}, fetchImpl as unknown as typeof fetch);
    await manager.download('small');
    await manager.delete('small');
    expect((await manager.list()).models[0].installed).toBe(false);
    await expect(readFile(join(root, 'models', 'ggml-test.bin'))).rejects.toThrow();
  });

  it('reports insufficient disk space before downloading', async () => {
    const data = Buffer.from('space');
    const root = await mkdtemp(join(tmpdir(), 'kataribe-models-'));
    roots.push(root);
    const manager = new ModelManager({
      modelsDir: join(root, 'models'),
      definitions: [
        {
          model: 'small',
          fileName: 'ggml-test.bin',
          url: 'https://example.com/model',
          sizeBytes: data.length,
          sha256: createHash('sha256').update(data).digest('hex'),
        },
      ],
      freeBytes: async () => 1,
    });
    await expect(manager.download('small')).rejects.toThrow(/not enough disk space/);
  });
});
