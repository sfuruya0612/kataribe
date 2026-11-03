import { useI18n } from './i18n';

type StaleTranscriptNoticeProps = {
  summaryStale: boolean;
  translationStale: boolean;
};

/**
 * 要約や翻訳が以前の文字起こしに基づくことを表示する。
 */
export function StaleTranscriptNotice({
  summaryStale,
  translationStale,
}: StaleTranscriptNoticeProps) {
  const { t } = useI18n();
  if (!summaryStale && !translationStale) {
    return null;
  }
  return (
    <p className="alert alert-warning" role="status">
      {t(
        'この要約と翻訳は以前の文字起こしに基づいています。要約と翻訳を再生成してください。',
      )}
    </p>
  );
}
