import { DEFAULT_CLIPPING_CONFIG } from './clipping';
import type { RecordingAppState } from './types';

export function createInitialRecordingAppState(): RecordingAppState {
  return {
    status: 'idle',
    inputSource: 'both',
    session: null,
    startedAt: null,
    elapsedSeconds: 0,
    level: null,
    captureStats: null,
    chunkCount: 0,
    lastResult: null,
    lastMeetingDir: null,
    notice: null,
    clipping: null,
    clippingConfig: { ...DEFAULT_CLIPPING_CONFIG },
    error: null,
  };
}
