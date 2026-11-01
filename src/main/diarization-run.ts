import type { TranscriptSegment } from '../shared/markdown';
import type { SpeakerCount } from '../shared/types';
import type { DiarizationProgress, DiarizationService } from './diarization';
import type { MeetingMetaDiarization } from './meeting-meta';

export type RunDiarizationOptions = {
  service: DiarizationService;
  wavPath: string;
  segments: readonly TranscriptSegment[];
  numSpeakers: SpeakerCount;
  signal: AbortSignal;
  onProgress?: (progress: DiarizationProgress) => void;
};

export type RunDiarizationResult = {
  segments: TranscriptSegment[];
  meta: MeetingMetaDiarization;
};

/**
 * 話者分離を実行し、失敗しても文字起こしを失わない結果に畳み込む。
 */
export async function runDiarization(
  options: RunDiarizationOptions,
): Promise<RunDiarizationResult> {
  try {
    const result = await options.service.diarize(options.wavPath, options.segments, {
      numSpeakers: options.numSpeakers,
      signal: options.signal,
      onProgress: options.onProgress,
    });
    if (result === null) {
      if (options.signal.aborted) {
        return {
          segments: [...options.segments],
          meta: { state: 'failed', error: 'speaker diarization was cancelled' },
        };
      }
      return {
        segments: [...options.segments],
        meta: { state: 'completed', speakers: 0 },
      };
    }
    const speakers = new Set(
      result
        .map((segment) => segment.speaker)
        .filter(
          (speaker): speaker is string =>
            typeof speaker === 'string' && speaker.length > 0,
        ),
    );
    return {
      segments: result,
      meta: { state: 'completed', speakers: speakers.size },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`speaker diarization failed: ${message}`);
    return {
      segments: [...options.segments],
      meta: { state: 'failed', error: message.slice(0, 2000) },
    };
  }
}
