/**
 * 会議詳細が meta.json の強調音声の有無から再生の選択肢を作ることを検証する。
 * 対応する要求: REQ-ENHANCE-001
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  MeetingSummary,
  ProcessingState,
} from '../../shared/types';
import { I18nProvider } from './i18n';
import { MeetingDetail } from './MeetingDetail';

const meeting: MeetingSummary = {
  id: '00000000-0000-4000-8000-000000000001',
  title: '週次定例',
  meetingDir: '/tmp/kataribe',
  startedAt: '2026-11-04T00:00:00.000Z',
  duration: 60,
  status: 'transcribed',
  inputSource: 'both',
  sampleRate: 48_000,
  audioUrl:
    'kataribe-audio://meeting/00000000-0000-4000-8000-000000000001?v=1700000000000-1234',
  chunkCount: 1,
  hasTranscript: true,
  hasSummary: false,
  transcriptPartial: false,
  translationLanguages: [],
  summaryLanguage: null,
  pinned: false,
  enhancedModels: ['nemotronlabs'],
  hasRawTranscript: false,
  transcriptModels: [],
  enhancementState: 'succeeded',
};

const processing: ProcessingState = {
  stage: null,
  meetingId: null,
  progress: null,
  etaSeconds: null,
  message: null,
  cancellable: false,
  error: null,
};

function render(value: MeetingSummary = meeting): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'ja',
      children: createElement(MeetingDetail, {
        meeting: value,
        processing,
        defaultSummaryLanguage: 'ja',
        whisperModel: 'large-v3-turbo',
        transcriptionEngine: 'whisper-cpp',
        enhanceBeforeTranscription: false,
        initialSeekSeconds: null,
        onUpdateSettings: async () => undefined,
        onBack: () => undefined,
        onOpenFolder: () => undefined,
        onOpenSettings: () => undefined,
      }),
    }),
  );
}

describe('MeetingDetail audio choices', () => {
  it('shows the enhanced audio choice from the meeting summary', () => {
    const html = render();
    expect(html).toContain('audio-variant-selector');
    expect(html).toContain('生音声');
    expect(html).toContain('強調音声');
    expect(html).toContain(
      'kataribe-audio://meeting/00000000-0000-4000-8000-000000000001?v=1700000000000-1234',
    );
  });

  it('hides the enhanced audio choice when the summary has no enhanced model', () => {
    const html = render({ ...meeting, enhancedModels: [] });
    expect(html).not.toContain('audio-variant-selector');
  });
});
