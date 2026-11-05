import { useCallback, useEffect, useState } from 'react';
import {
  REUSE_GPU_REASON_MESSAGE_KEYS,
  type MessageKey,
} from '../../shared/i18n';
import type { ReuseLicenseKind } from '../../shared/reuse';
import type {
  AppSettings,
  ReuseModel,
  ReuseModelList,
  ReuseModelInfo,
  ReuseModelProgress,
} from '../../shared/types';
import { useI18n } from './i18n';
import { findAdapter, type GpuReason } from './reuse/gpu-check.js';
import { errorText, formatBytes } from './recording-utils';

export type ReuseGpuStatus = {
  available: boolean;
  reason: GpuReason | null;
};

type ReuseSettingsViewProps = {
  models: ReuseModelList | null;
  gpu: ReuseGpuStatus;
  savedAudioEnabled: boolean;
  transcriptionEnabled: boolean;
  busy: ReuseModel | null;
  error: string | null;
  notice: string | null;
  onToggleSavedAudio: (enabled: boolean) => void;
  onToggleTranscription: (enabled: boolean) => void;
  onDownload: (model: ReuseModel) => void;
  onCancel: (model: ReuseModel) => void;
  onDelete: (model: ReuseModel) => void;
  onOpenLicense: (kind: ReuseLicenseKind) => void;
};

function modelStateLabel(
  model: ReuseModelInfo,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  if (model.downloading) {
    return model.progress === null
      ? t('ダウンロード中')
      : t('ダウンロード中 ({percent}%)', {
          percent: Math.round(model.progress * 100),
        });
  }
  if (model.installed) {
    return t('インストール済み');
  }
  return t('未取得 ({size})', { size: formatBytes(model.sizeBytes) });
}

/**
 * 音声強調のモデル、ライセンス、WebGPU の可用性を表示する。
 */
export function ReuseSettingsView({
  models,
  gpu,
  savedAudioEnabled,
  transcriptionEnabled,
  busy,
  error,
  notice,
  onToggleSavedAudio,
  onToggleTranscription,
  onDownload,
  onCancel,
  onDelete,
  onOpenLicense,
}: ReuseSettingsViewProps) {
  const { t } = useI18n();
  return (
    <section className="settings-section">
      <p className="settings-label">{t('音声強調 (RE-USE)')}</p>
      <div className="setting-card">
        <label className="setting-row">
          <span className="setting-row-text">
            <strong>{t('録音停止後の保存音声の強調')}</strong>
            <span className="muted">
              {t(
                '録音停止後に保存する音声へ RE-USE を適用し、生の audio.mp3 と強調した audio.enhanced.nemotronlabs.mp3 を保存します。既定は OFF です。',
              )}
            </span>
          </span>
          <input
            type="checkbox"
            checked={savedAudioEnabled}
            onChange={(event) => onToggleSavedAudio(event.target.checked)}
          />
        </label>
      </div>
      <div className="setting-card">
        <label className="setting-row">
          <span className="setting-row-text">
            <strong>{t('文字起こし前の音声を強調する')}</strong>
            <span className="muted">
              {t(
                '文字起こしの前に RE-USE を適用し、生と強調の文字起こしを保存して比較できます。既定は OFF です。',
              )}
            </span>
            <span className="muted">
              {t(
                'OpenAI の文字起こし API を選んだ場合は比較せず、強調に成功した音声または生の音声を 1 回だけ送ります。',
              )}
            </span>
          </span>
          <input
            type="checkbox"
            checked={transcriptionEnabled}
            onChange={(event) => onToggleTranscription(event.target.checked)}
          />
        </label>
      </div>
      <div className="setting-card">
        <div className="setting-row">
          <span className="setting-row-text">
            <strong>{t('WebGPU')}</strong>
            <span className={gpu.available ? 'ok-text' : 'error-text'}>
              {gpu.available
                ? t('音声強調を実行できます。')
                : gpu.reason
                  ? t(REUSE_GPU_REASON_MESSAGE_KEYS[gpu.reason])
                  : t('WebGPU の可用性を確認しています。')}
            </span>
            <span className="muted">
              {t(
                '音声強調は端末内の WebGPU で実行し、音声を外部に送りません。WebGPU が使えないときは音声強調を無効にします。',
              )}
            </span>
          </span>
        </div>
        <div className="setting-actions">
          <button
            type="button"
            className="link-button"
            onClick={() => onOpenLicense('engine')}
          >
            {t('WebGPU エンジンのライセンス')}
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => onOpenLicense('model')}
          >
            {t('音声強調モデルのライセンス')}
          </button>
        </div>
      </div>
      <div className="setting-card model-list">
        <div className="setting-row">
          <span className="setting-row-text">
            <strong>{t('音声強調モデル')}</strong>
            <span className="muted">
              {t(
                '商用利用が可能な NVIDIA NemotronLabs RE-USE だけを使います。モデルは初回利用時にダウンロードし、SHA-256 を照合してから使います。',
              )}
            </span>
          </span>
        </div>
        {models === null ? (
          <p className="muted">{t('モデル一覧を読み込んでいます...')}</p>
        ) : (
          models.models.map((model) => (
            <div className="model-row" key={model.id}>
              <span className="model-name-group">
                <span className="mono model-name">{model.label}</span>
                <span className="muted">
                  {model.license} · {formatBytes(model.sizeBytes)}
                </span>
                <span
                  className={
                    model.error ? 'error-text' : model.installed ? 'ok-text' : 'muted'
                  }
                >
                  {modelStateLabel(model, t)}
                </span>
                {model.downloading ? (
                  <span className="model-progress">
                    <span className="progress-track model-progress-track">
                      <span
                        className="progress-bar"
                        style={{
                          width: `${Math.round((model.progress ?? 0) * 100)}%`,
                        }}
                      />
                    </span>
                  </span>
                ) : null}
                {model.error ? (
                  <span className="error-text">{model.error}</span>
                ) : null}
              </span>
              <span className="model-action">
                {model.downloading ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onCancel(model.id)}
                  >
                    {t('中止')}
                  </button>
                ) : model.installed ? (
                  <button
                    type="button"
                    className="link-button"
                    disabled={busy !== null}
                    onClick={() => onDelete(model.id)}
                  >
                    {t('削除')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="link-button"
                    disabled={busy !== null}
                    onClick={() => onDownload(model.id)}
                  >
                    {busy === model.id ? t('開始中...') : t('ダウンロード')}
                  </button>
                )}
              </span>
            </div>
          ))
        )}
        {models?.modelsDir ? (
          <p className="muted mono">{models.modelsDir}</p>
        ) : null}
        {error ? <p className="alert alert-error">{error}</p> : null}
        {notice ? <p className="notice-text">{notice}</p> : null}
      </div>
      <p className="muted">
        {t(
          '研究および教育用のモデルは、モデル一覧、設定、ダウンロードのいずれにも含めません。',
        )}
      </p>
    </section>
  );
}

