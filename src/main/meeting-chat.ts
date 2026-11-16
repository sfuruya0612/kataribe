import { randomUUID } from 'node:crypto';
import type {
  AppSettings,
  ChatHistory,
  ChatMessage,
  ChatSendRequest,
  ChatSendResult,
  ChatSource,
} from '../shared/types';
import type { ApiKeyStore } from './api-keys';
import { buildChatContextSnapshot, CHAT_MAX_WEB_RESULTS, buildChatRequest } from './chat-context';
import { ChatStore } from './chat-store';
import {
  readCleanedTranscript,
  removeCleanedTranscript,
  writeCleanedTranscript,
} from './cleaned-transcript';
import { t } from './i18n';
import { LlmError, type LlmClient } from './llm';
import { resolveLlmRuntime } from './llm-runtime';
import type { MeetingStore } from './meetings';
import { cleanTranscript } from './transcript-cleanup';
import { WebSearchError, type WebSearchService } from './web-search';

export const MAX_CHAT_MESSAGE_CHARS = 4_000;

type ActiveChat = {
  controller: AbortController;
  kind: 'send' | 'prepare';
};

export type MeetingChatServiceOptions = {
  meetingStore: MeetingStore;
  apiKeyStore: ApiKeyStore;
  llmClient: LlmClient;
  settings: () => AppSettings;
  webSearch: WebSearchService;
  now?: () => Date;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function searchErrorMessage(error: unknown): string {
  if (error instanceof WebSearchError) {
    if (error.code === 'timeout') {
      return t('Web 検索がタイムアウトしました。');
    }
    if (error.code === 'blocked') {
      return t('Web 検索が検索エンジンにブロックされました。');
    }
    if (error.code === 'unavailable') {
      return t(
        'Web 検索を利用できませんでした。時間をおいて再試行してください。',
      );
    }
  }
  return t('Web 検索に失敗しました: {error}', {
    error: errorMessage(error),
  });
}

function buildSearchQuery(
  message: string,
  messages: readonly ChatMessage[],
): string {
  const normalized = message.replace(/\s+/gu, ' ').trim();
  if (normalized.length >= 12) {
    return normalized;
  }
  const previous = [...messages]
    .reverse()
    .find((entry) => entry.role === 'user' && entry.content.trim().length > 0);
  return previous
    ? `${previous.content.replace(/\s+/gu, ' ').trim()} ${normalized}`.slice(0, 300)
    : normalized;
}

export class MeetingChatService {
  private readonly meetingStore: MeetingStore;
  private readonly apiKeyStore: ApiKeyStore;
  private readonly llmClient: LlmClient;
  private readonly settings: () => AppSettings;
  private readonly webSearch: WebSearchService;
  private readonly now: () => Date;
  private readonly chatStore = new ChatStore();
  private readonly active = new Map<string, ActiveChat>();

  constructor(options: MeetingChatServiceOptions) {
    this.meetingStore = options.meetingStore;
    this.apiKeyStore = options.apiKeyStore;
    this.llmClient = options.llmClient;
    this.settings = options.settings;
    this.webSearch = options.webSearch;
    this.now = options.now ?? (() => new Date());
  }

  async load(meetingId: string): Promise<ChatHistory> {
    const meeting = await this.meetingStore.find(meetingId);
    if (!meeting) {
      throw new Error(t('会議が見つかりません。'));
    }
    const detail = await this.meetingStore.detail(meetingId);
    if (!detail) {
      throw new Error(t('会議が見つかりません。'));
    }
    const cleaned = await readCleanedTranscript(meeting.meetingDir);
    const stored = await this.chatStore.read(meeting);
    const lastUserMessage = [...stored.messages]
      .reverse()
      .find((message) => message.role === 'user');
    const snapshot = buildChatContextSnapshot({
      summary: detail.summary,
      transcript: detail.transcript,
      cleaned,
      query: lastUserMessage?.content ?? '',
    });
    return {
      meetingId,
      messages: stored.messages,
      context: snapshot.info,
      lastProfileId: stored.lastProfileId,
      contextChanged: Boolean(
        stored.contextHash && stored.contextHash !== snapshot.contextHash,
      ),
      warning: stored.error
        ? t('チャット履歴を読み込めませんでした: {error}', {
            error: stored.error,
          })
        : null,
    };
  }

  async send(request: ChatSendRequest): Promise<ChatSendResult> {
    if (typeof request !== 'object' || request === null) {
      throw new Error(t('チャットの送信内容が正しくありません。'));
    }
    const meetingId =
      typeof request.meetingId === 'string' ? request.meetingId : '';
    const message =
      typeof request.message === 'string' ? request.message.trim() : '';
    if (!meetingId) {
      throw new Error(t('会議が見つかりません。'));
    }
    if (!message) {
      throw new Error(t('メッセージを入力してください。'));
    }
    if (message.length > MAX_CHAT_MESSAGE_CHARS) {
      throw new Error(
        t('メッセージが長すぎます。{count} 文字以内で入力してください。', {
          count: MAX_CHAT_MESSAGE_CHARS,
        }),
      );
    }
    if (this.active.has(meetingId)) {
      throw new Error(
        t('別のチャットが実行中です。完了してから実行してください。'),
      );
    }
    const meeting = await this.meetingStore.find(meetingId);
    if (!meeting) {
      throw new Error(t('会議が見つかりません。'));
    }
    const detail = await this.meetingStore.detail(meetingId);
    if (!detail?.summary?.body.trim()) {
      throw new Error(t('先に要約を生成してください。'));
    }
    if (!detail.transcript?.body.trim()) {
      throw new Error(
        t('文字起こしがありません。先に文字起こしを完了してください。'),
      );
    }
    const webSearch = request.webSearch === true;
    const profileId =
      typeof request.profileId === 'string' && request.profileId
        ? request.profileId
        : undefined;
    const runtime = await resolveLlmRuntime({
      settings: this.settings(),
      apiKeyStore: this.apiKeyStore,
      profileId,
    });
    const cleaned = await readCleanedTranscript(meeting.meetingDir);
    const stored = await this.chatStore.read(meeting);
    const controller = this.begin(meetingId, 'send');

    try {
      let sources: ChatSource[] = [];
      let searchError: string | null = null;
      if (webSearch) {
        try {
          const response = await this.webSearch.search(
            buildSearchQuery(message, stored.messages),
            {
              signal: controller.signal,
              locale: this.settings().uiLanguage,
              limit: CHAT_MAX_WEB_RESULTS,
            },
          );
          sources = response.results.slice(0, CHAT_MAX_WEB_RESULTS).map(
            (result, index) => ({
              index: index + 1,
              title: result.title,
              url: result.url,
              displayUrl: result.displayUrl,
              snippet: result.snippet,
            }),
          );
        } catch (error) {
          if (
            controller.signal.aborted ||
            (error instanceof WebSearchError && error.code === 'cancelled')
          ) {
            throw error;
          }
          console.error(`web search failed: ${errorMessage(error)}`);
          searchError = searchErrorMessage(error);
        }
      }

      const built = buildChatRequest({
        summary: detail.summary,
        transcript: detail.transcript,
        cleaned,
        messages: stored.messages,
        query: message,
        sources,
        searchError,
      });
      const createdAt = this.now().toISOString();
      const userMessage: ChatMessage = {
        id: randomUUID(),
        role: 'user',
        content: message,
        createdAt,
        profileId: runtime.config.id,
        model: runtime.config.model,
        webSearch,
        sources: [],
        searchError: null,
      };
      const result = await this.llmClient.complete({
        kind: runtime.config.kind,
        endpoint: runtime.config.endpoint,
        apiKey: runtime.apiKey,
        model: runtime.config.model,
        system: built.system,
        user: message,
        history: built.history,
        maxTokens: 4096,
        timeoutMs: 120_000,
        signal: controller.signal,
      });
      const assistantMessage: ChatMessage = {
        id: randomUUID(),
        role: 'assistant',
        content: result.text.trim(),
        createdAt: this.now().toISOString(),
        profileId: runtime.config.id,
        model: runtime.config.model,
        webSearch,
        sources,
        searchError,
      };
      const currentMeeting = await this.meetingStore.find(meetingId);
      if (!currentMeeting) {
        throw new Error(t('会議が見つかりません。'));
      }
      await this.chatStore.save(
        currentMeeting,
        [...stored.messages, userMessage, assistantMessage],
        runtime.config.id,
        built.contextHash,
      );
      const history = await this.load(meetingId);
      return {
        history,
        userMessage,
        assistantMessage,
        searchError,
        usage:
          result.inputTokens !== null || result.outputTokens !== null
            ? {
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
              }
            : null,
      };
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof LlmError && error.code === 'cancelled')
      ) {
        throw new Error(t('チャットをキャンセルしました。'));
      }
      throw error;
    } finally {
      this.active.delete(meetingId);
    }
  }

  async prepare(meetingId: string, profileId?: string): Promise<ChatHistory> {
    if (this.active.has(meetingId)) {
      throw new Error(
        t('別のチャットが実行中です。完了してから実行してください。'),
      );
    }
    const meeting = await this.meetingStore.find(meetingId);
    if (!meeting) {
      throw new Error(t('会議が見つかりません。'));
    }
    const detail = await this.meetingStore.detail(meetingId);
    if (!detail?.summary?.body.trim()) {
      throw new Error(t('先に要約を生成してください。'));
    }
    if (!detail.transcript?.body.trim()) {
      throw new Error(
        t('文字起こしがありません。先に文字起こしを完了してください。'),
      );
    }
    const runtime = await resolveLlmRuntime({
      settings: this.settings(),
      apiKeyStore: this.apiKeyStore,
      profileId,
    });
    const sourceBody = detail.transcript.body.trim();
    const controller = this.begin(meetingId, 'prepare');
    try {
      const cleaned = await cleanTranscript({
        client: this.llmClient,
        transcriptBody: sourceBody,
        kind: runtime.config.kind,
        endpoint: runtime.config.endpoint,
        apiKey: runtime.apiKey,
        model: runtime.config.model,
        signal: controller.signal,
      });
      if (!cleaned.body.trim()) {
        throw new Error(t('相槌と擬音の除去に失敗しました。'));
      }
      const currentMeeting = await this.meetingStore.find(meetingId);
      if (!currentMeeting) {
        throw new Error(t('会議が見つかりません。'));
      }
      let warning: string | null = null;
      if (cleaned.state === 'failed') {
        await removeCleanedTranscript(currentMeeting.meetingDir);
        warning = t(
          '相槌と擬音の除去に失敗しました。元の文字起こしを使います。',
        );
      } else {
        await writeCleanedTranscript(currentMeeting.meetingDir, {
          title: currentMeeting.title,
          startedAt: currentMeeting.startedAt,
          durationSeconds: currentMeeting.duration,
          language: detail.transcript.language,
          sourceBody,
          body: cleaned.body.trim(),
          state: cleaned.state,
          provider: runtime.config.provider,
          model: runtime.config.model,
          generatedAt: this.now().toISOString(),
        });
        if (cleaned.state === 'partial') {
          warning = t('相槌と擬音の除去が一部の区間で失敗しました。');
        }
      }
      const history = await this.load(meetingId);
      return {
        ...history,
        warning: warning ?? history.warning,
      };
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof LlmError && error.code === 'cancelled')
      ) {
        throw new Error(t('相槌と擬音の除去をキャンセルしました。'));
      }
      throw error;
    } finally {
      this.active.delete(meetingId);
    }
  }

  async clear(meetingId: string): Promise<ChatHistory> {
    if (this.active.has(meetingId)) {
      throw new Error(
        t('チャットの実行中は履歴を消去できません。完了してから消去してください。'),
      );
    }
    const meeting = await this.meetingStore.find(meetingId);
    if (!meeting) {
      throw new Error(t('会議が見つかりません。'));
    }
    await this.chatStore.clear(meeting);
    return this.load(meetingId);
  }

  private begin(meetingId: string, kind: 'send' | 'prepare'): AbortController {
    if (this.active.has(meetingId)) {
      throw new Error(
        t('別のチャットが実行中です。完了してから実行してください。'),
      );
    }
    const controller = new AbortController();
    this.active.set(meetingId, { controller, kind });
    return controller;
  }

  cancel(meetingId: string): boolean {
    const active = this.active.get(meetingId);
    if (!active) {
      return false;
    }
    active.controller.abort();
    return true;
  }

  isActive(meetingId: string): boolean {
    return this.active.has(meetingId);
  }

  shutdown(): void {
    for (const active of this.active.values()) {
      active.controller.abort();
    }
    this.active.clear();
  }
}
