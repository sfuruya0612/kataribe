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
      llmProvider: 'ollama',
      llmModel: 'qwen3',
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
    expect(updated.llmProvider).toBe('ollama');
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(updated);

    const reloaded = new SettingsStore(filePath);
    expect(await reloaded.load()).toEqual(updated);
  });

  it('serializes concurrent updates', async () => {
    const { store } = await createStore();
    await store.load();

    await Promise.all([
      store.save({ llmProvider: 'ollama' }),
      store.save({ llmModel: 'qwen3' }),
      store.save({ summaryLanguage: 'en' }),
    ]);

    expect(store.get()).toMatchObject({
      llmProvider: 'ollama',
      llmModel: 'qwen3',
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
        globalShortcutEnabled: false,
        whisperInitialPrompt: '  Kataribe, BlackHole  ',
        whisperSpeedRatios: { small: 0.12, medium: 0.2, 'large-v3-turbo': 0.3 },
        mp3BitrateKbps: 128,
        summaryPromptTemplate: '  custom prompt  ',
      }),
    ).toMatchObject({
      saveRoot: '/Users/test/Kataribe',
      theme: 'dark',
      speakerDiarization: false,
      globalShortcutEnabled: false,
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
    expect(
      normalizeAppSettings({
        whisperSpeedRatios: { small: 0, medium: 99 },
      }).whisperSpeedRatios,
    ).toEqual({});
  });
});
