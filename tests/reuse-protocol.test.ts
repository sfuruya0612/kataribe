/**
 * 音声強調のカスタムプロトコル、Range、トークン、ライセンスの許可を検証する。
 * 対応する要求: REQ-ENHANCE-001、共通基盤
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../src/main/csp';
import {
  REUSE_PROTOCOL_PRIVILEGES,
  REUSE_PROTOCOL_SCHEMES,
  ReuseTempTokenStore,
  isReuseLicenseKind,
  parseReuseUrl,
  registerReuseProtocols,
  reuseLicensePath,
  serveFileRange,
} from '../src/main/reuse-protocol';
import {
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

async function createModelFile(data: Buffer) {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-reuse-protocol-'));
  roots.push(root);
  const definition: ReuseModelDefinition = {
    id: 'nemotronlabs',
    label: 'NVIDIA NemotronLabs RE-USE',
    license: 'OpenMDW-1.1',
    fileName: 'nemotronlabs.safetensors',
    url: 'https://example.com/model.safetensors',
    sizeBytes: data.length,
    sha256: digest(data),
  };
  const modelsDir = join(root, 'models', 'reuse');
  await (await import('node:fs/promises')).mkdir(modelsDir, { recursive: true });
  await writeFile(join(modelsDir, definition.fileName), data);
  const manager = new ReuseModelManager({
    modelsDir,
    definitions: [definition],
  });
  return { manager, definition };
}

describe('parseReuseUrl', () => {
  it('parses the temp and model URLs with an allowed token and model', () => {
    expect(parseReuseUrl('kataribe-temp://enhance/abc-123')).toEqual({
      kind: 'temp',
      token: 'abc-123',
    });
    expect(parseReuseUrl('kataribe-model://reuse/nemotronlabs')).toEqual({
      kind: 'model',
      model: 'nemotronlabs',
    });
  });

  it('rejects unknown hosts, paths, queries, fragments, and model ids', () => {
    expect(parseReuseUrl('kataribe-temp://other/abc')).toBeNull();
    expect(parseReuseUrl('kataribe-temp://enhance/')).toBeNull();
    expect(parseReuseUrl('kataribe-temp://enhance/abc?path=/etc/passwd')).toBeNull();
    expect(parseReuseUrl('kataribe-temp://enhance/abc#fragment')).toBeNull();
    expect(parseReuseUrl('kataribe-model://reuse/nvidia/RE-USE')).toBeNull();
    expect(parseReuseUrl('kataribe-model://reuse/RE-USE')).toBeNull();
    expect(parseReuseUrl('file:///etc/passwd')).toBeNull();
  });
});

describe('ReuseTempTokenStore', () => {
  it('returns the path until the token expires or is revoked', () => {
    let now = 1000;
    const store = new ReuseTempTokenStore({
      now: () => now,
      ttlMs: 10,
      createToken: () => 'token',
    });
    const token = store.issue('/tmp/input.wav');
    expect(store.resolve(token)).toBe('/tmp/input.wav');
    now = 1010;
    expect(store.resolve(token)).toBeNull();
    expect(store.resolve(token)).toBeNull();

    const revoked = store.issue('/tmp/other.wav');
    store.revoke(revoked);
    expect(store.resolve(revoked)).toBeNull();
  });

  it('extends the expiry while the token keeps being read', () => {
    let now = 0;
    const store = new ReuseTempTokenStore({
      now: () => now,
      ttlMs: 10,
      createToken: () => 'token',
    });
    const token = store.issue('/tmp/input.wav');
    now = 9;
    expect(store.resolve(token)).toBe('/tmp/input.wav');
    now = 18;
    expect(store.resolve(token)).toBe('/tmp/input.wav');
    now = 27;
    expect(store.resolve(token)).toBe('/tmp/input.wav');
    now = 38;
    expect(store.resolve(token)).toBeNull();
  });
});

describe('serveFileRange', () => {
  it('returns the whole file without a Range header', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kataribe-range-'));
    roots.push(root);
    const path = join(root, 'audio.wav');
    await writeFile(path, '0123456789');
    const response = await serveFileRange(
      path,
      new Request('kataribe-temp://enhance/token'),
      'audio/wav',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe('10');
    expect(await response.text()).toBe('0123456789');
  });

  it('returns 206 with the requested byte range', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kataribe-range-'));
    roots.push(root);
    const path = join(root, 'audio.wav');
    await writeFile(path, '0123456789');
    const response = await serveFileRange(
      path,
      new Request('kataribe-temp://enhance/token', {
        headers: { Range: 'bytes=2-5' },
      }),
      'audio/wav',
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(response.headers.get('content-length')).toBe('4');
    expect(await response.text()).toBe('2345');
  });

  it('supports a suffix range and rejects an unsatisfiable range', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kataribe-range-'));
    roots.push(root);
    const path = join(root, 'audio.wav');
    await writeFile(path, '0123456789');
    const suffix = await serveFileRange(
      path,
      new Request('kataribe-temp://enhance/token', {
        headers: { Range: 'bytes=-4' },
      }),
      'audio/wav',
    );
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get('content-range')).toBe('bytes 6-9/10');
    expect(await suffix.text()).toBe('6789');

    const invalid = await serveFileRange(
      path,
      new Request('kataribe-temp://enhance/token', {
        headers: { Range: 'bytes=20-30' },
      }),
      'audio/wav',
    );
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get('content-range')).toBe('bytes */10');
  });

  it('returns 404 for a missing file', async () => {
    const response = await serveFileRange(
      join(tmpdir(), 'kataribe-no-such-file.wav'),
      new Request('kataribe-temp://enhance/token'),
      'audio/wav',
    );
    expect(response.status).toBe(404);
  });
});

