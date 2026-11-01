import type { TranscriptSegment } from '../shared/markdown';
import type { SpeakerCount } from '../shared/types';
import type { DiarizationProgress, DiarizationService } from './diarization';
import { turnsToCache, type DiarizationResult } from './diarization';
import {
  DIARIZATION_CACHE_SCHEMA_VERSION,
  type DiarizationCache,
} from './diarization-cache';
import type { MeetingMetaDiarization } from './meeting-meta';

export type RunDiarizationOptions = {
  service: DiarizationService;
  wavPath: string;
  segments: readonly TranscriptSegment[];
  numSpeakers: SpeakerCount;
  signal: AbortSignal;
  cache?: DiarizationCache | null;
  audioSha256?: string;
  onProgress?: (progress: DiarizationProgress) => void;
};

export type RunDiarizationResult = {
  segments: TranscriptSegment[];
  meta: MeetingMetaDiarization;
  cache: DiarizationCache | null;
  cacheHit: boolean;
};

function toCache(result: DiarizationResult): DiarizationCache {
  const allowedClusters = new Set(Object.values(result.labels));
  const names = Object.fromEntries(
    Object.entries(result.names).filter(([cluster]) =>
      allowedClusters.has(cluster),
    ),
  );
  return {
    schema_version: DIARIZATION_CACHE_SCHEMA_VERSION,
    key: result.cacheKey,
    turns: turnsToCache(result.turns),
    names,
    labels: result.labels,
  };
}

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
      cache: options.cache,
      audioSha256: options.audioSha256,
      onProgress: options.onProgress,
    });
    if (result === null) {
      if (options.signal.aborted) {
        return {
          segments: [...options.segments],
          meta: { state: 'failed', error: 'speaker diarization was cancelled' },
          cache: null,
          cacheHit: false,
        };
      }
      return {
        segments: [...options.segments],
        meta: { state: 'completed', speakers: 0 },
        cache: null,
        cacheHit: false,
      };
    }
    const speakers = new Set(
      result.segments
        .map((segment) => segment.speaker)
        .filter(
          (speaker): speaker is string =>
            typeof speaker === 'string' && speaker.length > 0,
        ),
    );
    return {
      segments: result.segments,
      meta: { state: 'completed', speakers: speakers.size },
      cache: toCache(result),
      cacheHit: result.cacheHit,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`speaker diarization failed: ${message}`);
    return {
      segments: [...options.segments],
      meta: { state: 'failed', error: message.slice(0, 2000) },
      cache: null,
      cacheHit: false,
    };
  }
}
