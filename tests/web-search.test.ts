/**
 * キー不要 Web 検索の RSS / HTML 解析、フォールバック、キャッシュ、エラーを検証する。
 * 対応する要求: REQ-CHAT-002
 */
import { describe, expect, it, vi } from 'vitest';
import {
  WebSearchError,
  WebSearchService,
  decodeHtmlEntities,
  parseBingRss,
  parseBraveHtml,
  parseDuckDuckGoHtml,
  resolveDuckDuckGoUrl,
  stripHtml,
} from '../src/main/web-search';

const BING_RSS = [
  '<?xml version="1.0" encoding="utf-8" ?>',
  '<rss version="2.0"><channel><title>Bing: OpenAI</title>',
  '<item><title>OpenAI | Research &amp; Deployment</title>',
  '<link>https://openai.com/</link>',
  '<description>OpenAI &lt;b&gt;research&lt;/b&gt; and deployment.</description></item>',
  '<item><title>API</title><link>https://platform.openai.com/</link>',
  '<description>Build with the OpenAI API.</description></item>',
  '</channel></rss>',
].join('');

const BRAVE_HTML = [
  '<div class="snippet svelte-jmfu5f" data-pos="1" data-type="web">',
  '<a href="/go/v1/token-1" class="svelte-14r20fy l1">',
  '<div class="title search-snippet-title" title="Brave Result">Brave Result</div>',
  '</a>',
  '<div class="generic-snippet"><div class="content">Brave snippet &amp; more.</div></div>',
  '<cite class="snippet-url">https://example.com › page</cite>',
  '</div>',
].join('');

const DUCKDUCKGO_HTML = [
  '<div class="result results_links">',
  '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle%3Fid%3D1">Example &amp; Article</a>',
  '<a class="result__snippet" href="https://example.com/article?id=1">This is &lt;b&gt;a snippet&lt;/b&gt;.</a>',
  '</div>',
  '<div class="result results_links">',
  '<a rel="nofollow" class="result__a" href="https://example.org/second">Second</a>',
  '<a class="result__snippet">Second snippet.</a>',
  '</div>',
].join('');

describe('HTML text helpers', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeHtmlEntities('a &amp; b &lt;c&gt; &#39;d&#x27;')).toBe(
      "a & b <c> 'd'",
    );
  });

  it('removes scripts, styles, and tags', () => {
    expect(
      stripHtml('<style>.x{}</style><p>Hello <b>world</b></p><script>x</script>'),
    ).toBe('Hello world');
  });
});

describe('parseBingRss', () => {
  it('parses titles, links, and snippets', () => {
    expect(parseBingRss(BING_RSS)).toEqual([
      {
        title: 'OpenAI | Research & Deployment',
        url: 'https://openai.com/',
        displayUrl: 'https://openai.com/',
        snippet: 'OpenAI research and deployment.',
      },
      {
        title: 'API',
        url: 'https://platform.openai.com/',
        displayUrl: 'https://platform.openai.com/',
        snippet: 'Build with the OpenAI API.',
      },
    ]);
  });

  it('returns no results for a non-RSS response', () => {
    expect(parseBingRss('<html>challenge</html>')).toEqual([]);
  });

  it('drops unsupported URL schemes and duplicates', () => {
    const xml = [
      '<rss><channel>',
      '<item><title>A</title><link>javascript:alert(1)</link><description>x</description></item>',
      '<item><title>B</title><link>https://example.com/</link><description>1</description></item>',
      '<item><title>C</title><link>https://example.com/</link><description>2</description></item>',
      '</channel></rss>',
    ].join('');
    expect(parseBingRss(xml)).toEqual([
      {
        title: 'B',
        url: 'https://example.com/',
        displayUrl: 'https://example.com/',
        snippet: '1',
      },
    ]);
  });
});

describe('parseBraveHtml', () => {
  it('parses result links, titles, snippets, and display URLs', () => {
    expect(parseBraveHtml(BRAVE_HTML)).toEqual([
      {
        title: 'Brave Result',
        url: 'https://search.brave.com/go/v1/token-1',
        displayUrl: 'https://example.com/',
        snippet: 'Brave snippet & more.',
      },
    ]);
  });
});

describe('parseDuckDuckGoHtml', () => {
  it('decodes redirect links and snippets', () => {
    expect(parseDuckDuckGoHtml(DUCKDUCKGO_HTML)).toEqual([
      {
        title: 'Example & Article',
        url: 'https://example.com/article?id=1',
        displayUrl: 'https://example.com/article?id=1',
        snippet: 'This is a snippet.',
      },
      {
        title: 'Second',
        url: 'https://example.org/second',
        displayUrl: 'https://example.org/second',
        snippet: 'Second snippet.',
      },
    ]);
  });

  it('rejects DuckDuckGo internal links', () => {
    expect(resolveDuckDuckGoUrl('https://duckduckgo.com/html/?q=test')).toBeNull();
  });

  it('reports a bot challenge when no result is present', () => {
    expect(() =>
      parseDuckDuckGoHtml('<div class="anomaly-modal__box">challenge</div>'),
    ).toThrow(WebSearchError);
  });
});

describe('WebSearchService', () => {
  it('uses Brave first and caches the result', async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request) => {
        return new Response(BRAVE_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      },
    );
    const service = new WebSearchService({
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => 1000,
    });
    const first = await service.search('OpenAI');
    expect(first.provider).toBe('brave');
    expect(first.results).toHaveLength(1);
    const second = await service.search('OpenAI');
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      'q=OpenAI',
    );
  });

  it('falls back to DuckDuckGo when Brave fails', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('search.brave.com')) {
        return new Response('server error', { status: 500 });
      }
      return new Response(DUCKDUCKGO_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
    const service = new WebSearchService({
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const result = await service.search('OpenAI');
    expect(result.provider).toBe('duckduckgo');
    expect(result.results[0]?.url).toBe(
      'https://example.com/article?id=1',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('falls back to Bing when Brave and DuckDuckGo fail', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('bing.com')) {
        return new Response(BING_RSS, {
          status: 200,
          headers: { 'content-type': 'application/rss+xml' },
        });
      }
      return new Response('server error', { status: 500 });
    });
    const service = new WebSearchService({
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const result = await service.search('OpenAI');
    expect(result.provider).toBe('bing');
    expect(result.results).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not use Bing for a CJK query', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('blocked', { status: 403 });
    });
    const service = new WebSearchService({
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await expect(service.search('会議 文字起こし')).rejects.toMatchObject({
      name: 'WebSearchError',
      code: 'unavailable',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails with a clear error when all providers fail', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('blocked', { status: 403 });
    });
    const service = new WebSearchService({
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await expect(service.search('OpenAI')).rejects.toMatchObject({
      name: 'WebSearchError',
      code: 'unavailable',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('rejects an empty query', async () => {
    const service = new WebSearchService();
    await expect(service.search('   ')).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
});
