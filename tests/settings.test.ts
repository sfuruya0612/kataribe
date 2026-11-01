import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from '../src/shared/settings';
import { SettingsStore } from '../src/main/settings';

const roots: string[] = [];

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-settings-'));
  roots.push(root);
  const filePath = join(root, 'settings.json');
  return { root, filePath, store: new SettingsStore(filePath) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SettingsStore', () => {
  it('loads defaults when settings.json does not exist', async () => {
    const { store } = await createStore();
    expect(await store.load()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('saves and reloads settings', async () => {
    const { filePath, store } = await createStore();
    await store.load();

    const updated = await store.save({
      whisperModel: 'medium',
      llmProfiles: [
        {
          id: 'work',
          provider: 'chatgpt',
          baseUrl: 'https://proxy.example.com/v1',
          model: 'gpt-5.5',
        },
        {
          id: 'local',
          provider: 'ollama',
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen3',
        },
      ],
      llmDefaultProfileId: 'local',
      summaryLanguage: 'en',
      clippingConfig: {
        peakThreshold: 0.9,
        intervalsToWarn: 2,
        recoveryIntervals: 2,
      },
      silenceConfig: {
        windowSeconds: 2,
        rmsThreshold: 0.004,
        graceSeconds: 10,
      },
    });

    expect(updated.whisperModel).toBe('medium');
    expect(updated.llmProfiles.map((profile) => profile.id)).toEqual([
      'work',
      'local',
    ]);
    expect(updated.llmDefaultProfileId).toBe('local');
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(updated);

    const reloaded = new SettingsStore(filePath);
    expect(await reloaded.load()).toEqual(updated);
  });

  it('serializes concurrent updates', async () => {
    const { store } = await createStore();
    await store.load();

    await Promise.all([
      store.save({ whisperModel: 'medium' }),
      store.save({ theme: 'dark' }),
      store.save({ summaryLanguage: 'en' }),
    ]);

    expect(store.get()).toMatchObject({
      whisperModel: 'medium',
      theme: 'dark',
      summaryLanguage: 'en',
    });
  });

  it('falls back to defaults for a broken settings.json', async () => {
    const { filePath, store } = await createStore();
    await writeFile(filePath, '{broken');
    expect(await store.load()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('normalizes unsupported values', () => {
    expect(
      normalizeAppSettings({
        whisperModel: 'unknown' as never,
        llmProvider: 'unknown' as never,
        summaryLanguage: 'fr' as never,
        llmModel: '   ',
        clippingConfig: {
          peakThreshold: 2,
          intervalsToWarn: 3,
          recoveryIntervals: 5,
        },
        silenceConfig: {
          windowSeconds: 0,
          rmsThreshold: 0.003,
          graceSeconds: 30,
        },
      }),
    ).toEqual({
      ...DEFAULT_APP_SETTINGS,
      clippingConfig: {
        ...DEFAULT_APP_SETTINGS.clippingConfig,
        peakThreshold: 1,
      },
      silenceConfig: {
        ...DEFAULT_APP_SETTINGS.silenceConfig,
        windowSeconds: 1,
      },
    });
  });

  it('normalizes the save root and speaker diarization', () => {
    expect(
      normalizeAppSettings({
        saveRoot: '/Users/test/Kataribe',
        theme: 'dark',
        speakerDiarization: false,
        whisperInitialPrompt: '  Kataribe, BlackHole  ',
        whisperSpeedRatios: { small: 0.12, medium: 0.2, 'large-v3-turbo': 0.3 },
        mp3BitrateKbps: 128,
        summaryPromptTemplate: '  custom prompt  ',
      }),
    ).toMatchObject({
      saveRoot: '/Users/test/Kataribe',
      theme: 'dark',
      speakerDiarization: false,
      whisperInitialPrompt: 'Kataribe, BlackHole',
      whisperSpeedRatios: { small: 0.12, medium: 0.2, 'large-v3-turbo': 0.3 },
      mp3BitrateKbps: 128,
      summaryPromptTemplate: '  custom prompt  ',
    });
    expect(normalizeAppSettings({ saveRoot: 'relative/path' }).saveRoot).toBe('');
    expect(normalizeAppSettings({ theme: 'blue' as never }).theme).toBe('system');
    expect(
      normalizeAppSettings({ speakerDiarization: 'yes' as never })
        .speakerDiarization,
    ).toBe(true);
    expect(
      normalizeAppSettings({ mp3BitrateKbps: 96 as never }).mp3BitrateKbps,
    ).toBe(64);
    expect(normalizeAppSettings({ speakerCount: 5 }).speakerCount).toBe(5);
    expect(normalizeAppSettings({ speakerCount: 11 as never }).speakerCount).toBe(
      'auto',
    );
    expect(normalizeAppSettings({ speakerCount: 'many' as never }).speakerCount).toBe(
      'auto',
    );
    expect(
      normalizeAppSettings({
        whisperSpeedRatios: { small: 0, medium: 99 },
      }).whisperSpeedRatios,
    ).toEqual({});
  });

  it('migrates legacy LLM settings to a profile named after the provider', () => {
    const settings = normalizeAppSettings({
      llmProvider: 'gemini',
      llmModel: '',
      llmBaseUrl: '',
    });
    expect(settings.llmProfiles).toEqual([
      {
        id: 'gemini',
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-3-pro',
      },
    ]);
    expect(settings.llmDefaultProfileId).toBe('gemini');
  });

  it('normalizes LLM profiles and keeps a valid default', () => {
    const settings = normalizeAppSettings({
      llmProfiles: [
        {
          id: ' work ',
          provider: 'chatgpt',
          baseUrl: 'https://proxy.example.com/v1/',
          model: ' gpt-5.5 ',
        },
        {
          id: 'work',
          provider: 'claude',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-5-5',
        },
        {
          id: '',
          provider: 'ollama',
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen3',
        },
        {
          id: 'local',
          provider: 'ollama',
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen3',
        },
      ],
      llmDefaultProfileId: 'local',
    });
    expect(settings.llmProfiles).toEqual([
      {
        id: 'work',
        provider: 'chatgpt',
        baseUrl: 'https://proxy.example.com/v1',
        model: 'gpt-5.5',
      },
      {
        id: 'local',
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen3',
      },
    ]);
    expect(settings.llmDefaultProfileId).toBe('local');
  });

  it('uses the only profile as the default', () => {
    const settings = normalizeAppSettings({
      llmProfiles: [
        {
          id: 'only',
          provider: 'ollama',
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen3',
        },
      ],
      llmDefaultProfileId: 'missing',
    });
    expect(settings.llmDefaultProfileId).toBe('only');
  });

  it('keeps an explicitly empty profile list', () => {
    const settings = normalizeAppSettings({
      llmProfiles: [],
      llmDefaultProfileId: 'work',
    });
    expect(settings.llmProfiles).toEqual([]);
    expect(settings.llmDefaultProfileId).toBe('');
  });
});
