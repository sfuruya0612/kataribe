/**
 * 会議チャットの空状態、入力欄、Web 検索、プロファイル未設定の表示を検証する。
 * 対応する要求: REQ-CHAT-001, REQ-CHAT-002
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  translate,
  type MessageKey,
  type MessageParams,
} from '../../shared/i18n';
import type {
  ChatMessage,
  LlmProfilesState,
  UiLanguage,
} from '../../shared/types';
import { I18nProvider } from './i18n';
import { ChatMessageView, MeetingChat } from './MeetingChat';

const t = (key: MessageKey, params?: MessageParams): string =>
  translate('ja', key, params);

const PROFILES: LlmProfilesState = {
  profiles: [
    {
      id: 'claude',
      provider: 'claude',
      providerLabel: 'Claude',
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      endpoint: 'https://api.anthropic.com/v1/messages',
      model: 'claude-test',
      apiKeyConfigured: true,
      apiKeyStored: true,
      storedHost: 'api.anthropic.com',
      keychainAvailable: true,
      keychainError: null,
      host: 'api.anthropic.com',
      hostMatchesKey: true,
      isDefault: true,
    },
  ],
  defaultProfileId: 'claude',
};

function render({
  locale = 'ja',
  hasSummary = true,
  hasTranscript = true,
  llmProfiles = PROFILES,
}: {
  locale?: UiLanguage;
  hasSummary?: boolean;
  hasTranscript?: boolean;
  llmProfiles?: LlmProfilesState | null;
} = {}): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(MeetingChat, {
        meetingId: 'meeting-1',
        hasSummary,
        hasTranscript,
        llmProfiles,
        defaultWebSearch: false,
        contextVersion: 'v1',
        onOpenSettings: () => undefined,
      }),
    }),
  );
}

describe('req_chat_001_meeting_chat', () => {
  it('shows the summary requirement when there is no summary', () => {
    const html = render({ hasSummary: false });
    expect(html).toContain('会議チャット');
    expect(html).toContain(
      '要約を生成すると、要約と文字起こしをもとに会議の内容について質問できます。',
    );
    expect(html).not.toContain('Web 検索を使う');
  });

  it('shows the transcript requirement when there is no transcript', () => {
    const html = render({ hasTranscript: false });
    expect(html).toContain(
      '文字起こしがありません。先に文字起こしを完了してください。',
    );
    expect(html).not.toContain('会議について質問を入力');
  });

  it('shows the composer and the web search toggle', () => {
    const html = render();
    expect(html).toContain('会議チャット');
    expect(html).toContain(
      '要約と文字起こしをもとに、会議の内容について質問できます。',
    );
    expect(html).toContain('会議について質問を入力');
    expect(html).toContain('Web 検索を使う');
    expect(html).toContain('Cmd + Enter で送信');
    expect(html).toContain('履歴を消去');
    expect(html).toContain('会議の内容について質問できます。');
  });

  it('shows a settings link when no LLM profile is configured', () => {
    const html = render({ llmProfiles: { profiles: [], defaultProfileId: '' } });
    expect(html).toContain(
      'LLM プロファイルが設定されていません。設定画面でプロファイルを追加してください。',
    );
    expect(html).toContain('LLM の設定を開く');
  });

  it('renders the English labels', () => {
    const html = render({ locale: 'en', hasSummary: false });
    expect(html).toContain('Meeting chat');
    expect(html).toContain(
      'Generate a summary to ask questions about the meeting based on the summary and transcript.',
    );
    expect(html).not.toContain('会議チャット');
  });
});

describe('req_chat_002_chat_sources', () => {
  it('renders the assistant answer, search status, and source list', () => {
    const message: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: '会議では来週リリースすると決めました [1]。',
      createdAt: '2026-11-16T10:00:00.000Z',
      profileId: 'claude',
      model: 'claude-test',
      webSearch: true,
      sources: [
        {
          index: 1,
          title: 'リリース計画の作り方',
          url: 'https://search.brave.com/go/v1/token-1',
          displayUrl: 'https://example.com/',
          snippet: '小さくリリースする。',
        },
      ],
      searchError: null,
    };
    const html = renderToStaticMarkup(
      createElement(ChatMessageView, {
        message,
        locale: 'ja',
        onOpenSource: () => undefined,
        t,
      }),
    );
    expect(html).toContain('会議では来週リリースすると決めました [1]。');
    expect(html).toContain('Web 検索の結果を使いました。');
    expect(html).toContain('出典');
    expect(html).toContain('リリース計画の作り方');
    expect(html).toContain('example.com');
    expect(html).toContain('小さくリリースする。');
  });
});
