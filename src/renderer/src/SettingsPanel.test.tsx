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
import { SettingsPanel } from './SettingsPanel';

const baseSettings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  saveRoot: '/tmp/Kataribe',
};

function renderSettings(
  locale: UiLanguage,
  overrides: Partial<AppSettings> = {},
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
