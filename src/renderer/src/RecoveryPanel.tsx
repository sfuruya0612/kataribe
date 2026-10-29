import type { RecoverableRecording } from '../../shared/types';
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
  if (recordings.length === 0) {
    return null;
  }

  return (
    <section className="panel recovery-panel" aria-labelledby="recovery-title">
      <div className="panel-head">
        <div>
          <p className="section-label">Recovery</p>
          <h2 id="recovery-title">復旧できる録音</h2>
        </div>
        <span className="state state-error">{recordings.length} 件</span>
      </div>
      <p className="muted">
        前回の終了時に残ったチャンクがあります。復旧すると 1 つの WAV に結合します。
      </p>
      <ul className="recovery-list" data-testid="recovery-list">
        {recordings.map((recording) => (
          <li key={recording.meetingId} className="recovery-item">
            <div>
              <strong>{formatDateTime(recording.startedAt)}</strong>
              <p>
                {inputSourceLabel(recording.inputSource)} / {recording.chunks} チャンク /{' '}
                {(recording.actualSamples / recording.sampleRate).toFixed(1)} 秒相当
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
              {recoveringId === recording.meetingId ? '復旧しています...' : '復旧する'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
