import { describe, expect, it } from 'vitest';
import {
  detectSummaryLanguage,
  formatSummaryMarkdown,
  formatTranscriptBody,
  formatTranscriptMarkdown,
  normalizeSummaryMarkdown,
  parseFrontMatter,
  stringifyFrontMatter,
} from '../src/shared/markdown';

describe('front matter', () => {
  it('parses and serializes YAML-like values', () => {
    const markdown = stringifyFrontMatter(
      {
        title: '週次定例: リリース',
        date: '2026-10-29T14:00:00+09:00',
        duration: '00:52:13',
        source: 'mic+system',
        model: 'ggml-large-v3-turbo',
        language: 'ja',
        partial: true,
      },
      '[00:00:04] 今日は先週の話をします。\n',
    );
    const parsed = parseFrontMatter(markdown);
    expect(parsed.hasFrontMatter).toBe(true);
    expect(parsed.frontMatter).toMatchObject({
      title: '週次定例: リリース',
      date: '2026-10-29T14:00:00+09:00',
      duration: '00:52:13',
      source: 'mic+system',
      model: 'ggml-large-v3-turbo',
      language: 'ja',
      partial: true,
    });
    expect(parsed.body).toBe('[00:00:04] 今日は先週の話をします。\n');
  });

  it('returns the raw body when front matter is absent', () => {
    expect(parseFrontMatter('## 要約\n本文')).toEqual({
      frontMatter: {},
      body: '## 要約\n本文',
      hasFrontMatter: false,
    });
  });

  it('keeps colons and hashes in quoted values', () => {
    const markdown = stringifyFrontMatter({ title: 'A # B: C' }, 'body');
    expect(markdown).toContain('title: "A # B: C"');
    expect(parseFrontMatter(markdown).frontMatter.title).toBe('A # B: C');
  });
});

describe('transcript markdown', () => {
  it('formats timestamps and flattens whitespace', () => {
    expect(
      formatTranscriptBody([
        { startSeconds: 4.9, text: ' 今日は\n先週の話です。 ' },
        { startSeconds: 3671, text: '終わり' },
        { startSeconds: 10, text: '   ' },
      ]),
    ).toBe('[00:00:04] 今日は 先週の話です。\n[01:01:11] 終わり');
  });

  it('adds front matter and partial flag', () => {
    const markdown = formatTranscriptMarkdown({
      title: '週次定例',
      startedAt: '2026-10-29T14:00:00+09:00',
      durationSeconds: 3721,
      source: 'mic+system',
      model: 'ggml-small',
      language: 'ja',
      partial: true,
      segments: [{ startSeconds: 12, text: 'こんにちは' }],
    });
    expect(markdown).toContain('duration: "01:02:01"');
    expect(markdown).toContain('partial: true');
    expect(markdown).toContain('[00:00:12] こんにちは');
  });
});

describe('summary markdown', () => {
  it('fills missing sections in Japanese and keeps extra headings', () => {
    const result = normalizeSummaryMarkdown(
      [
        '前置きです。',
        '## 要約',
        '会議の要約です。',
        '## 決定事項',
        '- リリースする',
        '## ToDo',
        '- 資料をまとめる',
        '## その他',
        '補足の内容',
      ].join('\n'),
      'ja',
    );
    expect(result.missingSections).toEqual(['openQuestions']);
    expect(result.body).toContain('## 要約\n\n前置きです。\n会議の要約です。');
    expect(result.body).toContain('## ToDo\n\n- [ ] 資料をまとめる');
    expect(result.body).toContain('## 未決事項');
    expect(result.body).toContain('## その他\n\n補足の内容');
  });

  it('recognizes English headings and code fences', () => {
    const result = normalizeSummaryMarkdown(
      ['```markdown', '## Summary', 'Done', '## Decisions', 'Ship', '## ToDo', '- [ ] test', '## Open Questions', 'None', '```'].join('\n'),
      'en',
    );
    expect(result.language).toBe('en');
    expect(result.missingSections).toEqual([]);
    expect(result.body).toContain('## Summary\n\nDone');
    expect(result.body).toContain('## Open Questions\n\nNone');
  });

  it('treats a response without headings as the summary section', () => {
    const result = normalizeSummaryMarkdown('本文だけの応答です。', 'ja');
    expect(result.missingSections).toEqual([
      'decisions',
      'todo',
      'openQuestions',
    ]);
    expect(result.body).toContain('## 要約\n\n本文だけの応答です。');
  });

  it('formats summary front matter and detects language', () => {
    const markdown = formatSummaryMarkdown({
      title: '週次定例',
      date: '2026-10-29',
      provider: 'claude',
      model: 'claude-sonnet-5-5',
      generatedAt: '2026-10-29T15:05:12+09:00',
      language: 'en',
      body: '## Summary\n\nDone',
    });
    expect(markdown).toContain('provider: claude');
    expect(markdown).toContain('model: claude-sonnet-5-5');
    expect(detectSummaryLanguage(markdown)).toBe('en');
  });
});
