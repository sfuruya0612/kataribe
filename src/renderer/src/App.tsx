import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppInfo,
  InputSource,
  MicrophonePermissionStatus,
  RecordingCaptureStats,
  RecordingChunk,
  RecordingStopResult,
  RecoverableRecording,
} from '../../shared/types';
import {
  buildAudioConstraints,
  deviceLabel,
  formatDuration,
  formatLevel,
  frameClockDeltaSeconds,
  inputSourceLabel,
  isClipping,
  levelPercent,
  pickDeviceId,
  splitInputDevices,
  type InputDevice,
} from './recording-utils';

type Phase = 'idle' | 'starting' | 'recording' | 'stopping' | 'finished' | 'error';

type PermissionState = MicrophonePermissionStatus | 'requesting';

type LevelSnapshot = {
  peak: number;
  rms: number;
  stats: RecordingCaptureStats;
};

type WorkletChunkData = {
  sequence: number;
  frames: number;
  sampleRate: number;
  expectedFrames: number;
  samples: Float32Array;
};

type WorkletChunkMessage = WorkletChunkData & {
  type: 'chunk';
};

type WorkletLevelMessage = {
  type: 'level';
  peak: number;
  rms: number;
  frames: number;
  expectedFrames: number;
  gaps: number;
  maxGapFrames: number;
  missedFrames: number;
  sampleRate: number;
  channels: number;
  currentTime: number;
};

type WorkletStoppedMessage = {
  type: 'stopped';
  stats: RecordingCaptureStats;
  finalChunk: WorkletChunkData | null;
};

type WorkletMessage = WorkletChunkMessage | WorkletLevelMessage | WorkletStoppedMessage;

type RecorderGraph = {
  context: AudioContext;
  node: AudioWorkletNode;
  sink: GainNode;
  sources: MediaStreamAudioSourceNode[];
  gains: GainNode[];
  streams: MediaStream[];
};

const sourceOptions: Array<{ value: InputSource; label: string }> = [
  { value: 'microphone', label: 'マイク' },
  { value: 'system', label: 'システム音声' },
  { value: 'both', label: '両方' },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordingErrorText(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return 'マイクの使用が許可されていません。システム設定の「プライバシーとセキュリティ」>「マイク」で Kataribe を許可してください。';
      case 'NotFoundError':
        return '選択した入力デバイスが見つかりません。デバイスを接続してから再試行してください。';
      case 'NotReadableError':
        return '入力デバイスを開けませんでした。他のアプリが使用していないか確認してください。';
      case 'OverconstrainedError':
        return '選択した入力デバイスの設定に対応できません。別のデバイスを選んでください。';
      default:
        break;
    }
  }
  return errorText(error);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function phaseTitle(phase: Phase): string {
  switch (phase) {
    case 'starting':
      return '録音を準備しています';
    case 'recording':
      return '録音中';
    case 'stopping':
      return '録音を保存しています';
    case 'finished':
      return '録音を保存しました';
    case 'error':
      return '録音を開始できませんでした';
    default:
      return '録音の準備';
  }
}

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'starting':
      return '準備中';
    case 'recording':
      return 'REC';
    case 'stopping':
      return '保存中';
    case 'finished':
      return '保存済み';
    case 'error':
      return 'エラー';
    default:
      return '待機中';
  }
}

