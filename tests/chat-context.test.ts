/**
 * 会議チャットのコンテキスト選択、履歴の上限、Web 検索結果の埋め込みを検証する。
 * 対応する要求: REQ-CHAT-001, REQ-CHAT-003
 */
import { describe, expect, it } from 'vitest';
import type {
  ChatMessage,
  CleanedTranscriptDocument,
  SummaryDocument,
  TranscriptDocument,
} from '../src/shared/types';
import {
  buildChatContextInfo,
  buildChatRequest,
  hashChatContext,
  resolveChatTranscript,
  selectChatHistory,
  selectTranscriptExcerpt,
} from '../src/main/chat-context';
import { hashTranscriptBody } from '../src/main/cleaned-transcript';

const SUMMARY: SummaryDocument = {
  markdown: '---\ntitle: 週次定例\n---\n\n## 要約\nリリース計画を確認した。',
  body: '## 要約\nリリース計画を確認した。',
  language: 'ja',
  provider: 'claude',
  model: 'claude-test',
  generatedAt: '2026-11-16T00:00:00.000Z',
  updatedAt: '2026-11-16T00:00:00.000Z',
};

const TRANSCRIPT_BODY = [
  '[00:00:01] 話者A: 今日はリリース計画を確認します。',
  '[00:00:05] 話者B: なるほど。',
  '[00:00:08] 話者A: 来週リリースします。',
].join('\n');

const TRANSCRIPT: TranscriptDocument = {
  markdown: `---\ntitle: 週次定例\n---\n\n${TRANSCRIPT_BODY}`,
  body: TRANSCRIPT_BODY,
  language: 'ja',
  model: 'whisper',
  partial: false,
  updatedAt: '2026-11-16T00:00:00.000Z',
};

function cleaned(
  body: string,
  sourceBody = TRANSCRIPT_BODY,
  state: CleanedTranscriptDocument['state'] = 'completed',
): CleanedTranscriptDocument {
  return {
    markdown: `---\nsource_sha256: ${hashTranscriptBody(sourceBody)}\n---\n\n${body}`,
    body,
    sourceHash: hashTranscriptBody(sourceBody),
    state,
    generatedAt: '2026-11-16T01:00:00.000Z',
    provider: 'claude',
    model: 'claude-test',
    updatedAt: '2026-11-16T01:00:00.000Z',
  };
}

const CLEANED_BODY = [
  '[00:00:01] 話者A: 今日はリリース計画を確認します。',
  '[00:00:08] 話者A: 来週リリースします。',
].join('\n');

function message(
  id: string,
  role: ChatMessage['role'],
  content: string,
): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: '2026-11-16T00:00:00.000Z',
    profileId: 'claude',
    model: 'claude-test',
    webSearch: false,
    sources: [],
    searchError: null,
  };
}

describe('resolveChatTranscript', () => {
  it('falls back to the original transcript when no cleaned transcript exists', () => {
    expect(
      resolveChatTranscript({ transcript: TRANSCRIPT, cleaned: null }),
    ).toMatchObject({
      body: TRANSCRIPT_BODY,
      state: 'missing',
      source: 'original',
    });
  });

  it('uses the cleaned transcript when the source hash matches', () => {
    expect(
      resolveChatTranscript({
        transcript: TRANSCRIPT,
        cleaned: cleaned(CLEANED_BODY),
      }),
    ).toMatchObject({
      body: CLEANED_BODY,
      state: 'ready',
      source: 'cleaned',
      generatedAt: '2026-11-16T01:00:00.000Z',
    });
  });

  it('marks a partial cleaned transcript as partial', () => {
    expect(
      resolveChatTranscript({
        transcript: TRANSCRIPT,
        cleaned: cleaned(CLEANED_BODY, TRANSCRIPT_BODY, 'partial'),
      }),
    ).toMatchObject({
      state: 'partial',
      source: 'cleaned',
    });
  });

  it('falls back when the cleaned transcript is stale', () => {
    expect(
      resolveChatTranscript({
        transcript: { ...TRANSCRIPT, body: `${TRANSCRIPT_BODY}\n追記` },
        cleaned: cleaned(CLEANED_BODY),
      }),
    ).toMatchObject({
      state: 'stale',
      source: 'original',
    });
  });

  it('falls back when the cleanup failed', () => {
    expect(
      resolveChatTranscript({
        transcript: TRANSCRIPT,
        cleaned: cleaned(CLEANED_BODY, TRANSCRIPT_BODY, 'failed'),
      }),
    ).toMatchObject({
      state: 'missing',
      source: 'original',
    });
  });
});

describe('selectTranscriptExcerpt', () => {
  it('returns the full transcript when it fits', () => {
    expect(selectTranscriptExcerpt(TRANSCRIPT_BODY, 'リリース', 1000)).toEqual({
      text: TRANSCRIPT_BODY,
      excerpted: false,
    });
  });

  it('keeps the matched line and its neighbors for a long transcript', () => {
    const body = Array.from(
      { length: 100 },
      (_, index) =>
        `[00:${String(index).padStart(2, '0')}:00] 話者A: ${
          index === 50 ? 'リリース計画を確認します。' : '雑談です。'
        }`,
    ).join('\n');
    const excerpt = selectTranscriptExcerpt(body, 'リリース計画', 220);
    expect(excerpt.excerpted).toBe(true);
    expect(excerpt.text).toContain('リリース計画を確認します。');
    expect(excerpt.text).toContain('雑談です。');
    expect(excerpt.text.length).toBeLessThanOrEqual(220);
  });

  it('keeps the head and tail when no line matches', () => {
    const body = Array.from(
      { length: 100 },
      (_, index) => `[00:${String(index).padStart(2, '0')}:00] 雑談 ${index} です。`,
    ).join('\n');
    const excerpt = selectTranscriptExcerpt(body, '存在しない語', 220);
    expect(excerpt.excerpted).toBe(true);
    expect(excerpt.text).toContain('雑談 0 です。');
    expect(excerpt.text).toContain('雑談 99 です。');
    expect(excerpt.text).toContain('[...]');
    expect(excerpt.text.length).toBeLessThanOrEqual(220);
  });
});

