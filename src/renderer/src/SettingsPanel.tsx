import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getLlmProviderPreset,
  LLM_PROVIDER_PRESETS,
  validateEndpointUrl,
} from '../../shared/llm';
import {
  INPUT_SOURCES,
  INPUT_SOURCE_MESSAGE_KEYS,
  type MessageKey,
} from '../../shared/i18n';
import type {
  AppSettings,
  InputSource,
  LlmProfileStatus,
  LlmProfilesState,
  LlmProvider,
  MultiOutputStatus,
  SaveLlmProfileRequest,
  SummaryLanguage,
  ThemeMode,
  UiLanguage,
  WhisperModel,
  WhisperModelList,
} from '../../shared/types';
import { DiarizationSettings } from './DiarizationSettings';
import { useI18n } from './i18n';
import { errorText, formatBytes, type InputDevice } from './recording-utils';
import { SummaryCleanupSetting } from './SummaryCleanupSetting';
import { TranscriptionEngineSettings } from './TranscriptionEngineSettings';
import type { PermissionState } from './use-recorder';

export type SettingsTab = 'general' | 'recording' | 'transcription' | 'summary';

type SettingsPanelProps = {
  saveRoot: string;
  version: string;
  settings: AppSettings;
  inputSource: InputSource;
  permission: PermissionState;
  microphones: InputDevice[];
  systemDevices: InputDevice[];
  initialTab?: SettingsTab;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onChangeSaveRoot: () => void;
  onSetInputSource: (source: InputSource) => void;
  onRequestPermission: () => void;
  onOpenMicrophoneSettings: () => void;
  onOpenReadme: () => void;
  onOpenBlackHoleSite: () => void;
  onShowAbout: () => void;
};

const tabs: Array<{ value: SettingsTab; label: MessageKey; color: string }> = [
  { value: 'general', label: '一般', color: '#8E8E93' },
  { value: 'recording', label: '録音', color: '#FF3B30' },
  { value: 'transcription', label: '文字起こし', color: '#5856D6' },
  { value: 'summary', label: '要約', color: '#34C759' },
];

const sourceOptions: Array<{ value: InputSource; label: MessageKey }> =
  INPUT_SOURCES.map((value) => ({
    value,
    label: INPUT_SOURCE_MESSAGE_KEYS[value],
  }));

const whisperModels: Array<{ value: WhisperModel; label: string; size: string }> = [
  { value: 'large-v3-turbo', label: 'large-v3-turbo', size: '1.6 GB' },
  { value: 'medium', label: 'medium', size: '1.5 GB' },
  { value: 'small', label: 'small', size: '488 MB' },
];

const themeOptions: Array<{ value: ThemeMode; label: MessageKey }> = [
  { value: 'system', label: 'システム' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
];

const uiLanguageOptions: Array<{ value: UiLanguage; label: MessageKey }> = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
];

