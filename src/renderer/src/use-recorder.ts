import { useCallback, useEffect, useRef, useState } from 'react';
import { createInitialRecordingAppState } from '../../shared/recording-state';
import type {
  InputSource,
  MicrophonePermissionStatus,
  RecordingAppState,
  RecordingCaptureStats,
  RecordingChunk,
  RecordingCommand,
  RecordingEvent,
  RecordingLevelUpdate,
  RecoverableRecording,
} from '../../shared/types';
import {
  buildAudioConstraints,
  deviceLossAction,
  errorText,
  pickDeviceId,
  recordingErrorText,
  splitInputDevices,
  type InputDevice,
} from './recording-utils';

export type PermissionState = MicrophonePermissionStatus | 'requesting';

type WorkletChunkData = {
  sequence: number;
  frames: number;
  sampleRate: number;
  expectedFrames: number;
  samples: Float32Array;
};

type WorkletChunkMessage = WorkletChunkData & { type: 'chunk' };

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

type RecorderInput = {
  role: 'microphone' | 'system';
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  track: MediaStreamTrack | null;
};

type RecorderGraph = {
  context: AudioContext;
  node: AudioWorkletNode;
  sink: GainNode;
  inputs: RecorderInput[];
  onDeviceChange: () => void;
};

export type RecorderController = {
  appState: RecordingAppState;
  permission: PermissionState;
  microphones: InputDevice[];
  systemDevices: InputDevice[];
  micDeviceId: string;
  systemDeviceId: string;
  recoverable: RecoverableRecording[];
  recoveringId: string | null;
  warning: string | null;
  uiError: string | null;
  setMicDeviceId: (deviceId: string) => void;
  setSystemDeviceId: (deviceId: string) => void;
  requestPermission: () => Promise<void>;
  requestStart: () => Promise<void>;
  requestStop: () => Promise<void>;
  setInputSource: (source: InputSource) => Promise<void>;
  recover: (recording: RecoverableRecording) => Promise<void>;
  openFolder: () => Promise<void>;
  openMicrophoneSettings: () => Promise<void>;
  refreshRecoverable: () => Promise<void>;
};

function makeEvent(
  kind: RecordingEvent['kind'],
  device: RecordingEvent['device'],
  severity: RecordingEvent['severity'],
  message: string,
): RecordingEvent {
  return {
    at: new Date().toISOString(),
    kind,
    device,
    severity,
    message,
  };
}

function mediaFailureEvent(
  role: 'microphone' | 'system',
  reason: unknown,
): RecordingEvent {
  const kind =
    reason instanceof DOMException && reason.name === 'NotAllowedError'
      ? 'permission-denied'
      : 'device-open-failed';
  return makeEvent(kind, role, 'error', recordingErrorText(reason));
}

function removeInput(graph: RecorderGraph, role: RecorderInput['role']): void {
  const input = graph.inputs.find((entry) => entry.role === role);
  if (!input) {
    return;
  }
  if (input.track) {
    input.track.onended = null;
  }
  try {
    input.source.disconnect();
  } catch {
    // The node may already be disconnected.
  }
  try {
    input.gain.disconnect();
  } catch {
    // The node may already be disconnected.
  }
  for (const track of input.stream.getTracks()) {
    track.stop();
  }
  graph.inputs = graph.inputs.filter((entry) => entry !== input);
  const remaining = graph.inputs[0];
  if (remaining) {
    remaining.gain.gain.value = 1;
  }
}

