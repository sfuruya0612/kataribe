import { useCallback, useEffect, useState } from 'react';
import type {
  AppSettings,
  DiarizationModelStatus,
  SpeakerCount,
} from '../../shared/types';
import { useI18n } from './i18n';
import { errorText, formatBytes } from './recording-utils';

type DiarizationSettingsProps = {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
};

const speakerCounts: SpeakerCount[] = ['auto', 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * 話者分離の有効化、話者数、モデルの取得を設定する。
 */
export function DiarizationSettings({
  settings,
  onUpdateSettings,
}: DiarizationSettingsProps) {
  const { t, tc } = useI18n();
  const [model, setModel] = useState<DiarizationModelStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setModel(await window.kataribe.getDiarizationModelStatus());
      setError(null);
    } catch (reason: unknown) {
      setError(
        t('話者分離モデルの状態を取得できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    }
  }, [t]);

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
        t('話者分離モデルのダウンロードを開始できませんでした: {error}', {
          error: errorText(reason),
        }),
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
        t('話者分離モデルのダウンロードを中断できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    }
  };

  const updateSpeakerCount = (value: string) => {
    const option = speakerCounts.find(
      (candidate) => String(candidate) === value,
    );
    if (option !== undefined) {
      void onUpdateSettings({ speakerCount: option });
    }
  };

  const downloading =
    model?.state === 'downloading' || model?.state === 'verifying';

  return (
    <section className="settings-section">
      <p className="settings-label">{t('話者分離')}</p>
      <div className="setting-card">
        <label className="setting-row">
          <span className="setting-row-text">
            <strong>{t('話者分離を使う')}</strong>
            <span className="muted">
              {t(
                '発話区間から 2〜10 人の話者を推定し、文字起こしの行頭に話者ラベルを付けます。声質が近い場合や重なり発話では誤ることがあります。',
              )}
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
          <span className="setting-row-text">
            <strong>{t('話者数')}</strong>
            <span className="muted">
              {t(
                '自動を選ぶと 2〜10 人の範囲で推定します。人数を指定すると、その人数に分けます。',
              )}
            </span>
          </span>
          <select
            className="setting-input"
            value={settings.speakerCount}
            disabled={!settings.speakerDiarization}
            onChange={(event) => updateSpeakerCount(event.target.value)}
          >
            {speakerCounts.map((count) => (
              <option value={count} key={count}>
                {count === 'auto'
                  ? t('自動')
                  : tc(count, '1 人', '{count} 人')}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="setting-card">
        <div className="setting-row">
          <span className="setting-row-text">
            <strong>{t('話者分離モデル')}</strong>
            <span className="muted">
              {t(
                '初回は約 46 MB をダウンロードします。SHA-256 を照合してから使います。',
              )}
            </span>
            {model?.installed ? (
              <span className="ok-text">{t('インストール済み')}</span>
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
                    ? t('検証中')
                    : `${Math.round((model.progress ?? 0) * 100)}%`}
                </span>
              </span>
            ) : (
              <span className="muted">
                {model
                  ? t('未取得 ({downloaded} / {total})', {
                      downloaded: formatBytes(model.downloadedBytes),
                      total: formatBytes(model.totalBytes),
                    })
                  : t('状態を確認中')}
              </span>
            )}
          </span>
          <span className="model-action">
            {downloading ? (
              <button type="button" className="link-button" onClick={() => void cancel()}>
                {t('中止')}
              </button>
            ) : model?.installed ? null : (
              <button
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() => void download()}
              >
                {busy ? t('開始中...') : t('ダウンロード')}
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