describe('buildChatRequest', () => {
  it('builds a system prompt with the summary and the original transcript', () => {
    const built = buildChatRequest({
      summary: SUMMARY,
      transcript: TRANSCRIPT,
      cleaned: null,
      messages: [],
      query: 'リリースはいつ？',
      sources: [],
      searchError: null,
    });
    expect(built.system).toContain('## 要約\nリリース計画を確認した。');
    expect(built.system).toContain(TRANSCRIPT_BODY);
    expect(built.system).toContain(
      '相槌と擬音を除去した文字起こしがないため',
    );
    expect(built.system).toMatch(/MEETING SUMMARY START [0-9a-f]+/u);
    expect(built.system).toMatch(/MEETING TRANSCRIPT END [0-9a-f]+/u);
    expect(built.info.transcriptState).toBe('missing');
    expect(built.info.transcriptSource).toBe('original');
    expect(built.user).toBe('リリースはいつ？');
  });

  it('includes web search results with source numbers', () => {
    const built = buildChatRequest({
      summary: SUMMARY,
      transcript: TRANSCRIPT,
      cleaned: cleaned(CLEANED_BODY),
      messages: [],
      query: '一般的なリリース方法は？',
      sources: [
        {
          index: 1,
          title: 'リリース計画の作り方',
          url: 'https://example.com/release',
          displayUrl: 'https://example.com/release',
          snippet: '小さくリリースする。',
        },
      ],
      searchError: null,
    });
    expect(built.system).toContain('[1] リリース計画の作り方');
    expect(built.system).toContain('URL: https://example.com/release');
    expect(built.system).toContain('小さくリリースする。');
    expect(built.system).toContain('出典番号を付けてください');
  });

  it('includes the search failure note without web results', () => {
    const built = buildChatRequest({
      summary: SUMMARY,
      transcript: TRANSCRIPT,
      cleaned: null,
      messages: [],
      query: '調べて',
      sources: [],
      searchError: 'blocked',
    });
    expect(built.system).toContain('Web search failed: blocked');
    expect(built.system).toContain('検索できなかったことを回答に明記してください');
  });

  it('selects the latest chat history within the character limit', () => {
    const messages = [
      message('1', 'user', '古い質問'),
      message('2', 'assistant', '古い回答'),
      message('3', 'user', '新しい質問'),
      message('4', 'assistant', '新しい回答'),
    ];
    expect(selectChatHistory(messages, 1000, 4)).toEqual([
      { role: 'user', content: '古い質問' },
      { role: 'assistant', content: '古い回答' },
      { role: 'user', content: '新しい質問' },
      { role: 'assistant', content: '新しい回答' },
    ]);
    expect(selectChatHistory(messages, 12, 4)).toEqual([
      { role: 'user', content: '新しい質問' },
      { role: 'assistant', content: '新しい回答' },
    ]);
  });

  it('merges consecutive messages with the same role', () => {
    const messages = [
      message('1', 'user', '最初の質問'),
      message('2', 'user', '追加の質問'),
      message('3', 'assistant', '回答'),
    ];
    expect(selectChatHistory(messages)).toEqual([
      { role: 'user', content: '最初の質問\n\n追加の質問' },
      { role: 'assistant', content: '回答' },
    ]);
  });

  it('drops an unanswered trailing user message', () => {
    const messages = [
      message('1', 'user', '最初の質問'),
      message('2', 'assistant', '回答'),
      message('3', 'user', '応答が保存されなかった質問'),
    ];
    expect(selectChatHistory(messages)).toEqual([
      { role: 'user', content: '最初の質問' },
      { role: 'assistant', content: '回答' },
    ]);
  });
});

describe('chat context hash', () => {
  it('is deterministic and changes with the summary or transcript', () => {
    const first = hashChatContext('summary', 'transcript');
    expect(first).toBe(hashChatContext('summary', 'transcript'));
    expect(first).not.toBe(hashChatContext('summary2', 'transcript'));
    expect(first).not.toBe(hashChatContext('summary', 'transcript2'));
  });

  it('reports the transcript size and token estimate', () => {
    const info = buildChatContextInfo({
      summary: SUMMARY,
      transcript: TRANSCRIPT,
      cleaned: cleaned(CLEANED_BODY),
      query: 'リリース',
    });
    expect(info.summaryChars).toBe(SUMMARY.body.length);
    expect(info.transcriptChars).toBe(CLEANED_BODY.length);
    expect(info.usedTranscriptChars).toBe(CLEANED_BODY.length);
    expect(info.transcriptState).toBe('ready');
    expect(info.transcriptSource).toBe('cleaned');
    expect(info.estimatedTokens).toBeGreaterThan(0);
  });
});
