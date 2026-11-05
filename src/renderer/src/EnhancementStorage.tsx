import { useCallback, useEffect, useState } from 'react';
import type { ReuseDiskUsage } from '../../shared/types';
import { useI18n } from './i18n';
import { errorText, formatBytes } from './recording-utils';

type EnhancementStorageViewProps = {
  usage: ReuseDiskUsage | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  onDelete: () => void;
};

/**
 * 保存済みの強調音声の使用量と削除操作を表示する。
 */
export function EnhancementStorageView({
  usage,
  busy,
  error,
  notice,
  onDelete,
}: EnhancementStorageViewProps) {
  const { t } = useI18n();
  return (
    <section className="settings-section">
      <p className="settings-label">{t('音声強調のディスク使用量')}</p>
      <div className="setting-card">
        <div className="setting-row">
          <span className="setting-row-text">
            {usage === null ? (
              <span className="muted">{t('使用量を確認中...')}</span>
            ) : (
              <>
                <strong>{formatBytes(usage.bytes)}</strong>
                <span className="muted">
                  {t('{size} を使用しています。', {
                    size: formatBytes(usage.bytes),
                  })}
                </span>
              </>
            )}
          </span>
          <span className="model-action">
            <button
              type="button"
              className="link-button"
              disabled={busy || usage === null || usage.bytes === 0}
              onClick={onDelete}
            >
              {t('強調音声を削除')}
            </button>
          </span>
        </div>
        {error ? <p className="alert alert-error">{error}</p> : null}
        {notice ? <p className="notice-text">{notice}</p> : null}
      </div>
    </section>
  );
}

/**
 * 保存済みの強調音声の使用量を Main と接続する。
 */
export function EnhancementStorage() {
  const { t } = useI18n();
  const [usage, setUsage] = useState<ReuseDiskUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUsage(await window.kataribe.getReuseDiskUsage());
      setError(null);
    } catch (reason: unknown) {
      setError(
        t('音声強調の使用量を取得できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async () => {
    if (!window.confirm(t('強調音声を削除します。よろしいですか？'))) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await window.kataribe.deleteReuseSavedAudio();
      setUsage({ bytes: 0, meetings: 0 });
      setNotice(t('強調音声を削除しました。'));
    } catch (reason: unknown) {
      setError(
        t('強調音声を削除できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnhancementStorageView
      usage={usage}
      busy={busy}
      error={error}
      notice={notice}
      onDelete={() => void remove()}
    />
  );
}
