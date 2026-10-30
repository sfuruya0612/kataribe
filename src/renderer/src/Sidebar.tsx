import type { MeetingSummary } from '../../shared/types';

export type MeetingFilter =
  | 'all'
  | 'processing'
  | 'error'
  | 'recording'
  | `year:${string}`;

type SidebarProps = {
  meetings: MeetingSummary[];
  view: 'meetings' | 'detail' | 'recording' | 'settings';
  filter: MeetingFilter;
  onFilter: (filter: MeetingFilter) => void;
  onOpenRecording: () => void;
  onOpenSettings: () => void;
};

export function Sidebar({
  meetings,
  view,
  filter,
  onFilter,
  onOpenRecording,
  onOpenSettings,
}: SidebarProps) {
  const processing = meetings.filter(
    (meeting) => meeting.status === 'encoding' || meeting.status === 'transcribing',
  ).length;
  const errors = meetings.filter((meeting) => meeting.status === 'error').length;
  const recording = meetings.filter((meeting) => meeting.status === 'recording').length;
  const years = [...new Set(
    meetings
      .map((meeting) => new Date(meeting.startedAt).getFullYear())
      .filter((year) => Number.isFinite(year)),
  )].sort((left, right) => right - left);
  const isMeetings = view === 'meetings';

  return (
    <nav className="sidebar" aria-label="会議の絞り込み">
      <p className="side-label">Library</p>
      <button
        type="button"
        className={`side ${isMeetings && filter === 'all' ? 'is-active' : ''}`}
        onClick={() => onFilter('all')}
        data-testid="filter-all"
      >
        すべての会議
        <span className="side-count">{meetings.length}</span>
      </button>
      <button
        type="button"
        className={`side ${isMeetings && filter === 'processing' ? 'is-active' : ''}`}
        onClick={() => onFilter('processing')}
      >
        処理中
        <span className="side-count">{processing}</span>
      </button>
      <button
        type="button"
        className={`side ${isMeetings && filter === 'recording' ? 'is-active' : ''}`}
        onClick={() => onFilter('recording')}
      >
        録音中
        <span className="side-count">{recording}</span>
      </button>
      <button
        type="button"
        className={`side ${isMeetings && filter === 'error' ? 'is-active' : ''}`}
        onClick={() => onFilter('error')}
      >
        エラー
        <span className="side-count">{errors}</span>
      </button>

      {years.length > 0 ? (
        <>
          <p className="side-label side-label-spaced">Year</p>
          {years.map((year) => (
            <button
              type="button"
              className={`side ${isMeetings && filter === `year:${year}` ? 'is-active' : ''}`}
              key={year}
              onClick={() => onFilter(`year:${year}`)}
            >
              {year}
              <span className="side-count">
                {
                  meetings.filter(
                    (meeting) =>
                      new Date(meeting.startedAt).getFullYear() === year,
                  ).length
                }
              </span>
            </button>
          ))}
        </>
      ) : null}

      <div className="side-spacer" />
      <p className="side-label side-label-spaced">Actions</p>
      <button
        type="button"
        className={`side ${view === 'recording' ? 'is-active' : ''}`}
        onClick={onOpenRecording}
        data-testid="nav-recording"
      >
        録音パネル
      </button>
      <button
        type="button"
        className={`side ${view === 'settings' ? 'is-active' : ''}`}
        onClick={onOpenSettings}
        data-testid="nav-settings"
      >
        設定
      </button>
    </nav>
  );
}
