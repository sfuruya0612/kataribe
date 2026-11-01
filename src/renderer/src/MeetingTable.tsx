import type { MeetingSummary } from '../../shared/types';
import { useI18n } from './i18n';
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
  onImportAudio: () => void;
  onSetPinned: (meeting: MeetingSummary, pinned: boolean) => void;
  onDeleteMeeting: (meeting: MeetingSummary) => void;
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
  onImportAudio,
  onSetPinned,
  onDeleteMeeting,
}: MeetingTableProps) {
  const { locale, t } = useI18n();
  return (
    <section className="meetings-panel" aria-labelledby="meetings-title">
      <div className="table-toolbar">
        <div>
          <p className="section-label">{t('会議')}</p>
          <h1 id="meetings-title" className="table-title">
            {t('会議一覧')}
          </h1>
        </div>
        <div className="table-actions">
          <button type="button" className="button button-secondary" onClick={onImportAudio}>
            {t('音声を取り込む')}
          </button>
          <button type="button" className="button button-secondary" onClick={onRefresh}>
            {t('再読み込み')}
          </button>
          <button
            type="button"
            className={`button ${isRecording ? 'button-danger' : 'button-primary'}`}
            onClick={onToggleRecording}
            disabled={recordingBusy}
          >
            {isRecording ? t('録音を停止') : t('録音を開始')}
          </button>
        </div>
      </div>

      <div className="meeting-table" role="table" aria-label={t('会議一覧')}>
        <div className="table-head" role="row">
          <span>{t('日付')}</span>
          <span>{t('タイトル')}</span>
          <span className="align-right">{t('長さ')}</span>
          <span>{t('状態')}</span>
          <span className="align-right">{t('操作')}</span>
        </div>

        {loading ? (
          <div className="meeting-empty">{t('会議を読み込んでいます。')}</div>
        ) : meetings.length === 0 ? (
          <div className="meeting-empty">
            <h2>{t('録音した会議はここに表示されます')}</h2>
            <p>{t('右側の「録音を開始」から最初の会議を録音できます。')}</p>
          </div>
        ) : (
          meetings.map((meeting) => (
            <div
              role="row"
              className={`meeting-row ${selectedId === meeting.id ? 'is-selected' : ''}`}
              key={meeting.id}
            >
              <button
                type="button"
                className="meeting-row-main"
                onClick={() => onSelect(meeting)}
                data-testid={`meeting-${meeting.id}`}
              >
                <span className="meeting-date">
                  {formatMeetingDate(meeting.startedAt, locale)}
                </span>
                <span className="meeting-name">
                  {meeting.pinned ? <span className="pin-mark">★</span> : null}
                  {meeting.title}
                </span>
                <span className="meeting-duration">
                  {formatDuration(meeting.duration)}
                </span>
                <span className={`status-chip ${meetingStatusClass(meeting.status)}`}>
                  {meetingStatusLabel(meeting.status, locale)}
                </span>
              </button>
              <span className="meeting-row-actions">
                <button
                  type="button"
                  className={`icon-button pin-button ${meeting.pinned ? 'is-pinned' : ''}`}
                  aria-label={meeting.pinned ? t('Pin を解除') : t('Pin 止め')}
                  title={meeting.pinned ? t('Pin を解除') : t('Pin 止め')}
                  onClick={() => onSetPinned(meeting, !meeting.pinned)}
                >
                  {meeting.pinned ? '★' : '☆'}
                </button>
                <button
                  type="button"
                  className="icon-button delete-button"
                  aria-label={t('会議を削除')}
                  title={t('会議を削除')}
                  onClick={() => onDeleteMeeting(meeting)}
                >
                  ×
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
