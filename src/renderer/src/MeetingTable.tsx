import type { MeetingSummary } from '../../shared/types';
import {
  formatDuration,
  formatMeetingDate,
  meetingStatusClass,
  meetingStatusLabel,
} from './recording-utils';

type MeetingTableProps = {
  meetings: MeetingSummary[];
  loading: boolean;
  selectedId: string | null;
  isRecording: boolean;
  recordingBusy: boolean;
  onSelect: (meeting: MeetingSummary) => void;
  onRefresh: () => void;
  onToggleRecording: () => void;
};

export function MeetingTable({
  meetings,
  loading,
  selectedId,
  isRecording,
  recordingBusy,
  onSelect,
  onRefresh,
  onToggleRecording,
}: MeetingTableProps) {
  return (
    <section className="meetings-panel" aria-labelledby="meetings-title">
      <div className="table-toolbar">
        <div>
          <p className="section-label">Meetings</p>
          <h1 id="meetings-title" className="table-title">
            会議一覧
          </h1>
        </div>
        <div className="table-actions">
          <button type="button" className="button button-secondary" onClick={onRefresh}>
            再読み込み
          </button>
          <button
            type="button"
            className={`button ${isRecording ? 'button-danger' : 'button-primary'}`}
            onClick={onToggleRecording}
            disabled={recordingBusy}
          >
            {isRecording ? '録音を停止' : '録音を開始'}
          </button>
        </div>
      </div>

      <div className="meeting-table" role="table" aria-label="会議一覧">
        <div className="table-head" role="row">
          <span>日付</span>
          <span>タイトル</span>
          <span className="align-right">長さ</span>
          <span>状態</span>
        </div>

        {loading ? (
          <div className="meeting-empty">会議を読み込んでいます。</div>
        ) : meetings.length === 0 ? (
          <div className="meeting-empty">
            <h2>録音した会議はここに表示されます</h2>
            <p>右側の「録音を開始」から最初の会議を録音できます。</p>
          </div>
        ) : (
          meetings.map((meeting) => (
            <button
              type="button"
              role="row"
              className={`meeting-row ${selectedId === meeting.id ? 'is-selected' : ''}`}
              key={meeting.id}
              onClick={() => onSelect(meeting)}
              data-testid={`meeting-${meeting.id}`}
            >
              <span className="meeting-date">
                {formatMeetingDate(meeting.startedAt)}
              </span>
              <span className="meeting-name">{meeting.title}</span>
              <span className="meeting-duration">
                {formatDuration(meeting.duration)}
              </span>
              <span className={`status-chip ${meetingStatusClass(meeting.status)}`}>
                {meetingStatusLabel(meeting.status)}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