/**
 * 音声強調のモデル管理を Main と接続する。
 */
export function ReuseSettings({
  settings,
  onUpdateSettings,
}: {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [models, setModels] = useState<ReuseModelList | null>(null);
  const [gpu, setGpu] = useState<ReuseGpuStatus>({
    available: false,
    reason: null,
  });
  const [busy, setBusy] = useState<ReuseModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setModels(await window.kataribe.listReuseModels());
      setError(null);
    } catch (reason: unknown) {
      setError(
        t('音声強調モデルの状態を取得できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    const unsubscribeModels = window.kataribe.onReuseModelsChanged((list) => {
      setModels(list);
    });
    const unsubscribeProgress = window.kataribe.onReuseModelProgress(
      (progress: ReuseModelProgress) => {
        setModels((current) =>
          current
            ? {
                ...current,
                models: current.models.map((model) =>
                  model.id === progress.id
                    ? {
                        ...model,
                        downloading: true,
                        progress: progress.progress,
                        error: null,
                      }
                    : model,
                ),
              }
            : current,
        );
      },
    );
    let cancelled = false;
    void findAdapter().then((result) => {
      if (cancelled) {
        return;
      }
      setGpu(
        result.adapter
          ? { available: true, reason: null }
          : { available: false, reason: result.reason },
      );
    });
    return () => {
      cancelled = true;
      unsubscribeModels();
      unsubscribeProgress();
    };
  }, [refresh]);

  const download = async (model: ReuseModel) => {
    setBusy(model);
    setError(null);
    setNotice(null);
    try {
      setModels(await window.kataribe.downloadReuseModel(model));
    } catch (reason: unknown) {
      setError(
        t('モデルのダウンロードを開始できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (model: ReuseModel) => {
    try {
      setModels(await window.kataribe.cancelReuseModelDownload(model));
      setNotice(t('ダウンロードを中断しました。次回は続きから再開します。'));
    } catch (reason: unknown) {
      setError(
        t('ダウンロードを中断できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    }
  };

  const remove = async (model: ReuseModel) => {
    if (
      !window.confirm(
        t('{model} のモデルファイルを削除します。よろしいですか？', {
          model,
        }),
      )
    ) {
      return;
    }
    setBusy(model);
    setError(null);
    setNotice(null);
    try {
      setModels(await window.kataribe.deleteReuseModel(model));
      setNotice(t('{model} を削除しました。', { model }));
    } catch (reason: unknown) {
      setError(
        t('モデルを削除できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  const openLicense = (kind: ReuseLicenseKind) => {
    void window.kataribe.openReuseLicense(kind).catch((reason: unknown) => {
      setError(
        t('ライセンスを開けませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    });
  };

  return (
    <ReuseSettingsView
      models={models}
      gpu={gpu}
      savedAudioEnabled={settings.enhanceSavedAudio}
      transcriptionEnabled={settings.enhanceBeforeTranscription}
      busy={busy}
      error={error}
      notice={notice}
      onToggleSavedAudio={(enabled) => {
        void onUpdateSettings({ enhanceSavedAudio: enabled });
      }}
      onToggleTranscription={(enabled) => {
        void onUpdateSettings({ enhanceBeforeTranscription: enabled });
      }}
      onDownload={(model) => void download(model)}
      onCancel={(model) => void cancel(model)}
      onDelete={(model) => void remove(model)}
      onOpenLicense={openLicense}
    />
  );
}
