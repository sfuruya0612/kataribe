import { useCallback, useEffect, useState } from 'react';
import {
  getLlmProviderPreset,
  LLM_PROVIDER_PRESETS,
  validateEndpointUrl,
} from '../../shared/llm';
import type {
  AppSettings,
  InputSource,
  LlmProvider,
  LlmRuntimeConfig,
  SummaryLanguage,
  WhisperModel,
  WhisperModelList,
} from '../../shared/types';
import { errorText, type InputDevice } from './recording-utils';
import type { PermissionState } from './use-recorder';

type SettingsTab = 'general' | 'recording' | 'transcription' | 'summary';

type SettingsPanelProps = {
  saveRoot: string;
  version: string;
  settings: AppSettings;
  inputSource: InputSource;
  permission: PermissionState;
  microphones: InputDevice[];
  systemDevices: InputDevice[];
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onSetInputSource: (source: InputSource) => void;
  onRequestPermission: () => void;
  onOpenMicrophoneSettings: () => void;
  onOpenReadme: () => void;
  onOpenBlackHoleSite: () => void;
  onShowAbout: () => void;
};

const tabs: Array<{ value: SettingsTab; label: string; color: string }> = [
  { value: 'general', label: '一般', color: '#8E8E93' },
  { value: 'recording', label: '録音', color: '#FF3B30' },
  { value: 'transcription', label: '文字起こし', color: '#5856D6' },
  { value: 'summary', label: '要約', color: '#34C759' },
];

const sourceOptions: Array<{ value: InputSource; label: string }> = [
  { value: 'microphone', label: 'マイク' },
  { value: 'system', label: 'システム' },
  { value: 'both', label: '両方' },
];

const whisperModels: Array<{ value: WhisperModel; label: string; size: string }> = [
  { value: 'large-v3-turbo', label: 'large-v3-turbo', size: '1.6 GB' },
  { value: 'medium', label: 'medium', size: '1.5 GB' },
  { value: 'small', label: 'small', size: '488 MB' },
];

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return '-';
  }
  const gb = value / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  }
  return `${Math.round(value / (1024 * 1024))} MB`;
}

