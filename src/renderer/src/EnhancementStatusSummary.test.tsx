/**
 * 音声強調の状態を 1 行に畳み込む規則と、その要約ボタンを検証する。
 * 対応する要求: REQ-ENHANCE-001
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  EnhancementFile,
  EnhancementSavedAudio,
  EnhancementState,
  EnhancementTranscriptionEntry,
} from '../../shared/types';
import { EnhancementStatusSummary } from './EnhancementStatusSummary';
import { summarizeEnhancement } from './enhancement-state';
import { I18nProvider } from './i18n';

function savedAudio(state: EnhancementState): EnhancementSavedAudio {
  return {
    state,
    model_sha256: 'b'.repeat(64),
    input: {
      path: 'audio.mp3',
      sha256: 'a'.repeat(64),
      sample_rate: 48_000,
      channels: 1,
    },
    output:
      state === 'succeeded'
        ? { path: 'audio.enhanced.nemotronlabs.mp3', sha256: 'c'.repeat(64) }
        : null,
    settings: {
      chunk_seconds: 5,
      hop_seconds: 2.5,
      crossfade_seconds: 0.5,
    },
    started_at: null,
    finished_at: null,
    elapsed_seconds: null,
    error: null,
  };
}

function transcriptionEntry(
  state: EnhancementState,
): EnhancementTranscriptionEntry {
  return {
    state,
    path: null,
    input_sha256: 'a'.repeat(64),
    output_sha256: null,
    model: 'small',
    model_sha256: null,
    settings: {
      engine: 'whisper-cpp',
      whisper_model: 'small',
      chunk_seconds: null,
      hop_seconds: null,
      crossfade_seconds: null,
    },
    chars: null,
    started_at: null,
    finished_at: null,
    elapsed_seconds: null,
    error: null,
  };
}

function fixture(options: {
  saved?: EnhancementState;
  raw?: EnhancementState;
  model?: EnhancementState;
}): EnhancementFile {
  return {
    schema_version: 1,
    source: {
      path: 'audio.mp3',
      sha256: 'a'.repeat(64),
      sample_rate: 48_000,
      channels: 1,
    },
    saved_audio: options.saved
      ? { nemotronlabs: savedAudio(options.saved) }
      : {},
    transcription: {
      source_input_sha256: null,
      raw: transcriptionEntry(options.raw ?? 'pending'),
      models: options.model
        ? { nemotronlabs: transcriptionEntry(options.model) }
        : {},
      primary: { source: 'raw', path: null },
    },
  };
}

function render(
  enhancement: EnhancementFile | null,
  warning: string | null = null,
): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'ja',
      children: createElement(EnhancementStatusSummary, {
        enhancement,
        warning,
      }),
    }),
  );
}

describe('summarizeEnhancement', () => {
  it('returns no state when there is no enhancement data', () => {
    expect(summarizeEnhancement(null, null)).toBeNull();
  });

  it('shows a read error before every processing state', () => {
    expect(summarizeEnhancement(fixture({ saved: 'succeeded' }), 'broken')).toBe(
      'warning',
    );
  });

  it('prioritizes running, failure, interruption, success, and cancellation', () => {
    expect(
      summarizeEnhancement(
        fixture({ saved: 'succeeded', model: 'running' }),
        null,
      ),
    ).toBe('running');
    expect(
      summarizeEnhancement(
        fixture({ saved: 'succeeded', model: 'failed' }),
        null,
      ),
    ).toBe('failed');
    expect(
      summarizeEnhancement(fixture({ saved: 'succeeded', model: 'interrupted' }), null),
    ).toBe('interrupted');
    expect(
      summarizeEnhancement(fixture({ saved: 'succeeded', model: 'cancelled' }), null),
    ).toBe('succeeded');
    expect(
      summarizeEnhancement(fixture({ saved: 'cancelled', raw: 'cancelled' }), null),
    ).toBe('cancelled');
  });

  it('shows not run when every entry is pending or missing', () => {
    expect(summarizeEnhancement(fixture({}), null)).toBe('pending');
    expect(summarizeEnhancement(fixture({ raw: 'pending' }), null)).toBe(
      'pending',
    );
  });
});

describe('EnhancementStatusSummary', () => {
  it('renders nothing when there is no enhancement data', () => {
    expect(render(null)).toBe('');
  });

  it('renders one summary button and keeps the details closed', () => {
    const html = render(fixture({ saved: 'succeeded' }));
    expect(html).toContain('enhancement-summary-button');
    expect(html).toContain('音声強調');
    expect(html).toContain('成功');
    expect(html).toContain('詳細');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('音声強調の状態</h2>');
  });

  it('shows a read error in the summary button', () => {
    const html = render(null, 'broken enhancement.json');
    expect(html).toContain('状態を読み込めません');
    expect(html).toContain('詳細');
  });
});
