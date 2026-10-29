import type { RecordingStopResult } from '../../shared/types';
import { formatDateTime, formatDuration } from './recording-utils';

type MeetingListProps = {
  lastResult: RecordingStopResult | null;
  onOpenDetail: (result: RecordingStopResult) => void;
};

export function MeetingList({ lastResult, onOpenDetail }: MeetingListProps) {
  return (
    <section className="view-panel" aria-labelledby="meetings-title">
      <div className="view-head">
        <div>
          <p className="section-label">Meetings</p>
          <h2 id="meetings-title">会議一覧</h2>
        </div>
        <span className="panel-note">一覧の本実装は次の issue</span>
      </div>

      {lastResult ? (
        <article className="meeting-card">
          <div className="meeting-main">
            <strong>{formatDateTime(lastResult.startedAt)}</strong>
            <p>
              {formatDuration(lastResult.actualSamples / lastResult.sampleRate)} /{' '}
              {lastResult.hadChunkFailure ? '一部保存' : '変換待ち'}
            </p>
            <p className="path">{lastResult.meetingDir}</p>
          </div>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => onOpenDetail(lastResult)}
          >
            詳細を開く
          </button>
        </article>
      ) : (
        <div className="empty-state">
          <h3>録音した会議はここに表示されます</h3>
          <p>
            会議一覧の本実装は次の issue で追加します。現在は、直近に保存した録音だけを表示します。
          </p>
        </div>
      )}
    </section>
  );
}
