import { useCallback, useEffect, useState } from 'react';
import type {
  AppSettings,
  DiarizationModelStatus,
  SpeakerCount,
} from '../../shared/types';
import { errorText, formatBytes } from './recording-utils';

type DiarizationSettingsProps = {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
};

const speakerCountOptions: Array<{ value: SpeakerCount; label: string }> = [
  { value: 'auto', label: '自動' },
  ...([2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map((value) => ({
    value,
    label: `${value} 人`,
  })),
];

/**
 * 話者分離の有効化、話者数、モデルの取得を設定する。
 */
export function DiarizationSettings({
  settings,
  onUpdateSettings,
}: DiarizationSettingsProps) {
  const [model, setModel] = useState<DiarizationModelStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setModel(await window.kataribe.getDiarizationModelStatus());
      setError(null);
    } catch (reason: unknown) {
      setError(`話者分離モデルの状態を取得できませんでした: ${errorText(reason)}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribeProgress = window.kataribe.onDiarizationModelProgress(
      (progress) => {
        setModel((current) =>
          current
            ? {
                ...current,
                state: progress.state,
                downloadedBytes: progress.downloadedBytes,
                totalBytes: progress.totalBytes,
                progress: progress.progress,
                error: null,
              }
            : current,
        );
      },
    );
    const unsubscribeChanged = window.kataribe.onDiarizationModelsChanged(() => {
      void refresh();
    });
    return () => {
      unsubscribeProgress();
      unsubscribeChanged();
    };
  }, [refresh]);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      setModel(await window.kataribe.downloadDiarizationModels());
    } catch (reason: unknown) {
      setError(
        `話者分離モデルのダウンロードを開始できませんでした: ${errorText(reason)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    try {
      setModel(await window.kataribe.cancelDiarizationModelDownload());
    } catch (reason: unknown) {
      setError(
        `話者分離モデルのダウンロードを中断できませんでした: ${errorText(reason)}`,
      );
    }
  };

  const updateSpeakerCount = (value: string) => {
    const option = speakerCountOptions.find(
      (candidate) => String(candidate.value) === value,
    );
    if (option) {
      void onUpdateSettings({ speakerCount: option.value });
    }
  };

  const downloading =
    model?.state === 'downloading' || model?.state === 'verifying';

  return (
    <section className="settings-section">
      <p className="settings-label">話者分離</p>
      <div className="setting-card">
        <label className="setting-row">
          <span>
            <strong>話者分離を使う</strong>
            <span className="muted">
              発話区間から 2〜10 人の話者を推定し、文字起こしの行頭に話者ラベルを付けます。
              声質が近い場合や重なり発話では誤ることがあります。
            </span>
          </span>
          <input
            type="checkbox"
            checked={settings.speakerDiarization}
            onChange={(event) =>
              void onUpdateSettings({
                speakerDiarization: event.target.checked,
              })
            }
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>話者数</strong>
            <span className="muted">
              自動を選ぶと 2〜10 人の範囲で推定します。人数を指定すると、その人数に分けます。
            </span>
          </span>
          <select
            className="setting-input"
            value={settings.speakerCount}
            disabled={!settings.speakerDiarization}
            onChange={(event) => updateSpeakerCount(event.target.value)}
          >
            {speakerCountOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="setting-card">
        <div className="setting-row">
          <span>
            <strong>話者分離モデル</strong>
            <span className="muted">
              初回は約 46 MB をダウンロードします。SHA-256 を照合してから使います。
            </span>
            {model?.installed ? (
              <span className="ok-text">インストール済み</span>
            ) : downloading ? (
              <span className="model-progress">
                <span className="progress-track model-progress-track">
                  <span
                    className="progress-bar"
                    style={{
                      width: `${Math.round((model.progress ?? 0) * 100)}%`,
                    }}
                  />
                </span>
                <span className="mono">
                  {model.state === 'verifying'
                    ? '検証中'
                    : `${Math.round((model.progress ?? 0) * 100)}%`}
                </span>
              </span>
            ) : (
              <span className="muted">
                {model
                  ? `未取得 (${formatBytes(model.downloadedBytes)} / ${formatBytes(model.totalBytes)})`
                  : '状態を確認中'}
              </span>
            )}
          </span>
          <span className="model-action">
            {downloading ? (
              <button type="button" className="link-button" onClick={() => void cancel()}>
                中止
              </button>
            ) : model?.installed ? null : (
              <button
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() => void download()}
              >
                {busy ? '開始中...' : 'ダウンロード'}
              </button>
            )}
          </span>
        </div>
        {error ? <p className="alert alert-error">{error}</p> : null}
        {model?.error ? <p className="alert alert-error">{model.error}</p> : null}
        {model?.modelsDir ? (
          <p className="muted mono">{model.modelsDir}</p>
        ) : null}
      </div>
    </section>
  );
}
