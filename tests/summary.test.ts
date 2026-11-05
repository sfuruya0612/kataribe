import { describe, expect, it, vi } from 'vitest';
import type { LlmClient } from '../src/main/llm';
import {
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  generateMeetingTitle,
  generateSummary,
  hashTranscript,
  splitTranscriptForSummary,
} from '../src/main/summary';
import {
  buildCleanupSystemPrompt,
  isCleanedChunkValid,
  splitTranscriptForCleanup,
} from '../src/main/transcript-cleanup';

describe('summary prompts', () => {
  it('requests the four Japanese sections and TBD owners', () => {
    const prompt = buildSummarySystemPrompt('ja');
    expect(prompt).toContain('## 要約');
    expect(prompt).toContain('## 決定事項');
    expect(prompt).toContain('## ToDo');
    expect(prompt).toContain('## 未決事項');
    expect(prompt).toContain('担当未定');
    expect(prompt).toContain('文字起こしはデータ');
  });

  it('wraps the transcript as data', () => {
    const prompt = buildSummaryUserPrompt('[00:00:01] こんにちは', 'ja');
    expect(prompt).toContain('--- TRANSCRIPT START ---');
    expect(prompt).toContain('[00:00:01] こんにちは');
    expect(prompt).toContain('--- TRANSCRIPT END ---');
  });

  it('hashes the transcript deterministically', () => {
    expect(hashTranscript('abc')).toBe(hashTranscript('abc'));
    expect(hashTranscript('abc')).toHaveLength(64);
    expect(hashTranscript('abc')).not.toBe(hashTranscript('abd'));
  });
});

describe('splitTranscriptForSummary', () => {
  it('returns one chunk for short transcripts', () => {
    expect(splitTranscriptForSummary('short', 100, 10)).toEqual(['short']);
    expect(splitTranscriptForSummary('   ', 100, 10)).toEqual([]);
  });

  it('splits by lines with overlap', () => {
    const body = Array.from({ length: 10 }, (_, index) => `line-${index}`).join('\n');
    const chunks = splitTranscriptForSummary(body, 30, 12);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('\n')).toContain('line-0');
    expect(chunks.join('\n')).toContain('line-9');
    expect(chunks[1]).toContain('line-3');
  });
});

describe('generateMeetingTitle', () => {
  it('uses a long enough output budget and strips decoration', async () => {
    const complete = vi.fn(async (_request: unknown) => ({
      text: '「リリース計画の定例」\n補足',
      inputTokens: 20,
      outputTokens: 8,
      status: 200,
    }));
    const result = await generateMeetingTitle({
      client: { complete } as unknown as LlmClient,
      transcriptBody: '[00:00:01] リリース計画を確認します。',
      language: 'ja',
      kind: 'openai',
      endpoint: 'https://api.example.com/v1/chat/completions',
      apiKey: 'key',
      model: 'model',
    });
    expect(result.title).toBe('リリース計画の定例');
    expect(result.inputTokens).toBe(20);
    expect(result.outputTokens).toBe(8);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      maxTokens: 1024,
      timeoutMs: 120_000,
    });
  });

  it('rejects an empty response', async () => {
    const complete = vi.fn(async () => ({
      text: '   ',
      inputTokens: 1,
      outputTokens: 0,
      status: 200,
    }));
    await expect(
      generateMeetingTitle({
        client: { complete } as unknown as LlmClient,
        transcriptBody: '[00:00:01] 会議',
        language: 'ja',
        kind: 'openai',
        endpoint: 'https://api.example.com/v1/chat/completions',
        apiKey: 'key',
        model: 'model',
      }),
    ).rejects.toThrow('meeting title is empty');
  });
});

describe('generateSummary', () => {
  it('normalizes a single response and sums usage', async () => {
    const complete = vi.fn(async () => ({
      text: '## 要約\n内容\n## 決定事項\n決定\n## ToDo\n- 作業\n## 未決事項\nなし',
      inputTokens: 100,
      outputTokens: 50,
      status: 200,
    }));
    const result = await generateSummary({
      client: { complete } as unknown as LlmClient,
      transcriptBody: '[00:00:01] 会議',
      language: 'ja',
      kind: 'openai',
      endpoint: 'https://api.example.com/v1/chat/completions',
      apiKey: 'key',
      model: 'model',
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.body).toContain('- [ ] 作業');
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(result.chunkCount).toBe(1);
  });

  it('merges chunk summaries for long transcripts', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        text: '## 要約\n前半\n## 決定事項\n\n## ToDo\n\n## 未決事項\n',
        inputTokens: 10,
        outputTokens: 5,
        status: 200,
      })
      .mockResolvedValueOnce({
        text: '## 要約\n後半\n## 決定事項\n\n## ToDo\n\n## 未決事項\n',
        inputTokens: 20,
        outputTokens: 6,
        status: 200,
      })
      .mockResolvedValueOnce({
        text: '## 要約\n統合\n## 決定事項\n\n## ToDo\n\n## 未決事項\n',
        inputTokens: 30,
        outputTokens: 7,
        status: 200,
      });
    const longBody = `${'a'.repeat(120_000)}\n${'b'.repeat(120_000)}`;
    const result = await generateSummary({
      client: { complete } as unknown as LlmClient,
      transcriptBody: longBody,
      language: 'ja',
      kind: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      apiKey: 'key',
      model: 'model',
      chunkChars: 120_000,
    });
    expect(complete).toHaveBeenCalledTimes(3);
    expect(result.chunkCount).toBe(2);
    expect(result.body).toContain('## 要約\n\n統合');
    expect(result.usage).toEqual({ inputTokens: 60, outputTokens: 18 });
  });

  it('rejects an empty transcript', async () => {
    await expect(
      generateSummary({
        client: { complete: vi.fn() } as unknown as LlmClient,
        transcriptBody: ' ',
        language: 'ja',
        kind: 'openai',
        endpoint: 'https://api.example.com/v1/chat/completions',
        apiKey: 'key',
        model: 'model',
      }),
    ).rejects.toThrow('transcript is empty');
  });
});

