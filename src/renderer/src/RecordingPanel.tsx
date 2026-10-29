import type {
  InputSource,
  RecordingAppStatus,
  RecordingEvent,
  RecordingSession,
} from '../../shared/types';
import {
  deviceLabel,
  formatDuration,
  type InputDevice,
} from './recording-utils';
import type { PermissionState } from './use-recorder';

type RecordingPanelProps = {
  status: RecordingAppStatus;
  inputSource: InputSource;
  session: RecordingSession | null;
  elapsedSeconds: number;
  error: string | null;
  warning: string | null;
  uiError: string | null;
  notice: RecordingEvent | null;
  permission: PermissionState;
  microphones: InputDevice[];
  systemDevices: InputDevice[];
  micDeviceId: string;
  systemDeviceId: string;
  onMicDeviceChange: (deviceId: string) => void;
  onSystemDeviceChange: (deviceId: string) => void;
  onRequestStart: () => void;
  onRequestStop: () => void;
  onRequestPermission: () => void;
  onOpenMicrophoneSettings: () => void;
  onSetInputSource: (source: InputSource) => void;
};

const sourceOptions: Array<{ value: InputSource; label: string }> = [
  { value: 'microphone', label: 'マイク' },
  { value: 'system', label: 'システム音声' },
  { value: 'both', label: '両方' },
];

function phaseTitle(status: RecordingAppStatus): string {
  switch (status) {
    case 'starting':
      return '録音を準備しています';
    case 'recording':
      return '録音中';
    case 'stopping':
      return '録音を保存しています';
    case 'encoding':
      return '録音を保存しました';
    case 'error':
      return '録音でエラーが発生しました';
    default:
      return '録音の準備';
  }
}

