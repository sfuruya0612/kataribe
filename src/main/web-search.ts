/**
 * API キーを要求しない簡易 Web 検索。
 * Brave Search の HTML を第一候補、DuckDuckGo の HTML を第二候補とし、
 * Bing の RSS は CJK を含まないクエリだけ最後のフォールバックに使う。
 * 検索エンジンの仕様変更で使えなくなる場合がある。
 */
export type WebSearchProvider = 'brave' | 'duckduckgo' | 'bing';

export type WebSearchResultItem = {
  title: string;
  url: string;
  displayUrl: string | null;
  snippet: string;
};

export type WebSearchResponse = {
  query: string;
  provider: WebSearchProvider;
  results: WebSearchResultItem[];
};

export type WebSearchErrorCode =
  | 'unavailable'
  | 'blocked'
  | 'timeout'
  | 'cancelled';

export class WebSearchError extends Error {
  readonly code: WebSearchErrorCode;

  constructor(code: WebSearchErrorCode, message: string) {
    super(message);
    this.name = 'WebSearchError';
    this.code = code;
  }
}

export type WebSearchOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  cacheTtlMs?: number;
};

export type WebSearchRequestOptions = {
  signal?: AbortSignal;
  locale?: 'ja' | 'en';
  limit?: number;
};

const MAX_RESPONSE_CHARS = 2_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_LIMIT = 5;
const MAX_CACHE_ENTRIES = 50;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '...',
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);/giu, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/giu, ' ')
    .replace(/<br\s*\/?>/giu, ' ')
    .replace(/<[^>]*>/gu, '')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([.,!?;:、。])/gu, '$1')
    .trim();
}

function cleanText(value: string): string {
  const decoded = decodeHtmlEntities(value);
  return decodeHtmlEntities(stripHtml(decoded)).replace(/\s+/gu, ' ').trim();
}

function xmlTag(block: string, tag: string): string {
  const pattern = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
    'iu',
  );
  const match = block.match(pattern);
  if (!match) {
    return '';
  }
  return cleanText(
    match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/u, '$1'),
  );
}

function normalizeResultUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function displayUrlFor(url: string, citeText: string): string | null {
  const compact = citeText.replace(/(https?:\/\/)\s+/gu, '$1');
  const match = compact.match(/https?:\/\/[^\s›]+/u);
  if (match) {
    const candidate = normalizeResultUrl(match[0]);
    if (candidate) {
      return candidate;
    }
  }
  return url.includes('search.brave.com') ? null : url;
}

function dedupe(
  results: WebSearchResultItem[],
  limit: number,
): WebSearchResultItem[] {
  const seen = new Set<string>();
  const unique: WebSearchResultItem[] = [];
  for (const result of results) {
    if (seen.has(result.url)) {
      continue;
    }
    seen.add(result.url);
    unique.push(result);
    if (unique.length >= limit) {
      break;
    }
  }
  return unique;
}

export function parseBraveHtml(
  html: string,
  limit = DEFAULT_LIMIT,
): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = [];
  const blocks = html.split(/(?=<div[^>]*\bdata-type="web")/iu);
  for (const block of blocks) {
    if (!/<div[^>]*\bdata-type="web"/iu.test(block)) {
      continue;
    }
    const anchor = block.match(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/iu);
    if (!anchor) {
      continue;
    }
    const href = decodeHtmlEntities(anchor[1]);
    let url: string | null = null;
    try {
      url = normalizeResultUrl(
        href.startsWith('//')
          ? `https:${href}`
          : href.startsWith('/')
            ? new URL(href, 'https://search.brave.com').toString()
            : href,
      );
    } catch {
      url = null;
    }
    if (!url) {
      continue;
    }
    const titleMatch =
      block.match(
        /<div[^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*\btitle="([^"]*)"/iu,
      ) ??
      block.match(
        /<div[^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/div>/iu,
      );
    const snippetMatch = block.match(
      /<div[^>]*\bclass="[^"]*\bgeneric-snippet\b[^"]*"[^>]*>[\s\S]*?<div[^>]*\bclass="[^"]*\bcontent\b[^"]*"[^>]*>([\s\S]*?)<\/div>/iu,
    );
    const citeMatch = block.match(
      /<cite[^>]*\bclass="[^"]*\bsnippet-url\b[^"]*"[^>]*>([\s\S]*?)<\/cite>/iu,
    );
    const title = cleanText(titleMatch?.[1] ?? '');
    const citeText = cleanText(citeMatch?.[1] ?? '');
    results.push({
      title: title || url,
      url,
      displayUrl: displayUrlFor(url, citeText),
      snippet: cleanText(snippetMatch?.[1] ?? ''),
    });
  }
  if (
    results.length === 0 &&
    /captcha|unusual traffic|not a robot/iu.test(html)
  ) {
    throw new WebSearchError(
      'blocked',
      'Brave Search returned a bot challenge',
    );
  }
  return dedupe(results, Math.max(1, limit));
}

