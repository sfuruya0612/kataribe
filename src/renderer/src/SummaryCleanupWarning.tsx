import { useI18n } from './i18n';

type SummaryCleanupWarningProps = {
  enabled: boolean;
};

/**
 * 相槌と擬音の除去で文字起こしを 2 回送ることを確認ダイアログに表示する。
 */
export function SummaryCleanupWarning({ enabled }: SummaryCleanupWarningProps) {
  const { t } = useI18n();
  if (!enabled) {
    return null;
  }
  return (
    <p className="alert alert-warning">
      {t('相槌と擬音の除去でも文字起こしを送信するため、送信は 2 回になります。')}
    </p>
  );
}
