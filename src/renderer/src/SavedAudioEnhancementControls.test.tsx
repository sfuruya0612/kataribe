/**
 * 保存音声の強調の再実行操作を検証する。
 * 対応する要求: REQ-ENHANCE-001
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from './i18n';
import { SavedAudioEnhancementControls } from './SavedAudioEnhancementControls';

function render(
  overrides: Partial<{
    enabled: boolean;
    busy: boolean;
    progress: number | null;
    error: string | null;
    notice: string | null;
    inputDiffers: boolean;
  }> = {},
): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'ja',
      children: createElement(SavedAudioEnhancementControls, {
        enabled: true,
        busy: false,
        progress: null,
        error: null,
        notice: null,
        inputDiffers: true,
        onRun: () => undefined,
        onCancel: () => undefined,
        ...overrides,
      }),
    }),
  );
}

describe('SavedAudioEnhancementControls', () => {
  it('shows the re-run action and the input difference note', () => {
    const html = render();
    expect(html).toContain('>保存音声の強調を再実行</button>');
    expect(html).toContain('再実行の入力は audio.mp3 から作るため');
  });

  it('shows progress and cancel while running', () => {
    const html = render({ busy: true, progress: 0.5 });
    expect(html).toContain('50%');
    expect(html).toContain('>中止</button>');
  });

  it('shows errors and notices', () => {
    const html = render({ error: 'GPU failed', notice: 'done' });
    expect(html).toContain('GPU failed');
    expect(html).toContain('done');
  });

  it('disables the action when it is not available', () => {
    const html = render({ enabled: false });
    expect(html).toContain('disabled=""');
  });
});
