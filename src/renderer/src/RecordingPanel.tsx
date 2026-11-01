import type {
  InputSource,
  RecordingAppStatus,
  RecordingEvent,
  RecordingSession,
} from '../../shared/types';
import { useI18n, type I18nValue } from './i18n';
import { INPUT_SOURCES } from '../../shared/i18n';
import {
  deviceLabel,
  formatDuration,
  inputSourceLabel,
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
  onOpenReadme: () => void;
  onSetInputSource: (source: InputSource) => void;
};

const sourceOptions = INPUT_SOURCES;

function phaseTitle(status: RecordingAppStatus, t: I18nValue['t']): string {
  switch (status) {
    case 'starting':
      return t('録音を準備しています');
    case 'recording':
      return t('録音中');
    case 'stopping':
      return t('録音を保存しています');
    case 'encoding':
      return t('録音を保存しました');
    case 'error':
      return t('録音でエラーが発生しました');
    default:
      return t('録音の準備');
  }
}

function phaseLabel(status: RecordingAppStatus, t: I18nValue['t']): string {
  switch (status) {
    case 'starting':
      return t('準備中');
    case 'recording':
      return 'REC';
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
  onOpenReadme,
  onSetInputSource,
}: RecordingPanelProps) {
  const { locale, t } = useI18n();
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
      ? t('マイク権限: 許可済み')
      : permission === 'requesting'
        ? t('マイク権限: 確認中')
        : permission === 'denied' || permission === 'restricted'
          ? t('マイク権限: 拒否')
          : permission === 'not-determined'
            ? t('マイク権限: 未確認')
            : t('マイク権限: 不明');

  return (
    <section
      className={`panel recorder-panel ${isRecording ? 'is-recording' : ''}`}
      aria-labelledby="recorder-title"
    >
      <div className="panel-head">
        <div>
          <p className="section-label">{t('録音パネル')}</p>
          <h2 id="recorder-title">{phaseTitle(status, t)}</h2>
        </div>
        <span className={`state state-${status}`} data-testid="recording-state">
          {phaseLabel(status, t)}
        </span>
      </div>

      <div className="timer-row">
        <span className="timer" data-testid="elapsed">
          {formatDuration(elapsedSeconds)}
        </span>
        <span className="timer-caption">
          {isRecording
            ? t('録音中')
            : status === 'encoding'
              ? t('保存した音声の長さ')
              : t('録音は停止しています')}
        </span>
      </div>

      <fieldset className="source-picker" disabled={sourceDisabled}>
        <legend>{t('入力ソース')}</legend>
        {sourceOptions.map((option) => {
          const unavailable =
            permissionDenied ||
            (option === 'microphone' && !microphoneAvailable) ||
            (option === 'system' && !systemAvailable) ||
            (option === 'both' && (!microphoneAvailable || !systemAvailable));
          return (
            <label className="source-option" key={option}>
              <input
                type="radio"
                name="input-source"
                value={option}
                checked={inputSource === option}
                onChange={() => onSetInputSource(option)}
                disabled={unavailable}
                data-testid={`source-${option}`}
              />
              <span>{inputSourceLabel(option, locale)}</span>
            </label>
          );
        })}
      </fieldset>

      {sourceChanged ? (
        <p className="hint">
          {t('入力ソースを変更しました。この変更は次の録音から適用されます。')}
        </p>
      ) : null}

      <div className="device-grid">
        <label className="field">
          <span>{t('マイク')}</span>
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
              <option value="">{t('マイクが見つかりません')}</option>
            ) : (
              microphones.map((device, index) => (
                <option value={device.deviceId} key={device.deviceId}>
                  {deviceLabel(
                    device,
                    t('マイク {index}', { index: index + 1 }),
                  )}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="field">
          <span>{t('システム音声（BlackHole 2ch）')}</span>
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
              <option value="">{t('BlackHole 2ch が見つかりません')}</option>
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
            {t('マイク権限を確認する')}
          </button>
        ) : null}
        {permissionDenied ? (
          <button
            type="button"
            className="link-button"
            onClick={onOpenMicrophoneSettings}
            disabled={controlsDisabled}
          >
            {t('システム設定を開く')}
          </button>
        ) : null}
      </div>

      {permissionDenied ? (
        <div className="alert alert-error" role="alert">
          {t(
            'マイク権限が拒否されています。システム設定の「プライバシーとセキュリティ」>「マイク」で Kataribe を許可してください。',
          )}
        </div>
      ) : null}

      {permission !== 'granted' ? (
        <p className="hint">
          {t(
            '入力デバイスの検出と録音にマイク権限を使います。システム音声だけの場合も、BlackHole 2ch のラベル取得に必要です。',
          )}
        </p>
      ) : null}

      {needsMicrophone && !microphoneAvailable ? (
        <p className="hint">
          {t('マイクが見つかりません。マイクを接続し、マイク権限を確認してください。')}
        </p>
      ) : null}

      {needsSystem && systemDevices.length === 0 ? (
        <div className="hint">
          {t('BlackHole 2ch が見つかりません。')}
          <button type="button" className="link-button" onClick={onOpenReadme}>
            {t('セットアップ手順を開く')}
          </button>
        </div>
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
            {status === 'stopping' ? t('保存しています...') : t('録音を停止')}
          </button>
        ) : (
          <button
            type="button"
            className="button button-primary"
            onClick={onRequestStart}
            disabled={!canStart}
            data-testid="start-button"
          >
            {status === 'starting' ? t('準備しています...') : t('録音を開始')}
          </button>
        )}
        {session ? (
          <span className="path-inline" data-testid="active-path">
             {t('保存先: {path}', { path: session.meetingDir })}
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
