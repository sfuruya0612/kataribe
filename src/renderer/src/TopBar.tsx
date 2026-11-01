import type { RecordingAppState } from '../../shared/types';
import appIcon from './assets/app-icon.png';
import { useI18n, type I18nValue } from './i18n';
import { formatDuration, inputSourceLabel } from './recording-utils';

type TopBarProps = {
  appState: RecordingAppState;
  saveRoot: string;
  meetingCount: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onToggleRecording: () => void;
};

function statusLabel(state: RecordingAppState, t: I18nValue['t']): string {
  switch (state.status) {
    case 'starting':
      return t('準備中');
    case 'recording':
      return t('録音中');
    case 'stopping':
      return t('保存中');
    case 'encoding':
      return t('変換待ち');
    case 'error':
      return t('エラー');
    default:
      return t('待機中');
  }
}

function compactPath(path: string): string {
  const home = '/Users/';
  if (path.startsWith(home)) {
    const parts = path.split('/');
    return `~/${parts.slice(3).join('/')}`;
  }
  return path;
}

export function TopBar({
  appState,
  saveRoot,
  meetingCount,
  searchQuery,
  onSearchChange,
  onToggleRecording,
}: TopBarProps) {
  const { locale, t, tc } = useI18n();
  const isRecording = appState.status === 'recording';
  const isBusy = appState.status === 'starting' || appState.status === 'stopping';

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <img className="titlebar-icon" src={appIcon} alt="" aria-hidden="true" />
        <span className="titlebar-name">Kataribe</span>
        <span className="titlebar-path" title={saveRoot}>
          {compactPath(saveRoot)} ·{' '}
          {tc(meetingCount, '1 件の会議', '{count} 件の会議')}
        </span>
      </div>
      <label className="titlebar-search">
        <span className="visually-hidden">{t('会議を検索')}</span>
        <input
          type="search"
          className="titlebar-search-input"
          value={searchQuery}
          placeholder={t('文字起こし・要約を検索')}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
      <span className="titlebar-spacer" />
      <span className={`status-chip status-${appState.status}`}>
        {statusLabel(appState, t)}
      </span>
      <span className="titlebar-source">
        {inputSourceLabel(appState.inputSource, locale)}
      </span>
      {isRecording ? (
        <span className="titlebar-timer">{formatDuration(appState.elapsedSeconds)}</span>
      ) : null}
      <button
        type="button"
        className={`record-button ${isRecording ? 'is-stopping' : ''}`}
        onClick={onToggleRecording}
        disabled={isBusy}
        data-testid="topbar-record"
      >
        {isRecording ? t('停止') : isBusy ? t('処理中') : t('録音を開始')}
      </button>
    </header>
  );
}
