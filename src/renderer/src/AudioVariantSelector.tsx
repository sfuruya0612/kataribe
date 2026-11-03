import { useI18n } from './i18n';

export type AudioVariant = 'raw' | 'enhanced';

type AudioVariantSelectorProps = {
  value: AudioVariant;
  hasEnhanced: boolean;
  onChange: (value: AudioVariant) => void;
};

/**
 * 生音声と強調音声の再生を切り替える。
 */
export function AudioVariantSelector({
  value,
  hasEnhanced,
  onChange,
}: AudioVariantSelectorProps) {
  const { t } = useI18n();
  if (!hasEnhanced) {
    return null;
  }
  return (
    <div
      className="audio-variant-selector"
      role="group"
      aria-label={t('音声の種類')}
    >
      <button
        type="button"
        className={`link-button ${value === 'raw' ? 'is-active' : ''}`}
        aria-pressed={value === 'raw'}
        onClick={() => onChange('raw')}
      >
        {t('生音声')}
      </button>
      <button
        type="button"
        className={`link-button ${value === 'enhanced' ? 'is-active' : ''}`}
        aria-pressed={value === 'enhanced'}
        onClick={() => onChange('enhanced')}
      >
        {t('強調音声')}
      </button>
    </div>
  );
}
