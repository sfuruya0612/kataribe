/**
 * 設定画面の表示言語の切り替えを検証する。
 * 対応する要求: REQ-UI-001
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings';
import type { AppSettings, UiLanguage } from '../../shared/types';
import { I18nProvider } from './i18n';
import { SettingsPanel, type SettingsTab } from './SettingsPanel';

const baseSettings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  saveRoot: '/tmp/Kataribe',
};

function renderSettings(
  locale: UiLanguage,
  overrides: Partial<AppSettings> = {},
  initialTab: SettingsTab = 'general',
): string {
  const settings: AppSettings = { ...baseSettings, ...overrides };
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(SettingsPanel, {
        saveRoot: settings.saveRoot,
        version: '0.1.0',
        settings,
        inputSource: 'both',
        permission: 'granted',
        microphones: [],
        systemDevices: [],
        initialTab,
        onUpdateSettings: async () => undefined,
        onChangeSaveRoot: () => undefined,
        onSetInputSource: () => undefined,
        onRequestPermission: () => undefined,
        onOpenMicrophoneSettings: () => undefined,
        onOpenReadme: () => undefined,
        onOpenBlackHoleSite: () => undefined,
        onShowAbout: () => undefined,
      }),
    }),
  );
}

describe('req_ui_001_settings_panel_language', () => {
  it('renders the language selector in Japanese by default', () => {
    const html = renderSettings('ja');

    expect(html).toContain('>UI の言語</p>');
    expect(html).toContain('>日本語</button>');
    expect(html).toContain('>English</button>');
    expect(html).toContain('>一般</button>');
    expect(html).not.toContain('>Language</p>');
    expect(html).toMatch(/aria-pressed="true"[^>]*>日本語<\/button>/);
  });

  it('renders the language selector in English', () => {
    const html = renderSettings('en', { uiLanguage: 'en' });

    expect(html).toContain('>Language</p>');
    expect(html).toContain('>Japanese</button>');
    expect(html).toContain('>English</button>');
    expect(html).toContain('>General</button>');
    expect(html).not.toContain('>UI の言語</p>');
    expect(html).toMatch(/aria-pressed="true"[^>]*>English<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Japanese<\/button>/);
  });
});

describe('req_trans_001_settings_panel_transcription_engine', () => {
  it('renders the local engine and the OpenAI option in Japanese', () => {
    const html = renderSettings('ja', {}, 'transcription');

    expect(html).toContain('>文字起こしエンジン</p>');
    expect(html).toContain('>ローカル (whisper.cpp)</button>');
    expect(html).toContain('>OpenAI API</button>');
    expect(html).toMatch(/aria-pressed="true"[^>]*>ローカル \(whisper\.cpp\)<\/button>/);
  });

  it('renders the OpenAI profile, model, and timestamp warning', () => {
    const html = renderSettings(
      'ja',
      {
        transcriptionEngine: 'openai',
        openaiTranscriptionModel: 'gpt-4o-transcribe',
      },
      'transcription',
    );

    expect(html).toContain('>ChatGPT プロファイル</span>');
    expect(html).toContain('>OpenAI の文字起こしモデル</span>');
    expect(html).toContain('>gpt-4o-transcribe</option>');
    expect(html).toContain(
      'このモデルは区間のタイムスタンプを返しません。文字起こしの時刻は分割した区間の単位になります。',
    );
    expect(html).toContain('>OpenAI の API キーを設定</button>');
  });

  it('renders the English labels', () => {
    const html = renderSettings(
      'en',
      { uiLanguage: 'en', transcriptionEngine: 'openai' },
      'transcription',
    );

    expect(html).toContain('>Transcription engine</p>');
    expect(html).toContain('>Local (whisper.cpp)</button>');
    expect(html).toContain('>OpenAI transcription model</span>');
    expect(html).toContain('>Set the OpenAI API key</button>');
  });
});

describe('req_summary_002_settings_panel_cleanup', () => {
  it('renders the cleanup option checked by default', () => {
    const html = renderSettings('ja', {}, 'summary');

    expect(html).toContain('>要約の前処理</p>');
    expect(html).toContain('相槌と擬音を除いてから要約する');
    expect(html).toMatch(/type="checkbox" checked=""/);
  });

  it('renders the cleanup option in English', () => {
    const html = renderSettings('en', { uiLanguage: 'en' }, 'summary');

    expect(html).toContain('>Summary preprocessing</p>');
    expect(html).toContain('Remove fillers and interjections before summarizing');
  });
});
