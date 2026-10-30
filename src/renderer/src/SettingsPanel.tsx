import { useState } from 'react';
import type {
  AppSettings,
  InputSource,
  LlmProvider,
  SummaryLanguage,
  WhisperModel,
} from '../../shared/types';
import type { InputDevice } from './recording-utils';
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
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
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

const providers: Array<{ value: LlmProvider; label: string }> = [
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'ollama', label: 'Ollama Cloud' },
  { value: 'fireworks', label: 'Fireworks AI' },
  { value: 'custom', label: 'カスタム' },
];

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
  const permissionDenied = permission === 'denied' || permission === 'restricted';
  const microphoneAvailable = microphones.length > 0;
  const systemAvailable = systemDevices.length > 0;

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
              {whisperModels.map((model) => (
                <label className="model-row" key={model.value}>
                  <input
                    type="radio"
                    name="whisper-model"
                    checked={settings.whisperModel === model.value}
                    onChange={() => onUpdateSettings({ whisperModel: model.value })}
                  />
                  <span className="mono model-name">{model.label}</span>
                  <span className="muted">{model.size}</span>
                  <span className="model-action">
                    {settings.whisperModel === model.value ? (
                      <span className="status-chip status-summarized">選択中</span>
                    ) : (
                      <button type="button" className="link-button" disabled>
                        ダウンロード
                      </button>
                    )}
                  </span>
                </label>
              ))}
            </div>
            <p className="muted">
              モデルのダウンロードと管理はまだ実装されていません。選択値だけを保存します。
            </p>
          </section>
        ) : null}

        {tab === 'summary' ? (
          <>
            <section className="settings-section">
              <p className="settings-label">要約 LLM</p>
              <div className="setting-card">
                <div className="provider-chips">
                  {providers.map((provider) => (
                    <button
                      type="button"
                      className={`provider-chip ${
                        settings.llmProvider === provider.value ? 'is-active' : ''
                      }`}
                      key={provider.value}
                      onClick={() => onUpdateSettings({ llmProvider: provider.value })}
                    >
                      {provider.label}
                    </button>
                  ))}
                </div>
                <div className="settings-grid api-grid">
                  <label className="field">
                    <span>API キー</span>
                    <input
                      className="setting-input"
                      value="Keychain 保存は未実装"
                      readOnly
                    />
                  </label>
                  <label className="field">
                    <span>モデル</span>
                    <input
                      className="setting-input mono"
                      value={settings.llmModel}
                      onChange={(event) =>
                        onUpdateSettings({ llmModel: event.target.value })
                      }
                    />
                  </label>
                </div>
                <p className="muted">
                  API キーの保存と LLM への送信はまだ実装されていません。音声は送信しません。
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
                    onClick={() => onUpdateSettings({ summaryLanguage: option.value })}
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