describe('registerReuseProtocols', () => {
  it('serves only issued temp tokens and the installed model', async () => {
    const modelData = Buffer.from('model weights');
    const { manager } = await createModelFile(modelData);
    const tempTokens = new ReuseTempTokenStore({ createToken: () => 'temp' });
    const tempPath = join(tmpdir(), 'kataribe-reuse-input.wav');
    await writeFile(tempPath, 'wav input');
    const token = tempTokens.issue(tempPath);
    const handlers = new Map<
      string,
      (request: Request) => Promise<Response>
    >();
    registerReuseProtocols({
      protocol: {
        handle(scheme, handler) {
          handlers.set(scheme, handler);
        },
      },
      tempTokens,
      modelManager: manager,
    });
    expect([...handlers.keys()].sort()).toEqual([
      'kataribe-model',
      'kataribe-temp',
    ]);

    const tempHandler = handlers.get('kataribe-temp');
    const modelHandler = handlers.get('kataribe-model');
    expect(tempHandler).toBeDefined();
    expect(modelHandler).toBeDefined();
    if (!tempHandler || !modelHandler) {
      return;
    }
    const tempResponse = await tempHandler(
      new Request(`kataribe-temp://enhance/${token}`, {
        headers: { Range: 'bytes=0-2' },
      }),
    );
    expect(tempResponse.status).toBe(206);
    expect(await tempResponse.text()).toBe('wav');

    const modelResponse = await modelHandler(
      new Request('kataribe-model://reuse/nemotronlabs'),
    );
    expect(modelResponse.status).toBe(200);
    expect(await modelResponse.text()).toBe('model weights');

    const deniedModel = await modelHandler(
      new Request('kataribe-model://reuse/RE-USE'),
    );
    expect(deniedModel.status).toBe(404);

    const deniedToken = await tempHandler(
      new Request('kataribe-temp://enhance/not-issued'),
    );
    expect(deniedToken.status).toBe(404);
  });

  // 長い会議では強調に 10 分以上かかるため、読み出しが続く間はトークンを失効させない。
  it('serves a temp file across reads that outlast the initial token ttl', async () => {
    let now = 0;
    const tempTokens = new ReuseTempTokenStore({
      now: () => now,
      ttlMs: 10,
      createToken: () => 'temp',
    });
    const root = await mkdtemp(join(tmpdir(), 'kataribe-reuse-long-'));
    roots.push(root);
    const tempPath = join(root, 'input.wav');
    await writeFile(tempPath, 'wav input');
    const token = tempTokens.issue(tempPath);
    const { manager } = await createModelFile(Buffer.from('model weights'));
    const handlers = new Map<
      string,
      (request: Request) => Promise<Response>
    >();
    registerReuseProtocols({
      protocol: {
        handle(scheme, handler) {
          handlers.set(scheme, handler);
        },
      },
      tempTokens,
      modelManager: manager,
    });
    const tempHandler = handlers.get('kataribe-temp');
    expect(tempHandler).toBeDefined();
    if (!tempHandler) {
      return;
    }

    for (const time of [9, 18, 27]) {
      now = time;
      const response = await tempHandler(
        new Request(`kataribe-temp://enhance/${token}`, {
          headers: { Range: 'bytes=0-2' },
        }),
      );
      expect(response.status).toBe(206);
      expect(await response.text()).toBe('wav');
    }

    now = 38;
    const expired = await tempHandler(
      new Request(`kataribe-temp://enhance/${token}`, {
        headers: { Range: 'bytes=0-2' },
      }),
    );
    expect(expired.status).toBe(404);
  });
});

describe('licenses and schemes', () => {
  it('registers both schemes as privileged and adds both to connect-src', () => {
    expect(REUSE_PROTOCOL_SCHEMES).toEqual([
      'kataribe-temp',
      'kataribe-model',
    ]);
    expect(REUSE_PROTOCOL_PRIVILEGES).toEqual({
      standard: false,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    });
    for (const policy of [
      contentSecurityPolicy(true),
      contentSecurityPolicy(false),
    ]) {
      expect(policy).toContain('connect-src');
      expect(policy).toContain('kataribe-temp:');
      expect(policy).toContain('kataribe-model:');
    }
  });

  it('accepts only the engine and model license kinds', () => {
    expect(isReuseLicenseKind('engine')).toBe(true);
    expect(isReuseLicenseKind('model')).toBe(true);
    expect(isReuseLicenseKind('research')).toBe(false);
    expect(isReuseLicenseKind(null)).toBe(false);
  });

  it('resolves fixed license paths for development and packaged builds', () => {
    expect(
      reuseLicensePath('engine', {
        isPackaged: false,
        resourcesPath: '/packaged/resources',
        appPath: '/app',
      }),
    ).toBe('/app/resources/licenses/reuse-webgpu-engine-LICENSE.txt');
    expect(
      reuseLicensePath('model', {
        isPackaged: true,
        resourcesPath: '/packaged/resources',
        appPath: '/app',
      }),
    ).toBe(
      '/packaged/resources/licenses/nvidia-nemotronlabs-re-use-LICENSE.txt',
    );
  });
});
