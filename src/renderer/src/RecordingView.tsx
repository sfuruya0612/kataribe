import type { RecordingStopResult } from '../../shared/types';
import { LevelPanel } from './LevelPanel';
import { RecordingPanel } from './RecordingPanel';
import { RecoveryPanel } from './RecoveryPanel';
import { ResultPanel } from './ResultPanel';
import type { RecorderController } from './use-recorder';

type RecordingViewProps = {
  recorder: RecorderController;
  onOpenDetail: (result: RecordingStopResult) => void;
  onOpenReadme: () => void;
};

export function RecordingView({
  recorder,
  onOpenDetail,
  onOpenReadme,
}: RecordingViewProps) {
  const appState = recorder.appState;

  return (
    <div className="recording-view">
      <div className="recording-intro">
        <div>
          <p className="section-label">Recorder</p>
          <h1 className="page-title">録音</h1>
        </div>
        <p className="muted">
          メニューバーまたはこの画面から録音を開始できます。録音中にウィンドウを閉じても録音は続きます。
        </p>
      </div>

      <div className="recording-grid">
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
          onOpenReadme={onOpenReadme}
          onSetInputSource={(source) => void recorder.setInputSource(source)}
        />
        <LevelPanel
          status={appState.status}
          chunkCount={appState.chunkCount}
          clipping={appState.clipping}
          silence={appState.silence}
        />
      </div>

      {appState.lastResult ? (
        <ResultPanel
          result={appState.lastResult}
          onOpenFolder={() => void recorder.openFolder()}
          onOpenDetail={() => onOpenDetail(appState.lastResult as RecordingStopResult)}
        />
      ) : null}

      <RecoveryPanel
        recordings={recorder.recoverable}
        recoveringId={recorder.recoveringId}
        onRecover={(recording) => void recorder.recover(recording)}
      />
    </div>
  );
}
