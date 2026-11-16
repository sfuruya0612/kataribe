import { defaultLlmProfile, findLlmProfile } from '../shared/llm';
import type { AppSettings, LlmRuntimeConfig } from '../shared/types';
import type { ApiKeyStore } from './api-keys';
import { t } from './i18n';
import { buildLlmProfileStatus } from './llm-profiles';

/**
 * 設定から LLM プロファイルの実行設定を組み立てる。
 */
export async function runtimeConfigFor(
  settings: AppSettings,
  apiKeyStore: ApiKeyStore,
  profileId?: string,
): Promise<LlmRuntimeConfig | null> {
  const profile = profileId
    ? findLlmProfile(settings, profileId)
    : defaultLlmProfile(settings);
  if (!profile) {
    return null;
  }
  return buildLlmProfileStatus(
    profile,
    profile.id === settings.llmDefaultProfileId,
    apiKeyStore,
    settings.uiLanguage,
  );
}

/**
 * LLM プロファイルを選び、API キーを復号して返す。
 * 設定の不足は画面に表示できる日本語のエラーにする。
 */
export async function resolveLlmRuntime(options: {
  settings: AppSettings;
  apiKeyStore: ApiKeyStore;
  profileId?: string;
}): Promise<{ config: LlmRuntimeConfig; apiKey: string }> {
  const config = await runtimeConfigFor(
    options.settings,
    options.apiKeyStore,
    options.profileId,
  );
  if (!config) {
    throw new Error(
      t(
        'LLM プロファイルが設定されていません。設定画面でプロファイルを追加してください。',
      ),
    );
  }
  if (!config.endpoint) {
    throw new Error(
      t('LLM のエンドポイント URL が正しくありません。設定を確認してください。'),
    );
  }
  if (!config.apiKeyConfigured) {
    throw new Error(
      t('LLM の API キーが設定されていません。設定画面で保存してください。'),
    );
  }
  let apiKey: string;
  try {
    apiKey =
      (await options.apiKeyStore.getKey(
        config.id,
        config.baseUrl,
        config.provider,
      )) ?? '';
  } catch (error) {
    throw new Error(
      t('API キーを復号できませんでした。設定画面で再入力してください。{detail}', {
        detail: error instanceof Error ? ` (${error.message})` : '',
      }),
    );
  }
  if (!apiKey) {
    throw new Error(t('API キーが設定されていません。'));
  }
  return { config, apiKey };
}