export function SettingsPanel({
  saveRoot,
  version,
  settings,
  inputSource,
  permission,
  microphones,
  systemDevices,
  initialTab,
  onUpdateSettings,
  onChangeSaveRoot,
  onSetInputSource,
  onRequestPermission,
  onOpenMicrophoneSettings,
  onOpenReadme,
  onOpenBlackHoleSite,
  onShowAbout,
}: SettingsPanelProps) {
  const { locale, t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general');
  const [models, setModels] = useState<WhisperModelList | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [llmProfiles, setLlmProfiles] = useState<LlmProfilesState | null>(null);
  const [llmProfilesError, setLlmProfilesError] = useState<string | null>(null);
  const [profileFormOpen, setProfileFormOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileIdDraft, setProfileIdDraft] = useState('');
  const [profileProviderDraft, setProfileProviderDraft] =
    useState<LlmProvider>('claude');
  const [profileEndpointDraft, setProfileEndpointDraft] = useState('');
  const [profileModelDraft, setProfileModelDraft] = useState('');
  const [profileApiKeyDraft, setProfileApiKeyDraft] = useState('');
  const [profileMakeDefault, setProfileMakeDefault] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const profileFormRef = useRef<HTMLElement | null>(null);
  const [initialPromptDraft, setInitialPromptDraft] = useState(
    settings.whisperInitialPrompt,
  );
  const [summaryPromptDraft, setSummaryPromptDraft] = useState(
    settings.summaryPromptTemplate,
  );
  const [modelBusy, setModelBusy] = useState<WhisperModel | null>(null);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [multiOutput, setMultiOutput] = useState<MultiOutputStatus | null>(null);
  const [outputUid, setOutputUid] = useState('');
  const [multiOutputBusy, setMultiOutputBusy] = useState(false);
  const [multiOutputError, setMultiOutputError] = useState<string | null>(null);
  const [multiOutputNotice, setMultiOutputNotice] = useState<string | null>(null);
  const [indexBusy, setIndexBusy] = useState(false);
  const [indexNotice, setIndexNotice] = useState<string | null>(null);
  const permissionDenied = permission === 'denied' || permission === 'restricted';
  const microphoneAvailable = microphones.length > 0;
  const systemAvailable = systemDevices.length > 0;
  const selectedProfile =
    llmProfiles?.profiles.find((profile) => profile.id === editingProfileId) ??
    null;
  const profileKeychainAvailable = selectedProfile?.keychainAvailable ?? true;

  const refreshModels = useCallback(async () => {
    try {
      setModels(await window.kataribe.listWhisperModels());
      setModelsError(null);
    } catch (reason: unknown) {
      setModelsError(
        t('モデル一覧を取得できませんでした: {error}', { error: errorText(reason) }),
      );
    }
  }, [t]);

  const fillProfileForm = useCallback((profile: LlmProfileStatus | null) => {
    if (profile) {
      setProfileIdDraft(profile.id);
      setProfileProviderDraft(profile.provider);
      setProfileEndpointDraft(profile.baseUrl);
      setProfileModelDraft(profile.model);
      setProfileMakeDefault(profile.isDefault);
    } else {
      const preset = getLlmProviderPreset('claude');
      setProfileIdDraft('');
      setProfileProviderDraft('claude');
      setProfileEndpointDraft(preset.defaultBaseUrl);
      setProfileModelDraft(preset.defaultModel);
      setProfileMakeDefault(false);
    }
    setProfileApiKeyDraft('');
    setProfileError(null);
  }, []);

  const syncProfileForm = useCallback(
    (state: LlmProfilesState, profileId: string | null) => {
      const profile =
        state.profiles.find((entry) => entry.id === profileId) ?? null;
      setEditingProfileId(profile?.id ?? null);
      fillProfileForm(profile);
    },
    [fillProfileForm],
  );

  const refreshLlmProfiles = useCallback(async () => {
    try {
      const state = await window.kataribe.getLlmProfiles();
      setLlmProfilesError(null);
      setLlmProfiles(state);
      return state;
    } catch (reason: unknown) {
      setLlmProfilesError(
        t('LLM プロファイルを読み込めませんでした: {error}', {
          error: errorText(reason),
        }),
      );
      return null;
    }
  }, [t]);

  const refreshMultiOutput = useCallback(async () => {
    try {
      const status = await window.kataribe.getMultiOutputStatus();
      setMultiOutput(status);
      setOutputUid((current) => {
        if (current && status.outputDevices.some((device) => device.uid === current)) {
          return current;
        }
        const preferred =
          status.currentOutput &&
          !status.currentOutput.name.toLowerCase().includes('blackhole') &&
          !status.currentOutput.name.toLowerCase().includes('multi-output') &&
          !status.currentOutput.isAggregate
            ? status.currentOutput
            : status.outputDevices.find(
                (device) =>
                  !device.name.toLowerCase().includes('blackhole') &&
                  !device.name.toLowerCase().includes('multi-output') &&
                  !device.isAggregate,
              );
        return preferred?.uid ?? '';
      });
      setMultiOutputError(null);
    } catch (reason: unknown) {
      setMultiOutputError(
        t('Multi-Output Device の状態を取得できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    }
  }, [t]);

  useEffect(() => {
    void refreshModels();
    void refreshLlmProfiles();
    void refreshMultiOutput();
    const unsubscribeModels = window.kataribe.onModelsChanged((list) => {
      setModels(list);
    });
    const unsubscribeProgress = window.kataribe.onModelProgress((progress) => {
      setModels((current) =>
        current
          ? {
              ...current,
              models: current.models.map((entry) =>
                entry.model === progress.model
                  ? {
                      ...entry,
                      state: 'downloading',
                      downloadedBytes: progress.downloadedBytes,
                      progress: progress.progress,
                      error: null,
                    }
                  : entry,
              ),
            }
          : current,
      );
    });
    return () => {
      unsubscribeModels();
      unsubscribeProgress();
    };
  }, [refreshLlmProfiles, refreshModels, refreshMultiOutput]);

  useEffect(() => {
    setInitialPromptDraft(settings.whisperInitialPrompt);
    setSummaryPromptDraft(settings.summaryPromptTemplate);
  }, [settings.whisperInitialPrompt, settings.summaryPromptTemplate]);

  useEffect(() => {
    if (profileFormOpen) {
      profileFormRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }, [profileFormOpen]);

  const startCreateProfile = () => {
    setProfileFormOpen(true);
    setEditingProfileId(null);
    fillProfileForm(null);
    setProfileMakeDefault(
      llmProfiles === null || llmProfiles.profiles.length === 0,
    );
    setProfileNotice(null);
  };

  const startEditProfile = (profile: LlmProfileStatus) => {
    setProfileFormOpen(true);
    setEditingProfileId(profile.id);
    fillProfileForm(profile);
    setProfileNotice(null);
  };

  const closeProfileForm = () => {
    setProfileFormOpen(false);
    setEditingProfileId(null);
    setProfileApiKeyDraft('');
    setProfileError(null);
  };

  const chooseProfileProvider = (provider: LlmProvider) => {
    if (provider === profileProviderDraft) {
      return;
    }
    const preset = getLlmProviderPreset(provider);
    setProfileProviderDraft(provider);
    setProfileEndpointDraft(preset.defaultBaseUrl);
    setProfileModelDraft(preset.defaultModel);
  };

  const saveProfile = async () => {
    const id = profileIdDraft.trim();
    if (!id) {
      setProfileError(t('ID を入力してください。'));
      return;
    }
    if (id.length > 64) {
      setProfileError(t('ID は 64 文字以内で入力してください。'));
      return;
    }
    if (
      llmProfiles?.profiles.some(
        (profile) => profile.id === id && profile.id !== editingProfileId,
      )
    ) {
      setProfileError(t('その ID は既に使われています。別の ID を入力してください。'));
      return;
    }
    const endpoint = validateEndpointUrl(profileEndpointDraft, locale);
    if (!endpoint.ok) {
      setProfileError(endpoint.error);
      return;
    }
    const model = profileModelDraft.trim();
    if (!model) {
      setProfileError(t('モデルを入力してください。'));
      return;
    }
    setProfileBusy(true);
    setProfileError(null);
    setProfileNotice(null);
    try {
      const request: SaveLlmProfileRequest = {
        profile: {
          id,
          provider: profileProviderDraft,
          baseUrl: endpoint.normalized,
          model,
        },
        originalId: editingProfileId,
        apiKey: profileApiKeyDraft.trim() || null,
        makeDefault: profileMakeDefault,
      };
      const state = await window.kataribe.saveLlmProfile(request);
      setLlmProfiles(state);
      setProfileFormOpen(true);
      syncProfileForm(state, id);
      setProfileNotice(
        editingProfileId
          ? t('LLM プロファイルを更新しました。')
          : t('LLM プロファイルを追加しました。'),
      );
    } catch (reason: unknown) {
      setProfileError(
        t('LLM プロファイルを保存できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    } finally {
      setProfileBusy(false);
    }
  };

  const removeProfile = async (profile: LlmProfileStatus) => {
    if (
      !window.confirm(
        t(
          'LLM プロファイル「{id}」を削除します。保存済みの API キーも削除されます。よろしいですか？',
          { id: profile.id },
        ),
      )
    ) {
      return;
    }
    setProfileBusy(true);
    setProfileError(null);
    setProfileNotice(null);
    try {
      const state = await window.kataribe.deleteLlmProfile(profile.id);
      setLlmProfiles(state);
      if (profileFormOpen && editingProfileId === profile.id) {
        closeProfileForm();
      }
      setProfileNotice(t('LLM プロファイルを削除しました。'));
    } catch (reason: unknown) {
      setProfileError(
        t('LLM プロファイルを削除できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    } finally {
      setProfileBusy(false);
    }
  };

  const setDefaultProfile = async (profile: LlmProfileStatus) => {
    setProfileBusy(true);
    setProfileError(null);
    setProfileNotice(null);
    try {
      const state = await window.kataribe.setDefaultLlmProfile(profile.id);
      setLlmProfiles(state);
      setProfileMakeDefault(editingProfileId === profile.id);
      setProfileNotice(
        t('「{id}」を既定の LLM プロファイルにしました。', { id: profile.id }),
      );
    } catch (reason: unknown) {
      setProfileError(
        t('既定の LLM プロファイルを変更できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    } finally {
      setProfileBusy(false);
    }
  };

  const clearProfileApiKey = async () => {
    if (!editingProfileId) {
      return;
    }
    if (
      !window.confirm(
        t('「{id}」の API キーを削除します。よろしいですか？', {
          id: editingProfileId,
        }),
      )
    ) {
      return;
    }
    setProfileBusy(true);
    setProfileError(null);
    setProfileNotice(null);
    try {
      const state = await window.kataribe.clearLlmApiKey(editingProfileId);
      setLlmProfiles(state);
      syncProfileForm(state, editingProfileId);
      setProfileNotice(t('API キーを削除しました。'));
    } catch (reason: unknown) {
      setProfileError(
        t('API キーを削除できませんでした: {error}', { error: errorText(reason) }),
      );
    } finally {
      setProfileBusy(false);
    }
  };

  const saveInitialPrompt = async () => {
    if (initialPromptDraft === settings.whisperInitialPrompt) {
      return;
    }
    await onUpdateSettings({ whisperInitialPrompt: initialPromptDraft });
  };

  const saveSummaryPrompt = async () => {
    if (summaryPromptDraft === settings.summaryPromptTemplate) {
      return;
    }
    await onUpdateSettings({ summaryPromptTemplate: summaryPromptDraft });
  };

  const downloadModel = async (model: WhisperModel) => {
    setModelBusy(model);
    setModelNotice(null);
    try {
      setModels(await window.kataribe.downloadWhisperModel(model));
    } catch (reason: unknown) {
      setModelsError(
        t('モデルのダウンロードを開始できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    } finally {
      setModelBusy(null);
    }
  };

  const cancelModel = async (model: WhisperModel) => {
    try {
      setModels(await window.kataribe.cancelWhisperModelDownload(model));
      setModelNotice(t('ダウンロードを中断しました。次回は続きから再開します。'));
    } catch (reason: unknown) {
      setModelsError(
        t('ダウンロードを中断できませんでした: {error}', { error: errorText(reason) }),
      );
    }
  };

  const deleteModel = async (model: WhisperModel) => {
    if (
      !window.confirm(
        t('{model} のモデルファイルを削除します。よろしいですか？', {
          model,
        }),
      )
    ) {
      return;
    }
    setModelBusy(model);
    try {
      setModels(await window.kataribe.deleteWhisperModel(model));
      setModelNotice(t('{model} を削除しました。', { model }));
    } catch (reason: unknown) {
      setModelsError(
        t('モデルを削除できませんでした: {error}', { error: errorText(reason) }),
      );
    } finally {
      setModelBusy(null);
    }
  };

  const createMultiOutput = async () => {
    if (!outputUid) {
      setMultiOutputError(t('出力デバイスを選択してください。'));
      return;
    }
    setMultiOutputBusy(true);
    setMultiOutputError(null);
    setMultiOutputNotice(null);
    try {
      const status = await window.kataribe.createMultiOutput(outputUid);
      if (status) {
        setMultiOutput(status);
        setMultiOutputNotice(
          t(
            'Kataribe Multi-Output を作成し、macOS の出力に設定しました。システム音声の入力に BlackHole 2ch を選んでください。',
          ),
        );
      }
    } catch (reason: unknown) {
      setMultiOutputError(
        t('Multi-Output Device を作成できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    } finally {
      setMultiOutputBusy(false);
    }
  };

  const removeMultiOutput = async () => {
    setMultiOutputBusy(true);
    setMultiOutputError(null);
    setMultiOutputNotice(null);
    try {
      const status = await window.kataribe.removeMultiOutput();
      if (status) {
        setMultiOutput(status);
        setMultiOutputNotice(t('Kataribe Multi-Output を削除しました。'));
      }
    } catch (reason: unknown) {
      setMultiOutputError(
        t('Multi-Output Device を削除できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    } finally {
      setMultiOutputBusy(false);
    }
  };

  const rebuildIndex = async () => {
    setIndexBusy(true);
    setIndexNotice(null);
    try {
      const list = await window.kataribe.rebuildMeetingIndex();
      setIndexNotice(
        t('索引を再構築しました（{count} 件）。', { count: list.length }),
      );
    } catch (reason: unknown) {
      setIndexNotice(
        t('索引を再構築できませんでした: {error}', { error: errorText(reason) }),
      );
    } finally {
      setIndexBusy(false);
    }
  };

  const activeTab = tabs.find((entry) => entry.value === tab) ?? tabs[0];

  return (
    <section className="settings-panel" aria-labelledby="settings-title">
      <div className="settings-tabs" role="tablist" aria-label={t('設定')}>
        {tabs.map((entry) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === entry.value}
            className={`settings-tab ${tab === entry.value ? 'is-active' : ''}`}
            key={entry.value}
            onClick={() => setTab(entry.value)}
          >
            <span className="settings-tab-icon" style={{ background: entry.color }} />
            {t(entry.label)}
          </button>
        ))}
      </div>

      <div className="settings-content">
        <div className="settings-content-head">
          <div>
            <p className="section-label">{t('設定')}</p>
            <h1 id="settings-title" className="page-title">
              {t(activeTab.label)}
            </h1>
          </div>
          <span className="panel-note">{t('設定はローカルに保存されます')}</span>
        </div>

        {tab === 'general' ? (
          <>
            <section className="settings-section">
              <p className="settings-label">{t('保存先')}</p>
              <div className="setting-card setting-row">
                <span className="mono setting-path">{saveRoot}</span>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={onChangeSaveRoot}
                >
                  {t('変更')}
                </button>
              </div>
              <p className="muted">
                {t(
                  '変更後、既存の会議は新しい保存先の一覧に表示されません。会議フォルダは移動しません。',
                )}
              </p>
            </section>

            <section className="settings-section">
              <p className="settings-label">{t('外観')}</p>
              <div className="setting-card">
                <div className="seg settings-source-seg">
                  {themeOptions.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      aria-pressed={settings.theme === option.value}
                      onClick={() => void onUpdateSettings({ theme: option.value })}
                    >
                      {t(option.label)}
                    </button>
                  ))}
                </div>
                <p className="muted">
                  {t(
                    'システムを選ぶと macOS のライト / ダーク設定に追従します。既定はシステムです。',
                  )}
                </p>
              </div>
            </section>

            <section className="settings-section">
              <p className="settings-label">{t('UI の言語')}</p>
              <div className="setting-card">
                <div className="seg settings-source-seg">
                  {uiLanguageOptions.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      aria-pressed={settings.uiLanguage === option.value}
                      onClick={() =>
                        void onUpdateSettings({ uiLanguage: option.value })
                      }
                    >
                      {t(option.label)}
                    </button>
                  ))}
                </div>
                <p className="muted">
                  {t(
                    'アプリの表示に使う言語です。変更するとすぐに反映されます。',
                  )}
                </p>
              </div>
            </section>

            <section className="settings-section">
              <p className="settings-label">{t('このアプリについて')}</p>
              <div className="setting-card setting-row">
                <div>
                  <strong>{t('Kataribe 会議録')}</strong>
                  <p className="muted">
                    v{version} · {t('ローカルビルド')}
                  </p>
                </div>
                <button type="button" className="button button-secondary" onClick={onShowAbout}>
                  {t('About を開く')}
                </button>
              </div>
            </section>

            <section className="settings-section">
              <p className="settings-label">{t('会議索引')}</p>
              <div className="setting-card">
                <p className="muted">
                  {t(
                    '会議一覧と全文検索の索引を、会議フォルダから作り直します。索引が壊れた場合や、外部で会議フォルダを編集した場合に使います。',
                  )}
                </p>
                <div className="setting-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={indexBusy}
                    onClick={() => void rebuildIndex()}
                  >
                    {indexBusy ? t('再構築中...') : t('索引を再構築')}
                  </button>
                </div>
                {indexNotice ? <p className="notice-text">{indexNotice}</p> : null}
              </div>
            </section>

            <section className="settings-section">
              <p className="settings-label">{t('セットアップ')}</p>
              <div className="setting-card">
                <p className="muted">
                  {t(
                    'システム音声を録音するには BlackHole 2ch と Multi-Output Device の設定が必要です。',
                  )}
                </p>
                <div className="setting-actions">
                  <button type="button" className="button button-secondary" onClick={onOpenReadme}>
                    {t('セットアップ手順を開く')}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={onOpenBlackHoleSite}
                  >
                    {t('BlackHole 2ch の配布元')}
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {tab === 'recording' ? (
          <>
            <section className="settings-section">
              <p className="settings-label">{t('入力ソース')}</p>
              <div className="seg settings-source-seg">
                {sourceOptions.map((option) => {
                  const unavailable =
                    permissionDenied ||
                    (option.value === 'microphone' && !microphoneAvailable) ||
                    (option.value === 'system' && !systemAvailable) ||
                    (option.value === 'both' && (!microphoneAvailable || !systemAvailable));
                  return (
                    <button
                      type="button"
                      key={option.value}
                      aria-pressed={inputSource === option.value}
                      disabled={unavailable}
                      onClick={() => onSetInputSource(option.value)}
                    >
                      {t(option.label)}
                    </button>
                  );
                })}
              </div>
              <p className="muted">
                {t(
                  '入力ソースはトレイと録音パネルに同期します。録音中の変更は次の録音から適用されます。',
                )}
              </p>
            </section>

            <section className="settings-section">
              <p className="settings-label">{t('入力デバイス')}</p>
              <div className="settings-grid">
                <div className="setting-card">
                  <div className="setting-row">
                    <strong>{t('マイク')}</strong>
                    <span className={microphoneAvailable ? 'ok-text' : 'error-text'}>
                      {microphoneAvailable ? t('検出済み') : t('見つかりません')}
                    </span>
                  </div>
                  <p className="muted">
                    {microphones[0]?.label || t('マイクを接続してください。')}
                  </p>
                  <div className="setting-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={onRequestPermission}
                      disabled={permission === 'requesting' || permission === 'granted'}
                    >
                      {t('マイク権限を確認')}
                    </button>
                    {permissionDenied ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={onOpenMicrophoneSettings}
                      >
                        {t('システム設定を開く')}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="setting-card">
                  <div className="setting-row">
                    <strong>{t('システム音声')}</strong>
                    <span className={systemAvailable ? 'ok-text' : 'error-text'}>
                      {systemAvailable ? t('検出済み') : t('見つかりません')}
                    </span>
                  </div>
                  <p className="muted mono">
                    {systemDevices[0]?.label || 'BlackHole 2ch'}
                  </p>
                  <button type="button" className="link-button" onClick={onOpenReadme}>
                    {t('セットアップ手順')}
                  </button>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <p className="settings-label">{t('mp3 のビットレート')}</p>
              <div className="setting-card">
                <div className="seg settings-source-seg">
                  {([64, 128] as const).map((bitrate) => (
                    <button
                      type="button"
                      key={bitrate}
                      aria-pressed={settings.mp3BitrateKbps === bitrate}
                      onClick={() =>
                        void onUpdateSettings({ mp3BitrateKbps: bitrate })
                      }
                    >
                      {bitrate} kbps
                    </button>
                  ))}
                </div>
                <p className="muted">
                  {t(
                    '新しく録音する会議に適用します。64 kbps は 1 時間で約 29 MB、128 kbps は約 58 MB です。既存の mp3 は変更しません。',
                  )}
                </p>
              </div>
            </section>

            <DiarizationSettings
              settings={settings}
              onUpdateSettings={onUpdateSettings}
            />

            <section className="settings-section">
              <p className="settings-label">Multi-Output Device</p>
              <div className="setting-card">
                <p className="muted">
                  {t(
                    'macOS の出力デバイスと BlackHole 2ch を含む「Kataribe Multi-Output」を自動作成し、システム出力に設定します。作成には BlackHole 2ch が必要です。',
                  )}
                </p>
                {multiOutput?.supported === false ? (
                  <p className="alert alert-error">
                    {t(
                      'Multi-Output Device の自動作成は macOS でのみ利用できます。',
                    )}
                  </p>
                ) : (
                  <>
                    <div className="settings-grid">
                      <label className="field">
                        <span>{t('出力デバイス')}</span>
                        <select
                          value={outputUid}
                          disabled={multiOutputBusy || !multiOutput?.helperAvailable}
                          onChange={(event) => setOutputUid(event.target.value)}
                        >
                          <option value="">{t('選択してください')}</option>
                          {(multiOutput?.outputDevices ?? [])
                            .filter(
                              (device) =>
                                !device.name.toLowerCase().includes('blackhole') &&
                                !device.name.toLowerCase().includes('multi-output') &&
                                !device.isAggregate,
                            )
                            .map((device) => (
                              <option value={device.uid} key={device.uid}>
                                {t('{name}（{channels} ch）', {
                                  name: device.name,
                                  channels: device.channels,
                                })}
                              </option>
                            ))}
                        </select>
                      </label>
                      <div className="field">
                        <span>{t('現在の出力')}</span>
                        <p className="setting-input setting-readonly mono">
                          {multiOutput?.currentOutput?.name ?? t('取得できません')}
                        </p>
                      </div>
                    </div>
                    <div className="setting-actions">
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={
                          multiOutputBusy ||
                          !outputUid ||
                          multiOutput?.helperAvailable === false
                        }
                        onClick={() => void createMultiOutput()}
                      >
                        {multiOutputBusy ? t('処理中...') : t('自動作成して出力に設定')}
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={multiOutputBusy || !multiOutput?.multiOutput}
                        onClick={() => void removeMultiOutput()}
                      >
                        {t('Kataribe Multi-Output を削除')}
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={multiOutputBusy}
                        onClick={() => void refreshMultiOutput()}
                      >
                        {t('再検出')}
                      </button>
                    </div>
                    {multiOutput?.multiOutput ? (
                      <p className="ok-text">
                        {t('作成済み: {name}（{channels} ch）', {
                          name: multiOutput.multiOutput.name,
                          channels: multiOutput.multiOutput.channels,
                        })}
                      </p>
                    ) : null}
                    {multiOutput?.helperAvailable === false ? (
                      <p className="alert alert-error">
                        {t(
                          'Multi-Output ヘルパーが見つかりません。`npm run binaries` で再ビルドしてください。',
                        )}
                      </p>
                    ) : null}
                    {multiOutput?.error ? (
                      <p className="alert alert-error">{multiOutput.error}</p>
                    ) : null}
                    {multiOutputError ? (
                      <p className="alert alert-error">{multiOutputError}</p>
                    ) : null}
                    {multiOutputNotice ? (
                      <p className="notice-text">{multiOutputNotice}</p>
                    ) : null}
                  </>
                )}
              </div>
            </section>

            <section className="settings-section">
              <p className="settings-label">{t('クリッピング警告')}</p>
              <div className="setting-card">
                <p className="muted">
                  {t(
                    'マイク入力のピークがしきい値を超えた状態が続くと警告します。値は 100 ms 単位の連続回数で指定します。',
                  )}
                </p>
                <div className="settings-grid settings-grid-3">
                  <label className="field">
                    <span>{t('ピークしきい値（0.5〜1.0）')}</span>
                    <input
                      className="setting-input"
                      type="number"
                      min="0.5"
                      max="1"
                      step="0.005"
                      value={settings.clippingConfig.peakThreshold}
                      onChange={(event) =>
                        onUpdateSettings({
                          clippingConfig: {
                            ...settings.clippingConfig,
                            peakThreshold: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t('警告までの連続回数')}</span>
                    <input
                      className="setting-input"
                      type="number"
                      min="1"
                      max="50"
                      value={settings.clippingConfig.intervalsToWarn}
                      onChange={(event) =>
                        onUpdateSettings({
                          clippingConfig: {
                            ...settings.clippingConfig,
                            intervalsToWarn: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t('解除までの連続回数')}</span>
                    <input
                      className="setting-input"
                      type="number"
                      min="1"
                      max="50"
                      value={settings.clippingConfig.recoveryIntervals}
                      onChange={(event) =>
                        onUpdateSettings({
                          clippingConfig: {
                            ...settings.clippingConfig,
                            recoveryIntervals: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <p className="settings-label">{t('システム音声の無音検出')}</p>
              <div className="setting-card">
                <p className="muted">
                  {t(
                    'システム音声の RMS がしきい値を下回る状態が続くと警告します。猶予時間は会議前の無音で警告しないために使います。',
                  )}
                </p>
                <div className="settings-grid settings-grid-3">
                  <label className="field">
                    <span>{t('監視ウィンドウ（秒）')}</span>
                    <input
                      className="setting-input"
                      type="number"
                      min="1"
                      max="60"
                      value={settings.silenceConfig.windowSeconds}
                      onChange={(event) =>
                        onUpdateSettings({
                          silenceConfig: {
                            ...settings.silenceConfig,
                            windowSeconds: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t('RMS しきい値')}</span>
                    <input
                      className="setting-input"
                      type="number"
                      min="0"
                      max="1"
                      step="0.001"
                      value={settings.silenceConfig.rmsThreshold}
                      onChange={(event) =>
                        onUpdateSettings({
                          silenceConfig: {
                            ...settings.silenceConfig,
                            rmsThreshold: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t('猶予時間（秒）')}</span>
                    <input
                      className="setting-input"
                      type="number"
                      min="0"
                      max="600"
                      value={settings.silenceConfig.graceSeconds}
                      onChange={(event) =>
                        onUpdateSettings({
                          silenceConfig: {
                            ...settings.silenceConfig,
                            graceSeconds: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {tab === 'transcription' ? (
          <>
          <TranscriptionEngineSettings
            settings={settings}
            llmProfiles={llmProfiles}
            onUpdateSettings={onUpdateSettings}
            onOpenSummary={() => setTab('summary')}
          />

          <section className="settings-section">
            <p className="settings-label">{t('whisper.cpp モデル')}</p>
            <div className="setting-card model-list">
              {whisperModels.map((entry) => {
                const info = models?.models.find((item) => item.model === entry.value);
                const downloading =
                  info?.state === 'downloading' || info?.state === 'verifying';
                return (
                  <div className="model-row" key={entry.value}>
                    <input
                      type="radio"
                      name="whisper-model"
                      aria-label={entry.label}
                      checked={settings.whisperModel === entry.value}
                      onChange={() => void onUpdateSettings({ whisperModel: entry.value })}
                    />
                    <span className="model-name-group">
                      <span className="mono model-name">{entry.label}</span>
                      <span className="muted">
                        {entry.size}
                        {info?.installed
                          ? t(' · インストール済み {size}', {
                              size: formatBytes(info.installedBytes),
                            })
                          : info?.downloadedBytes
                            ? t(' · 取得済み {size}', {
                                size: formatBytes(info.downloadedBytes),
                              })
                            : ''}
                      </span>
                    </span>
                    <span className="model-action">
                      {downloading ? (
                        <span className="model-progress">
                          <span className="progress-track model-progress-track">
                            <span
                              className="progress-bar"
                              style={{
                                width: `${Math.round((info?.progress ?? 0) * 100)}%`,
                              }}
                            />
                          </span>
                          <span className="mono">
                            {info?.state === 'verifying'
                              ? t('検証中')
                              : `${Math.round((info?.progress ?? 0) * 100)}%`}
                          </span>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => void cancelModel(entry.value)}
                          >
                            {t('中止')}
                          </button>
                        </span>
                      ) : info?.installed ? (
                        <span className="model-installed">
                          {settings.whisperModel === entry.value ? (
                            <span className="status-chip status-summarized">
                              {t('選択中')}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className="link-button"
                            disabled={modelBusy !== null}
                            onClick={() => void deleteModel(entry.value)}
                          >
                            {t('削除')}
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="link-button"
                          disabled={modelBusy !== null}
                          onClick={() => void downloadModel(entry.value)}
                        >
                          {modelBusy === entry.value
                            ? t('開始中...')
                            : t('ダウンロード')}
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            {models?.models.some((item) => item.error) ? (
              <p className="alert alert-error">
                {models.models
                  .filter((item) => item.error)
                  .map((item) => `${item.model}: ${item.error}`)
                  .join('\n')}
              </p>
            ) : null}
            {modelsError ? <p className="alert alert-error">{modelsError}</p> : null}
            {modelNotice ? <p className="notice-text">{modelNotice}</p> : null}
            <p className="muted">
              {t(
                'モデルは HTTPS でダウンロードし、SHA-256 を照合してから保存します。中断しても次回は続きから再開します。',
              )}
              {models?.modelsDir
                ? t(' 保存先: {path}', { path: models.modelsDir })
                : ''}
            </p>
            <p className="muted">
              {t(
                '録音停止後の文字起こしで使うモデルです。OpenAI API を選んだ場合も、送信を取りやめたときのフォールバックに使います。',
              )}
            </p>
            <div className="setting-card prompt-card">
              <label className="field">
                <span>{t('用語集（initial prompt）')}</span>
                <textarea
                  className="setting-input prompt-textarea"
                  value={initialPromptDraft}
                  placeholder={t('例: Kataribe, BlackHole, リリース, スプリント')}
                  onChange={(event) => setInitialPromptDraft(event.target.value)}
                  onBlur={() => void saveInitialPrompt()}
                />
              </label>
              <p className="muted">
                {t(
                  '専門用語や固有名詞をカンマ区切りで入力します。日本語の会議で用語の表記を安定させます。用語集が多いと関係のない単語を誘導することがあります。',
                )}
              </p>
              <p className="muted">
                {t(
                  'OpenAI の文字起こしでは、用語集は API のプロンプト上限に合わせて先頭から使います。',
                )}
              </p>
            </div>
          </section>
          </>
        ) : null}

        {tab === 'summary' ? (
          <>
            <section className="settings-section">
              <p className="settings-label">{t('LLM プロファイル')}</p>
              <div className="setting-card">
                <p className="muted">
                  {t(
                    'ID ごとに Provider、エンドポイント URL、モデル、API キーを保存します。要約と翻訳では、既定のプロファイルまたは任意のプロファイルを選んで使用します。',
                  )}
                </p>
                {llmProfiles === null ? (
                  <p className="muted">
                    {t('LLM プロファイルを読み込んでいます...')}
                  </p>
                ) : llmProfiles.profiles.length > 0 ? (
                  <div className="llm-profile-list">
                    {llmProfiles.profiles.map((profile) => (
                      <div
                        className={`llm-profile-row ${
                          editingProfileId === profile.id ? 'is-active' : ''
                        }`}
                        key={profile.id}
                      >
                        <input
                          type="radio"
                          name="llm-default-profile"
                          aria-label={t('{id} を既定にする', { id: profile.id })}
                          checked={profile.isDefault}
                          disabled={profileBusy || llmProfiles.profiles.length <= 1}
                          onChange={() => void setDefaultProfile(profile)}
                        />
                        <div className="llm-profile-main">
                          <div className="llm-profile-title">
                            <strong className="mono">{profile.id}</strong>
                            {profile.isDefault ? (
                              <span className="status-chip status-summarized">
                                {t('既定')}
                              </span>
                            ) : null}
                          </div>
                          <span className="muted">
                            {profile.providerLabel} · {profile.model}
                          </span>
                          <span className="muted mono llm-profile-endpoint">
                            {profile.endpoint || t('エンドポイント未設定')}
                          </span>
                          <span
                            className={
                              profile.apiKeyConfigured ? 'ok-text' : 'error-text'
                            }
                          >
                            {profile.apiKeyConfigured
                              ? t('API キー設定済み')
                              : profile.apiKeyStored
                                ? t('設定変更のため API キーの再入力が必要')
                                : t('API キー未設定')}
                          </span>
                        </div>
                        <div className="llm-profile-actions">
                          <button
                            type="button"
                            className="link-button"
                            disabled={profileBusy}
                            onClick={() => startEditProfile(profile)}
                          >
                            {t('編集')}
                          </button>
                          <button
                            type="button"
                            className="link-button"
                            disabled={profileBusy}
                            onClick={() => void removeProfile(profile)}
                          >
                            {t('削除')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="alert alert-warning">
                    {t(
                      'LLM プロファイルがありません。下のフォームから追加してください。',
                    )}
                  </p>
                )}
                {llmProfiles && llmProfiles.profiles.length === 1 ? (
                  <p className="muted">
                    {t(
                      'プロファイルが 1 つだけのため、自動的に既定として使用します。',
                    )}
                  </p>
                ) : null}
                <div className="setting-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={profileBusy}
                    onClick={startCreateProfile}
                  >
                    {t('新規プロファイル')}
                  </button>
                </div>
                {llmProfilesError ? (
                  <p className="alert alert-error">{llmProfilesError}</p>
                ) : null}
                {!profileFormOpen && profileError ? (
                  <p className="alert alert-error">{profileError}</p>
                ) : null}
                {!profileFormOpen && profileNotice ? (
                  <p className="notice-text">{profileNotice}</p>
                ) : null}
              </div>
            </section>

            {profileFormOpen ? (
              <section className="settings-section" ref={profileFormRef}>
                <p className="settings-label">
                  {editingProfileId
                    ? t('プロファイルを編集: {id}', { id: editingProfileId })
                    : t('プロファイルを追加')}
                </p>
                <div className="setting-card">
                  <div className="provider-chips">
                    {LLM_PROVIDER_PRESETS.map((provider) => (
                      <button
                        type="button"
                        className={`provider-chip ${
                          profileProviderDraft === provider.provider ? 'is-active' : ''
                        }`}
                        key={provider.provider}
                        onClick={() => chooseProfileProvider(provider.provider)}
                      >
                        {provider.provider === 'custom' ? t('カスタム') : provider.label}
                      </button>
                    ))}
                  </div>
                  <div className="settings-grid api-grid">
                    <label className="field field-span-2">
                      <span>{t('ID（一意の名前）')}</span>
                      <input
                        className="setting-input mono"
                        value={profileIdDraft}
                        maxLength={64}
                        placeholder={t('例: work-claude')}
                        onChange={(event) => setProfileIdDraft(event.target.value)}
                      />
                    </label>
                    <label className="field field-span-2">
                      <span>{t('エンドポイント URL')}</span>
                      <input
                        className="setting-input mono"
                        value={profileEndpointDraft}
                        placeholder="https://api.example.com/v1"
                        onChange={(event) => setProfileEndpointDraft(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>{t('モデル')}</span>
                      <input
                        className="setting-input mono"
                        value={profileModelDraft}
                        placeholder={getLlmProviderPreset(profileProviderDraft).defaultModel}
                        onChange={(event) => setProfileModelDraft(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>{t('API キー')}</span>
                      <input
                        className="setting-input"
                        type="password"
                        value={profileApiKeyDraft}
                        placeholder={
                          selectedProfile?.apiKeyConfigured
                            ? t('設定済み（変更する場合だけ入力）')
                            : t('API キーを入力')
                        }
                        disabled={!profileKeychainAvailable || profileBusy}
                        onChange={(event) => setProfileApiKeyDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            void saveProfile();
                          }
                        }}
                      />
                    </label>
                  </div>
                  <label className="setting-row">
                    <span>
                      <strong>{t('このプロファイルを既定にする')}</strong>
                      <span className="muted">
                        {t(
                          '要約と翻訳で最初に選ばれるプロファイルです。プロファイルが 1 つだけの場合は自動的に既定になります。',
                        )}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={
                        llmProfiles !== null && llmProfiles.profiles.length === 1
                          ? true
                          : profileMakeDefault
                      }
                      disabled={
                        profileBusy ||
                        (llmProfiles !== null && llmProfiles.profiles.length <= 1)
                      }
                      onChange={(event) => setProfileMakeDefault(event.target.checked)}
                    />
                  </label>
                  <div className="setting-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={profileBusy}
                      onClick={() => void saveProfile()}
                    >
                      {profileBusy
                        ? t('保存中...')
                        : editingProfileId
                          ? t('変更を保存')
                          : t('プロファイルを追加')}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={profileBusy}
                      onClick={closeProfileForm}
                    >
                      {t('キャンセル')}
                    </button>
                    {editingProfileId && selectedProfile?.apiKeyStored ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={profileBusy}
                        onClick={() => void clearProfileApiKey()}
                      >
                        {t('API キーを削除')}
                      </button>
                    ) : null}
                  </div>
                  <div className="key-status">
                    <span
                      className={
                        selectedProfile?.apiKeyConfigured ? 'ok-text' : 'error-text'
                      }
                    >
                      {selectedProfile?.apiKeyConfigured
                        ? t('API キー設定済み')
                        : selectedProfile?.apiKeyStored
                          ? t('設定変更のため API キーの再入力が必要')
                          : t('API キー未設定')}
                    </span>
                    <span
                      className={
                        profileKeychainAvailable ? 'ok-text' : 'error-text'
                      }
                    >
                      {profileKeychainAvailable
                        ? t('macOS Keychain 利用可能')
                        : t('macOS Keychain を利用できません')}
                    </span>
                  </div>
                  {selectedProfile?.apiKeyStored &&
                  !selectedProfile.hostMatchesKey ? (
                    <p className="alert alert-warning">
                      {t(
                        '保存済みの API キーは現在のプロファイル設定と一致しません。',
                      )}
                      {selectedProfile.storedHost
                        ? t(' 保存時のホストは {host} です。', {
                            host: selectedProfile.storedHost,
                          })
                        : ''}
                      {t('API キーを再入力してください。')}
                    </p>
                  ) : null}
                  {selectedProfile?.keychainError ? (
                    <p className="alert alert-error">{selectedProfile.keychainError}</p>
                  ) : null}
                  {profileError ? (
                    <p className="alert alert-error">{profileError}</p>
                  ) : null}
                  {profileNotice ? (
                    <p className="notice-text">{profileNotice}</p>
                  ) : null}
                  <p className="muted">
                    {t(
                      'API キーは Electron の safeStorage で暗号化し、macOS Keychain に保護された鍵で保存します。設定ファイルに平文は残しません。別の Mac にコピーした場合は再入力が必要です。',
                    )}
                  </p>
                  <p className="muted">
                    {t(
                      '音声ファイルは送信しません。送信するのは文字起こしの本文だけで、要約の生成を実行したときだけ送ります。',
                    )}
                  </p>
                </div>
              </section>
            ) : null}

            <section className="settings-section">
              <p className="settings-label">{t('要約の出力言語')}</p>
              <div className="seg settings-source-seg">
                {([
                  { value: 'ja', label: '日本語' },
                  { value: 'en', label: 'English' },
                ] as Array<{ value: SummaryLanguage; label: MessageKey }>).map(
                  (option) => (
                    <button
                      type="button"
                      key={option.value}
                      aria-pressed={settings.summaryLanguage === option.value}
                      onClick={() =>
                        void onUpdateSettings({ summaryLanguage: option.value })
                      }
                    >
                      {t(option.label)}
                    </button>
                  ),
                )}
              </div>
            </section>

            <SummaryCleanupSetting
              settings={settings}
              onUpdateSettings={onUpdateSettings}
            />

            <section className="settings-section">
              <p className="settings-label">{t('要約プロンプト')}</p>
              <div className="setting-card">
                <label className="field">
                  <span>{t('システムプロンプト（空欄で既定）')}</span>
                  <textarea
                    className="setting-input prompt-textarea"
                    value={summaryPromptDraft}
                    placeholder={t(
                      '空欄の場合は、要約・決定事項・ToDo・未決事項の 4 セクションを指定する既定のプロンプトを使います。',
                    )}
                    onChange={(event) => setSummaryPromptDraft(event.target.value)}
                    onBlur={() => void saveSummaryPrompt()}
                  />
                </label>
                <p className="muted">
                  {t(
                    '4 セクションの見出しが欠けても、保存時に不足する見出しを補います。プロンプトを変更すると出力の品質や形式が変わる場合があります。',
                  )}
                </p>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </section>
  );
}
