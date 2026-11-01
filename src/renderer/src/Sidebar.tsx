import type { MeetingSummary } from '../../shared/types';
import { useI18n } from './i18n';
import { formatMonthLabel } from './recording-utils';

export type MeetingFilter =
  | 'all'
  | 'processing'
  | 'error'
  | 'recording'
  | `year:${string}`
  | `month:${string}`;

type SidebarProps = {
  meetings: MeetingSummary[];
  view: 'meetings' | 'detail' | 'recording' | 'settings' | 'search';
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
  const { locale, t } = useI18n();
  const processing = meetings.filter(
    (meeting) => meeting.status === 'encoding' || meeting.status === 'transcribing',
  ).length;
  const errors = meetings.filter((meeting) => meeting.status === 'error').length;
  const recording = meetings.filter((meeting) => meeting.status === 'recording').length;
  const groups = new Map<
    number,
    { total: number; months: Map<number, number> }
  >();
  for (const meeting of meetings) {
    const date = new Date(meeting.startedAt);
    if (!Number.isFinite(date.getTime())) {
      continue;
    }
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const group = groups.get(year) ?? { total: 0, months: new Map<number, number>() };
    group.total += 1;
    group.months.set(month, (group.months.get(month) ?? 0) + 1);
    groups.set(year, group);
  }
  const years = [...groups.keys()].sort((left, right) => right - left);
  const isMeetings = view === 'meetings';

  return (
    <nav className="sidebar" aria-label={t('会議の絞り込み')}>
      <p className="side-label">{t('ライブラリ')}</p>
      <button
        type="button"
        className={`side ${isMeetings && filter === 'all' ? 'is-active' : ''}`}
        onClick={() => onFilter('all')}
        data-testid="filter-all"
      >
        {t('すべての会議')}
        <span className="side-count">{meetings.length}</span>
      </button>
      <button
        type="button"
        className={`side ${isMeetings && filter === 'processing' ? 'is-active' : ''}`}
        onClick={() => onFilter('processing')}
      >
        {t('処理中')}
        <span className="side-count">{processing}</span>
      </button>
      <button
        type="button"
        className={`side ${isMeetings && filter === 'recording' ? 'is-active' : ''}`}
        onClick={() => onFilter('recording')}
      >
        {t('録音中')}
        <span className="side-count">{recording}</span>
      </button>
      <button
        type="button"
        className={`side ${isMeetings && filter === 'error' ? 'is-active' : ''}`}
        onClick={() => onFilter('error')}
      >
        {t('エラー')}
        <span className="side-count">{errors}</span>
      </button>

      {years.length > 0 ? (
        <>
          <p className="side-label side-label-spaced">{t('年 / 月')}</p>
          {years.map((year) => {
            const group = groups.get(year);
            if (!group) {
              return null;
            }
            const months = [...group.months.entries()].sort(
              (left, right) => right[0] - left[0],
            );
            return (
              <div className="side-date-group" key={year}>
                <button
                  type="button"
                  className={`side side-year ${isMeetings && filter === `year:${year}` ? 'is-active' : ''}`}
                  onClick={() => onFilter(`year:${year}`)}
                >
                  {year}
                  <span className="side-count">{group.total}</span>
                </button>
                {months.map(([month, count]) => {
                  const key = `${year}-${String(month).padStart(2, '0')}`;
                  return (
                    <button
                      type="button"
                      className={`side side-month ${isMeetings && filter === `month:${key}` ? 'is-active' : ''}`}
                      key={key}
                      onClick={() => onFilter(`month:${key}`)}
                    >
                      {formatMonthLabel(year, month, locale)}
                      <span className="side-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </>
      ) : null}

      <div className="side-spacer" />
      <p className="side-label side-label-spaced">{t('操作')}</p>
      <button
        type="button"
        className={`side ${view === 'recording' ? 'is-active' : ''}`}
        onClick={onOpenRecording}
        data-testid="nav-recording"
      >
        {t('録音パネル')}
      </button>
      <button
        type="button"
        className={`side ${view === 'settings' ? 'is-active' : ''}`}
        onClick={onOpenSettings}
        data-testid="nav-settings"
      >
        {t('設定')}
      </button>
    </nav>
  );
}
