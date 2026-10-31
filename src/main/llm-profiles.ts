import {
  buildChatEndpoint,
  getLlmProviderPreset,
  isLlmProvider,
  normalizeLlmProfileId,
  validateEndpointUrl,
} from '../shared/llm';
import type {
  LlmProfile,
  LlmProfileStatus,
  LlmProfilesState,
  SaveLlmProfileRequest,
} from '../shared/types';
import type { ApiKeyStore } from './api-keys';
import type { SettingsStore } from './settings';

export async function buildLlmProfileStatus(
  profile: LlmProfile,
  isDefault: boolean,
  apiKeyStore: ApiKeyStore,
): Promise<LlmProfileStatus> {
  const preset = getLlmProviderPreset(profile.provider);
  const validation = validateEndpointUrl(profile.baseUrl);
  const endpoint = validation.ok
    ? buildChatEndpoint(validation.normalized, preset.kind)
    : '';
  const status = await apiKeyStore.status(profile.id, profile.baseUrl);
  const hostMatchesKey =
    status.configured &&
    apiKeyStore.hostMatches(profile.id, profile.baseUrl, profile.provider);
  return {
    id: profile.id,
    provider: profile.provider,
    providerLabel: preset.label,
    kind: preset.kind,
    baseUrl: profile.baseUrl,
    endpoint,
    model: profile.model,
    apiKeyConfigured: hostMatchesKey,
    apiKeyStored: status.configured,
    storedHost: status.host,
    keychainAvailable: status.keychainAvailable,
    keychainError: status.keychainError,
    host: validation.ok ? validation.url.host : '',
    hostMatchesKey,
    isDefault,
  };
}

export class LlmProfileManager {
  private readonly settingsStore: SettingsStore;
  private readonly apiKeyStore: ApiKeyStore;

  constructor(options: {
    settingsStore: SettingsStore;
    apiKeyStore: ApiKeyStore;
  }) {
    this.settingsStore = options.settingsStore;
    this.apiKeyStore = options.apiKeyStore;
  }

  async state(): Promise<LlmProfilesState> {
    const settings = this.settingsStore.get();
    const defaultProfileId =
      settings.llmProfiles.find(
        (profile) => profile.id === settings.llmDefaultProfileId,
      )?.id ??
      settings.llmProfiles[0]?.id ??
      '';
    const profiles = await Promise.all(
      settings.llmProfiles.map((profile) =>
        buildLlmProfileStatus(
          profile,
          profile.id === defaultProfileId,
          this.apiKeyStore,
        ),
      ),
    );
    return { profiles, defaultProfileId };
  }

  async saveProfile(request: SaveLlmProfileRequest): Promise<LlmProfilesState> {
    if (typeof request !== 'object' || request === null) {
      throw new Error('LLM プロファイルの形式が正しくありません。');
    }
    const raw = request.profile;
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('LLM プロファイルの形式が正しくありません。');
    }
    const id = normalizeLlmProfileId(raw.id);
    if (!id) {
      throw new Error('ID は 1〜64 文字で入力してください。');
    }
    if (!isLlmProvider(raw.provider)) {
      throw new Error('Provider が正しくありません。');
    }
    const model =
      typeof raw.model === 'string' ? raw.model.trim().slice(0, 120) : '';
    if (!model) {
      throw new Error('モデルを入力してください。');
    }
    const endpoint = validateEndpointUrl(
      typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
    );
    if (!endpoint.ok) {
      throw new Error(endpoint.error);
    }
    const profile: LlmProfile = {
      id,
      provider: raw.provider,
      baseUrl: endpoint.normalized,
      model,
    };

    const current = this.settingsStore.get();
    const originalId =
      typeof request.originalId === 'string' && request.originalId.trim()
        ? request.originalId.trim()
        : null;
    const index = originalId
      ? current.llmProfiles.findIndex((entry) => entry.id === originalId)
      : -1;
    if (originalId && index < 0) {
      throw new Error('編集する LLM プロファイルが見つかりません。');
    }
    if (
      current.llmProfiles.some(
        (entry) => entry.id === profile.id && entry.id !== originalId,
      )
    ) {
      throw new Error('その ID は既に使われています。別の ID を入力してください。');
    }

    const profiles = [...current.llmProfiles];
    if (index >= 0) {
      profiles[index] = profile;
    } else {
      profiles.push(profile);
    }
    let defaultProfileId = current.llmDefaultProfileId;
    if (profiles.length === 1) {
      defaultProfileId = profile.id;
    } else if (request.makeDefault === true) {
      defaultProfileId = profile.id;
    } else if (originalId && defaultProfileId === originalId) {
      defaultProfileId = profile.id;
    }
    if (!profiles.some((entry) => entry.id === defaultProfileId)) {
      defaultProfileId = profiles[0]?.id ?? '';
    }

    await this.settingsStore.save({
      llmProfiles: profiles,
      llmDefaultProfileId: defaultProfileId,
    });
    if (originalId && originalId !== profile.id) {
      await this.apiKeyStore.renameKey(originalId, profile.id);
    }
    const apiKey = typeof request.apiKey === 'string' ? request.apiKey.trim() : '';
    if (apiKey) {
      await this.apiKeyStore.setKey(
        profile.id,
        profile.provider,
        apiKey,
        profile.baseUrl,
      );
    }
    return this.state();
  }

  async deleteProfile(profileId: string): Promise<LlmProfilesState> {
    const current = this.settingsStore.get();
    if (!current.llmProfiles.some((profile) => profile.id === profileId)) {
      throw new Error('削除する LLM プロファイルが見つかりません。');
    }
    const profiles = current.llmProfiles.filter(
      (profile) => profile.id !== profileId,
    );
    const defaultProfileId =
      current.llmDefaultProfileId === profileId
        ? profiles[0]?.id ?? ''
        : current.llmDefaultProfileId;
    await this.settingsStore.save({
      llmProfiles: profiles,
      llmDefaultProfileId: profiles.some(
        (profile) => profile.id === defaultProfileId,
      )
        ? defaultProfileId
        : profiles[0]?.id ?? '',
    });
    await this.apiKeyStore.clearKey(profileId);
    return this.state();
  }

  async setDefaultProfile(profileId: string): Promise<LlmProfilesState> {
    const current = this.settingsStore.get();
    if (!current.llmProfiles.some((profile) => profile.id === profileId)) {
      throw new Error('既定に設定する LLM プロファイルが見つかりません。');
    }
    await this.settingsStore.save({ llmDefaultProfileId: profileId });
    return this.state();
  }

  async setApiKey(
    profileId: string,
    apiKey: string,
  ): Promise<LlmProfilesState> {
    const profile = this.settingsStore
      .get()
      .llmProfiles.find((entry) => entry.id === profileId);
    if (!profile) {
      throw new Error('LLM プロファイルが見つかりません。');
    }
    await this.apiKeyStore.setKey(
      profile.id,
      profile.provider,
      apiKey,
      profile.baseUrl,
    );
    return this.state();
  }

  async clearApiKey(profileId: string): Promise<LlmProfilesState> {
    const profile = this.settingsStore
      .get()
      .llmProfiles.find((entry) => entry.id === profileId);
    if (!profile) {
      throw new Error('LLM プロファイルが見つかりません。');
    }
    await this.apiKeyStore.clearKey(profileId);
    return this.state();
  }
}
