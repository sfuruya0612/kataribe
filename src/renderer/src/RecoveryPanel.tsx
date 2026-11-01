import type { RecoverableRecording } from '../../shared/types';
import { useI18n } from './i18n';
import { formatDateTime, inputSourceLabel } from './recording-utils';

type RecoveryPanelProps = {
  recordings: RecoverableRecording[];
  recoveringId: string | null;
  onRecover: (recording: RecoverableRecording) => void;
};

export function RecoveryPanel({
  recordings,
  recoveringId,
  onRecover,
}: RecoveryPanelProps) {
  const { locale, t, tc } = useI18n();
  if (recordings.length === 0) {
    return null;
  }

  return (
    <section className="panel recovery-panel" aria-labelledby="recovery-title">
      <div className="panel-head">
        <div>
          <p className="section-label">{t('復旧')}</p>
          <h2 id="recovery-title">{t('復旧できる録音')}</h2>
        </div>
        <span className="state state-error">
          {tc(recordings.length, '1 件の録音', '{count} 件の録音')}
        </span>
      </div>
      <p className="muted">
        {t(
          '前回の終了時に残ったチャンクがあります。復旧すると 1 つの WAV に結合します。',
        )}
      </p>
      <ul className="recovery-list" data-testid="recovery-list">
        {recordings.map((recording) => (
          <li key={recording.meetingId} className="recovery-item">
            <div>
              <strong>{formatDateTime(recording.startedAt, locale)}</strong>
              <p>
                {inputSourceLabel(recording.inputSource, locale)} /{' '}
                {tc(recording.chunks, '1 チャンク', '{count} チャンク')} /{' '}
                {t('{seconds} 秒相当', {
                  seconds: (recording.actualSamples / recording.sampleRate).toFixed(1),
                })}
              </p>
              <p className="path">{recording.meetingDir}</p>
            </div>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => onRecover(recording)}
              disabled={recoveringId !== null}
              data-testid={`recover-${recording.meetingId}`}
            >
              {recoveringId === recording.meetingId
                ? t('復旧しています...')
                : t('復旧する')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
