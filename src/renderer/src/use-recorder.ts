import { useCallback, useEffect, useRef, useState } from 'react';
import { createInitialRecordingAppState } from '../../shared/recording-state';
import type {
  InputSource,
  MicrophonePermissionStatus,
  RecordingAppState,
  RecordingCaptureStats,
  RecordingChunk,
  RecordingCommand,
  RecordingLevelUpdate,
  RecoverableRecording,
} from '../../shared/types';
import {
  buildAudioConstraints,
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

type RecorderGraph = {
  context: AudioContext;
  node: AudioWorkletNode;
  sink: GainNode;
  sources: MediaStreamAudioSourceNode[];
  gains: GainNode[];
  streams: MediaStream[];
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
  refreshRecoverable: () => Promise<void>;
};

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

      let streams: MediaStream[] = [];
      let context: AudioContext | null = null;
      let graph: RecorderGraph | null = null;
      let sessionStarted = false;

      try {
        const granted = await window.kataribe.requestMicrophone();
        if (!granted) {
          throw new Error(
            'マイクの使用が許可されていません。システム設定の「プライバシーとセキュリティ」>「マイク」で Kataribe を許可してください。',
          );
        }
        setPermission('granted');

        const split = await refreshDevices();
        const micId = pickDeviceId(split.microphones, micDeviceId);
        const systemId = pickDeviceId(split.systemDevices, systemDeviceId);
        setMicDeviceId(micId);
        setSystemDeviceId(systemId);

        const needsMicrophone = inputSource !== 'system';
        const needsSystem = inputSource !== 'microphone';
        if (needsMicrophone && !micId) {
          throw new Error('マイクが見つかりません。マイクを接続してから再試行してください。');
        }
        if (needsSystem && !systemId) {
          throw new Error(
            'BlackHole 2ch が見つかりません。README の初期セットアップに従ってインストールしてください。',
          );
        }

        if (needsMicrophone) {
          streams.push(
            await navigator.mediaDevices.getUserMedia(
              buildAudioConstraints(micId, 1),
            ),
          );
        }
        if (needsSystem) {
          streams.push(
            await navigator.mediaDevices.getUserMedia(
              buildAudioConstraints(systemId, 2),
            ),
          );
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
        graphRef.current = graph;

        await window.kataribe.startRecording({
          inputSource,
          sampleRate: audioContext.sampleRate,
          microphoneLabel: needsMicrophone
            ? split.microphones.find((device) => device.deviceId === micId)?.label
            : undefined,
          systemLabel: needsSystem
            ? split.systemDevices.find((device) => device.deviceId === systemId)?.label
            : undefined,
        });
        sessionStarted = true;
        await audioContext.resume();
      } catch (reason: unknown) {
        if (sessionStarted) {
          try {
            await window.kataribe.stopRecording();
          } catch {
            // The main process records the failed session as an error.
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
        const message = recordingErrorText(reason);
        try {
          await window.kataribe.reportRecordingError(message);
        } catch {
          setUiError(message);
        }
      }
    },
    [handleWorkletMessage, micDeviceId, refreshDevices, systemDeviceId],
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
    refreshRecoverable,
  };
}