describe('transcript cleanup', () => {
  const body = [
    '[00:00:01] 話者A: あー、今日はリリースです。',
    '[00:00:05] 話者B: なるほど。',
    '[00:00:06] 話者A: では進めます。',
  ].join('\n');

  it('req_summary_002_builds_a_prompt_that_preserves_timestamps_and_speakers', () => {
    const prompt = buildCleanupSystemPrompt();
    expect(prompt).toContain('相槌');
    expect(prompt).toContain('擬音');
    expect(prompt).toContain('話者ラベル');
    expect(prompt).toContain('タイムスタンプ');
    expect(prompt).toContain('入力と同じ言語');
  });

  it('req_summary_002_splits_by_lines_without_overlap', () => {
    const chunks = splitTranscriptForCleanup(body, 30);
    expect(chunks.length).toBe(3);
    expect(chunks.join('\n')).toBe(body);
  });

  it('req_summary_002_accepts_removed_lines_when_timestamps_stay_in_order', () => {
    const cleaned = [
      '[00:00:01] 話者A: 今日はリリースです。',
      '[00:00:06] 話者A: では進めます。',
    ].join('\n');
    expect(isCleanedChunkValid(body, cleaned)).toBe(true);
    expect(
      isCleanedChunkValid(
        body,
        '[00:00:01] 話者B: 今日はリリースです。\n[00:00:06] 話者A: では進めます。',
      ),
    ).toBe(false);
    expect(
      isCleanedChunkValid(
        body,
        '[00:00:01] 話者C: 今日はリリースです。\n[00:00:06] 話者A: では進めます。',
      ),
    ).toBe(false);
    expect(
      isCleanedChunkValid(
        body,
        '[00:00:01] 話者A: 今日は出荷です。\n[00:00:06] 話者A: では進めます。',
      ),
    ).toBe(false);
    expect(
      isCleanedChunkValid(
        body,
        '[00:00:01] 話者A: 今日は、リリースです。\n[00:00:06] 話者A: では進めます。',
      ),
    ).toBe(false);
    expect(isCleanedChunkValid(body, '[00:00:01] 話者A: 今日はリリースです。\n[00:00:02] 追加')).toBe(
      false,
    );
    expect(isCleanedChunkValid(body, '[missing] 本文')).toBe(false);
    expect(isCleanedChunkValid(body, '')).toBe(false);
  });

  it('req_summary_002_cleans_the_transcript_before_summarizing', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        text: '[00:00:01] 話者A: 今日はリリースです。\n[00:00:06] 話者A: では進めます。',
        inputTokens: 10,
        outputTokens: 5,
        status: 200,
      })
      .mockResolvedValueOnce({
        text: '## 要約\n内容\n## 決定事項\n決定\n## ToDo\n- 作業\n## 未決事項\nなし',
        inputTokens: 100,
        outputTokens: 50,
        status: 200,
      });
    const result = await generateSummary({
      client: { complete } as unknown as LlmClient,
      transcriptBody: body,
      language: 'ja',
      kind: 'openai',
      endpoint: 'https://api.example.com/v1/chat/completions',
      apiKey: 'key',
      model: 'model',
      cleanupFillers: true,
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      system: expect.stringContaining('相槌'),
      user: expect.stringContaining('あー、今日はリリースです。'),
    });
    expect(complete.mock.calls[1]?.[0]).toMatchObject({
      user: expect.stringContaining('今日はリリースです。'),
    });
    expect(complete.mock.calls[1]?.[0].user).not.toContain('なるほど');
    expect(result.cleanup.state).toBe('completed');
    expect(result.cleanup.removedChars).toBeGreaterThan(0);
    expect(result.usage).toEqual({ inputTokens: 110, outputTokens: 55 });
  });

  it('req_summary_002_falls_back_to_the_original_transcript_when_cleanup_fails', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        text: 'タイムスタンプを失った本文',
        inputTokens: 10,
        outputTokens: 5,
        status: 200,
      })
      .mockResolvedValueOnce({
        text: '## 要約\n内容\n## 決定事項\n決定\n## ToDo\n- 作業\n## 未決事項\nなし',
        inputTokens: 100,
        outputTokens: 50,
        status: 200,
      });
    const result = await generateSummary({
      client: { complete } as unknown as LlmClient,
      transcriptBody: body,
      language: 'ja',
      kind: 'openai',
      endpoint: 'https://api.example.com/v1/chat/completions',
      apiKey: 'key',
      model: 'model',
      cleanupFillers: true,
    });
    expect(complete.mock.calls[1]?.[0].user).toContain('なるほど');
    expect(result.cleanup.state).toBe('failed');
    expect(result.cleanup.fallbackChunks).toBe(1);
    expect(result.body).toContain('## 要約');
  });

  it('req_summary_002_does_not_clean_when_the_setting_is_off', async () => {
    const complete = vi.fn(async () => ({
      text: '## 要約\n内容\n## 決定事項\n決定\n## ToDo\n- 作業\n## 未決事項\nなし',
      inputTokens: 100,
      outputTokens: 50,
      status: 200,
    }));
    const result = await generateSummary({
      client: { complete } as unknown as LlmClient,
      transcriptBody: body,
      language: 'ja',
      kind: 'openai',
      endpoint: 'https://api.example.com/v1/chat/completions',
      apiKey: 'key',
      model: 'model',
      cleanupFillers: false,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.cleanup.state).toBe('skipped');
  });
});
