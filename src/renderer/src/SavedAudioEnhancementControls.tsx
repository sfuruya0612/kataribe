import { useI18n } from './i18n';

type SavedAudioEnhancementControlsProps = {
  enabled: boolean;
  busy: boolean;
  progress: number | null;
  error: string | null;
  notice: string | null;
  inputDiffers: boolean;
  onRun: () => void;
  onCancel: () => void;
};

/**
 * 会議詳細から保存音声の強調を再実行する操作を表示する。
 */
export function SavedAudioEnhancementControls({
  enabled,
  busy,
  progress,
  error,
  notice,
  inputDiffers,
  onRun,
  onCancel,
}: SavedAudioEnhancementControlsProps) {
  const { t } = useI18n();
  return (
    <div className="saved-audio-enhancement">
      <button
        type="button"
        className="button button-secondary"
        disabled={!enabled || busy}
        onClick={onRun}
      >
        {t('保存音声の強調を再実行')}
      </button>
      {busy ? (
        <span className="model-progress">
          <span className="progress-track model-progress-track">
            <span
              className="progress-bar"
              style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
            />
          </span>
          <span className="mono">{Math.round((progress ?? 0) * 100)}%</span>
          <button type="button" className="link-button" onClick={onCancel}>
            {t('中止')}
          </button>
        </span>
      ) : null}
      {inputDiffers ? (
        <p className="muted">
          {t(
            '再実行の入力は audio.mp3 から作るため、録音直後の強調とは入力が異なります。',
          )}
        </p>
      ) : null}
      {error ? <p className="alert alert-error">{error}</p> : null}
      {notice ? <p className="notice-text">{notice}</p> : null}
    </div>
  );
}
