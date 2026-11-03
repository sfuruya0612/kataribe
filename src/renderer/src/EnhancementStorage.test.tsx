/**
 * 設定画面の音声強調のディスク使用量と削除操作を検証する。
 * 対応する要求: REQ-ENHANCE-001
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EnhancementStorageView } from './EnhancementStorage';
import { I18nProvider } from './i18n';

function render(
  usage: { bytes: number; meetings: number } | null,
  busy = false,
  error: string | null = null,
): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'ja',
      children: createElement(EnhancementStorageView, {
        usage,
        busy,
        error,
        notice: null,
        onDelete: () => undefined,
      }),
    }),
  );
}

describe('EnhancementStorageView', () => {
  it('shows the disk usage and the delete action', () => {
    const html = render({ bytes: 5 * 1024 * 1024, meetings: 1 });
    expect(html).toContain('音声強調のディスク使用量');
    expect(html).toContain('5 MB');
    expect(html).toContain('5 MB を使用しています。');
    expect(html).toContain('>強調音声を削除</button>');
    expect(html).not.toContain('disabled=""');
  });

  it('disables the delete action when there is no enhanced audio', () => {
    const html = render({ bytes: 0, meetings: 0 });
    expect(html).toContain('>強調音声を削除</button>');
    expect(html).toContain('disabled=""');
  });

  it('shows the loading state and an error', () => {
    expect(render(null)).toContain('使用量を確認中...');
    const html = render({ bytes: 1, meetings: 1 }, false, 'usage failed');
    expect(html).toContain('usage failed');
  });
});