export function SettingsPanel({
  saveRoot,
  version,
  settings,
  inputSource,
  permission,
  microphones,
  systemDevices,
  onUpdateSettings,
  onSetInputSource,
  onRequestPermission,
  onOpenMicrophoneSettings,
  onOpenReadme,
  onOpenBlackHoleSite,
  onShowAbout,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>('general');
  const [models, setModels] = useState<WhisperModelList | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [llm, setLlm] = useState<LlmRuntimeConfig | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [endpointDraft, setEndpointDraft] = useState(settings.llmBaseUrl);
  const [modelDraft, setModelDraft] = useState(settings.llmModel);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState<WhisperModel | null>(null);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const permissionDenied = permission === 'denied' || permission === 'restricted';
  const microphoneAvailable = microphones.length > 0;
  const systemAvailable = systemDevices.length > 0;

  const refreshModels = useCallback(async () => {
    try {
      setModels(await window.kataribe.listWhisperModels());
      setModelsError(null);
    } catch (reason: unknown) {
      setModelsError(`モデル一覧を取得できませんでした: ${errorText(reason)}`);
    }
  }, []);

  const refreshLlm = useCallback(async () => {
    try {
      setLlm(await window.kataribe.getLlmRuntime());
      setLlmError(null);
    } catch (reason: unknown) {
      setLlmError(`LLM の状態を取得できませんでした: ${errorText(reason)}`);
    }
  }, []);

  useEffect(() => {
    void refreshModels();
    void refreshLlm();
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
    const unsubscribeLlm = window.kataribe.onLlmChanged((config) => {
      setLlm(config);
    });
    return () => {
      unsubscribeModels();
      unsubscribeProgress();
      unsubscribeLlm();
    };
  }, [refreshLlm, refreshModels]);

  useEffect(() => {
    setEndpointDraft(settings.llmBaseUrl);
    setModelDraft(settings.llmModel);
  }, [settings.llmBaseUrl, settings.llmModel, settings.llmProvider]);

  const chooseProvider = async (provider: LlmProvider) => {
    const preset = getLlmProviderPreset(provider);
    try {
      await onUpdateSettings({
        llmProvider: provider,
        llmModel: preset.defaultModel || settings.llmModel,
        llmBaseUrl: preset.defaultBaseUrl,
      });
      await refreshLlm();
    } catch (reason: unknown) {
      setLlmError(`プロバイダを変更できませんでした: ${errorText(reason)}`);
    }
  };

  const saveEndpoint = async () => {
    if (endpointDraft === settings.llmBaseUrl) {
      return;
    }
    if (endpointDraft.trim()) {
      const validation = validateEndpointUrl(endpointDraft);
      if (!validation.ok) {
        setLlmError(validation.error);
        return;
      }
    }
    try {
      await onUpdateSettings({ llmBaseUrl: endpointDraft });
      await refreshLlm();
    } catch (reason: unknown) {
      setLlmError(`エンドポイントを保存できませんでした: ${errorText(reason)}`);
    }
  };

  const saveModelName = async () => {
    if (modelDraft === settings.llmModel) {
      return;
    }
    try {
      await onUpdateSettings({ llmModel: modelDraft });
      await refreshLlm();
    } catch (reason: unknown) {
      setLlmError(`モデル名を保存できませんでした: ${errorText(reason)}`);
    }
  };

  const saveApiKey = async () => {
    if (!apiKeyDraft.trim()) {
      return;
    }
    setKeyBusy(true);
    try {
      if (endpointDraft !== settings.llmBaseUrl || modelDraft !== settings.llmModel) {
        await onUpdateSettings({
          llmBaseUrl: endpointDraft,
          llmModel: modelDraft,
        });
      }
      const config = await window.kataribe.setLlmApiKey(apiKeyDraft);
      setLlm(config);
      setApiKeyDraft('');
      setLlmError(null);
    } catch (reason: unknown) {
      setLlmError(`API キーを保存できませんでした: ${errorText(reason)}`);
    } finally {
      setKeyBusy(false);
    }
  };

  const clearApiKey = async () => {
    if (!window.confirm('保存済みの API キーを削除します。よろしいですか？')) {
      return;
    }
    setKeyBusy(true);
    try {
      await window.kataribe.clearLlmApiKey();
      await refreshLlm();
    } catch (reason: unknown) {
      setLlmError(`API キーを削除できませんでした: ${errorText(reason)}`);
    } finally {
      setKeyBusy(false);
    }
  };

  const downloadModel = async (model: WhisperModel) => {
    setModelBusy(model);
    setModelNotice(null);
    try {
      setModels(await window.kataribe.downloadWhisperModel(model));
    } catch (reason: unknown) {
      setModelsError(`モデルのダウンロードを開始できませんでした: ${errorText(reason)}`);
    } finally {
      setModelBusy(null);
    }
  };

  const cancelModel = async (model: WhisperModel) => {
    try {
      setModels(await window.kataribe.cancelWhisperModelDownload(model));
      setModelNotice('ダウンロードを中断しました。次回は続きから再開します。');
    } catch (reason: unknown) {
      setModelsError(`ダウンロードを中断できませんでした: ${errorText(reason)}`);
    }
  };

  const deleteModel = async (model: WhisperModel) => {
    if (!window.confirm(`${model} のモデルファイルを削除します。よろしいですか？`)) {
      return;
    }
    setModelBusy(model);
    try {
      setModels(await window.kataribe.deleteWhisperModel(model));
      setModelNotice(`${model} を削除しました。`);
    } catch (reason: unknown) {
      setModelsError(`モデルを削除できませんでした: ${errorText(reason)}`);
    } finally {
      setModelBusy(null);
    }
  };

  return (
    <section className="settings-panel" aria-labelledby="settings-title">
      <div className="settings-tabs" role="tablist" aria-label="設定">
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
            {entry.label}
          </button>
        ))}
      </div>

      <div className="settings-content">
        <div className="settings-content-head">
          <div>
            <p className="section-label">Settings</p>
            <h1 id="settings-title" className="page-title">
              {tabs.find((entry) => entry.value === tab)?.label}
            </h1>
          </div>
          <span className="panel-note">設定はローカルに保存されます</span>
        </div>

        {tab === 'general' ? (
          <>
            <section className="settings-section">
              <p className="settings-label">保存先</p>
              <div className="setting-card setting-row">
                <span className="mono setting-path">{saveRoot}</span>
                <button type="button" className="button button-secondary" disabled>
                  変更
                </button>
              </div>
            </section>

            <section className="settings-section">
              <p className="settings-label">このアプリについて</p>
              <div className="setting-card setting-row">
                <div>
                  <strong>Kataribe 会議録</strong>
                  <p className="muted">v{version} · ローカルビルド</p>
                </div>
                <button type="button" className="button button-secondary" onClick={onShowAbout}>
                  About を開く
                </button>
              </div>
            </section>

            <section className="settings-section">
              <p className="settings-label">セットアップ</p>
              <div className="setting-card">
                <p className="muted">
                  システム音声を録音するには BlackHole 2ch と Multi-Output Device の設定が必要です。
                </p>
                <div className="setting-actions">
                  <button type="button" className="button button-secondary" onClick={onOpenReadme}>
                    セットアップ手順を開く
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={onOpenBlackHoleSite}
                  >
                    BlackHole 2ch の配布元
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {tab === 'recording' ? (
          <>
            <section className="settings-section">
              <p className="settings-label">入力ソース</p>
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
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="muted">
                入力ソースはトレイと録音パネルに同期します。録音中の変更は次の録音から適用されます。
              </p>
            </section>

            <section className="settings-section">
              <p className="settings-label">入力デバイス</p>
              <div className="settings-grid">
                <div className="setting-card">
                  <div className="setting-row">
                    <strong>マイク</strong>
                    <span className={microphoneAvailable ? 'ok-text' : 'error-text'}>
                      {microphoneAvailable ? '検出済み' : '見つかりません'}
                    </span>
                  </div>
                  <p className="muted">
                    {microphones[0]?.label || 'マイクを接続してください。'}
                  </p>
                  <div className="setting-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={onRequestPermission}
                      disabled={permission === 'requesting' || permission === 'granted'}
                    >
                      マイク権限を確認
                    </button>
                    {permissionDenied ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={onOpenMicrophoneSettings}
                      >
                        システム設定を開く
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="setting-card">
                  <div className="setting-row">
                    <strong>システム音声</strong>
                    <span className={systemAvailable ? 'ok-text' : 'error-text'}>
                      {systemAvailable ? '検出済み' : '見つかりません'}
                    </span>
                  </div>
                  <p className="muted mono">
                    {systemDevices[0]?.label || 'BlackHole 2ch'}
                  </p>
                  <button type="button" className="link-button" onClick={onOpenReadme}>
                    セットアップ手順
                  </button>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <p className="settings-label">クリッピング警告</p>
              <div className="setting-card">
                <p className="muted">
                  マイク入力のピークがしきい値を超えた状態が続くと警告します。値は 100 ms
                  単位の連続回数で指定します。
                </p>
                <div className="settings-grid settings-grid-3">
                  <label className="field">
                    <span>ピークしきい値（0.5〜1.0）</span>
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
                    <span>警告までの連続回数</span>
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
                    <span>解除までの連続回数</span>
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
              <p className="settings-label">システム音声の無音検出</p>
              <div className="setting-card">
                <p className="muted">
                  システム音声の RMS がしきい値を下回る状態が続くと警告します。猶予時間は会議前の無音で警告しないために使います。
                </p>
                <div className="settings-grid settings-grid-3">
                  <label className="field">
                    <span>監視ウィンドウ（秒）</span>
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
                    <span>RMS しきい値</span>
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
                    <span>猶予時間（秒）</span>
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
          <section className="settings-section">
            <p className="settings-label">whisper.cpp モデル</p>
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
                          ? ` · インストール済み ${formatBytes(info.installedBytes)}`
                          : info?.downloadedBytes
                            ? ` · 取得済み ${formatBytes(info.downloadedBytes)}`
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
                              ? '検証中'
                              : `${Math.round((info?.progress ?? 0) * 100)}%`}
                          </span>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => void cancelModel(entry.value)}
                          >
                            中止
                          </button>
                        </span>
                      ) : info?.installed ? (
                        <span className="model-installed">
                          {settings.whisperModel === entry.value ? (
                            <span className="status-chip status-summarized">選択中</span>
                          ) : null}
                          <button
                            type="button"
                            className="link-button"
                            disabled={modelBusy !== null}
                            onClick={() => void deleteModel(entry.value)}
                          >
                            削除
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="link-button"
                          disabled={modelBusy !== null}
                          onClick={() => void downloadModel(entry.value)}
                        >
                          {modelBusy === entry.value ? '開始中...' : 'ダウンロード'}
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
              モデルは HTTPS でダウンロードし、SHA-256 を照合してから保存します。中断しても次回は続きから再開します。
              {models?.modelsDir ? ` 保存先: ${models.modelsDir}` : ''}
            </p>
            <p className="muted">
              文字起こしは端末内の whisper.cpp で行います。録音停止後、選択中のモデルで自動的に開始します。
            </p>
          </section>
        ) : null}

        {tab === 'summary' ? (
          <>
            <section className="settings-section">
              <p className="settings-label">要約 LLM</p>
              <div className="setting-card">
                <div className="provider-chips">
                  {LLM_PROVIDER_PRESETS.map((provider) => (
                    <button
                      type="button"
                      className={`provider-chip ${
                        settings.llmProvider === provider.provider ? 'is-active' : ''
                      }`}
                      key={provider.provider}
                      onClick={() => void chooseProvider(provider.provider)}
                    >
                      {provider.label}
                    </button>
                  ))}
                </div>
                <div className="settings-grid api-grid">
                  <label className="field field-span-2">
                    <span>エンドポイント URL</span>
                    <input
                      className="setting-input mono"
                      value={endpointDraft}
                      placeholder="https://api.example.com/v1"
                      onChange={(event) => setEndpointDraft(event.target.value)}
                      onBlur={() => void saveEndpoint()}
                    />
                  </label>
                  <label className="field">
                    <span>モデル</span>
                    <input
                      className="setting-input mono"
                      value={modelDraft}
                      placeholder={getLlmProviderPreset(settings.llmProvider).defaultModel}
                      onChange={(event) => setModelDraft(event.target.value)}
                      onBlur={() => void saveModelName()}
                    />
                  </label>
                  <label className="field">
                    <span>API キー</span>
                    <input
                      className="setting-input"
                      type="password"
                      value={apiKeyDraft}
                      placeholder={
                        llm?.apiKeyConfigured
                          ? '設定済み（変更する場合だけ入力）'
                          : 'API キーを入力'
                      }
                      disabled={llm?.keychainAvailable === false || keyBusy}
                      onChange={(event) => setApiKeyDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void saveApiKey();
                        }
                      }}
                    />
                  </label>
                </div>
                <div className="setting-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={!apiKeyDraft.trim() || keyBusy || llm?.keychainAvailable === false}
                    onClick={() => void saveApiKey()}
                  >
                    {keyBusy ? '保存中...' : 'API キーを保存'}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={!llm?.apiKeyStored || keyBusy}
                    onClick={() => void clearApiKey()}
                  >
                    API キーを削除
                  </button>
                </div>
                <div className="key-status">
                  <span className={llm?.apiKeyConfigured ? 'ok-text' : 'error-text'}>
                    {llm?.apiKeyConfigured
                      ? 'API キー設定済み'
                      : llm?.apiKeyStored
                        ? 'エンドポイント変更のため API キーの再入力が必要'
                        : 'API キー未設定'}
                  </span>
                  <span className={llm?.keychainAvailable ? 'ok-text' : 'error-text'}>
                    {llm?.keychainAvailable
                      ? 'macOS Keychain 利用可能'
                      : 'macOS Keychain を利用できません'}
                  </span>
                </div>
                {llm?.apiKeyStored && !llm.hostMatchesKey && llm.storedHost ? (
                  <p className="alert alert-warning">
                    保存済みの API キーは {llm.storedHost} 用です。現在のエンドポイントのホストで再入力してください。
                  </p>
                ) : null}
                {llm?.keychainError ? (
                  <p className="alert alert-error">{llm.keychainError}</p>
                ) : null}
                {llmError ? <p className="alert alert-error">{llmError}</p> : null}
                <p className="muted">
                  API キーは Electron の safeStorage で暗号化し、macOS Keychain に保護された鍵で保存します。
                  設定ファイルに平文は残しません。別の Mac にコピーした場合は再入力が必要です。
                </p>
                <p className="muted">
                  音声ファイルは送信しません。送信するのは文字起こしの本文だけで、要約の生成を実行したときだけ送ります。
                </p>
              </div>
            </section>

            <section className="settings-section">
              <p className="settings-label">要約の出力言語</p>
              <div className="seg settings-source-seg">
                {([
                  { value: 'ja', label: '日本語' },
                  { value: 'en', label: 'English' },
                ] as Array<{ value: SummaryLanguage; label: string }>).map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    aria-pressed={settings.summaryLanguage === option.value}
                    onClick={() => void onUpdateSettings({ summaryLanguage: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </section>
  );
}