async function teardownGraph(graph: RecorderGraph): Promise<void> {
  navigator.mediaDevices.removeEventListener('devicechange', graph.onDeviceChange);
  graph.node.port.onmessage = null;
  for (const input of graph.inputs) {
    if (input.track) {
      input.track.onended = null;
    }
    try {
      input.source.disconnect();
    } catch {
      // The node may already be disconnected.
    }
    try {
      input.gain.disconnect();
    } catch {
      // The node may already be disconnected.
    }
    for (const track of input.stream.getTracks()) {
      track.stop();
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
  try {
    await graph.context.close();
  } catch {
    // The context may already be closed.
  }
}

export function useRecorder(): RecorderController {
  const [appState, setAppState] = useState<RecordingAppState>(() =>
    createInitialRecordingAppState(),
  );
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [microphones, setMicrophones] = useState<InputDevice[]>([]);
  const [systemDevices, setSystemDevices] = useState<InputDevice[]>([]);
  const [micDeviceId, setMicDeviceId] = useState('');
  const [systemDeviceId, setSystemDeviceId] = useState('');
  const [recoverable, setRecoverable] = useState<RecoverableRecording[]>([]);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);

  const graphRef = useRef<RecorderGraph | null>(null);
  const chunkQueueRef = useRef<Promise<void>>(Promise.resolve());
  const chunkErrorRef = useRef<string | null>(null);
  const levelErrorRef = useRef(false);
  const stopResolverRef = useRef<((stats: RecordingCaptureStats) => void) | null>(null);
  const lastStatsRef = useRef<RecordingCaptureStats | null>(null);
  const captureSourceRef = useRef<InputSource | null>(null);
  const captureDeviceIdsRef = useRef<{
    microphone: string | null;
    system: string | null;
  } | null>(null);
  const deviceLossReportedRef = useRef({ microphone: false, system: false });

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
      } catch (reason: unknown) {
        chunkErrorRef.current = errorText(reason);
        setWarning(`チャンクの保存に失敗しました: ${chunkErrorRef.current}`);
      }
    });
  }, []);

  const reportLevel = useCallback((message: WorkletLevelMessage) => {
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
    const update: RecordingLevelUpdate = {
      level: { peak: message.peak, rms: message.rms },
      stats,
    };
    void window.kataribe.reportRecordingLevel(update).catch((reason: unknown) => {
      if (!levelErrorRef.current) {
        levelErrorRef.current = true;
        setWarning(`入力レベルの送信に失敗しました: ${errorText(reason)}`);
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
        reportLevel(message);
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
    [enqueueChunk, reportLevel],
  );

  const waitForWorkletStop = useCallback(
    (graph: RecorderGraph): Promise<RecordingCaptureStats> => {
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
    },
    [],
  );

  const reportInputLoss = useCallback(
    (role: RecorderInput['role']) => {
      const graph = graphRef.current;
      const source = captureSourceRef.current;
      if (!graph || !source) {
        return;
      }
      if (deviceLossReportedRef.current[role]) {
        return;
      }
      if (role === 'microphone' && source === 'system') {
        return;
      }
      if (role === 'system' && source === 'microphone') {
        return;
      }
      deviceLossReportedRef.current[role] = true;

      const action = deviceLossAction(role, source);
      const fatal = action === 'stop';
      const message =
        role === 'system'
          ? 'BlackHole 2ch が切断されました。録音を停止してチャンクを保存します。'
          : fatal
            ? 'マイクが切断されました。録音を停止してチャンクを保存します。'
            : 'マイクが切断されました。システム音声の録音を続けます。';
      const event: RecordingEvent = {
        at: new Date().toISOString(),
        kind: 'device-lost',
        device: role,
        severity: fatal ? 'error' : 'warning',
        message,
      };

      if (role === 'microphone' && !fatal) {
        removeInput(graph, 'microphone');
      }

      void (async () => {
        try {
          const result = await window.kataribe.reportDeviceEvent(event);
          if (fatal && !result.stopping) {
            await window.kataribe.requestStopRecording();
          }
        } catch (reason: unknown) {
          setWarning(`デバイスの切断を記録できませんでした: ${errorText(reason)}`);
          if (fatal) {
            try {
              await window.kataribe.requestStopRecording();
            } catch {
              // The main process keeps the current state.
            }
          }
        }
      })();
    },
    [],
  );

  const detectDeviceLoss = useCallback(async () => {
    const graph = graphRef.current;
    const source = captureSourceRef.current;
    const ids = captureDeviceIdsRef.current;
    if (!graph || !source || !ids) {
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((device) => device.kind === 'audioinput');
      if (inputs.length === 0) {
        return;
      }
      if (
        source !== 'microphone' &&
        ids.system &&
        !inputs.some((device) => device.deviceId === ids.system)
      ) {
        reportInputLoss('system');
      }
      if (
        source !== 'system' &&
        ids.microphone &&
        !inputs.some((device) => device.deviceId === ids.microphone)
      ) {
        reportInputLoss('microphone');
      }
    } catch (reason: unknown) {
      setWarning(`入力デバイスの状態を確認できませんでした: ${errorText(reason)}`);
    }
  }, [reportInputLoss]);

  const startCapture = useCallback(
    async (inputSource: InputSource) => {
      if (graphRef.current) {
        return;
      }

      setWarning(null);
      setUiError(null);
      chunkQueueRef.current = Promise.resolve();
      chunkErrorRef.current = null;
      levelErrorRef.current = false;
      stopResolverRef.current = null;
      lastStatsRef.current = null;
      captureSourceRef.current = null;
      captureDeviceIdsRef.current = null;
      deviceLossReportedRef.current = { microphone: false, system: false };

      let streams: MediaStream[] = [];
      let context: AudioContext | null = null;
      let graph: RecorderGraph | null = null;
      let sessionStarted = false;
      let managerStartAttempted = false;
      let failureEvent: RecordingEvent | null = null;
      let microphoneLabel: string | undefined;
      let systemLabel: string | undefined;

      try {
        const audioContext = new AudioContext({ latencyHint: 'playback' });
        context = audioContext;
        if (audioContext.state === 'running') {
          await audioContext.suspend();
        }

        const granted = await window.kataribe.requestMicrophone();
        if (!granted) {
          setPermission('denied');
          const message =
            'マイクの使用が許可されていません。システム設定の「プライバシーとセキュリティ」>「マイク」で Kataribe を許可してください。';
          failureEvent = makeEvent('permission-denied', 'microphone', 'error', message);
          throw new Error(message);
        }
        setPermission('granted');

        const split = await refreshDevices();
        const micId = pickDeviceId(split.microphones, micDeviceId);
        const systemId = pickDeviceId(split.systemDevices, systemDeviceId);
        setMicDeviceId(micId);
        setSystemDeviceId(systemId);
        microphoneLabel = split.microphones.find(
          (device) => device.deviceId === micId,
        )?.label;
        systemLabel = split.systemDevices.find(
          (device) => device.deviceId === systemId,
        )?.label;

        const needsMicrophone = inputSource !== 'system';
        const needsSystem = inputSource !== 'microphone';
        if (needsMicrophone && !micId) {
          const message = 'マイクが見つかりません。マイクを接続してから再試行してください。';
          failureEvent = makeEvent('device-open-failed', 'microphone', 'error', message);
          throw new Error(message);
        }
        if (needsSystem && !systemId) {
          const message =
            'BlackHole 2ch が見つかりません。README の初期セットアップに従ってインストールしてください。';
          failureEvent = makeEvent('device-open-failed', 'system', 'error', message);
          throw new Error(message);
        }

        const inputSpecs: Array<{
          role: 'microphone' | 'system';
          stream: MediaStream;
        }> = [];
        if (needsMicrophone) {
          let stream: MediaStream;
          try {
            stream = await navigator.mediaDevices.getUserMedia(
              buildAudioConstraints(micId, 1),
            );
          } catch (reason: unknown) {
            if (reason instanceof DOMException && reason.name === 'NotAllowedError') {
              setPermission('denied');
            }
            failureEvent = mediaFailureEvent('microphone', reason);
            throw reason;
          }
          streams.push(stream);
          inputSpecs.push({ role: 'microphone', stream });
        }
        if (needsSystem) {
          let stream: MediaStream;
          try {
            stream = await navigator.mediaDevices.getUserMedia(
              buildAudioConstraints(systemId, 2),
            );
          } catch (reason: unknown) {
            if (reason instanceof DOMException && reason.name === 'NotAllowedError') {
              setPermission('denied');
            }
            failureEvent = mediaFailureEvent('system', reason);
            throw reason;
          }
          streams.push(stream);
          inputSpecs.push({ role: 'system', stream });
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

        const gainValue = inputSpecs.length > 1 ? 0.5 : 1;
        const inputs: RecorderInput[] = [];
        for (const spec of inputSpecs) {
          const sourceNode = audioContext.createMediaStreamSource(spec.stream);
          const gain = audioContext.createGain();
          gain.gain.value = gainValue;
          sourceNode.connect(gain);
          gain.connect(node);
          const track = spec.stream.getAudioTracks()[0] ?? null;
          const input: RecorderInput = {
            role: spec.role,
            stream: spec.stream,
            source: sourceNode,
            gain,
            track,
          };
          if (track) {
            track.onended = () => reportInputLoss(spec.role);
          }
          inputs.push(input);
        }

        node.port.onmessage = (event: MessageEvent) => {
          handleWorkletMessage(event.data as WorkletMessage);
        };

        const onDeviceChange = () => {
          void detectDeviceLoss();
        };
        navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);

        graph = {
          context: audioContext,
          node,
          sink,
          inputs,
          onDeviceChange,
        };
        graphRef.current = graph;
        captureSourceRef.current = inputSource;
        captureDeviceIdsRef.current = {
          microphone: needsMicrophone ? micId : null,
          system: needsSystem ? systemId : null,
        };
        deviceLossReportedRef.current = { microphone: false, system: false };

        managerStartAttempted = true;
        await window.kataribe.startRecording({
          inputSource,
          sampleRate: audioContext.sampleRate,
          microphoneLabel,
          systemLabel,
        });
        sessionStarted = true;
        await audioContext.resume();
      } catch (reason: unknown) {
        const event =
          failureEvent ??
          makeEvent('device-open-failed', 'unknown', 'error', recordingErrorText(reason));

        if (graph) {
          graphRef.current = null;
          await teardownGraph(graph);
          graph = null;
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
        captureSourceRef.current = null;
        captureDeviceIdsRef.current = null;

        if (sessionStarted) {
          try {
            await window.kataribe.reportDeviceEvent(event);
          } catch {
            // The error below keeps the failure visible.
          }
          try {
            await window.kataribe.stopRecording();
          } catch {
            // The main process records the failed session as an error.
          }
          try {
            await window.kataribe.reportRecordingError(event.message);
          } catch {
            setUiError(event.message);
          }
        } else if (managerStartAttempted) {
          try {
            await window.kataribe.reportRecordingError(event.message);
          } catch {
            setUiError(event.message);
          }
        } else {
          try {
            await window.kataribe.recordStartupFailure({
              options: {
                inputSource,
                sampleRate: context?.sampleRate ?? 48000,
                microphoneLabel,
                systemLabel,
              },
              event,
            });
          } catch {
            setUiError(event.message);
            try {
              await window.kataribe.reportRecordingError(event.message);
            } catch {
              // The local error is the fallback.
            }
          }
        }
      }
    },
    [
      detectDeviceLoss,
      handleWorkletMessage,
      micDeviceId,
      refreshDevices,
      reportInputLoss,
      systemDeviceId,
    ],
  );

  const stopCapture = useCallback(async () => {
    const graph = graphRef.current;
    if (!graph) {
      const message = '録音が開始されていません。';
      try {
        await window.kataribe.reportRecordingError(message);
      } catch {
        setUiError(message);
      }
      return;
    }
    graphRef.current = null;
    captureSourceRef.current = null;
    captureDeviceIdsRef.current = null;

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
      await window.kataribe.stopRecording(stats);
    } catch (reason: unknown) {
      const message = recordingErrorText(reason);
      try {
        await window.kataribe.reportRecordingError(message);
      } catch {
        setUiError(message);
      }
    } finally {
      await teardownGraph(graph);
      deviceLossReportedRef.current = { microphone: false, system: false };
      await refreshRecoverable();
    }
  }, [refreshRecoverable, waitForWorkletStop]);

  const startCaptureRef = useRef(startCapture);
  const stopCaptureRef = useRef(stopCapture);

  useEffect(() => {
    startCaptureRef.current = startCapture;
    stopCaptureRef.current = stopCapture;
  }, [startCapture, stopCapture]);

  useEffect(() => {
    const unsubscribe = window.kataribe.onRecordingCommand((command: RecordingCommand) => {
      if (command.action === 'start') {
        void startCaptureRef.current(command.inputSource);
      } else {
        void stopCaptureRef.current();
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = window.kataribe.onRecordingState((state) => {
      if (!cancelled) {
        setAppState(state);
      }
    });

    const initialize = async () => {
      try {
        const state = await window.kataribe.getRecordingState();
        if (!cancelled) {
          setAppState(state);
        }
      } catch (reason: unknown) {
        if (!cancelled) {
          setUiError(`録音状態の取得に失敗しました: ${errorText(reason)}`);
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

    void initialize();

    return () => {
      cancelled = true;
      unsubscribe();
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

  const requestPermission = useCallback(async () => {
    setPermission('requesting');
    setUiError(null);
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
      setUiError(`マイク権限の確認に失敗しました: ${errorText(reason)}`);
    }
  }, [refreshDevices]);

  const requestStart = useCallback(async () => {
    setUiError(null);
    try {
      const result = await window.kataribe.requestStartRecording();
      if (!result.accepted) {
        setUiError(`録音を開始できませんでした: ${result.reason ?? '状態を確認してください。'}`);
      }
    } catch (reason: unknown) {
      setUiError(`録音を開始できませんでした: ${errorText(reason)}`);
    }
  }, []);

  const requestStop = useCallback(async () => {
    setUiError(null);
    try {
      const result = await window.kataribe.requestStopRecording();
      if (!result.accepted) {
        setUiError(`録音を停止できませんでした: ${result.reason ?? '状態を確認してください。'}`);
      }
    } catch (reason: unknown) {
      setUiError(`録音を停止できませんでした: ${errorText(reason)}`);
    }
  }, []);

  const setInputSource = useCallback(async (source: InputSource) => {
    try {
      await window.kataribe.setInputSource(source);
    } catch (reason: unknown) {
      setUiError(`入力ソースを変更できませんでした: ${errorText(reason)}`);
    }
  }, []);

  const recover = useCallback(
    async (recording: RecoverableRecording) => {
      setRecoveringId(recording.meetingId);
      setUiError(null);
      try {
        await window.kataribe.recoverRecording(recording.meetingId);
        await refreshRecoverable();
      } catch (reason: unknown) {
        setUiError(`録音の復旧に失敗しました: ${recordingErrorText(reason)}`);
      } finally {
        setRecoveringId(null);
      }
    },
    [refreshRecoverable],
  );

  const openFolder = useCallback(async () => {
    try {
      await window.kataribe.openRecordingFolder();
    } catch (reason: unknown) {
      setUiError(`保存先を開けませんでした: ${errorText(reason)}`);
    }
  }, []);

  const openMicrophoneSettings = useCallback(async () => {
    try {
      await window.kataribe.openMicrophoneSettings();
    } catch (reason: unknown) {
      setUiError(`システム設定を開けませんでした: ${errorText(reason)}`);
    }
  }, []);

  return {
    appState,
    permission,
    microphones,
    systemDevices,
    micDeviceId,
    systemDeviceId,
    recoverable,
    recoveringId,
    warning,
    uiError,
    setMicDeviceId,
    setSystemDeviceId,
    requestPermission,
    requestStart,
    requestStop,
    setInputSource,
    recover,
    openFolder,
    openMicrophoneSettings,
    refreshRecoverable,
  };
}
