import type {
  InputSource,
  RecordingCommand,
  RecordingRequestResult,
} from '../shared/types';
import type { RecordingStateStore } from './recording-state';

export type SendRecordingCommand = (command: RecordingCommand) => boolean;

export class RecordingCoordinator {
  private readonly store: RecordingStateStore;
  private readonly sendCommand: SendRecordingCommand;

  constructor(store: RecordingStateStore, sendCommand: SendRecordingCommand) {
    this.store = store;
    this.sendCommand = sendCommand;
  }

  start(source?: InputSource): RecordingRequestResult {
    if (!this.store.startRequested(source)) {
      return { accepted: false, reason: 'recording cannot be started' };
    }

    const command: RecordingCommand = {
      action: 'start',
      inputSource: this.store.getInputSource(),
    };
    if (!this.sendCommand(command)) {
      const reason = 'recorder window is not ready';
      this.store.markError(reason);
      return { accepted: false, reason };
    }
    return { accepted: true };
  }

  stop(): RecordingRequestResult {
    if (!this.store.stopRequested()) {
      return { accepted: false, reason: 'recording is not active' };
    }

    if (!this.sendCommand({ action: 'stop' })) {
      const reason = 'recorder window is not ready';
      this.store.markError(reason);
      return { accepted: false, reason };
    }
    return { accepted: true };
  }

  toggle(): RecordingRequestResult {
    if (this.store.canStop()) {
      return this.stop();
    }
    if (this.store.canStart()) {
      return this.start();
    }
    return { accepted: false, reason: 'recording state is changing' };
  }
}
