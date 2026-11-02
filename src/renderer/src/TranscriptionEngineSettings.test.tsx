import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings';
import type {
  LlmProfilesState,
  OpenAiTranscriptionModel,
  TranscriptionEngine,
} from '../../shared/types';
import { I18nProvider } from './i18n';
import { TranscriptionEngineSettings } from './TranscriptionEngineSettings';

/**
 * 対応する要求: REQ-TRANS-001
 */

const profiles: LlmProfilesState = {
  defaultProfileId: 'work',
  profiles: [
    {
      id: 'work',
      provider: 'chatgpt',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.5',
      providerLabel: 'ChatGPT',
      kind: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKeyConfigured: false,
      apiKeyStored: false,
      storedHost: null,
      keychainAvailable: true,
      keychainError: null,
      host: 'api.openai.com',
      hostMatchesKey: false,
      isDefault: true,
    },
    {
      id: 'local',
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen3',
      providerLabel: 'Ollama Cloud',
      kind: 'openai',
      endpoint: 'http://localhost:11434/v1/chat/completions',
      apiKeyConfigured: true,
      apiKeyStored: true,
      storedHost: 'localhost:11434',
      keychainAvailable: true,
      keychainError: null,
      host: 'localhost:11434',
      hostMatchesKey: true,
      isDefault: false,
    },
  ],
};

function render(
  engine: TranscriptionEngine,
  model: OpenAiTranscriptionModel = 'whisper-1',
): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'ja',
      children: createElement(TranscriptionEngineSettings, {
        settings: {
          ...DEFAULT_APP_SETTINGS,
          transcriptionEngine: engine,
          openaiTranscriptionProfileId: 'work',
          openaiTranscriptionModel: model,
        },
        llmProfiles: profiles,
        onUpdateSettings: async () => undefined,
        onOpenSummary: () => undefined,
      }),
    }),
  );
}

describe('req_trans_001_transcription_engine_settings', () => {
  it('lists only ChatGPT profiles and shows the missing key state', () => {
    const html = render('openai');
    expect(html).toContain('<option value="work" selected="">work（API キー未設定）</option>');
    expect(html).not.toContain('<option value="local"');
    expect(html).toContain('ChatGPT プロファイル');
    expect(html).toContain('OpenAI の文字起こしモデル');
  });

  it('shows the timestamp limitation for gpt-4o models', () => {
    const html = render('openai', 'gpt-4o-transcribe');
    expect(html).toContain(
      'このモデルは区間のタイムスタンプを返しません。文字起こしの時刻は分割した区間の単位になります。',
    );
  });

  it('does not show the OpenAI fields for the local engine', () => {
    const html = render('whisper-cpp');
    expect(html).toContain('ローカル (whisper.cpp)');
    expect(html).not.toContain('ChatGPT プロファイル');
  });
});
