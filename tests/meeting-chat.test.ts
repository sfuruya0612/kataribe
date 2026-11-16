/**
 * 会議チャットの送信、履歴、Web 検索、相槌と擬音の除去、キャンセルを検証する。
 * 対応する要求: REQ-CHAT-001, REQ-CHAT-002, REQ-CHAT-003
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings';
import { stringifyFrontMatter } from '../src/shared/markdown';
import type { AppSettings } from '../src/shared/types';
import type { ApiKeyStore } from '../src/main/api-keys';
import { CLEANED_TRANSCRIPT_FILE, readCleanedTranscript } from '../src/main/cleaned-transcript';
import { LlmError, type ChatCompletionRequest, type LlmClient } from '../src/main/llm';
import { MeetingChatService } from '../src/main/meeting-chat';
import { MeetingStore } from '../src/main/meetings';
import { WebSearchError, type WebSearchService } from '../src/main/web-search';

const MEETING_ID = '00000000-0000-4000-8000-0000000000c1';
const ORIGINAL_BODY = [
  '[00:00:01] 話者A: あー、今日はリリース計画を確認します。',
  '[00:00:05] 話者B: なるほど。',
  '[00:00:08] 話者A: 来週リリースします。',
].join('\n');
const CLEANED_BODY = [
  '[00:00:01] 話者A: 今日はリリース計画を確認します。',
  '[00:00:08] 話者A: 来週リリースします。',
].join('\n');
const SUMMARY_BODY = [
  '## 要約',
  'リリース計画を確認した。',
  '## 決定事項',
  '来週リリースする。',
  '## ToDo',
  '- [ ] リリースノートを書く',
  '## 未決事項',
  'なし',
].join('\n');

const roots: string[] = [];

async function createMeeting(options: { summary?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-meeting-chat-'));
  roots.push(root);
  const meetingDir = join(root, '2026', '2026-11-16_週次定例');
  await mkdir(meetingDir, { recursive: true });
  await writeFile(
    join(meetingDir, 'meta.json'),
    JSON.stringify({
      schema_version: 1,
      id: MEETING_ID,
      status: options.summary === false ? 'transcribed' : 'summarized',
      title: '週次定例',
      started_at: '2026-11-16T00:00:00.000Z',
      duration: 60,
      source: { input: 'both' },
      sample_rate: 48000,
      channels: 1,
      bits_per_sample: 16,
      chunks: [],
      expected_samples: 0,
      actual_samples: 0,
      audio_path: 'audio.mp3',
      summary_language: 'ja',
    }),
  );
  await writeFile(
    join(meetingDir, 'transcript.md'),
    stringifyFrontMatter(
      {
        title: '週次定例',
        date: '2026-11-16',
        language: 'ja',
        model: 'whisper',
      },
      ORIGINAL_BODY,
    ),
  );
  if (options.summary !== false) {
    await writeFile(
      join(meetingDir, 'summary.md'),
      stringifyFrontMatter(
        {
          title: '週次定例',
          date: '2026-11-16',
          provider: 'claude',
          model: 'claude-test',
          generated_at: '2026-11-16T00:30:00.000Z',
          language: 'ja',
        },
        SUMMARY_BODY,
      ),
    );
  }
  return { root, meetingDir };
}

function createSettings(root: string): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    saveRoot: root,
    llmProfiles: [
      {
        id: 'claude',
        provider: 'claude',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-test',
      },
    ],
    llmDefaultProfileId: 'claude',
    uiLanguage: 'ja',
  };
}

function createApiKeyStore(): ApiKeyStore {
  return {
    status: async (profileId: string, baseUrl: string) => ({
      profileId,
      configured: true,
      host: new URL(baseUrl).host,
      keychainAvailable: true,
      keychainError: null,
    }),
    hostMatches: () => true,
    getKey: async () => 'test-key',
  } as unknown as ApiKeyStore;
}

function createLlmClient(
  complete: (request: ChatCompletionRequest) => Promise<{
    text: string;
    inputTokens: number | null;
    outputTokens: number | null;
    status: number;
  }>,
): LlmClient {
  return { complete } as unknown as LlmClient;
}

function createWebSearch(
  search: (query: string) => Promise<{
    query: string;
    provider: 'brave' | 'duckduckgo' | 'bing';
    results: Array<{
      title: string;
      url: string;
      displayUrl: string | null;
      snippet: string;
    }>;
  }>,
): WebSearchService {
  return { search } as unknown as WebSearchService;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('MeetingChatService', () => {
  it('loads an empty history and reports the context state', async () => {
    const { root } = await createMeeting();
    const service = new MeetingChatService({
      meetingStore: new MeetingStore(root),
      apiKeyStore: createApiKeyStore(),
      llmClient: createLlmClient(async () => ({
        text: '回答',
        inputTokens: 1,
        outputTokens: 1,
        status: 200,
      })),
      settings: () => createSettings(root),
      webSearch: createWebSearch(async () => ({
        query: '',
        provider: 'bing',
        results: [],
      })),
      now: () => new Date('2026-11-16T02:00:00.000Z'),
    });

    const history = await service.load(MEETING_ID);
    expect(history.meetingId).toBe(MEETING_ID);
    expect(history.messages).toEqual([]);
    expect(history.context.transcriptState).toBe('missing');
    expect(history.context.transcriptSource).toBe('original');
    expect(history.context.summaryChars).toBe(SUMMARY_BODY.length);
    expect(history.context.transcriptChars).toBe(ORIGINAL_BODY.length);
  });

  it('sends a message with the summary and original transcript', async () => {
    const { root } = await createMeeting();
    const complete = vi.fn(async (_request: ChatCompletionRequest) => ({
      text: '来週です。',
      inputTokens: 20,
      outputTokens: 5,
      status: 200,
    }));
    const service = new MeetingChatService({
      meetingStore: new MeetingStore(root),
      apiKeyStore: createApiKeyStore(),
      llmClient: createLlmClient(complete),
      settings: () => createSettings(root),
      webSearch: createWebSearch(async () => ({
        query: '',
        provider: 'bing',
        results: [],
      })),
      now: () => new Date('2026-11-16T02:00:00.000Z'),
    });

    const result = await service.send({
      meetingId: MEETING_ID,
      message: 'リリースはいつ？',
      profileId: 'claude',
      webSearch: false,
    });

    expect(result.assistantMessage.content).toBe('来週です。');
    expect(result.assistantMessage.sources).toEqual([]);
    expect(result.history.messages).toHaveLength(2);
    const request = complete.mock.calls[0]?.[0] as ChatCompletionRequest;
    expect(request.system).toContain(SUMMARY_BODY);
    expect(request.system).toContain(ORIGINAL_BODY);
    expect(request.system).toContain(
      '相槌と擬音を除去した文字起こしがないため',
    );
    expect(request.user).toBe('リリースはいつ？');
    expect(request.history).toEqual([]);

    const reloaded = await service.load(MEETING_ID);
    expect(reloaded.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(reloaded.contextChanged).toBe(false);
  });

  it('reports a context change after the summary is updated', async () => {
    const { root, meetingDir } = await createMeeting();
    const service = new MeetingChatService({
      meetingStore: new MeetingStore(root),
      apiKeyStore: createApiKeyStore(),
      llmClient: createLlmClient(async () => ({
        text: '回答',
        inputTokens: 1,
        outputTokens: 1,
        status: 200,
      })),
      settings: () => createSettings(root),
      webSearch: createWebSearch(async () => ({
        query: '',
        provider: 'bing',
        results: [],
      })),
    });

    await service.send({
      meetingId: MEETING_ID,
      message: '質問',
      profileId: 'claude',
      webSearch: false,
    });
    await writeFile(
      join(meetingDir, 'summary.md'),
      stringifyFrontMatter(
        {
          title: '週次定例',
          date: '2026-11-16',
          provider: 'claude',
          model: 'claude-test',
          generated_at: '2026-11-16T03:00:00.000Z',
          language: 'ja',
        },
        `${SUMMARY_BODY}\n更新しました。`,
      ),
    );
    const history = await service.load(MEETING_ID);
    expect(history.contextChanged).toBe(true);
  });

  it('sends the previous conversation as history', async () => {
    const { root } = await createMeeting();
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        text: '来週です。',
        inputTokens: 20,
        outputTokens: 5,
        status: 200,
      })
      .mockResolvedValueOnce({
        text: '担当は話者Aです。',
        inputTokens: 30,
        outputTokens: 6,
        status: 200,
      });
    const service = new MeetingChatService({
      meetingStore: new MeetingStore(root),
      apiKeyStore: createApiKeyStore(),
      llmClient: createLlmClient(complete),
      settings: () => createSettings(root),
      webSearch: createWebSearch(async () => ({
        query: '',
        provider: 'bing',
        results: [],
      })),
    });

    await service.send({
      meetingId: MEETING_ID,
      message: 'リリースはいつ？',
      profileId: 'claude',
      webSearch: false,
    });
    await service.send({
      meetingId: MEETING_ID,
      message: '担当は誰？',
      profileId: 'claude',
      webSearch: false,
    });

    const request = complete.mock.calls[1]?.[0] as ChatCompletionRequest;
    expect(request.history).toEqual([
      { role: 'user', content: 'リリースはいつ？' },
      { role: 'assistant', content: '来週です。' },
    ]);
  });

  it('adds web search results and saves the sources', async () => {
    const { root } = await createMeeting();
    const complete = vi.fn(async (_request: ChatCompletionRequest) => ({
      text: '一般的には小さくリリースします [1]。',
      inputTokens: 40,
      outputTokens: 10,
      status: 200,
    }));
    const search = vi.fn(async () => ({
      query: 'リリース 方法',
      provider: 'bing' as const,
      results: [
        {
          title: 'リリース計画の作り方',
          url: 'https://example.com/release',
          displayUrl: 'https://example.com/release',
          snippet: '小さくリリースする。',
        },
      ],
    }));
    const service = new MeetingChatService({
      meetingStore: new MeetingStore(root),
      apiKeyStore: createApiKeyStore(),
      llmClient: createLlmClient(complete),
      settings: () => createSettings(root),
      webSearch: createWebSearch(search),
    });

    const result = await service.send({
      meetingId: MEETING_ID,
      message: 'リリースの一般的な方法を調べて',
      profileId: 'claude',
      webSearch: true,
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(result.searchError).toBeNull();
    expect(result.assistantMessage.sources).toEqual([
      {
        index: 1,
        title: 'リリース計画の作り方',
        url: 'https://example.com/release',
        displayUrl: 'https://example.com/release',
        snippet: '小さくリリースする。',
      },
    ]);
    const request = complete.mock.calls[0]?.[0] as ChatCompletionRequest;
    expect(request.system).toContain('[1] リリース計画の作り方');
    expect(request.system).toContain('https://example.com/release');
    const reloaded = await service.load(MEETING_ID);
    expect(reloaded.messages[1]?.sources).toHaveLength(1);
  });

  it('answers without web results when search fails', async () => {
    const { root } = await createMeeting();
    const complete = vi.fn(async (_request: ChatCompletionRequest) => ({
      text: '検索できませんでした。',
      inputTokens: 40,
      outputTokens: 10,
      status: 200,
    }));
    const service = new MeetingChatService({
      meetingStore: new MeetingStore(root),
      apiKeyStore: createApiKeyStore(),
      llmClient: createLlmClient(complete),
      settings: () => createSettings(root),
      webSearch: createWebSearch(async () => {
        throw new WebSearchError('blocked', 'blocked');
      }),
    });

    const result = await service.send({
      meetingId: MEETING_ID,
      message: '調べて',
      profileId: 'claude',
      webSearch: true,
    });

    expect(result.searchError).toBe(
      'Web 検索が検索エンジンにブロックされました。',
    );
    expect(result.assistantMessage.searchError).toBe(result.searchError);
    const request = complete.mock.calls[0]?.[0] as ChatCompletionRequest;
    expect(request.system).toContain('Web search failed');
    expect(request.system).toContain(
      '検索できなかったことを回答に明記してください',
    );
  });

  it('removes filler words and uses the cleaned transcript', async () => {
    const { root } = await createMeeting();
    const complete = vi.fn(async (request: ChatCompletionRequest) => {
      if (request.user.includes('相槌と擬音を削除してください')) {
        return {
          text: CLEANED_BODY,
          inputTokens: 10,
          outputTokens: 5,
          status: 200,
        };
      }
      return {
        text: '来週です。',
        inputTokens: 20,
        outputTokens: 5,
        status: 200,
      };
    });
    const service = new MeetingChatService({
      meetingStore: new MeetingStore(root),
      apiKeyStore: createApiKeyStore(),
      llmClient: createLlmClient(complete),
      settings: () => createSettings(root),
      webSearch: createWebSearch(async () => ({
        query: '',
        provider: 'bing',
        results: [],
      })),
    });

    const prepared = await service.prepare(MEETING_ID, 'claude');
    expect(prepared.context.transcriptState).toBe('ready');
    expect(prepared.context.transcriptSource).toBe('cleaned');
    const cleaned = await readCleanedTranscript(
      join(root, '2026', '2026-11-16_週次定例'),
    );
    expect(cleaned?.body).toBe(CLEANED_BODY);
    expect(cleaned?.state).toBe('completed');

    await service.send({
      meetingId: MEETING_ID,
      message: 'リリースはいつ？',
      profileId: 'claude',
      webSearch: false,
    });
    const request = complete.mock.calls[1]?.[0] as ChatCompletionRequest;
    expect(request.system).toContain(CLEANED_BODY);
    expect(request.system).not.toContain(
      '相槌と擬音を除去した文字起こしがないため',
    );
  });

  it('reports a cleanup failure and falls back to the original transcript', async () => {
    const { root } = await createMeeting();
    const complete = vi.fn(async () => ({
      text: '削除できませんでした',
      inputTokens: 10,
      outputTokens: 5,
      status: 200,
    }));
    const service = new MeetingChatService({
      meetingStore: new MeetingStore(root),
      apiKeyStore: createApiKeyStore(),
      llmClient: createLlmClient(complete),
      settings: () => createSettings(root),
      webSearch: createWebSearch(async () => ({
        query: '',
        provider: 'bing',
        results: [],
      })),
    });

    const history = await service.prepare(MEETING_ID, 'claude');
    expect(history.context.transcriptState).toBe('missing');
    expect(history.warning).toBe(
      '相槌と擬音の除去に失敗しました。元の文字起こしを使います。',
    );
    await expect(
      readFile(
        join(root, '2026', '2026-11-16_週次定例', CLEANED_TRANSCRIPT_FILE),
        'utf8',
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a chat when there is no summary', async () => {
    const { root } = await createMeeting({ summary: false });
    const service = new MeetingChatService({
      meetingStore: new MeetingStore(root),
      apiKeyStore: createApiKeyStore(),
      llmClient: createLlmClient(async () => ({
        text: '回答',
        inputTokens: 1,
        outputTokens: 1,
        status: 200,
      })),
      settings: () => createSettings(root),
      webSearch: createWebSearch(async () => ({
        query: '',
        provider: 'bing',
        results: [],
      })),
    });

    await expect(
      service.send({
        meetingId: MEETING_ID,
        message: '質問',
        profileId: 'claude',
        webSearch: false,
      }),
    ).rejects.toThrow('先に要約を生成してください。');
  });

  it('cancels a running chat without saving the messages', async () => {
    const { root } = await createMeeting();
    const complete = vi.fn(
      (request: ChatCompletionRequest) =>
        new Promise<never>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => {
            reject(new LlmError('cancelled', 'cancelled'));
          });
        }),
    );
    const service = new MeetingChatService({
      meetingStore: new MeetingStore(root),
      apiKeyStore: createApiKeyStore(),
      llmClient: createLlmClient(complete),
      settings: () => createSettings(root),
      webSearch: createWebSearch(async () => ({
        query: '',
        provider: 'bing',
        results: [],
      })),
    });

    const pending = service.send({
      meetingId: MEETING_ID,
      message: '質問',
      profileId: 'claude',
      webSearch: false,
    });
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(service.cancel(MEETING_ID)).toBe(true);
    await expect(pending).rejects.toThrow('チャットをキャンセルしました。');
    const history = await service.load(MEETING_ID);
    expect(history.messages).toEqual([]);
  });

  it('clears the chat history', async () => {
    const { root } = await createMeeting();
    const service = new MeetingChatService({
      meetingStore: new MeetingStore(root),
      apiKeyStore: createApiKeyStore(),
      llmClient: createLlmClient(async () => ({
        text: '回答',
        inputTokens: 1,
        outputTokens: 1,
        status: 200,
      })),
      settings: () => createSettings(root),
      webSearch: createWebSearch(async () => ({
        query: '',
        provider: 'bing',
        results: [],
      })),
    });

    await service.send({
      meetingId: MEETING_ID,
      message: '質問',
      profileId: 'claude',
      webSearch: false,
    });
    const cleared = await service.clear(MEETING_ID);
    expect(cleared.messages).toEqual([]);
  });
});
