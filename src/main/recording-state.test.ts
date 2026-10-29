import { describe, expect, it } from 'vitest';
import type {
  RecordingAppState,
  RecordingLevelUpdate,
  RecordingSession,
  RecordingStopResult,
} from '../shared/types';
import { RecordingStateStore } from './recording-state';

const session: RecordingSession = {
  meetingId: '00000000-0000-4000-8000-000000000001',
  meetingDir: '/tmp/Kataribe/2026/2026-10-29_1405_タイトル未入力',
  startedAt: '2026-10-29T05:05:00.000Z',
  sampleRate: 48000,
  inputSource: 'both',
};

const result: RecordingStopResult = {
  meetingId: session.meetingId,
  meetingDir: session.meetingDir,
  audioPath: `${session.meetingDir}/audio.wav`,
  startedAt: session.startedAt,
  status: 'encoding',
  sampleRate: 48000,
  actualSamples: 48000,
  expectedSamples: 48000,
  captureStats: {
    frames: 48000,
    expectedFrames: 48000,
    gaps: 0,
    maxGapFrames: 0,
    missedFrames: 0,
    sampleRate: 48000,
    channels: 1,
    currentTime: 1,
  },
  hadChunkFailure: false,
};

const level: RecordingLevelUpdate = {
  level: { peak: 0.5, rms: 0.25 },
  stats: {
    frames: 24000,
    expectedFrames: 24000,
    gaps: 0,
    maxGapFrames: 0,
    missedFrames: 0,
    sampleRate: 48000,
    channels: 1,
    currentTime: 0.5,
  },
};

function createStore() {
  let now = Date.parse('2026-10-29T05:05:00.000Z') + 500;
  const states: RecordingAppState[] = [];
  const levels: RecordingLevelUpdate[] = [];
  const store = new RecordingStateStore({
    now: () => now,
    onStateChange: (state) => states.push(state),
    onLevelChange: (update) => levels.push(update),
  });
  return {
    store,
    states,
    levels,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe('RecordingStateStore', () => {
  it('starts idle and accepts a recording request', () => {
    const { store, states } = createStore();

    expect(store.getState()).toMatchObject({
      status: 'idle',
      inputSource: 'both',
      session: null,
      elapsedSeconds: 0,
      level: null,
      chunkCount: 0,
      lastResult: null,
      error: null,
    });

    expect(store.startRequested('microphone')).toBe(true);
    expect(store.getState()).toMatchObject({
      status: 'starting',
      inputSource: 'microphone',
      session: null,
      lastResult: null,
      error: null,
    });
    expect(states).toHaveLength(1);
    expect(store.startRequested()).toBe(false);
  });

  it('moves to recording, stores levels, and updates elapsed time', () => {
    const { store, states, levels, setNow } = createStore();
    store.startRequested('both');

    store.markRecording(session);
    expect(store.getState()).toMatchObject({
      status: 'recording',
      session,
      startedAt: session.startedAt,
      elapsedSeconds: 0.5,
      chunkCount: 0,
    });

    store.setLevel(level);
    expect(store.getState()).toMatchObject({
      level: { peak: 0.5, rms: 0.25 },
      captureStats: level.stats,
      elapsedSeconds: 0.5,
    });
    expect(levels).toEqual([level]);

    setNow(Date.parse(session.startedAt) + 3200);
    const beforeTick = states.length;
    store.tick();
    expect(states.length).toBe(beforeTick + 1);
    expect(store.getState().elapsedSeconds).toBe(0.5);
  });

  it('keeps the selected source separate from the active session source', () => {
    const { store } = createStore();
    store.startRequested('both');
    store.markRecording(session);

    expect(store.setInputSource('system')).toBe(true);
    expect(store.getState().inputSource).toBe('system');
    expect(store.getState().session?.inputSource).toBe('both');
    expect(store.setInputSource('invalid' as never)).toBe(false);
    expect(store.getState().inputSource).toBe('system');
  });

  it('counts chunks and stops into encoding state', () => {
    const { store, states } = createStore();
    store.startRequested('microphone');
    store.markRecording(session);

    store.incrementChunkCount();
    store.incrementChunkCount();
    expect(store.getState().chunkCount).toBe(2);

    expect(store.stopRequested()).toBe(true);
    expect(store.getState().status).toBe('stopping');
    expect(store.stopRequested()).toBe(false);

    const beforeStop = states.length;
    store.markStopped(result);
    expect(store.getState()).toMatchObject({
      status: 'encoding',
      session: null,
      startedAt: null,
      elapsedSeconds: 1,
      level: null,
      captureStats: result.captureStats,
      lastResult: result,
      lastMeetingDir: result.meetingDir,
      error: null,
    });
    expect(states.length).toBeGreaterThan(beforeStop);
  });

  it('marks recovered recordings as encoding', () => {
    const { store } = createStore();
    store.markRecovered(result);

    expect(store.getState()).toMatchObject({
      status: 'encoding',
      lastResult: result,
      lastMeetingDir: result.meetingDir,
      error: null,
    });
    expect(store.canStart()).toBe(true);
  });

  it('marks errors and allows a retry', () => {
    const { store } = createStore();
    store.startRequested('both');
    store.markError('microphone permission is not granted');

    expect(store.getState()).toMatchObject({
      status: 'error',
      session: null,
      level: null,
      error: 'microphone permission is not granted',
    });
    expect(store.canStart()).toBe(true);
    expect(store.startRequested()).toBe(true);
    expect(store.getState().error).toBeNull();
  });

  it('ignores levels when no recording is active', () => {
    const { store, levels } = createStore();
    store.setLevel(level);
    expect(levels).toEqual([]);
    expect(store.getState().level).toBeNull();
  });
});
