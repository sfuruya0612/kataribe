import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiKeyError,
  ApiKeyStore,
  type SecretCrypto,
} from '../src/main/api-keys';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeCrypto implements SecretCrypto {
  available = true;
  reEncryptNext = false;

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async encrypt(plainText: string): Promise<Buffer> {
    return Buffer.from(`encrypted:${plainText}`, 'utf8');
  }

  async decrypt(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }> {
    const result = encrypted.toString('utf8').replace(/^encrypted:/, '');
    const shouldReEncrypt = this.reEncryptNext;
    this.reEncryptNext = false;
    return { result, shouldReEncrypt };
  }
}

async function createStore(crypto = new FakeCrypto()) {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-api-keys-'));
  roots.push(root);
  const filePath = join(root, 'config.json');
  const store = new ApiKeyStore({ filePath, crypto });
  await store.load();
  return { root, filePath, crypto, store };
}

describe('ApiKeyStore', () => {
  it('stores an encrypted key per profile and reloads it', async () => {
    const { filePath, crypto, store } = await createStore();
    const status = await store.setKey(
      'work-claude',
      'claude',
      'sk-ant-secret',
      'https://api.anthropic.com/v1',
    );
    expect(status).toMatchObject({
      profileId: 'work-claude',
      configured: true,
      host: 'api.anthropic.com',
      keychainAvailable: true,
    });
    const config = await readFile(filePath, 'utf8');
    expect(config).not.toContain('sk-ant-secret');
    expect(config).toContain('api.anthropic.com');
    expect(config).toContain('profile_id');

    const reloaded = new ApiKeyStore({ filePath, crypto });
    await reloaded.load();
    expect(
      await reloaded.getKey('work-claude', 'https://api.anthropic.com/v1'),
    ).toBe('sk-ant-secret');
  });

  it('keeps different keys for profiles that use the same provider', async () => {
    const { store } = await createStore();
    await store.setKey(
      'work-claude',
      'claude',
      'sk-work',
      'https://api.anthropic.com/v1',
    );
    await store.setKey(
      'personal-claude',
      'claude',
      'sk-personal',
      'https://api.anthropic.com/v1',
    );
    expect(
      await store.getKey('work-claude', 'https://api.anthropic.com/v1'),
    ).toBe('sk-work');
    expect(
      await store.getKey('personal-claude', 'https://api.anthropic.com/v1'),
    ).toBe('sk-personal');
  });

  it('renames a key when the profile ID changes', async () => {
    const { store } = await createStore();
    await store.setKey(
      'work-claude',
      'claude',
      'sk-ant-secret',
      'https://api.anthropic.com/v1',
    );
    await store.renameKey('work-claude', 'team-claude');
    expect(
      await store.getKey('work-claude', 'https://api.anthropic.com/v1'),
    ).toBeNull();
    expect(
      await store.getKey('team-claude', 'https://api.anthropic.com/v1'),
    ).toBe('sk-ant-secret');
  });

  it('rejects a key when the provider changes on the same host', async () => {
    const { store } = await createStore();
    await store.setKey(
      'work-claude',
      'claude',
      'sk-ant-secret',
      'https://proxy.example.com/v1',
    );
    expect(
      store.hostMatches(
        'work-claude',
        'https://proxy.example.com/v1',
        'chatgpt',
      ),
    ).toBe(false);
    await expect(
      store.getKey(
        'work-claude',
        'https://proxy.example.com/v1',
        'chatgpt',
      ),
    ).rejects.toMatchObject({ code: 'host-mismatch' });
  });

  it('rejects a key when the endpoint host changes', async () => {
    const { store } = await createStore();
    await store.setKey(
      'work-claude',
      'claude',
      'sk-ant-secret',
      'https://api.anthropic.com/v1',
    );
    expect(
      store.hostMatches('work-claude', 'https://proxy.example.com/v1'),
    ).toBe(false);
    await expect(
      store.getKey('work-claude', 'https://proxy.example.com/v1'),
    ).rejects.toMatchObject({ code: 'host-mismatch' });
  });

  it('clears a stored key', async () => {
    const { store } = await createStore();
    await store.setKey(
      'work-chatgpt',
      'chatgpt',
      'sk-openai-secret',
      'https://api.openai.com/v1',
    );
    await store.clearKey('work-chatgpt');
    expect(
      await store.status('work-chatgpt', 'https://api.openai.com/v1'),
    ).toMatchObject({
      configured: false,
    });
    expect(
      await store.getKey('work-chatgpt', 'https://api.openai.com/v1'),
    ).toBeNull();
  });

  it('does not save when Keychain is unavailable', async () => {
    const crypto = new FakeCrypto();
    crypto.available = false;
    const { store } = await createStore(crypto);
    await expect(
      store.setKey(
        'work-claude',
        'claude',
        'sk-ant-secret',
        'https://api.anthropic.com/v1',
      ),
    ).rejects.toBeInstanceOf(ApiKeyError);
    expect(
      await store.getKey('work-claude', 'https://api.anthropic.com/v1'),
    ).toBeNull();
  });

  it('re-encrypts a key when shouldReEncrypt is true', async () => {
    const { filePath, crypto, store } = await createStore();
    await store.setKey(
      'work-claude',
      'claude',
      'sk-ant-secret',
      'https://api.anthropic.com/v1',
    );
    crypto.reEncryptNext = true;
    expect(
      await store.getKey('work-claude', 'https://api.anthropic.com/v1'),
    ).toBe('sk-ant-secret');
    const config = await readFile(filePath, 'utf8');
    expect(config).not.toContain('sk-ant-secret');
  });

  it('recovers from a broken config file', async () => {
    const { filePath, crypto } = await createStore();
    await writeFile(filePath, '{broken');
    const store = new ApiKeyStore({ filePath, crypto });
    await store.load();
    expect(
      await store.status('work-claude', 'https://api.anthropic.com/v1'),
    ).toMatchObject({
      configured: false,
      keychainAvailable: true,
    });
  });

  it('loads a version 1 config keyed by provider name', async () => {
    const crypto = new FakeCrypto();
    const root = await mkdtemp(join(tmpdir(), 'kataribe-api-keys-'));
    roots.push(root);
    const filePath = join(root, 'config.json');
    await writeFile(
      filePath,
      JSON.stringify({
        schema_version: 1,
        api_keys: {
          claude: {
            version: 1,
            provider: 'claude',
            host: 'api.anthropic.com',
            encrypted: Buffer.from('encrypted:sk-legacy', 'utf8').toString(
              'base64',
            ),
            created_at: '2026-10-31T00:00:00.000Z',
          },
        },
      }),
    );
    const store = new ApiKeyStore({ filePath, crypto });
    await store.load();
    expect(
      await store.getKey('claude', 'https://api.anthropic.com/v1'),
    ).toBe('sk-legacy');
  });
});
