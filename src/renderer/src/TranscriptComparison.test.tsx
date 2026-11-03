/**
 * 会議詳細の生と強調の文字起こしの切り替えを検証する。
 * 対応する要求: REQ-ENHANCE-002
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from './i18n';
import {
  TranscriptComparison,
  type TranscriptView,
} from './TranscriptComparison';

function render(
  value: TranscriptView,
  hasRaw: boolean,
  hasEnhanced: boolean,
): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'ja',
      children: createElement(TranscriptComparison, {
        value,
        hasRaw,
        hasEnhanced,
        onChange: () => undefined,
      }),
    }),
  );
}

describe('TranscriptComparison', () => {
  it('shows the current, raw, and enhanced choices', () => {
    const html = render('current', true, true);
    expect(html).toContain('現在の文字起こし');
    expect(html).toContain('生の文字起こし');
    expect(html).toContain('強調した文字起こし');
    expect(html).toMatch(/aria-pressed="true"[^>]*>現在の文字起こし<\/button>/);
  });

  it('shows the read-only note for a comparison transcript', () => {
    const html = render('enhanced', true, true);
    expect(html).toContain(
      '比較用の文字起こしです。読み取り専用で、検索、翻訳、要約、ToDo の入力には使いません。',
    );
    expect(html).toMatch(/aria-pressed="true"[^>]*>強調した文字起こし<\/button>/);
  });

  it('hides choices that do not exist', () => {
    const html = render('current', false, true);
    expect(html).not.toContain('生の文字起こし</button>');
    expect(html).toContain('強調した文字起こし</button>');
    expect(render('current', false, false)).toBe('');
  });
});
