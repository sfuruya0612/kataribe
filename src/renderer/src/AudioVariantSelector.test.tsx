/**
 * 会議詳細の音声の種類の切り替えを検証する。
 * 対応する要求: REQ-ENHANCE-001
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AudioVariantSelector } from './AudioVariantSelector';
import { I18nProvider } from './i18n';

function render(
  value: 'raw' | 'enhanced',
  hasEnhanced: boolean,
): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'ja',
      children: createElement(AudioVariantSelector, {
        value,
        hasEnhanced,
        onChange: () => undefined,
      }),
    }),
  );
}

describe('AudioVariantSelector', () => {
  it('shows both choices and marks the selected one', () => {
    const html = render('raw', true);
    expect(html).toContain('生音声');
    expect(html).toContain('強調音声');
    expect(html).toMatch(/aria-pressed="true"[^>]*>生音声<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>強調音声<\/button>/);
    expect(render('enhanced', true)).toMatch(
      /aria-pressed="true"[^>]*>強調音声<\/button>/,
    );
  });

  it('renders nothing when there is no enhanced audio', () => {
    expect(render('raw', false)).toBe('');
  });
});
