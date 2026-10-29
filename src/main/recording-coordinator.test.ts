import { describe, expect, it } from 'vitest';
import type {
  RecordingAppState,
  RecordingCommand,
} from '../shared/types';
import { RecordingCoordinator } from './recording-coordinator';
import { RecordingStateStore } from './recording-state';

function createCoordinator(sendResult = true) {
  const commands: RecordingCommand[] = [];
  const states: RecordingAppState[] = [];
  const store = new RecordingStateStore({
    now: () => Date.parse('2026-10-29T05:05:00.000Z'),
    onStateChange: (state) => states.push(state),
    onLevelChange: () => undefined,
  });
  const coordinator = new RecordingCoordinator(store, (command) => {
    commands.push(command);
    return sendResult;
  });
  return { store, coordinator, commands, states };
}

describe('RecordingCoordinator', () => {
  it('requests a start and sends the selected source to the renderer', () => {
    const { store, coordinator, commands } = createCoordinator();

    expect(coordinator.start('system')).toEqual({ accepted: true });
    expect(store.getState()).toMatchObject({
      status: 'starting',
      inputSource: 'system',
    });
    expect(commands).toEqual([{ action: 'start', inputSource: 'system' }]);
  });

  it('rejects a second start while the first is in progress', () => {
    const { coordinator, commands } = createCoordinator();
    expect(coordinator.start()).toEqual({ accepted: true });
    expect(coordinator.start()).toEqual({
      accepted: false,
      reason: 'recording cannot be started',
    });
    expect(commands).toHaveLength(1);
  });

  it('requests a stop only while recording', () => {
    const { store, coordinator, commands } = createCoordinator();
    expect(coordinator.stop()).toEqual({
      accepted: false,
      reason: 'recording is not active',
    });

    store.startRequested('both');
    store.markRecording({
      meetingId: '00000000-0000-4000-8000-000000000001',
      meetingDir: '/tmp/Kataribe/2026/meeting',
      startedAt: '2026-10-29T05:05:00.000Z',
      sampleRate: 48000,
      inputSource: 'both',
    });

    expect(coordinator.stop()).toEqual({ accepted: true });
    expect(store.getState().status).toBe('stopping');
    expect(commands).toEqual([{ action: 'stop' }]);
  });

  it('moves to the error state when the renderer is not available', () => {
    const { store, coordinator } = createCoordinator(false);

    expect(coordinator.start()).toEqual({
      accepted: false,
      reason: 'recorder window is not ready',
    });
    expect(store.getState()).toMatchObject({
      status: 'error',
      error: 'recorder window is not ready',
    });
  });

  it('toggles between start and stop', () => {
    const { store, coordinator } = createCoordinator();

    expect(coordinator.toggle()).toEqual({ accepted: true });
    store.markRecording({
      meetingId: '00000000-0000-4000-8000-000000000001',
      meetingDir: '/tmp/Kataribe/2026/meeting',
      startedAt: '2026-10-29T05:05:00.000Z',
      sampleRate: 48000,
      inputSource: 'both',
    });
    expect(coordinator.toggle()).toEqual({ accepted: true });
    expect(store.getState().status).toBe('stopping');
  });
});
