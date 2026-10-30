import { describe, expect, it, vi } from 'vitest';
import { LlmClient, LlmError } from '../src/main/llm';

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const baseRequest = {
  kind: 'openai' as const,
  endpoint: 'https://api.example.com/v1/chat/completions',
  apiKey: 'sk-secret',
  model: 'model-1',
  system: 'system prompt',
  user: 'user prompt',
};

describe('LlmClient', () => {
  it('sends an OpenAI-compatible chat completion request', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return jsonResponse({
        choices: [{ message: { content: 'result text' } }],
        usage: { prompt_tokens: 12, completion_tokens: 7 },
      });
    });
    const client = new LlmClient({ fetch: fetchImpl as unknown as typeof fetch });
    const result = await client.complete(baseRequest);
    expect(result).toEqual({
      text: 'result text',
      inputTokens: 12,
      outputTokens: 7,
      status: 200,
    });
    expect(capturedUrl).toBe('https://api.example.com/v1/chat/completions');
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-secret');
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.model).toBe('model-1');
    expect(body.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ]);
  });

  it('sends an Anthropic messages request', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      captured = init;
      return jsonResponse({
        content: [
          { type: 'text', text: 'anthropic ' },
          { type: 'text', text: 'result' },
        ],
        usage: { input_tokens: 20, output_tokens: 9 },
      });
    });
    const client = new LlmClient({ fetch: fetchImpl as unknown as typeof fetch });
    const result = await client.complete({
      ...baseRequest,
      kind: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      model: 'claude-test',
    });
    expect(result.text).toBe('anthropic result');
    expect(result.inputTokens).toBe(20);
    const headers = new Headers(captured?.headers);
    expect(headers.get('x-api-key')).toBe('sk-secret');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    const body = JSON.parse(String(captured?.body));
    expect(body.system).toBe('system prompt');
    expect(body.messages).toEqual([{ role: 'user', content: 'user prompt' }]);
    expect(body.max_tokens).toBe(4096);
  });

  it('does not retry configuration errors', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'bad key' }, 401));
    const client = new LlmClient({
      fetch: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });
    await expect(client.complete(baseRequest)).rejects.toMatchObject({
      code: 'configuration',
      status: 401,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries rate limits with exponential backoff', async () => {
    const responses = [
      jsonResponse({ error: 'rate' }, 429),
      jsonResponse({ error: 'rate' }, 429),
      jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift() as Response);
    const sleep = vi.fn(async () => undefined);
    const client = new LlmClient({
      fetch: fetchImpl as unknown as typeof fetch,
      sleep,
    });
    const result = await client.complete(baseRequest);
    expect(result.text).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect((sleep.mock.calls as unknown as Array<[number]>).map((call) => call[0])).toEqual([
      1000, 2000,
    ]);
  });

  it('reports request timeouts', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const client = new LlmClient({
      fetch: fetchImpl as unknown as typeof fetch,
      maxAttempts: 1,
    });
    await expect(
      client.complete({ ...baseRequest, timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects empty model responses', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '   ' } }] }),
    );
    const client = new LlmClient({ fetch: fetchImpl as unknown as typeof fetch });
    await expect(client.complete(baseRequest)).rejects.toBeInstanceOf(LlmError);
  });

  it('rejects insecure non-local endpoints', async () => {
    const client = new LlmClient({ fetch: vi.fn() as unknown as typeof fetch });
    await expect(
      client.complete({
        ...baseRequest,
        endpoint: 'http://api.example.com/v1/chat/completions',
      }),
    ).rejects.toMatchObject({ code: 'configuration' });
  });
});