async function teardownGraph(graph: RecorderGraph): Promise<void> {
  graph.node.port.onmessage = null;
  for (const source of graph.sources) {
    try {
      source.disconnect();
    } catch {
      // The node may already be disconnected.
    }
  }
  for (const gain of graph.gains) {
    try {
      gain.disconnect();
    } catch {
      // The node may already be disconnected.
    }
  }
  try {
    graph.node.disconnect();
  } catch {
    // The node may already be disconnected.
  }
  try {
    graph.sink.disconnect();
  } catch {
    // The node may already be disconnected.
  }
  for (const stream of graph.streams) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  try {
    await graph.context.close();
  } catch {
    // The context may already be closed.
  }
}

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [microphones, setMicrophones] = useState<InputDevice[]>([]);
  const [systemDevices, setSystemDevices] = useState<InputDevice[]>([]);
  const [micDeviceId, setMicDeviceId] = useState('');
  const [systemDeviceId, setSystemDeviceId] = useState('');
  const [source, setSource] = useState<InputSource>('both');
  const [level, setLevel] = useState<LevelSnapshot | null>(null);
  const [levelUpdates, setLevelUpdates] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);
  const [activeMeetingDir, setActiveMeetingDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [result, setResult] = useState<RecordingStopResult | null>(null);
  const [recoverable, setRecoverable] = useState<RecoverableRecording[]>([]);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  const graphRef = useRef<RecorderGraph | null>(null);
  const chunkQueueRef = useRef<Promise<void>>(Promise.resolve());
  const chunkErrorRef = useRef<string | null>(null);
  const stopResolverRef = useRef<((stats: RecordingCaptureStats) => void) | null>(null);
  const lastStatsRef = useRef<RecordingCaptureStats | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const refreshDevices = useCallback(async (): Promise<{
    microphones: InputDevice[];
    systemDevices: InputDevice[];
  }> => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices
      .filter((device) => device.kind === 'audioinput')
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
    const split = splitInputDevices(inputs);
    setMicrophones(split.microphones);
    setSystemDevices(split.systemDevices);
    setMicDeviceId((current) => pickDeviceId(split.microphones, current));
    setSystemDeviceId((current) => pickDeviceId(split.systemDevices, current));
    return split;
  }, []);

  const refreshRecoverable = useCallback(async () => {
    try {
      const recordings = await window.kataribe.listRecoverableRecordings();
      setRecoverable(recordings);
    } catch (reason: unknown) {
      setWarning(`復旧対象の確認に失敗しました: ${errorText(reason)}`);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const appInfo = await window.kataribe.getAppInfo();
        if (!cancelled) {
          setInfo(appInfo);
        }
      } catch (reason: unknown) {
        if (!cancelled) {
          setError(`アプリ情報の取得に失敗しました: ${errorText(reason)}`);
        }
      }

      try {
        const status = await window.kataribe.getMicrophoneStatus();
        if (!cancelled) {
          setPermission(status);
        }
      } catch (reason: unknown) {
        if (!cancelled) {
          setWarning(`マイク権限の確認に失敗しました: ${errorText(reason)}`);
        }
      }

      try {
        await refreshDevices();
      } catch (reason: unknown) {
        if (!cancelled) {
          setWarning(`入力デバイスの取得に失敗しました: ${errorText(reason)}`);
        }
      }

      await refreshRecoverable();

      if (!cancelled) {
        window.kataribe.ready();
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [refreshDevices, refreshRecoverable]);

  useEffect(() => {
    return () => {
      const graph = graphRef.current;
      graphRef.current = null;
      if (graph) {
        void teardownGraph(graph);
      }
    };
  }, []);

  useEffect(() => {
    if (phase !== 'recording') {
      return;
    }
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const enqueueChunk = useCallback((data: WorkletChunkData) => {
    chunkQueueRef.current = chunkQueueRef.current.then(async () => {
      if (chunkErrorRef.current) {
        return;
      }
      const chunk: RecordingChunk = {
        sequence: data.sequence,
        frames: data.frames,
        sampleRate: data.sampleRate,
        expectedFrames: data.expectedFrames,
        samples: data.samples,
      };
      try {
        await window.kataribe.appendChunk(chunk);
        setChunkCount((count) => count + 1);
      } catch (reason: unknown) {
        chunkErrorRef.current = errorText(reason);
        setWarning(`チャンクの保存に失敗しました: ${chunkErrorRef.current}`);
      }
    });
  }, []);

  const handleWorkletMessage = useCallback(
    (message: WorkletMessage) => {
      if (message.type === 'chunk') {
        enqueueChunk(message);
        return;
      }

      if (message.type === 'level') {
        const stats: RecordingCaptureStats = {
          frames: message.frames,
          expectedFrames: message.expectedFrames,
          gaps: message.gaps,
          maxGapFrames: message.maxGapFrames,
          missedFrames: message.missedFrames,
          sampleRate: message.sampleRate,
          channels: message.channels,
          currentTime: message.currentTime,
        };
        lastStatsRef.current = stats;
        setLevel({ peak: message.peak, rms: message.rms, stats });
        setLevelUpdates((count) => count + 1);
        return;
      }

      if (message.finalChunk) {
        enqueueChunk(message.finalChunk);
      }
      lastStatsRef.current = message.stats;
      const resolver = stopResolverRef.current;
      stopResolverRef.current = null;
      resolver?.(message.stats);
    },
    [enqueueChunk],
  );

  const waitForWorkletStop = (graph: RecorderGraph): Promise<RecordingCaptureStats> => {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        stopResolverRef.current = null;
        reject(new Error('timed out waiting for the recorder worklet to stop'));
      }, 10000);
      stopResolverRef.current = (stats) => {
        window.clearTimeout(timer);
        resolve(stats);
      };
      graph.node.port.postMessage({ type: 'stop' });
      if (graph.context.state === 'suspended') {
        void graph.context.resume();
      }
    });
  };

  const handlePermission = async () => {
    setPermission('requesting');
    setError(null);
    try {
      const granted = await window.kataribe.requestMicrophone();
      setPermission(granted ? 'granted' : 'denied');
      if (granted) {
        await refreshDevices();
      } else {
        setWarning(
          'マイク権限が拒否されています。システム設定の「プライバシーとセキュリティ」>「マイク」で Kataribe を許可してください。',
        );
      }
    } catch (reason: unknown) {
      setPermission('unknown');
      setError(`マイク権限の確認に失敗しました: ${errorText(reason)}`);
    }
  };

  const handleStart = async () => {
    if (phase === 'starting' || phase === 'recording' || phase === 'stopping') {
      return;
    }

    setPhase('starting');
    setError(null);
    setWarning(null);
    setResult(null);
    setLevel(null);
    setLevelUpdates(0);
    setChunkCount(0);
    setActiveMeetingDir(null);
    chunkQueueRef.current = Promise.resolve();
    chunkErrorRef.current = null;
    stopResolverRef.current = null;
    lastStatsRef.current = null;

    let streams: MediaStream[] = [];
    let context: AudioContext | null = null;
    let graph: RecorderGraph | null = null;
    let sessionStarted = false;

    try {
      const granted = await window.kataribe.requestMicrophone();
      if (!granted) {
        setPermission('denied');
        throw new Error('microphone permission is not granted');
      }
      setPermission('granted');

      const split = await refreshDevices();
      const micId = pickDeviceId(split.microphones, micDeviceId);
      const systemId = pickDeviceId(split.systemDevices, systemDeviceId);
      setMicDeviceId(micId);
      setSystemDeviceId(systemId);

      const needsMicrophone = source !== 'system';
      const needsSystem = source !== 'microphone';
      if (needsMicrophone && !micId) {
        throw new Error('microphone device is not available');
      }
      if (needsSystem && !systemId) {
        throw new Error('BlackHole 2ch is not available');
      }

      if (needsMicrophone) {
        const stream = await navigator.mediaDevices.getUserMedia(
          buildAudioConstraints(micId, 1),
        );
        streams.push(stream);
      }
      if (needsSystem) {
        const stream = await navigator.mediaDevices.getUserMedia(
          buildAudioConstraints(systemId, 2),
        );
        streams.push(stream);
      }

      const audioContext = new AudioContext({ latencyHint: 'playback' });
      context = audioContext;
      if (audioContext.state === 'running') {
        await audioContext.suspend();
      }

      const workletUrl = new URL('recorder-worklet.js', window.location.href).href;
      await audioContext.audioWorklet.addModule(workletUrl);

      const node = new AudioWorkletNode(audioContext, 'recorder-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        outputChannelCount: [1],
        processorOptions: { chunkSeconds: 10 },
      });
      const sink = audioContext.createGain();
      sink.gain.value = 0;
      node.connect(sink);
      sink.connect(audioContext.destination);

      const gainValue = streams.length > 1 ? 0.5 : 1;
      const sources: MediaStreamAudioSourceNode[] = [];
      const gains: GainNode[] = [];
      for (const stream of streams) {
        const sourceNode = audioContext.createMediaStreamSource(stream);
        const gain = audioContext.createGain();
        gain.gain.value = gainValue;
        sourceNode.connect(gain);
        gain.connect(node);
        sources.push(sourceNode);
        gains.push(gain);
      }

      node.port.onmessage = (event: MessageEvent) => {
        handleWorkletMessage(event.data as WorkletMessage);
      };

      graph = {
        context: audioContext,
        node,
        sink,
        sources,
        gains,
        streams,
      };

      const session = await window.kataribe.startRecording({
        inputSource: source,
        sampleRate: audioContext.sampleRate,
        microphoneLabel: needsMicrophone
          ? split.microphones.find((device) => device.deviceId === micId)?.label
          : undefined,
        systemLabel: needsSystem
          ? split.systemDevices.find((device) => device.deviceId === systemId)?.label
          : undefined,
      });
      sessionStarted = true;

      startedAtRef.current = Date.now();
      setClock(Date.now());
      setActiveMeetingDir(session.meetingDir);
      graphRef.current = graph;
      await audioContext.resume();
      setPhase('recording');
    } catch (reason: unknown) {
      if (sessionStarted) {
        try {
          await window.kataribe.stopRecording();
        } catch {
          // The main process cleans up the failed session.
        }
      }

      if (graph) {
        await teardownGraph(graph);
      } else {
        for (const stream of streams) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
        }
        if (context) {
          await context.close().catch(() => undefined);
        }
      }

      graphRef.current = null;
      setError(`録音を開始できませんでした: ${recordingErrorText(reason)}`);
      setPhase('error');
    }
  };

  const handleStop = async () => {
    const graph = graphRef.current;
    if (!graph) {
      setError('録音が開始されていません。');
      return;
    }
    if (phase === 'stopping') {
      return;
    }

    setPhase('stopping');
    setError(null);

    let stats = lastStatsRef.current ?? undefined;
    try {
      stats = await waitForWorkletStop(graph);
    } catch (reason: unknown) {
      setWarning(
        `録音処理の停止に失敗しました。保存済みのチャンクで停止します: ${errorText(reason)}`,
      );
    }

    await chunkQueueRef.current;

    try {
      const stopped = await window.kataribe.stopRecording(stats);
      setResult(stopped);
      setPhase('finished');
    } catch (reason: unknown) {
      setError(`録音を保存できませんでした: ${recordingErrorText(reason)}`);
      setPhase('error');
    } finally {
      graphRef.current = null;
      startedAtRef.current = null;
      setActiveMeetingDir(null);
      setLevel(null);
      await teardownGraph(graph);
      await refreshRecoverable();
    }
  };

  const handleRecover = async (recording: RecoverableRecording) => {
    setRecoveringId(recording.meetingId);
    setError(null);
    try {
      const recovered = await window.kataribe.recoverRecording(recording.meetingId);
      setResult(recovered);
      setPhase('finished');
      setRecoverable((current) =>
        current.filter((item) => item.meetingId !== recording.meetingId),
      );
    } catch (reason: unknown) {
      setError(`録音の復旧に失敗しました: ${recordingErrorText(reason)}`);
    } finally {
      setRecoveringId(null);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await window.kataribe.openRecordingFolder();
    } catch (reason: unknown) {
      setError(`保存先を開けませんでした: ${errorText(reason)}`);
    }
  };

  const needsMicrophone = source !== 'system';
  const needsSystem = source !== 'microphone';
  const isRecording = phase === 'recording';
  const isBusy = phase === 'starting' || phase === 'stopping';
  const controlsDisabled = isRecording || isBusy;
  const stats = level?.stats ?? null;

  const elapsedSeconds = isRecording
    ? stats
      ? stats.frames / stats.sampleRate
      : Math.max(0, (clock - (startedAtRef.current ?? clock)) / 1000)
    : result
      ? result.actualSamples / result.sampleRate
      : 0;

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
    <main className="app">
      <header className="app-header">
        <div className="header-copy">
          <p className="eyebrow">Kataribe</p>
          <h1>会議の録音</h1>
          <p className="lead">
            マイクと BlackHole 2ch を同じ AudioContext で混ぜ、10 秒ごとの WAV
            チャンクとして保存します。
          </p>
        </div>
        <div className="header-meta">
          <span className="badge">録音中核</span>
          <span className="version">{info ? `v${info.version}` : 'v...'}</span>
        </div>
      </header>

      <section
        className={`panel recorder-panel ${isRecording ? 'is-recording' : ''}`}
        aria-labelledby="recorder-title"
      >
        <div className="panel-head">
          <div>
            <p className="section-label">Recorder</p>
            <h2 id="recorder-title">{phaseTitle(phase)}</h2>
          </div>
          <span className={`state state-${phase}`} data-testid="recording-state">
            {phaseLabel(phase)}
          </span>
        </div>

        <div className="timer-row">
          <span className="timer" data-testid="elapsed">
            {formatDuration(elapsedSeconds)}
          </span>
          <span className="timer-caption">
            {isRecording ? '録音中' : result ? '保存した音声の長さ' : '録音は停止しています'}
          </span>
        </div>

        <fieldset className="source-picker" disabled={controlsDisabled}>
          <legend>入力ソース</legend>
          {sourceOptions.map((option) => (
            <label className="source-option" key={option.value}>
              <input
                type="radio"
                name="input-source"
                value={option.value}
                checked={source === option.value}
                onChange={() => setSource(option.value)}
                data-testid={`source-${option.value}`}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>

        <div className="device-grid">
          <label className="field">
            <span>マイク</span>
            <select
              value={micDeviceId}
              onChange={(event) => setMicDeviceId(event.target.value)}
              disabled={controlsDisabled || !needsMicrophone || microphones.length === 0}
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
              onChange={(event) => setSystemDeviceId(event.target.value)}
              disabled={controlsDisabled || !needsSystem || systemDevices.length === 0}
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
              onClick={handlePermission}
              disabled={permission === 'requesting' || controlsDisabled}
            >
              マイク権限を確認する
            </button>
          ) : null}
        </div>

        {needsSystem && systemDevices.length === 0 ? (
          <p className="hint">
            BlackHole 2ch が見つかりません。README の初期セットアップに従って
            BlackHole 2ch をインストールしてください。
          </p>
        ) : null}

        <div className="recorder-actions">
          {isRecording || phase === 'stopping' ? (
            <button
              type="button"
              className="button button-danger"
              onClick={handleStop}
              disabled={phase === 'stopping'}
              data-testid="stop-button"
            >
              {phase === 'stopping' ? '保存しています...' : '録音を停止'}
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary"
              onClick={handleStart}
              disabled={isBusy}
              data-testid="start-button"
            >
              {phase === 'starting' ? '準備しています...' : '録音を開始'}
            </button>
          )}
          {activeMeetingDir ? (
            <span className="path-inline" data-testid="active-path">
              保存先: {activeMeetingDir}
            </span>
          ) : null}
        </div>

        {error ? (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        ) : null}
        {warning ? (
          <p className="alert alert-warning" role="status">
            {warning}
          </p>
        ) : null}
      </section>

      <section className="panel level-panel" aria-labelledby="level-title">
        <div className="panel-head">
          <div>
            <p className="section-label">Levels</p>
            <h2 id="level-title">入力レベル</h2>
          </div>
          <span className="panel-note">100 ms 間隔 / {levelUpdates} 回更新</span>
        </div>

        <div className="meters">
          <div className="meter-row">
            <span className="meter-label">ピーク</span>
            <div className="meter" aria-hidden="true">
              <div
                className="meter-fill meter-peak"
                style={{ width: `${levelPercent(level?.peak ?? 0)}%` }}
              />
            </div>
            <span className="meter-value" data-testid="level-peak">
              {formatLevel(level?.peak ?? 0)}
            </span>
          </div>
          <div className="meter-row">
            <span className="meter-label">RMS</span>
            <div className="meter" aria-hidden="true">
              <div
                className="meter-fill meter-rms"
                style={{ width: `${levelPercent(level?.rms ?? 0)}%` }}
              />
            </div>
            <span className="meter-value" data-testid="level-rms">
              {formatLevel(level?.rms ?? 0)}
            </span>
          </div>
        </div>

        {isClipping(level?.peak ?? 0) ? (
          <p className="alert alert-warning">
            入力レベルが 0 dB に近づいています。マイクのゲインを下げてください。
          </p>
        ) : null}

        <dl className="stats-grid">
          <div>
            <dt>実フレーム</dt>
            <dd data-testid="stats-frames">
              {stats ? stats.frames.toLocaleString('ja-JP') : '0'}
            </dd>
          </div>
          <div>
            <dt>期待フレーム</dt>
            <dd>{stats ? stats.expectedFrames.toLocaleString('ja-JP') : '0'}</dd>
          </div>
          <div>
            <dt>欠落フレーム</dt>
            <dd>{stats ? stats.missedFrames.toLocaleString('ja-JP') : '0'}</dd>
          </div>
          <div>
            <dt>gap</dt>
            <dd>{stats ? `${stats.gaps} 回 / 最大 ${stats.maxGapFrames}` : '0 回'}</dd>
          </div>
          <div>
            <dt>コンテキスト差</dt>
            <dd>{stats ? `${frameClockDeltaSeconds(stats).toFixed(3)} 秒` : '0.000 秒'}</dd>
          </div>
          <div>
            <dt>保存済みチャンク</dt>
            <dd data-testid="chunk-count">{chunkCount}</dd>
          </div>
        </dl>

        {!stats ? (
          <p className="muted">
            録音を開始すると、AudioWorklet が数えた実フレーム数と入力レベルを表示します。
          </p>
        ) : null}
      </section>

      {result ? (
        <section className="panel result-panel" data-testid="result">
          <div className="panel-head">
            <div>
              <p className="section-label">Saved</p>
              <h2>録音を保存しました</h2>
            </div>
            <span className="state state-finished">
              {result.hadChunkFailure ? '一部保存' : '変換待ち'}
            </span>
          </div>
          <p className="path" data-testid="result-path">
            {result.audioPath}
          </p>
          <dl className="stats-grid">
            <div>
              <dt>長さ</dt>
              <dd>{formatDuration(result.actualSamples / result.sampleRate)}</dd>
            </div>
            <div>
              <dt>実サンプル</dt>
              <dd>{result.actualSamples.toLocaleString('ja-JP')}</dd>
            </div>
            <div>
              <dt>期待サンプル</dt>
              <dd>{result.expectedSamples.toLocaleString('ja-JP')}</dd>
            </div>
            <div>
              <dt>サンプルレート</dt>
              <dd>{result.sampleRate.toLocaleString('ja-JP')} Hz</dd>
            </div>
          </dl>
          {result.actualSamples !== result.expectedSamples ? (
            <p className="alert alert-warning">
              期待サンプル数と実サンプル数が一致しません。一部の音声が欠落している可能性があります。
            </p>
          ) : null}
          {result.hadChunkFailure ? (
            <p className="alert alert-warning">
              保存に失敗したチャンクがあります。音声が欠落している可能性があります。
            </p>
          ) : null}
          <div className="result-actions">
            <button type="button" className="button button-secondary" onClick={handleOpenFolder}>
              Finder で開く
            </button>
            <span className="muted">
              mp3 への変換は次の実装で行います。現在は結合した WAV を保存しています。
            </span>
          </div>
        </section>
      ) : null}

      {recoverable.length > 0 ? (
        <section className="panel recovery-panel" aria-labelledby="recovery-title">
          <div className="panel-head">
            <div>
              <p className="section-label">Recovery</p>
              <h2 id="recovery-title">復旧できる録音</h2>
            </div>
            <span className="state state-error">{recoverable.length} 件</span>
          </div>
          <p className="muted">
            前回の終了時に残ったチャンクがあります。復旧すると 1 つの WAV に結合します。
          </p>
          <ul className="recovery-list" data-testid="recovery-list">
            {recoverable.map((recording) => (
              <li key={recording.meetingId} className="recovery-item">
                <div>
                  <strong>{formatDateTime(recording.startedAt)}</strong>
                  <p>
                    {inputSourceLabel(recording.inputSource)} / {recording.chunks} チャンク /{' '}
                    {(recording.actualSamples / recording.sampleRate).toFixed(1)} 秒相当
                  </p>
                  <p className="path">{recording.meetingDir}</p>
                </div>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => handleRecover(recording)}
                  disabled={recoveringId !== null}
                  data-testid={`recover-${recording.meetingId}`}
                >
                  {recoveringId === recording.meetingId ? '復旧しています...' : '復旧する'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="app-footer">
        <span>macOS 14.2 以降 / Apple Silicon</span>
        <span>保存先: ~/Documents/Kataribe</span>
      </footer>
    </main>
  );
}
