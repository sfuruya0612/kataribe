import { validateEndpointUrl } from '../shared/llm';

export type LlmErrorCode =
  | 'configuration'
  | 'rate-limit'
  | 'server'
  | 'network'
  | 'timeout'
  | 'invalid-response'
  | 'cancelled';

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly status: number | null;

  constructor(code: LlmErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
  }
}

export type ChatCompletionRequest = {
  kind: 'openai' | 'anthropic';
  endpoint: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type ChatCompletionResult = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  status: number;
};

export type LlmClientOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxAttempts?: number;
};

type OpenAiResponse = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part &&
        typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : '',
      )
      .join('');
  }
  return '';
}

function parseOpenAiResponse(data: OpenAiResponse): {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
} {
  const text = contentToText(data.choices?.[0]?.message?.content);
  return {
    text,
    inputTokens:
      typeof data.usage?.prompt_tokens === 'number'
        ? data.usage.prompt_tokens
        : null,
    outputTokens:
      typeof data.usage?.completion_tokens === 'number'
        ? data.usage.completion_tokens
        : null,
  };
}

function parseAnthropicResponse(data: AnthropicResponse): {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
} {
  const text = (data.content ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('');
  return {
    text,
    inputTokens:
      typeof data.usage?.input_tokens === 'number'
        ? data.usage.input_tokens
        : null,
    outputTokens:
      typeof data.usage?.output_tokens === 'number'
        ? data.usage.output_tokens
        : null,
  };
}

function retryDelayMs(attempt: number, response: Response | null): number {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(30_000, seconds * 1000);
    }
  }
  return Math.min(8_000, 1000 * 2 ** attempt);
}

export class LlmClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;

  constructor(options: LlmClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const validation = validateEndpointUrl(request.endpoint);
    if (!validation.ok) {
      throw new LlmError('configuration', validation.error);
    }
    if (!request.apiKey) {
      throw new LlmError('configuration', 'API key is not configured');
    }
    if (!request.model.trim()) {
      throw new LlmError('configuration', 'model is not configured');
    }

    let lastError: LlmError | null = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        return await this.attempt(validation.normalized, request);
      } catch (error) {
        if (!(error instanceof LlmError)) {
          throw error;
        }
        lastError = error;
        if (
          error.code === 'configuration' ||
          error.code === 'cancelled' ||
          error.code === 'timeout' ||
          error.code === 'invalid-response'
        ) {
          throw error;
        }
        if (attempt + 1 >= this.maxAttempts) {
          throw error;
        }
        await this.sleep(retryDelayMs(attempt, null));
      }
    }
    throw lastError ?? new LlmError('network', 'LLM request failed');
  }

  private async attempt(
    endpoint: string,
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResult> {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    if (request.signal?.aborted) {
      throw new LlmError('cancelled', 'LLM request was cancelled');
    }
    request.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, request.timeoutMs ?? 120_000);
    timeout.unref?.();

    try {
      const body =
        request.kind === 'anthropic'
          ? {
              model: request.model,
              max_tokens: request.maxTokens ?? 4096,
              system: request.system,
              messages: [{ role: 'user', content: request.user }],
              temperature: request.temperature ?? 0.2,
            }
          : {
              model: request.model,
              messages: [
                { role: 'system', content: request.system },
                { role: 'user', content: request.user },
              ],
              ...(request.temperature !== undefined
                ? { temperature: request.temperature }
                : {}),
              ...(request.maxTokens
                ? /^(gpt-5|o[1-9])/i.test(request.model)
                  ? { max_completion_tokens: request.maxTokens }
                  : { max_tokens: request.maxTokens }
                : {}),
            };
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (request.kind === 'anthropic') {
        headers['x-api-key'] = request.apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers.authorization = `Bearer ${request.apiKey}`;
      }

      let response: Response;
      try {
        response = await this.fetchImpl(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
          redirect: 'error',
        });
      } catch (error) {
        if (request.signal?.aborted) {
          throw new LlmError('cancelled', 'LLM request was cancelled');
        }
        if (timedOut) {
          throw new LlmError('timeout', 'LLM request timed out');
        }
        throw new LlmError(
          'network',
          `LLM request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!response.ok) {
        const status = response.status;
        const errorText = (await response.text().catch(() => '')).slice(0, 2000);
        if (status === 401 || status === 403 || status === 404 || status === 400) {
          throw new LlmError(
            'configuration',
            `LLM configuration error: HTTP ${status}${errorText ? `: ${errorText}` : ''}`,
            status,
          );
        }
        if (status === 429) {
          throw new LlmError(
            'rate-limit',
            `LLM rate limit: HTTP 429${errorText ? `: ${errorText}` : ''}`,
            status,
          );
        }
        if (status >= 500 || status === 408) {
          throw new LlmError(
            'server',
            `LLM server error: HTTP ${status}${errorText ? `: ${errorText}` : ''}`,
            status,
          );
        }
        throw new LlmError(
          'configuration',
          `LLM request failed: HTTP ${status}${errorText ? `: ${errorText}` : ''}`,
          status,
        );
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new LlmError('invalid-response', 'LLM response is not valid JSON');
      }
      const parsed =
        request.kind === 'anthropic'
          ? parseAnthropicResponse(data as AnthropicResponse)
          : parseOpenAiResponse(data as OpenAiResponse);
      if (!parsed.text.trim()) {
        throw new LlmError('invalid-response', 'LLM response is empty');
      }
      return {
        ...parsed,
        status: response.status,
      };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }
}
