import { useI18n } from './i18n';

export type TranscriptView = 'current' | 'raw' | 'enhanced';

type TranscriptComparisonProps = {
  value: TranscriptView;
  hasRaw: boolean;
  hasEnhanced: boolean;
  onChange: (value: TranscriptView) => void;
};

/**
 * 現在の文字起こし、生の比較用、強調した比較用を切り替える。
 */
export function TranscriptComparison({
  value,
  hasRaw,
  hasEnhanced,
  onChange,
}: TranscriptComparisonProps) {
  const { t } = useI18n();
  if (!hasRaw && !hasEnhanced) {
    return null;
  }
  return (
    <div className="transcript-comparison">
      <div className="seg" role="group" aria-label={t('文字起こしの比較')}>
        <button
          type="button"
          aria-pressed={value === 'current'}
          onClick={() => onChange('current')}
        >
          {t('現在の文字起こし')}
        </button>
        {hasRaw ? (
          <button
            type="button"
            aria-pressed={value === 'raw'}
            onClick={() => onChange('raw')}
          >
            {t('生の文字起こし')}
          </button>
        ) : null}
        {hasEnhanced ? (
          <button
            type="button"
            aria-pressed={value === 'enhanced'}
            onClick={() => onChange('enhanced')}
          >
            {t('強調した文字起こし')}
          </button>
        ) : null}
      </div>
      {value !== 'current' ? (
        <p className="muted">
          {t(
            '比較用の文字起こしです。読み取り専用で、検索、翻訳、要約、ToDo の入力には使いません。',
          )}
        </p>
      ) : null}
    </div>
  );
}
