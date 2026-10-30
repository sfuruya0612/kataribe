import type { LlmProvider, LlmProviderPreset } from './types';

export const LLM_PROVIDER_PRESETS: LlmProviderPreset[] = [
  {
    provider: 'claude',
    label: 'Claude',
    kind: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5-5',
  },
  {
    provider: 'chatgpt',
    label: 'ChatGPT',
    kind: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.5',
  },
  {
    provider: 'gemini',
    label: 'Gemini',
    kind: 'openai',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3-pro',
  },
  {
    provider: 'ollama',
    label: 'Ollama Cloud',
    kind: 'openai',
    defaultBaseUrl: 'https://ollama.com/v1',
    defaultModel: 'qwen3.5:235b',
  },
  {
    provider: 'fireworks',
    label: 'Fireworks AI',
    kind: 'openai',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/gpt-oss-120b',
  },
  {
    provider: 'custom',
    label: 'カスタム',
    kind: 'openai',
    defaultBaseUrl: '',
    defaultModel: '',
  },
];

const PROVIDERS: LlmProvider[] = LLM_PROVIDER_PRESETS.map((preset) => preset.provider);

export function isLlmProvider(value: unknown): value is LlmProvider {
  return PROVIDERS.includes(value as LlmProvider);
}

export function getLlmProviderPreset(provider: LlmProvider): LlmProviderPreset {
  return (
    LLM_PROVIDER_PRESETS.find((preset) => preset.provider === provider) ??
    LLM_PROVIDER_PRESETS[0]
  );
}

export function isLocalHostname(hostname: string): boolean {
  const value = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost' || value === '127.0.0.1' || value === '::1';
}

export type EndpointValidation =
  | { ok: true; url: URL; normalized: string }
  | { ok: false; error: string };

export function validateEndpointUrl(raw: string): EndpointValidation {
  const value = raw.trim();
  if (!value) {
    return { ok: false, error: 'エンドポイント URL を入力してください。' };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'エンドポイント URL の形式が正しくありません。' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'エンドポイント URL に認証情報を含めないでください。' };
  }
  if (url.hash) {
    return { ok: false, error: 'エンドポイント URL にフラグメントを含めないでください。' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'エンドポイント URL は HTTPS を指定してください。' };
  }
  if (url.protocol === 'http:' && !isLocalHostname(url.hostname)) {
    return {
      ok: false,
      error: 'HTTP は localhost、127.0.0.1、::1 のいずれかでのみ使用できます。',
    };
  }
  return { ok: true, url, normalized: url.toString().replace(/\/$/, '') };
}

export function buildChatEndpoint(
  baseUrl: string,
  kind: 'openai' | 'anthropic',
): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }
  if (kind === 'anthropic') {
    return /\/messages$/i.test(trimmed) ? trimmed : `${trimmed}/messages`;
  }
  return /\/chat\/completions$/i.test(trimmed)
    ? trimmed
    : `${trimmed}/chat/completions`;
}

export function normalizeLlmBaseUrl(
  provider: LlmProvider,
  value: unknown,
): string {
  const preset = getLlmProviderPreset(provider);
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return preset.defaultBaseUrl;
  }
  const validation = validateEndpointUrl(raw);
  if (!validation.ok) {
    return preset.defaultBaseUrl;
  }
  return validation.normalized;
}

export function maskApiKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= 8) {
    return '********';
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (/[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(char)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.max(1, Math.ceil(cjk + other / 4));
}

