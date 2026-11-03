/**
 * 会議詳細の音声強調の状態、処理時間、使用モデルの表示を検証する。
 * 対応する要求: REQ-ENHANCE-001、REQ-ENHANCE-002
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EnhancementFile } from '../../shared/types';
import { EnhancementStatus } from './EnhancementStatus';
import { I18nProvider } from './i18n';

function fixture(): EnhancementFile {
  const source = {
    path: 'audio.mp3',
    sha256: 'a'.repeat(64),
    sample_rate: 44_100,
    channels: 1,
  };
  return {
    schema_version: 1,
    source,
    saved_audio: {
      nemotronlabs: {
        state: 'succeeded',
        model_sha256: 'b'.repeat(64),
        input: source,
        output: {
          path: 'audio.enhanced.nemotronlabs.mp3',
          sha256: 'c'.repeat(64),
        },
        settings: {
          chunk_seconds: 5,
          hop_seconds: 2.5,
          crossfade_seconds: 0.5,
        },
        started_at: null,
        finished_at: null,
        elapsed_seconds: 12,
        error: null,
      },
    },
    transcription: {
      source_input_sha256: 'd'.repeat(64),
      raw: {
        state: 'succeeded',
        path: 'transcript.raw.md',
        input_sha256: 'd'.repeat(64),
        output_sha256: 'e'.repeat(64),
        model: 'small',
        model_sha256: null,
        settings: {
          engine: 'whisper-cpp',
          whisper_model: 'small',
          chunk_seconds: null,
          hop_seconds: null,
          crossfade_seconds: null,
        },
        chars: 10,
        started_at: null,
        finished_at: null,
        elapsed_seconds: 7,
        error: null,
      },
      models: {
        nemotronlabs: {
          state: 'failed',
          path: null,
          input_sha256: 'f'.repeat(64),
          output_sha256: null,
          model: 'small',
          model_sha256: 'b'.repeat(64),
          settings: {
            engine: 'whisper-cpp',
            whisper_model: 'small',
            chunk_seconds: 5,
            hop_seconds: 2.5,
            crossfade_seconds: 0.5,
          },
          chars: null,
          started_at: null,
          finished_at: null,
          elapsed_seconds: 3,
          error: 'GPU failed',
        },
      },
      primary: { source: 'raw', path: 'transcript.md' },
    },
  };
}

function render(enhancement: EnhancementFile | null, warning: string | null = null): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'ja',
      children: createElement(EnhancementStatus, {
        enhancement,
        warning,
      }),
    }),
  );
}

describe('EnhancementStatus', () => {
  it('shows saved audio and comparison states with time and model', () => {
    const html = render(fixture());
    expect(html).toContain('音声強調の状態');
    expect(html).toContain('保存音声の強調');
    expect(html).toContain('nemotronlabs');
    expect(html).toContain('成功');
    expect(html).toContain('処理時間 12 秒');
    expect(html).toContain('文字起こし前の強調');
    expect(html).toContain('処理時間 7 秒');
    expect(html).toContain('使用モデル small');
    expect(html).toContain('失敗');
    expect(html).toContain('GPU failed');
  });

  it('shows a warning when enhancement.json cannot be read', () => {
    const html = render(null, 'broken enhancement.json');
    expect(html).toContain('音声強調の状態を読み込めませんでした。');
    expect(html).toContain('broken enhancement.json');
  });

  it('renders nothing when there is no enhancement data', () => {
    expect(render(null)).toBe('');
  });
});