function phaseLabel(status: RecordingAppStatus): string {
  switch (status) {
    case 'starting':
      return '準備中';
    case 'recording':
      return 'REC';
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

export function RecordingPanel({
  status,
  inputSource,
  session,
  elapsedSeconds,
  error,
  warning,
  uiError,
  notice,
  permission,
  microphones,
  systemDevices,
  micDeviceId,
  systemDeviceId,
  onMicDeviceChange,
  onSystemDeviceChange,
  onRequestStart,
  onRequestStop,
  onRequestPermission,
  onOpenMicrophoneSettings,
  onSetInputSource,
}: RecordingPanelProps) {
  const isRecording = status === 'recording';
  const isBusy = status === 'starting' || status === 'stopping';
  const canStart = status === 'idle' || status === 'encoding' || status === 'error';
  const needsMicrophone = inputSource !== 'system';
  const needsSystem = inputSource !== 'microphone';
  const controlsDisabled = isRecording || isBusy;
  const sourceDisabled = isBusy;
  const sourceChanged = session !== null && session.inputSource !== inputSource;
  const microphoneAvailable = microphones.length > 0;
  const systemAvailable = systemDevices.length > 0;
  const permissionDenied = permission === 'denied' || permission === 'restricted';

  const permissionMessage =
    permission === 'granted'
      ? 'マイク権限: 許可済み'
      : permission === 'requesting'
        ? 'マイク権限: 確認中'
        : permission === 'denied' || permission === 'restricted'
          ? 'マイク権限: 拒否'
          : permission === 'not-determined'
            ? 'マイク権限: 未確認'
            : 'マイク権限: 不明';

  return (
    <section
      className={`panel recorder-panel ${isRecording ? 'is-recording' : ''}`}
      aria-labelledby="recorder-title"
    >
      <div className="panel-head">
        <div>
          <p className="section-label">Recorder</p>
          <h2 id="recorder-title">{phaseTitle(status)}</h2>
        </div>
        <span className={`state state-${status}`} data-testid="recording-state">
          {phaseLabel(status)}
        </span>
      </div>

      <div className="timer-row">
        <span className="timer" data-testid="elapsed">
          {formatDuration(elapsedSeconds)}
        </span>
        <span className="timer-caption">
          {isRecording
            ? '録音中'
            : status === 'encoding'
              ? '保存した音声の長さ'
              : '録音は停止しています'}
        </span>
      </div>

      <fieldset className="source-picker" disabled={sourceDisabled}>
        <legend>入力ソース</legend>
        {sourceOptions.map((option) => {
          const unavailable =
            permissionDenied ||
            (option.value === 'microphone' && !microphoneAvailable) ||
            (option.value === 'system' && !systemAvailable) ||
            (option.value === 'both' && (!microphoneAvailable || !systemAvailable));
          return (
            <label className="source-option" key={option.value}>
              <input
                type="radio"
                name="input-source"
                value={option.value}
                checked={inputSource === option.value}
                onChange={() => onSetInputSource(option.value)}
                disabled={unavailable}
                data-testid={`source-${option.value}`}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </fieldset>

      {sourceChanged ? (
        <p className="hint">
          入力ソースを変更しました。この変更は次の録音から適用されます。
        </p>
      ) : null}

      <div className="device-grid">
        <label className="field">
          <span>マイク</span>
          <select
            value={micDeviceId}
            onChange={(event) => onMicDeviceChange(event.target.value)}
            disabled={
              controlsDisabled ||
              permissionDenied ||
              !needsMicrophone ||
              microphones.length === 0
            }
            data-testid="mic-select"
          >
            {microphones.length === 0 ? (
              <option value="">マイクが見つかりません</option>
            ) : (
              microphones.map((device, index) => (
                <option value={device.deviceId} key={device.deviceId}>
                  {deviceLabel(device, `マイク ${index + 1}`)}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="field">
          <span>システム音声（BlackHole 2ch）</span>
          <select
            value={systemDeviceId}
            onChange={(event) => onSystemDeviceChange(event.target.value)}
            disabled={
              controlsDisabled ||
              permissionDenied ||
              !needsSystem ||
              systemDevices.length === 0
            }
            data-testid="system-select"
          >
            {systemDevices.length === 0 ? (
              <option value="">BlackHole 2ch が見つかりません</option>
            ) : (
              systemDevices.map((device) => (
                <option value={device.deviceId} key={device.deviceId}>
                  {deviceLabel(device, 'BlackHole 2ch')}
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      <div className="permission-row">
        <span className={`permission permission-${permission}`}>{permissionMessage}</span>
        {permission !== 'granted' ? (
          <button
            type="button"
            className="link-button"
            onClick={onRequestPermission}
            disabled={permission === 'requesting' || controlsDisabled}
          >
            マイク権限を確認する
          </button>
        ) : null}
        {permissionDenied ? (
          <button
            type="button"
            className="link-button"
            onClick={onOpenMicrophoneSettings}
            disabled={controlsDisabled}
          >
            システム設定を開く
          </button>
        ) : null}
      </div>

      {permissionDenied ? (
        <div className="alert alert-error" role="alert">
          マイク権限が拒否されています。システム設定の「プライバシーとセキュリティ」&gt;「マイク」で
          Kataribe を許可してください。
        </div>
      ) : null}

      {needsMicrophone && !microphoneAvailable ? (
        <p className="hint">
          マイクが見つかりません。マイクを接続し、マイク権限を確認してください。
        </p>
      ) : null}

      {needsSystem && systemDevices.length === 0 ? (
        <p className="hint">
          BlackHole 2ch が見つかりません。設定画面のセットアップ手順を確認してください。
        </p>
      ) : null}



      <div className="recorder-actions">
        {isRecording || status === 'stopping' ? (
          <button
            type="button"
            className="button button-danger"
            onClick={onRequestStop}
            disabled={status === 'stopping'}
            data-testid="stop-button"
          >
            {status === 'stopping' ? '保存しています...' : '録音を停止'}
          </button>
        ) : (
          <button
            type="button"
            className="button button-primary"
            onClick={onRequestStart}
            disabled={!canStart}
            data-testid="start-button"
          >
            {status === 'starting' ? '準備しています...' : '録音を開始'}
          </button>
        )}
        {session ? (
          <span className="path-inline" data-testid="active-path">
            保存先: {session.meetingDir}
          </span>
        ) : null}
      </div>

      {error && !permissionDenied ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice && notice.message !== error ? (
        <p
          className={`alert ${
            notice.severity === 'error' ? 'alert-error' : 'alert-warning'
          }`}
          role="status"
        >
          {notice.message}
        </p>
      ) : null}
      {uiError ? (
        <p className="alert alert-error" role="alert">
          {uiError}
        </p>
      ) : null}
      {warning ? (
        <p className="alert alert-warning" role="status">
          {warning}
        </p>
      ) : null}
    </section>
  );
}
