import type { RecordingAppState } from '../../shared/types';
import { formatDuration, inputSourceLabel } from './recording-utils';

type TopBarProps = {
  appState: RecordingAppState;
  saveRoot: string;
  meetingCount: number;
  onToggleRecording: () => void;
};

function statusLabel(state: RecordingAppState): string {
  switch (state.status) {
    case 'starting':
      return '準備中';
    case 'recording':
      return '録音中';
    case 'stopping':
      return '保存中';
    case 'encoding':
      return '変換待ち';
    case 'error':
      return 'エラー';
    default:
      return '待機中';
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
  onToggleRecording,
}: TopBarProps) {
  const isRecording = appState.status === 'recording';
  const isBusy = appState.status === 'starting' || appState.status === 'stopping';

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="titlebar-name">Kataribe</span>
        <span className="titlebar-path" title={saveRoot}>
          {compactPath(saveRoot)} · {meetingCount} 件
        </span>
      </div>
      <span className="titlebar-spacer" />
      <span className={`status-chip status-${appState.status}`}>
        {statusLabel(appState)}
      </span>
      <span className="titlebar-source">{inputSourceLabel(appState.inputSource)}</span>
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
        {isRecording ? '停止' : isBusy ? '処理中' : '録音を開始'}
      </button>
    </header>
  );
}
