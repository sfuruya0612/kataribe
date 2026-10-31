import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiKeyStore, type SecretCrypto } from '../src/main/api-keys';
import { LlmProfileManager } from '../src/main/llm-profiles';
import { SettingsStore } from '../src/main/settings';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeCrypto implements SecretCrypto {
  available = true;

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async encrypt(plainText: string): Promise<Buffer> {
    return Buffer.from(`encrypted:${plainText}`, 'utf8');
  }

  async decrypt(
    encrypted: Buffer,
  ): Promise<{ result: string; shouldReEncrypt: boolean }> {
    return {
      result: encrypted.toString('utf8').replace(/^encrypted:/, ''),
      shouldReEncrypt: false,
    };
  }
}

async function createManager() {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-llm-profiles-'));
  roots.push(root);
  const settingsPath = join(root, 'settings.json');
  const configPath = join(root, 'config.json');
  const settingsStore = new SettingsStore(settingsPath);
  await settingsStore.load();
  const apiKeyStore = new ApiKeyStore({
    filePath: configPath,
    crypto: new FakeCrypto(),
  });
  await apiKeyStore.load();
  const manager = new LlmProfileManager({ settingsStore, apiKeyStore });
  return { root, settingsPath, configPath, settingsStore, apiKeyStore, manager };
}

describe('LlmProfileManager', () => {
  it('returns the default profile and its key status', async () => {
    const { manager, apiKeyStore } = await createManager();
    await apiKeyStore.setKey(
      'claude',
      'claude',
      'sk-ant-secret',
      'https://api.anthropic.com/v1',
    );
    const state = await manager.state();
    expect(state.defaultProfileId).toBe('claude');
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]).toMatchObject({
      id: 'claude',
      provider: 'claude',
      isDefault: true,
      apiKeyConfigured: true,
      apiKeyStored: true,
      endpoint: 'https://api.anthropic.com/v1/messages',
    });
  });

  it('saves a new profile with an API key and changes the default', async () => {
    const { manager, settingsStore, apiKeyStore } = await createManager();
    const state = await manager.saveProfile({
      profile: {
        id: 'work',
        provider: 'chatgpt',
        baseUrl: 'https://proxy.example.com/v1',
        model: 'gpt-5.5',
      },
      originalId: null,
      apiKey: 'sk-work',
      makeDefault: true,
    });
    expect(state.defaultProfileId).toBe('work');
    expect(state.profiles.map((profile) => profile.id)).toEqual([
      'claude',
      'work',
    ]);
    expect(
      state.profiles.find((profile) => profile.id === 'work'),
    ).toMatchObject({
      provider: 'chatgpt',
      model: 'gpt-5.5',
      isDefault: true,
      apiKeyConfigured: true,
    });
    expect(settingsStore.get().llmDefaultProfileId).toBe('work');
    expect(
      await apiKeyStore.getKey('work', 'https://proxy.example.com/v1'),
    ).toBe('sk-work');
  });

  it('rejects a duplicate ID', async () => {
    const { manager } = await createManager();
    await expect(
      manager.saveProfile({
        profile: {
          id: 'claude',
          provider: 'chatgpt',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.5',
        },
        originalId: null,
        apiKey: null,
        makeDefault: false,
      }),
    ).rejects.toThrow('既に使われています');
  });

  it('rejects an invalid endpoint URL', async () => {
    const { manager } = await createManager();
    await expect(
      manager.saveProfile({
        profile: {
          id: 'work',
          provider: 'custom',
          baseUrl: 'http://api.example.com/v1',
          model: 'model',
        },
        originalId: null,
        apiKey: null,
        makeDefault: false,
      }),
    ).rejects.toThrow('local');
  });

  it('moves the API key and default when a profile ID changes', async () => {
    const { manager, apiKeyStore } = await createManager();
    await manager.saveProfile({
      profile: {
        id: 'work',
        provider: 'chatgpt',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.5',
      },
      originalId: null,
      apiKey: 'sk-work',
      makeDefault: true,
    });
    const state = await manager.saveProfile({
      profile: {
        id: 'team',
        provider: 'chatgpt',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.5',
      },
      originalId: 'work',
      apiKey: null,
      makeDefault: false,
    });
    expect(state.defaultProfileId).toBe('team');
    expect(state.profiles.map((profile) => profile.id)).toEqual([
      'claude',
      'team',
    ]);
    expect(
      await apiKeyStore.getKey('team', 'https://api.openai.com/v1'),
    ).toBe('sk-work');
    expect(
      await apiKeyStore.getKey('work', 'https://api.openai.com/v1'),
    ).toBeNull();
  });

  it('deletes a profile, its key, and moves the default', async () => {
    const { manager, apiKeyStore } = await createManager();
    await manager.saveProfile({
      profile: {
        id: 'work',
        provider: 'chatgpt',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.5',
      },
      originalId: null,
      apiKey: 'sk-work',
      makeDefault: true,
    });
    const state = await manager.deleteProfile('work');
    expect(state.defaultProfileId).toBe('claude');
    expect(state.profiles.map((profile) => profile.id)).toEqual(['claude']);
    expect(
      await apiKeyStore.getKey('work', 'https://api.openai.com/v1'),
    ).toBeNull();
  });

  it('sets and clears an API key for a profile', async () => {
    const { manager, apiKeyStore } = await createManager();
    await manager.saveProfile({
      profile: {
        id: 'work',
        provider: 'chatgpt',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.5',
      },
      originalId: null,
      apiKey: null,
      makeDefault: false,
    });
    let state = await manager.setApiKey('work', 'sk-work');
    expect(state.profiles.find((profile) => profile.id === 'work')).toMatchObject({
      apiKeyConfigured: true,
    });
    expect(
      await apiKeyStore.getKey('work', 'https://api.openai.com/v1'),
    ).toBe('sk-work');

    state = await manager.clearApiKey('work');
    expect(state.profiles.find((profile) => profile.id === 'work')).toMatchObject({
      apiKeyConfigured: false,
    });
    expect(
      await apiKeyStore.getKey('work', 'https://api.openai.com/v1'),
    ).toBeNull();
  });

  it('uses the first profile when the stored default is missing', async () => {
    const { manager, settingsStore } = await createManager();
    await settingsStore.save({ llmDefaultProfileId: 'missing' });
    const state = await manager.state();
    expect(state.defaultProfileId).toBe('claude');
    expect(state.profiles[0]?.isDefault).toBe(true);
  });
});
