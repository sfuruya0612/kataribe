import { useEffect, useState } from 'react';
import type {
  AppInfo,
  RecordingAppStatus,
  RecordingStopResult,
} from '../../shared/types';
import { LevelPanel } from './LevelPanel';
import { MeetingDetail } from './MeetingDetail';
import { MeetingList } from './MeetingList';
import { RecordingPanel } from './RecordingPanel';
import { RecoveryPanel } from './RecoveryPanel';
import { ResultPanel } from './ResultPanel';
import { SettingsPanel } from './SettingsPanel';
import {
  errorText,
  formatDuration,
  inputSourceLabel,
} from './recording-utils';
import { useRecorder } from './use-recorder';

type View = 'meetings' | 'detail' | 'settings';

function statusBadge(status: RecordingAppStatus): string {
  switch (status) {
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

export default function App() {
  const recorder = useRecorder();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [view, setView] = useState<View>('meetings');
  const [selectedResult, setSelectedResult] = useState<RecordingStopResult | null>(null);
  const [shellError, setShellError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.kataribe
      .getAppInfo()
      .then((value) => {
        if (!cancelled) {
          setInfo(value);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setInfoError(`アプリ情報の取得に失敗しました: ${errorText(reason)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openDetail = (result: RecordingStopResult) => {
    setSelectedResult(result);
    setView('detail');
  };

  const runShellAction = async (action: () => Promise<void>) => {
    try {
      await action();
      setShellError(null);
    } catch (reason: unknown) {
      setShellError(`操作に失敗しました: ${errorText(reason)}`);
    }
  };

  const appState = recorder.appState;
  const lastResult = appState.lastResult;
  const detailResult = selectedResult ?? lastResult;
  const saveRoot = info?.saveRoot ?? '~/Documents/Kataribe';

  return (
    <main className="app">
      <header className="app-header">
        <div className="header-copy">
          <p className="eyebrow">Kataribe</p>
          <h1>会議の録音</h1>
          <p className="lead">
            メニューバーから録音を開始し、マイクと BlackHole 2ch の音声を 1
            つの会議フォルダにまとめます。
          </p>
        </div>
        <div className="header-meta">
          <span className={`state state-${appState.status}`} data-testid="header-state">
            {statusBadge(appState.status)}
          </span>
          <span className="version">{info ? `v${info.version}` : 'v...'}</span>
        </div>
      </header>

      <div className="recording-layout">
        <RecordingPanel
          status={appState.status}
          inputSource={appState.inputSource}
          session={appState.session}
          elapsedSeconds={appState.elapsedSeconds}
          error={appState.error}
          warning={recorder.warning}
          uiError={recorder.uiError}
          notice={appState.notice}
          permission={recorder.permission}
          microphones={recorder.microphones}
          systemDevices={recorder.systemDevices}
          micDeviceId={recorder.micDeviceId}
          systemDeviceId={recorder.systemDeviceId}
          onMicDeviceChange={recorder.setMicDeviceId}
          onSystemDeviceChange={recorder.setSystemDeviceId}
          onRequestStart={() => void recorder.requestStart()}
          onRequestStop={() => void recorder.requestStop()}
          onRequestPermission={() => void recorder.requestPermission()}
          onOpenMicrophoneSettings={() => void recorder.openMicrophoneSettings()}
          onOpenReadme={() => void runShellAction(() => window.kataribe.openReadme())}
          onSetInputSource={(source) => void recorder.setInputSource(source)}
        />
        <LevelPanel status={appState.status} chunkCount={appState.chunkCount} />
      </div>

      {lastResult ? (
        <ResultPanel
          result={lastResult}
          onOpenFolder={() => void recorder.openFolder()}
          onOpenDetail={() => openDetail(lastResult)}
        />
      ) : null}

      <RecoveryPanel
        recordings={recorder.recoverable}
        recoveringId={recorder.recoveringId}
        onRecover={(recording) => void recorder.recover(recording)}
      />

      <div className="workspace">
        <aside className="sidebar" aria-label="画面の切り替え">
          <p className="sidebar-label">メニュー</p>
          <button
            type="button"
            className={`nav-button ${view === 'meetings' ? 'is-active' : ''}`}
            onClick={() => setView('meetings')}
            data-testid="nav-meetings"
          >
            会議一覧
          </button>
          <button
            type="button"
            className={`nav-button ${view === 'detail' ? 'is-active' : ''}`}
            onClick={() => setView('detail')}
            data-testid="nav-detail"
          >
            会議詳細
          </button>
          <button
            type="button"
            className={`nav-button ${view === 'settings' ? 'is-active' : ''}`}
            onClick={() => setView('settings')}
            data-testid="nav-settings"
          >
            設定
          </button>

          <div className="sidebar-status">
            <span>録音状態</span>
            <strong>{statusBadge(appState.status)}</strong>
            <span>経過時間</span>
            <strong>{formatDuration(appState.elapsedSeconds)}</strong>
            <span>入力ソース</span>
            <strong>{inputSourceLabel(appState.inputSource)}</strong>
          </div>
        </aside>

        <div className="view-area">
          {view === 'meetings' ? (
            <MeetingList lastResult={appState.lastResult} onOpenDetail={openDetail} />
          ) : null}
          {view === 'detail' ? <MeetingDetail result={detailResult} /> : null}
          {view === 'settings' ? (
            <SettingsPanel
              saveRoot={saveRoot}
              version={info?.version ?? '0.1.0'}
              inputSource={appState.inputSource}
              permission={recorder.permission}
              microphones={recorder.microphones}
              systemDevices={recorder.systemDevices}
              onSetInputSource={(source) => void recorder.setInputSource(source)}
              onRequestPermission={() => void recorder.requestPermission()}
              onOpenMicrophoneSettings={() => void recorder.openMicrophoneSettings()}
              onOpenReadme={() => void runShellAction(() => window.kataribe.openReadme())}
              onOpenBlackHoleSite={() =>
                void runShellAction(() => window.kataribe.openBlackHoleSite())
              }
              onShowAbout={() => void runShellAction(() => window.kataribe.showAbout())}
            />
          ) : null}
        </div>
      </div>

      {infoError ? (
        <p className="alert alert-error" role="alert">
          {infoError}
        </p>
      ) : null}
      {shellError ? (
        <p className="alert alert-error" role="alert">
          {shellError}
        </p>
      ) : null}

      <footer className="app-footer">
        <span>macOS 14.2 以降 / Apple Silicon</span>
        <span>保存先: {saveRoot}</span>
      </footer>
    </main>
  );
}
