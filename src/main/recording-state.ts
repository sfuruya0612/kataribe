import { createInitialRecordingAppState } from '../shared/recording-state';
import type {
  InputSource,
  RecordingAppState,
  RecordingEvent,
  RecordingLevel,
  RecordingLevelUpdate,
  RecordingSession,
  RecordingStopResult,
} from '../shared/types';

export type RecordingStateStoreOptions = {
  now: () => number;
  onStateChange: (state: RecordingAppState) => void;
  onLevelChange: (update: RecordingLevelUpdate) => void;
};

const INPUT_SOURCES: InputSource[] = ['microphone', 'system', 'both'];

function isInputSource(value: string): value is InputSource {
  return INPUT_SOURCES.includes(value as InputSource);
}

export class RecordingStateStore {
  private status = createInitialRecordingAppState().status;
  private inputSource: InputSource = createInitialRecordingAppState().inputSource;
  private session: RecordingSession | null = null;
  private startedAtMs: number | null = null;
  private level: RecordingLevel | null = null;
  private captureStats: RecordingAppState['captureStats'] = null;
  private chunkCount = 0;
  private lastResult: RecordingStopResult | null = null;
  private lastMeetingDir: string | null = null;
  private notice: RecordingEvent | null = null;
  private error: string | null = null;
  private readonly now: () => number;
  private readonly onStateChange: (state: RecordingAppState) => void;
  private readonly onLevelChange: (update: RecordingLevelUpdate) => void;

  constructor(options: RecordingStateStoreOptions) {
    this.now = options.now;
    this.onStateChange = options.onStateChange;
    this.onLevelChange = options.onLevelChange;
  }

  getState(): RecordingAppState {
    return {
      status: this.status,
      inputSource: this.inputSource,
      session: this.session,
      startedAt: this.session?.startedAt ?? null,
      elapsedSeconds: this.computeElapsedSeconds(),
      level: this.level,
      captureStats: this.captureStats,
      chunkCount: this.chunkCount,
      lastResult: this.lastResult,
      lastMeetingDir: this.lastMeetingDir,
      notice: this.notice,
      error: this.error,
    };
  }

  getStatus(): RecordingAppState['status'] {
    return this.status;
  }

  getInputSource(): InputSource {
    return this.inputSource;
  }

  canStart(): boolean {
    return this.status === 'idle' || this.status === 'encoding' || this.status === 'error';
  }

  canStop(): boolean {
    return this.status === 'recording';
  }

  setInputSource(source: InputSource): boolean {
    if (!isInputSource(source)) {
      return false;
    }
    if (this.inputSource === source) {
      return true;
    }
    this.inputSource = source;
    this.emitState();
    return true;
  }

  startRequested(source?: InputSource): boolean {
    if (!this.canStart()) {
      return false;
    }
    if (source !== undefined) {
      if (!isInputSource(source)) {
        return false;
      }
      this.inputSource = source;
    }
    this.status = 'starting';
    this.session = null;
    this.startedAtMs = null;
    this.level = null;
    this.captureStats = null;
    this.chunkCount = 0;
    this.lastResult = null;
    this.notice = null;
    this.error = null;
    this.emitState();
    return true;
  }

  markRecording(session: RecordingSession): void {
    if (this.status === 'recording') {
      return;
    }
    this.status = 'recording';
    this.session = session;
    this.startedAtMs = Date.parse(session.startedAt);
    if (!Number.isFinite(this.startedAtMs)) {
      this.startedAtMs = this.now();
    }
    this.lastMeetingDir = session.meetingDir;
    this.level = null;
    this.captureStats = null;
    this.chunkCount = 0;
    this.notice = null;
    this.error = null;
    this.emitState();
  }

  stopRequested(): boolean {
    if (this.status !== 'recording') {
      return false;
    }
    this.status = 'stopping';
    this.emitState();
    return true;
  }

  markStopped(result: RecordingStopResult): void {
    this.status = 'encoding';
    this.session = null;
    this.startedAtMs = null;
    this.level = null;
    this.captureStats = result.captureStats ?? null;
    this.lastResult = result;
    this.lastMeetingDir = result.meetingDir;
    this.error = null;
    this.emitState();
  }

  markRecovered(result: RecordingStopResult): void {
    this.status = 'encoding';
    this.session = null;
    this.startedAtMs = null;
    this.level = null;
    this.captureStats = result.captureStats ?? null;
    this.lastResult = result;
    this.lastMeetingDir = result.meetingDir;
    this.error = null;
    this.emitState();
  }

  markError(message: string): void {
    this.status = 'error';
    this.session = null;
    this.startedAtMs = null;
    this.level = null;
    this.captureStats = null;
    this.lastResult = null;
    this.notice = null;
    this.error = message;
    this.emitState();
  }

  markStartupFailure(event: RecordingEvent, meetingDir: string): void {
    this.status = 'error';
    this.session = null;
    this.startedAtMs = null;
    this.level = null;
    this.captureStats = null;
    this.chunkCount = 0;
    this.lastResult = null;
    this.lastMeetingDir = meetingDir;
    this.notice = event;
    this.error = event.message;
    this.emitState();
  }

  setNotice(event: RecordingEvent): void {
    this.notice = event;
    this.emitState();
  }

  setLevel(update: RecordingLevelUpdate): void {
    if (this.status !== 'recording' && this.status !== 'stopping') {
      return;
    }
    if (
      !Number.isFinite(update.level.peak) ||
      !Number.isFinite(update.level.rms) ||
      !Number.isFinite(update.stats.frames)
    ) {
      return;
    }
    this.level = { peak: update.level.peak, rms: update.level.rms };
    this.captureStats = update.stats;
    this.onLevelChange({
      level: this.level,
      stats: this.captureStats,
    });
  }

  incrementChunkCount(): void {
    if (this.status !== 'recording' && this.status !== 'stopping') {
      return;
    }
    this.chunkCount += 1;
    this.emitState();
  }

  tick(): void {
    if (this.status === 'recording' || this.status === 'stopping') {
      this.emitState();
    }
  }

  private computeElapsedSeconds(): number {
    if (this.captureStats && this.captureStats.sampleRate > 0) {
      return Math.max(0, this.captureStats.frames / this.captureStats.sampleRate);
    }
    if (this.startedAtMs !== null) {
      return Math.max(0, (this.now() - this.startedAtMs) / 1000);
    }
    if (this.lastResult) {
      return Math.max(0, this.lastResult.actualSamples / this.lastResult.sampleRate);
    }
    return 0;
  }

  private emitState(): void {
    this.onStateChange(this.getState());
  }
}
