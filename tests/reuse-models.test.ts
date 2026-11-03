/**
 * 音声強調モデルのカタログ、取得、照合、削除を検証する。
 * 対応する要求: REQ-ENHANCE-001
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REUSE_MODEL_DEFINITIONS,
  ReuseModelManager,
  type ReuseModelDefinition,
} from '../src/main/reuse-models';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function digest(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function streamResponse(
  data: Buffer,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(data));
      controller.close();
    },
  });
  return new Response(body, { status, headers });
}

async function createManager(
  data: Buffer,
  overrides: Partial<ReuseModelDefinition> = {},
  fetchImpl?: typeof fetch,
  onProgress?: (progress: { progress: number }) => void,
) {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-reuse-models-'));
  roots.push(root);
  const definition: ReuseModelDefinition = {
    id: 'nemotronlabs',
    label: 'NVIDIA NemotronLabs RE-USE',
    license: 'OpenMDW-1.1',
    fileName: 'nemotronlabs.safetensors',
    url: 'https://example.com/nemotronlabs.safetensors',
    sizeBytes: data.length,
    sha256: digest(data),
    ...overrides,
  };
  const modelsDir = join(root, 'models', 'reuse');
  const manager = new ReuseModelManager({
    modelsDir,
    definitions: [definition],
    freeBytes: async () => 1024 * 1024 * 1024,
    fetch: fetchImpl,
    onProgress,
  });
  return { root, modelsDir, definition, manager };
}

describe('reuse model catalog', () => {
  it('contains only the commercially usable nemotronlabs model', () => {
    expect(REUSE_MODEL_DEFINITIONS).toHaveLength(1);
    expect(REUSE_MODEL_DEFINITIONS[0]).toEqual({
      id: 'nemotronlabs',
      label: 'NVIDIA NemotronLabs RE-USE',
      license: 'OpenMDW-1.1',
      fileName: 'nemotronlabs.safetensors',
      url: 'https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE/resolve/31f82f2efad1095034492f236e8dac9239ba713b/model.safetensors',
      sizeBytes: 38_592_940,
      sha256:
        '06badaf4029b297f97f7fe48d62990b48d5482608210df577354e0d4e0ed70e1',
    });
  });
});

describe('ReuseModelManager', () => {
  it('downloads, verifies, and lists the installed model', async () => {
    const data = Buffer.from('reuse model bytes');
    const fetchImpl = vi.fn(async () =>
      streamResponse(data, 200, { 'content-length': String(data.length) }),
    );
    const { manager, modelsDir, definition } = await createManager(
      data,
      {},
      fetchImpl as unknown as typeof fetch,
    );
    const progress: number[] = [];
    const managerWithProgress = new ReuseModelManager({
      modelsDir,
      definitions: [definition],
      freeBytes: async () => 1024 * 1024 * 1024,
      fetch: fetchImpl as unknown as typeof fetch,
      onProgress: (value) => progress.push(value.progress),
    });
    await managerWithProgress.download('nemotronlabs');
    const list = await managerWithProgress.list();
    expect(list.models[0]).toMatchObject({
      id: 'nemotronlabs',
      installed: true,
      downloading: false,
      progress: null,
      error: null,
    });
    expect(await managerWithProgress.installedPath('nemotronlabs')).toContain(
      'nemotronlabs.safetensors',
    );
    expect(progress.at(-1)).toBe(1);
  });

  it('resumes a partial download with a Range request', async () => {
    const data = Buffer.from('0123456789abcdef');
    const split = 7;
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).get('range')).toBe(`bytes=${split}-`);
        return streamResponse(data.subarray(split), 206, {
          'content-length': String(data.length - split),
        });
      },
    );
    const { root, manager } = await createManager(
      data,
      {},
      fetchImpl as unknown as typeof fetch,
    );
    const modelsDir = join(root, 'models', 'reuse');
    await (await import('node:fs/promises')).mkdir(modelsDir, { recursive: true });
    await writeFile(
      join(modelsDir, 'nemotronlabs.safetensors.part'),
      data.subarray(0, split),
    );

    await manager.download('nemotronlabs');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readFile(join(modelsDir, 'nemotronlabs.safetensors'))).toEqual(
      data,
    );
    await expect(
      stat(join(modelsDir, 'nemotronlabs.safetensors.part')),
    ).rejects.toThrow();
  });

  it('reports progress and cancellation without recording an error', async () => {
    const data = Buffer.from('cancelled model bytes');
    let cancelRequested = false;
    const progress: number[] = [];
    const { manager } = await createManager(
      data,
      {},
      (async () => {
        throw new Error('fetch should not run');
      }) as unknown as typeof fetch,
      (value) => {
        progress.push(value.progress);
        if (!cancelRequested) {
          cancelRequested = true;
          expect(manager.cancel('nemotronlabs')).toBe(true);
        }
      },
    );
    await expect(manager.download('nemotronlabs')).rejects.toThrow();
    expect(progress.length).toBeGreaterThan(0);
    expect((await manager.list()).models[0].error).toBeNull();
  });

  it('rejects a same-size file whose content does not match', async () => {
    const data = Buffer.from('correct model');
    const wrong = Buffer.from('corrupted data');
    const fetchImpl = vi.fn(async () =>
      streamResponse(data, 200, { 'content-length': String(data.length) }),
    );
    const { root, manager } = await createManager(
      data,
      {},
      fetchImpl as unknown as typeof fetch,
    );
    const modelsDir = join(root, 'models', 'reuse');
    await (await import('node:fs/promises')).mkdir(modelsDir, { recursive: true });
    const path = join(modelsDir, 'nemotronlabs.safetensors');
    await writeFile(path, wrong);

    expect((await manager.list()).models[0].installed).toBe(false);
    await manager.download('nemotronlabs');
    expect(await readFile(path)).toEqual(data);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects deleting a model that an enhancement job is using', async () => {
    const data = Buffer.from('in use model');
    const { manager } = await createManager(data);
    const release = manager.acquire('nemotronlabs');
    await expect(manager.delete('nemotronlabs')).rejects.toThrow(/in use/u);
    release();
    await expect(manager.delete('nemotronlabs')).resolves.toBeUndefined();
  });

  it('records a checksum mismatch as an error and removes the partial file', async () => {
    const data = Buffer.from('expected model');
    const wrong = Buffer.alloc(data.length, 7);
    const fetchImpl = vi.fn(async () =>
      streamResponse(wrong, 200, { 'content-length': String(wrong.length) }),
    );
    const { manager } = await createManager(
      data,
      {},
      fetchImpl as unknown as typeof fetch,
    );
    await expect(manager.download('nemotronlabs')).rejects.toThrow(
      /checksum mismatch/u,
    );
    const list = await manager.list();
    expect(list.models[0].installed).toBe(false);
    expect(list.models[0].error).toContain('checksum mismatch');
  });

  it('rejects an unknown model id', async () => {
    const data = Buffer.from('model');
    const { manager } = await createManager(data);
    await expect(
      manager.download('nvidia/RE-USE' as 'nemotronlabs'),
    ).rejects.toThrow(/unsupported reuse model/u);
  });
});
