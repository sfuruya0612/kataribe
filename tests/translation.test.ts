import { describe, expect, it, vi } from 'vitest';
import type { LlmClient } from '../src/main/llm';
import {
  buildTranslationSystemPrompt,
  parseTranslatedLines,
  splitTranslationLines,
  translateTranscript,
} from '../src/main/translation';

describe('translation helpers', () => {
  it('builds a prompt that preserves timestamps and line count', () => {
    const prompt = buildTranslationSystemPrompt('ja', 'en');
    expect(prompt).toContain('日本語');
    expect(prompt).toContain('[HH:MM:SS]');
    expect(prompt).toContain('行数とタイムスタンプを変えない');
  });

  it('splits transcript lines without splitting a segment', () => {
    const body = [
      '[00:00:00] short',
      '[00:00:05] this is a longer line',
      '[00:00:10] last',
    ].join('\n');
    const chunks = splitTranslationLines(body, 24);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat().map((line) => line.text)).toEqual([
      'short',
      'this is a longer line',
      'last',
    ]);
    expect(chunks.flat().map((line) => line.startSeconds)).toEqual([0, 5, 10]);
  });

  it('parses translated lines in source order', () => {
    const parsed = parseTranslatedLines(
      ['[00:00:00] こんにちは', '[00:00:05] さようなら'].join('\n'),
      [
        { startSeconds: 0, text: 'hello' },
        { startSeconds: 5, text: 'goodbye' },
      ],
    );
    expect(parsed.partial).toBe(false);
    expect(parsed.segments).toEqual([
      { startSeconds: 0, text: 'こんにちは' },
      { startSeconds: 5, text: 'さようなら' },
    ]);
  });

  it('matches translations by timestamp and marks mismatches partial', () => {
    const parsed = parseTranslatedLines(
      ['[00:00:05] さようなら'].join('\n'),
      [
        { startSeconds: 0, text: 'hello' },
        { startSeconds: 5, text: 'goodbye' },
      ],
    );
    expect(parsed.partial).toBe(true);
    expect(parsed.segments).toEqual([{ startSeconds: 5, text: 'さようなら' }]);
  });

  it('translates long transcripts in chunks and sums usage', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        text: '[00:00:00] hello',
        inputTokens: 10,
        outputTokens: 4,
        status: 200,
      })
      .mockResolvedValueOnce({
        text: '[00:00:10] goodbye',
        inputTokens: 12,
        outputTokens: 5,
        status: 200,
      });
    const body = [
      '[00:00:00] こんにちは',
      '[00:00:10] さようなら',
    ].join('\n');
    const result = await translateTranscript({
      client: { complete } as unknown as LlmClient,
      transcriptBody: body,
      sourceLanguage: 'ja',
      targetLanguage: 'en',
      kind: 'openai',
      endpoint: 'https://api.example.com/v1/chat/completions',
      apiKey: 'key',
      model: 'model',
      chunkChars: 20,
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.segments).toEqual([
      { startSeconds: 0, text: 'hello' },
      { startSeconds: 10, text: 'goodbye' },
    ]);
    expect(result.partial).toBe(false);
    expect(result.usage).toEqual({ inputTokens: 22, outputTokens: 9 });
  });

  it('rejects an empty transcript', async () => {
    await expect(
      translateTranscript({
        client: { complete: vi.fn() } as unknown as LlmClient,
        transcriptBody: '   ',
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        kind: 'openai',
        endpoint: 'https://api.example.com/v1/chat/completions',
        apiKey: 'key',
        model: 'model',
      }),
    ).rejects.toThrow('transcript is empty');
  });
});