export function parseBingRss(
  xml: string,
  limit = DEFAULT_LIMIT,
): WebSearchResultItem[] {
  if (!/<rss\b/iu.test(xml)) {
    return [];
  }
  const results: WebSearchResultItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)) {
    const block = match[1];
    const title = xmlTag(block, 'title');
    const url = normalizeResultUrl(xmlTag(block, 'link'));
    if (!url) {
      continue;
    }
    results.push({
      title: title || url,
      url,
      displayUrl: url,
      snippet: xmlTag(block, 'description'),
    });
  }
  return dedupe(results, Math.max(1, limit));
}

export function resolveDuckDuckGoUrl(raw: string): string | null {
  let value = raw.trim();
  if (!value) {
    return null;
  }
  if (value.startsWith('//')) {
    value = `https:${value}`;
  } else if (value.startsWith('/')) {
    value = new URL(value, 'https://duckduckgo.com').toString();
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (/(^|\.)duckduckgo\.com$/iu.test(url.hostname) && url.pathname.startsWith('/l/')) {
    const target = url.searchParams.get('uddg');
    if (!target) {
      return null;
    }
    try {
      url = new URL(target);
    } catch {
      return null;
    }
  }
  if (/(^|\.)duckduckgo\.com$/iu.test(url.hostname)) {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }
  return url.toString();
}

export function parseDuckDuckGoHtml(
  html: string,
  limit = DEFAULT_LIMIT,
): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const attributes = match[1];
    if (!/\bclass="[^"]*\bresult__a\b[^"]*"/iu.test(attributes)) {
      continue;
    }
    const href = attributes.match(/\bhref="([^"]*)"/iu)?.[1];
    const url = href ? resolveDuckDuckGoUrl(decodeHtmlEntities(href)) : null;
    if (!url) {
      continue;
    }
    const title = cleanText(match[2]) || url;
    const anchorEnd = (match.index ?? 0) + match[0].length;
    const tail = html.slice(anchorEnd, anchorEnd + 8_000);
    const snippetMatch =
      tail.match(
        /<a\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/iu,
      ) ??
      tail.match(
        /<div\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/div>/iu,
      );
    results.push({
      title,
      url,
      displayUrl: url,
      snippet: snippetMatch ? cleanText(snippetMatch[1]) : '',
    });
  }
  if (
    results.length === 0 &&
    /anomaly-modal|anomaly-modal__|challenge-form/iu.test(html)
  ) {
    throw new WebSearchError(
      'blocked',
      'DuckDuckGo returned a bot challenge instead of search results',
    );
  }
  return dedupe(results, Math.max(1, limit));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class WebSearchService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<
    string,
    { expiresAt: number; response: WebSearchResponse }
  >();

  constructor(options: WebSearchOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  }

  async search(
    query: string,
    options: WebSearchRequestOptions = {},
  ): Promise<WebSearchResponse> {
    const normalized = query.replace(/\s+/gu, ' ').trim().slice(0, 300);
    if (!normalized) {
      throw new WebSearchError('unavailable', 'search query is empty');
    }
    const limit = Math.max(1, Math.min(10, options.limit ?? DEFAULT_LIMIT));
    const locale = options.locale ?? 'ja';
    const cacheKey = `${locale}\n${limit}\n${normalized}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      return cached.response;
    }

    const errors: string[] = [];
    const attempt = async (
      label: string,
      url: string,
      accept: string,
      provider: WebSearchProvider,
      parse: (text: string, limit: number) => WebSearchResultItem[],
    ): Promise<WebSearchResponse | null> => {
      try {
        const text = await this.fetchText(
          url,
          accept,
          options.signal,
          locale,
        );
        const results = parse(text, limit);
        if (results.length > 0) {
          return this.remember(cacheKey, {
            query: normalized,
            provider,
            results,
          });
        }
        errors.push(`${label} returned no results`);
      } catch (error) {
        if (error instanceof WebSearchError && error.code === 'cancelled') {
          throw error;
        }
        errors.push(`${label}: ${errorMessage(error)}`);
      }
      return null;
    };

    const braveUrl = new URL('https://search.brave.com/search');
    braveUrl.searchParams.set('q', normalized);
    braveUrl.searchParams.set('source', 'web');
    const brave = await attempt(
      'Brave',
      braveUrl.toString(),
      'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'brave',
      parseBraveHtml,
    );
    if (brave) {
      return brave;
    }

    const duckDuckGoUrl = new URL('https://html.duckduckgo.com/html/');
    duckDuckGoUrl.searchParams.set('q', normalized);
    duckDuckGoUrl.searchParams.set('kl', locale === 'ja' ? 'jp-jp' : 'us-en');
    const duckDuckGo = await attempt(
      'DuckDuckGo',
      duckDuckGoUrl.toString(),
      'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'duckduckgo',
      parseDuckDuckGoHtml,
    );
    if (duckDuckGo) {
      return duckDuckGo;
    }

    // Bing の RSS は日本語のクエリで無関係な結果を返すことがあるため、
    // CJK を含まないクエリだけ最後のフォールバックに使う。
    const hasCjk =
      /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(
        normalized,
      );
    if (!hasCjk) {
      const bingUrl = new URL('https://www.bing.com/search');
      bingUrl.searchParams.set('q', normalized);
      bingUrl.searchParams.set('format', 'rss');
      bingUrl.searchParams.set('setlang', locale === 'ja' ? 'ja' : 'en');
      bingUrl.searchParams.set('mkt', locale === 'ja' ? 'ja-JP' : 'en-US');
      const bing = await attempt(
        'Bing',
        bingUrl.toString(),
        'application/rss+xml, application/xml;q=0.9, text/html;q=0.8',
        'bing',
        parseBingRss,
      );
      if (bing) {
        return bing;
      }
    } else {
      errors.push('Bing skipped for a CJK query');
    }

    throw new WebSearchError(
      'unavailable',
      `web search failed: ${errors.join('; ')}`,
    );
  }

  private remember(key: string, response: WebSearchResponse): WebSearchResponse {
    if (this.cacheTtlMs > 0) {
      if (!this.cache.has(key) && this.cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest) {
          this.cache.delete(oldest);
        }
      }
      this.cache.set(key, {
        expiresAt: this.now() + this.cacheTtlMs,
        response,
      });
    }
    return response;
  }

  private async fetchText(
    url: string,
    accept: string,
    signal: AbortSignal | undefined,
    locale: 'ja' | 'en',
  ): Promise<string> {
    if (signal?.aborted) {
      throw new WebSearchError('cancelled', 'web search was cancelled');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: {
            accept,
            'accept-language':
              locale === 'ja'
                ? 'ja-JP,ja;q=0.9,en;q=0.8'
                : 'en-US,en;q=0.9',
            'user-agent': USER_AGENT,
          },
          // 検索エンジン以外へのリダイレクトを追わず、SSRF を防ぐ。
          redirect: 'error',
          signal: controller.signal,
        });
      } catch (error) {
        if (signal?.aborted) {
          throw new WebSearchError('cancelled', 'web search was cancelled');
        }
        if (controller.signal.aborted) {
          throw new WebSearchError('timeout', 'web search timed out');
        }
        throw new WebSearchError(
          'unavailable',
          `web search request failed: ${errorMessage(error)}`,
        );
      }
      if (!response.ok) {
        throw new WebSearchError(
          'unavailable',
          `web search request failed: HTTP ${response.status}`,
        );
      }
      const contentLength = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_CHARS) {
        throw new WebSearchError(
          'unavailable',
          'web search response is too large',
        );
      }
      const text = await response.text();
      if (text.length > MAX_RESPONSE_CHARS) {
        throw new WebSearchError(
          'unavailable',
          'web search response is too large',
        );
      }
      return text;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
