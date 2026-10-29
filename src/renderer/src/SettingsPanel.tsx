import type { InputSource } from '../../shared/types';
import type { InputDevice } from './recording-utils';
import type { PermissionState } from './use-recorder';

type SettingsPanelProps = {
  saveRoot: string;
  version: string;
  inputSource: InputSource;
  permission: PermissionState;
  microphones: InputDevice[];
  systemDevices: InputDevice[];
  onSetInputSource: (source: InputSource) => void;
  onRequestPermission: () => void;
  onOpenMicrophoneSettings: () => void;
  onOpenReadme: () => void;
  onOpenBlackHoleSite: () => void;
  onShowAbout: () => void;
};

const sourceOptions: Array<{ value: InputSource; label: string }> = [
  { value: 'microphone', label: 'マイク' },
  { value: 'system', label: 'システム音声' },
  { value: 'both', label: 'マイク + システム音声' },
];

export function SettingsPanel({
  saveRoot,
  version,
  inputSource,
  permission,
  microphones,
  systemDevices,
  onSetInputSource,
  onRequestPermission,
  onOpenMicrophoneSettings,
  onOpenReadme,
  onOpenBlackHoleSite,
  onShowAbout,
}: SettingsPanelProps) {
  const permissionMessage =
    permission === 'granted'
      ? '許可済み'
      : permission === 'requesting'
        ? '確認中'
        : permission === 'denied' || permission === 'restricted'
          ? '拒否'
          : permission === 'not-determined'
            ? '未確認'
            : '不明';
  const microphoneAvailable = microphones.length > 0;
  const systemAvailable = systemDevices.length > 0;
  const permissionDenied = permission === 'denied' || permission === 'restricted';

  return (
    <section className="view-panel" aria-labelledby="settings-title">
      <div className="view-head">
        <div>
          <p className="section-label">Settings</p>
          <h2 id="settings-title">設定</h2>
        </div>
        <span className="panel-note">各設定の保存は次の issue</span>
      </div>

      <div className="settings-grid">
        <section className="setting-card">
          <h3>録音</h3>
          <p className="muted">
            入力ソースはトレイと同期します。録音中に変更した場合は、次の録音から適用されます。
          </p>
          <fieldset className="source-picker settings-source">
            <legend>入力ソース</legend>
            {sourceOptions.map((option) => {
              const unavailable =
                permissionDenied ||
                (option.value === 'microphone' && !microphoneAvailable) ||
                (option.value === 'system' && !systemAvailable) ||
                (option.value === 'both' && (!microphoneAvailable || !systemAvailable));
              return (
                <label className="source-option" key={option.value}>
                  <input
                    type="radio"
                    name="settings-input-source"
                    value={option.value}
                    checked={inputSource === option.value}
                    onChange={() => onSetInputSource(option.value)}
                    disabled={unavailable}
                    data-testid={`settings-source-${option.value}`}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </fieldset>
        </section>

        <section className="setting-card">
          <h3>保存先フォルダ</h3>
          <p className="muted">録音と文字起こしを保存するフォルダです。</p>
          <input className="setting-input" value={saveRoot} readOnly />
          <button type="button" className="button button-secondary" disabled>
            フォルダを変更（未実装）
          </button>
        </section>

        <section className="setting-card">
          <h3>whisper.cpp モデル</h3>
          <p className="muted">文字起こしに使うモデルを選びます。</p>
          <select className="setting-input" disabled defaultValue="large-v3-turbo">
            <option value="large-v3-turbo">large-v3-turbo（約 1.6 GB）</option>
            <option value="large-v3">large-v3</option>
            <option value="medium">medium</option>
          </select>
        </section>

        <section className="setting-card">
          <h3>LLM プロバイダ</h3>
          <p className="muted">要約に使う LLM の接続先を選びます。</p>
          <select className="setting-input" disabled defaultValue="openai-compatible">
            <option value="openai-compatible">OpenAI 互換 API</option>
            <option value="ollama">Ollama</option>
          </select>
        </section>

        <section className="setting-card">
          <h3>要約の出力言語</h3>
          <p className="muted">要約、決定事項、ToDo を出力する言語です。</p>
          <select className="setting-input" disabled defaultValue="ja">
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </section>

        <section className="setting-card">
          <h3>マイク権限</h3>
          <p className="muted">入力デバイスの検出と録音に使います。</p>
          <p className={`permission permission-${permission}`}>
            現在の状態: {permissionMessage}
          </p>
          <div className="setting-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={onRequestPermission}
              disabled={permission === 'requesting' || permission === 'granted'}
            >
              マイク権限を確認する
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
        </section>

        <section className="setting-card setting-card-wide">
          <h3>BlackHole 2ch のセットアップ</h3>
          <p className="muted">
            システム音声を録音するには、BlackHole 2ch と Multi-Output Device
            の設定が必要です。Kataribe は macOS の音声出力を自動で変更しません。
          </p>
          <div className="setting-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={onOpenReadme}
            >
              セットアップ手順を開く
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={onOpenBlackHoleSite}
            >
              BlackHole 2ch の配布元を開く
            </button>
          </div>
        </section>

        <section className="setting-card setting-card-wide">
          <h3>このアプリについて</h3>
          <p className="muted">Kataribe 会議録 v{version}</p>
          <button type="button" className="button button-secondary" onClick={onShowAbout}>
            About 画面を開く
          </button>
        </section>
      </div>
    </section>
  );
}
