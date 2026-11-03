import { ENHANCEMENT_STATE_MESSAGE_KEYS } from '../../shared/i18n';
import type {
  EnhancementFile,
  EnhancementState,
  EnhancementTranscriptionEntry,
} from '../../shared/types';
import { REUSE_MODELS } from '../../shared/types';
import { useI18n } from './i18n';

type EnhancementStatusProps = {
  enhancement: EnhancementFile | null;
  warning: string | null;
};

function stateClass(state: EnhancementState): string {
  if (state === 'succeeded') {
    return 'status-summarized';
  }
  if (state === 'failed' || state === 'interrupted') {
    return 'status-error';
  }
  if (state === 'running') {
    return 'status-transcribing';
  }
  return 'status-idle';
}

/**
 * 音声強調の状態、処理時間、使用モデルを表示する。
 */
export function EnhancementStatus({
  enhancement,
  warning,
}: EnhancementStatusProps) {
  const { t } = useI18n();
  if (!enhancement && !warning) {
    return null;
  }
  const savedAudio = enhancement
    ? REUSE_MODELS.flatMap((model) => {
        const entry = enhancement.saved_audio[model];
        return entry ? [{ model, entry }] : [];
      })
    : [];
  const raw = enhancement?.transcription.raw;
  const enhancedModels = enhancement
    ? REUSE_MODELS.flatMap((model) => {
        const entry = enhancement.transcription.models[model];
        return entry ? [{ model, entry }] : [];
      })
    : [];
  const hasComparison =
    enhancement !== null &&
    (enhancement.transcription.source_input_sha256 !== null ||
      enhancedModels.length > 0);

  const renderEntry = (
    entry: EnhancementTranscriptionEntry,
    label: string,
    key: string,
  ) => (
    <div className="model-row" key={key}>
      <span className="model-name-group">
        <span>{label}</span>
        <span className={`status-chip ${stateClass(entry.state)}`}>
          {t(ENHANCEMENT_STATE_MESSAGE_KEYS[entry.state])}
        </span>
        {entry.elapsed_seconds !== null ? (
          <span className="muted">
            {t('処理時間 {seconds} 秒', {
              seconds: Math.round(entry.elapsed_seconds),
            })}
          </span>
        ) : null}
        {entry.model ? (
          <span className="muted">
            {t('使用モデル {model}', { model: entry.model })}
          </span>
        ) : null}
        {entry.error ? <span className="error-text">{entry.error}</span> : null}
      </span>
    </div>
  );

  return (
    <section className="detail-enhancement" aria-label={t('音声強調の状態')}>
      <strong>{t('音声強調の状態')}</strong>
      {warning ? (
        <p className="alert alert-warning" role="status">
          {t('音声強調の状態を読み込めませんでした。')}
          {warning}
        </p>
      ) : null}
      {savedAudio.length > 0 ? (
        <div className="setting-card">
          <p className="settings-label">{t('保存音声の強調')}</p>
          {savedAudio.map(({ model, entry }) => (
            <div className="model-row" key={`saved-${model}`}>
              <span className="model-name-group">
                <span className="mono">{model}</span>
                <span className={`status-chip ${stateClass(entry.state)}`}>
                  {t(ENHANCEMENT_STATE_MESSAGE_KEYS[entry.state])}
                </span>
                {entry.elapsed_seconds !== null ? (
                  <span className="muted">
                    {t('処理時間 {seconds} 秒', {
                      seconds: Math.round(entry.elapsed_seconds),
                    })}
                  </span>
                ) : null}
                {entry.error ? (
                  <span className="error-text">{entry.error}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {hasComparison ? (
        <div className="setting-card">
          <p className="settings-label">{t('文字起こし前の強調')}</p>
          {raw && raw.state !== 'pending'
            ? renderEntry(raw, t('文字起こし前の強調'), 'raw')
            : null}
          {enhancedModels.map(({ model, entry }) =>
            renderEntry(entry, model, `comparison-${model}`),
          )}
        </div>
      ) : null}
      {enhancement &&
      savedAudio.length === 0 &&
      !hasComparison &&
      !warning ? (
        <p className="muted">{t('音声強調はまだ実行されていません。')}</p>
      ) : null}
    </section>
  );
}
