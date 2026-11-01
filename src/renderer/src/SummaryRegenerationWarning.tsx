import { useI18n } from './i18n';

type SummaryRegenerationWarningProps = {
  visible: boolean;
};

/**
 * 要約の再生成で既存の要約と ToDo の完了状態が失われることを、送信確認に表示する。
 */
export function SummaryRegenerationWarning({
  visible,
}: SummaryRegenerationWarningProps) {
  const { t } = useI18n();
  if (!visible) {
    return null;
  }
  return (
    <div className="alert alert-warning summary-regeneration-warning">
      <strong>{t('既存の要約を上書きします')}</strong>
      <p>{t('ToDo の完了状態は引き継ぎません。')}</p>
      <p>{t('直前の要約は summary.previous.md に退避します。')}</p>
    </div>
  );
}
