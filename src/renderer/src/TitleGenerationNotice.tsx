import type { MeetingTitleGeneration } from '../../shared/types';
import { useI18n } from './i18n';

type TitleGenerationNoticeProps = {
  titleGeneration: MeetingTitleGeneration | null;
  canRetry: boolean;
  busy: boolean;
  onRetry: () => void;
};

/**
 * タイトル生成に失敗した理由と再試行の導線を表示する。
 */
export function TitleGenerationNotice({
  titleGeneration,
  canRetry,
  busy,
  onRetry,
}: TitleGenerationNoticeProps) {
  const { t } = useI18n();
  if (titleGeneration?.state !== 'failed') {
    return null;
  }
  return (
    <div className="alert alert-warning title-generation-notice" role="status">
      <strong>{t('タイトルを自動生成できませんでした')}</strong>
      {titleGeneration.error ? <p>{titleGeneration.error}</p> : null}
      {canRetry ? (
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={onRetry}
        >
          {busy ? t('生成中...') : t('タイトル生成を再試行')}
        </button>
      ) : null}
    </div>
  );
}
