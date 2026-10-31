import { describe, expect, it } from 'vitest';
import {
  buildChatEndpoint,
  estimateTokens,
  getLlmProviderPreset,
  maskApiKey,
  normalizeLlmBaseUrl,
  validateEndpointUrl,
} from '../src/shared/llm';
import { normalizeAppSettings } from '../src/shared/settings';

describe('LLM provider configuration', () => {
  it('provides the five presets and custom', () => {
    expect(
      ['claude', 'chatgpt', 'gemini', 'ollama', 'fireworks', 'custom'].map(
        (provider) => getLlmProviderPreset(provider as never).provider,
      ),
    ).toEqual(['claude', 'chatgpt', 'gemini', 'ollama', 'fireworks', 'custom']);
    expect(getLlmProviderPreset('claude').kind).toBe('anthropic');
    expect(getLlmProviderPreset('chatgpt').kind).toBe('openai');
  });

  it('builds OpenAI and Anthropic endpoints', () => {
    expect(buildChatEndpoint('https://api.openai.com/v1/', 'openai')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    expect(
      buildChatEndpoint('https://api.anthropic.com/v1', 'anthropic'),
    ).toBe('https://api.anthropic.com/v1/messages');
    expect(
      buildChatEndpoint(
        'https://api.example.com/v1/chat/completions',
        'openai',
      ),
    ).toBe('https://api.example.com/v1/chat/completions');
  });

  it('requires HTTPS except for localhost', () => {
    expect(validateEndpointUrl('https://api.example.com/v1').ok).toBe(true);
    expect(validateEndpointUrl('http://localhost:11434/v1').ok).toBe(true);
    expect(validateEndpointUrl('http://127.0.0.1:11434/v1').ok).toBe(true);
    expect(validateEndpointUrl('http://api.example.com/v1').ok).toBe(false);
    expect(validateEndpointUrl('ftp://api.example.com/v1').ok).toBe(false);
    expect(validateEndpointUrl('https://user:pass@api.example.com/v1').ok).toBe(
      false,
    );
  });

  it('normalizes provider-specific defaults', () => {
    const gemini = normalizeAppSettings({
      llmProfiles: [
        {
          id: 'gemini',
          provider: 'gemini',
          baseUrl: '',
          model: '',
        },
      ],
    });
    expect(gemini.llmProfiles[0]?.baseUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );
    expect(gemini.llmProfiles[0]?.model).toBe('gemini-3-pro');

    const custom = normalizeAppSettings({
      llmProfiles: [
        {
          id: 'custom',
          provider: 'custom',
          baseUrl: 'http://example.com/v1',
          model: 'local-model',
        },
      ],
    });
    expect(custom.llmProfiles[0]?.baseUrl).toBe('');
  });

  it('keeps an explicit valid base URL', () => {
    expect(
      normalizeLlmBaseUrl('chatgpt', 'https://proxy.example.com/v1/'),
    ).toBe('https://proxy.example.com/v1');
  });

  it('estimates tokens and masks keys', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
    expect(estimateTokens('こんにちは')).toBe(5);
    expect(maskApiKey('sk-1234567890')).toBe('sk-1...7890');
    expect(maskApiKey('short')).toBe('********');
  });
});
