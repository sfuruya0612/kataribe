import { rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WhisperModel } from '../shared/types';
import type { BinaryLocator } from './media';
import { MediaError } from './media';
import { runProcess, ProcessStartError } from './process';
import { readWavInfo } from './wav';
import type { TranscriptSegment } from '../shared/markdown';

export type TranscriptionErrorCode =
  | 'model-missing'
  | 'binary-missing'
  | 'process-failed'
  | 'stalled'
  | 'hard-limit'
  | 'empty-output'
  | 'incomplete'
  | 'cancelled'
  | 'invalid-audio';

export type TranscriptionState = 'completed' | 'partial' | 'cancelled' | 'failed';

export type TranscriptionProgress = {
  segments: TranscriptSegment[];
  language: string;
  lastEndSeconds: number;
  ratio: number;
  etaSeconds: number | null;
  message: string | null;
};

export type TranscriptionOutcome = {
  state: TranscriptionState;
  segments: TranscriptSegment[];
  language: string;
  lastEndSeconds: number;
  durationSeconds: number;
  elapsedSeconds: number;
  errorCode: TranscriptionErrorCode | null;
  error: string | null;
  resumed: boolean;
};

export type TranscribeOptions = {
  meetingId: string;
  tempDir: string;
  audioWavPath: string;
  model: WhisperModel;
  modelPath: string;
  durationSeconds?: number;
  predictedSpeedRatio?: number;
  initialPrompt?: string;
  signal?: AbortSignal;
  onUpdate?: (progress: TranscriptionProgress) => void;
  onPartial?: (outcome: TranscriptionOutcome) => void | Promise<void>;
  onHardLimitExceeded?: (
    elapsedSeconds: number,
    predictedSeconds: number,
  ) => Promise<boolean>;
};

export type TranscriptionServiceOptions = {
  locator: BinaryLocator;
  runner?: typeof runProcess;
  now?: () => number;
  watchdogIntervalMs?: number;
  threads?: number;
};

class PausableClock {
  private readonly realNow: () => number;
  private pausedAtReal: number | null = null;
  private pausedTotal = 0;

  constructor(realNow: () => number) {
    this.realNow = realNow;
  }

  now(): number {
    const real = this.realNow();
    if (this.pausedAtReal !== null) {
      return this.pausedAtReal - this.pausedTotal;
    }
    return real - this.pausedTotal;
  }

  pause(): void {
    if (this.pausedAtReal === null) {
      this.pausedAtReal = this.realNow();
    }
  }

  resume(): void {
    if (this.pausedAtReal !== null) {
      this.pausedTotal += this.realNow() - this.pausedAtReal;
      this.pausedAtReal = null;
    }
  }
}

const SEGMENT_PATTERN =
  /^\[(\d+):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d+):(\d{2}):(\d{2})[.,](\d{3})\]\s*(.*)$/u;
const PROGRESS_PATTERN = /progress\s*=\s*(\d+)%/u;

function timestampToSeconds(
  hours: string,
  minutes: string,
  seconds: string,
  millis: string,
): number {
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(millis) / 1000
  );
}

export function parseWhisperSegmentLine(line: string): TranscriptSegment | null {
  const match = line.match(SEGMENT_PATTERN);
  if (!match) {
    return null;
  }
  return {
    startSeconds: timestampToSeconds(match[1], match[2], match[3], match[4]),
    endSeconds: timestampToSeconds(match[5], match[6], match[7], match[8]),
    text: match[9].trim(),
  };
}

export function parseWhisperProgressLine(line: string): number | null {
  const match = line.match(PROGRESS_PATTERN);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

type WhisperJson = {
  result?: { language?: string };
  params?: { language?: string };
  transcription?: Array<{
    offsets?: { from?: number; to?: number };
    text?: string;
  }>;
};

export function parseWhisperJson(text: string): {
  segments: TranscriptSegment[];
  language: string | null;
} {
  let data: WhisperJson;
  try {
    data = JSON.parse(text) as WhisperJson;
  } catch {
    return { segments: [], language: null };
  }
  const segments: TranscriptSegment[] = [];
  for (const entry of data.transcription ?? []) {
    const from = entry.offsets?.from;
    const to = entry.offsets?.to;
    if (
      typeof from !== 'number' ||
      typeof to !== 'number' ||
      !Number.isFinite(from) ||
      !Number.isFinite(to)
    ) {
      continue;
    }
    segments.push({
      startSeconds: from / 1000,
      endSeconds: to / 1000,
      text: (entry.text ?? '').trim(),
    });
  }
  const language =
    (typeof data.result?.language === 'string' && data.result.language) ||
    (typeof data.params?.language === 'string' && data.params.language !== 'auto'
      ? data.params.language
      : null);
  return { segments, language: language || null };
}

export function isTranscriptionComplete(
  segments: TranscriptSegment[],
  durationSeconds: number,
): boolean {
  const spoken = segments.filter((segment) => segment.text.trim().length > 0);
  if (spoken.length === 0) {
    return false;
  }
  const lastEnd = spoken.reduce(
    (maximum, segment) => Math.max(maximum, segment.endSeconds ?? segment.startSeconds),
    0,
  );
  const threshold = Math.max(0, durationSeconds - 15);
  return lastEnd >= threshold;
}

export function mergeSegments(
  existing: TranscriptSegment[],
  incoming: TranscriptSegment[],
): TranscriptSegment[] {
  const keys = new Set(
    existing.map(
      (segment) =>
        `${segment.startSeconds.toFixed(3)}|${(segment.endSeconds ?? 0).toFixed(3)}|${segment.text}`,
    ),
  );
  const merged = [...existing];
  for (const segment of incoming) {
    const key = `${segment.startSeconds.toFixed(3)}|${(segment.endSeconds ?? 0).toFixed(3)}|${segment.text}`;
    if (!keys.has(key)) {
      keys.add(key);
      merged.push(segment);
    }
  }
  merged.sort(
    (left, right) =>
      left.startSeconds - right.startSeconds ||
      (left.endSeconds ?? 0) - (right.endSeconds ?? 0),
  );
  return merged;
}

export function buildWhisperArgs(options: {
  modelPath: string;
  audioPath: string;
  outputPrefix: string;
  offsetMs?: number;
  initialPrompt?: string;
  threads?: number;
}): string[] {
  const args = [
    '-m',
    options.modelPath,
    '-f',
    options.audioPath,
    '-l',
    'auto',
    '-oj',
    '-of',
    options.outputPrefix,
    '-pp',
    '-sns',
    '-nth',
    '0.6',
  ];
  if (options.threads && options.threads > 0) {
    args.push('-t', String(options.threads));
  }
  if (options.offsetMs && options.offsetMs > 0) {
    args.push('-ot', String(Math.floor(options.offsetMs)));
  }
  if (options.initialPrompt && options.initialPrompt.trim()) {
    args.push('--prompt', options.initialPrompt.trim());
  }
  return args;
}

function attemptSegments(
  lines: TranscriptSegment[],
  jsonSegments: TranscriptSegment[],
  offsetSeconds: number,
): TranscriptSegment[] {
  const source = jsonSegments.length > 0 ? jsonSegments : lines;
  if (source.length === 0) {
    return [];
  }
  const maxEnd = source.reduce(
    (maximum, segment) => Math.max(maximum, segment.endSeconds ?? 0),
    0,
  );
  const needsOffset =
    offsetSeconds > 0 && maxEnd > 0 && maxEnd < offsetSeconds - 0.5;
  return needsOffset
    ? source.map((segment) => ({
        ...segment,
        startSeconds: segment.startSeconds + offsetSeconds,
        endSeconds:
          segment.endSeconds === undefined
            ? undefined
            : segment.endSeconds + offsetSeconds,
      }))
    : source;
}

export class TranscriptionService {
  private readonly locator: BinaryLocator;
  private readonly runner: typeof runProcess;
  private readonly now: () => number;
  private readonly watchdogIntervalMs: number;
  private readonly threads: number;
  private clock: PausableClock | null = null;

  constructor(options: TranscriptionServiceOptions) {
    this.locator = options.locator;
    this.runner = options.runner ?? runProcess;
    this.now = options.now ?? (() => Date.now());
    this.watchdogIntervalMs = options.watchdogIntervalMs ?? 1000;
    this.threads =
      options.threads ??
      Math.max(1, Math.min(8, Number.parseInt(process.env.KATARIBE_WHISPER_THREADS ?? '0', 10) || 4));
  }

  pause(): void {
    this.clock?.pause();
  }

  resume(): void {
    this.clock?.resume();
  }

  async transcribe(options: TranscribeOptions): Promise<TranscriptionOutcome> {
    const clock = new PausableClock(this.now);
    this.clock = clock;
    try {
      return await this.transcribeInternal(options, clock);
    } finally {
      this.clock = null;
    }
  }

  private async transcribeInternal(
    options: TranscribeOptions,
    clock: PausableClock,
  ): Promise<TranscriptionOutcome> {
    const durationSeconds =
      options.durationSeconds ?? (await readWavInfo(options.audioWavPath)).duration;
    const runStartedAt = clock.now();
    let segments: TranscriptSegment[] = [];
    let language = 'auto';
    let resumed = false;
    let hardLimitDecision: boolean | null = null;
    let lastErrorCode: TranscriptionErrorCode | null = null;
    let lastError: string | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const offsetSeconds =
        attempt === 0
          ? 0
          : segments.reduce(
              (maximum, segment) =>
                Math.max(maximum, segment.endSeconds ?? segment.startSeconds),
              0,
            );
      const offsetMs = Math.floor(offsetSeconds * 1000);
      const outputPrefix = join(
        options.tempDir,
        `whisper-${options.meetingId}-${attempt}-${process.pid}-${clock.now()}`,
      );
      const jsonPath = `${outputPrefix}.json`;
      const stdoutSegments: TranscriptSegment[] = [];
      let lastSegmentAt = clock.now();
      let maxProgress = 0;
      let watchdogError: TranscriptionErrorCode | null = null;
      let hardLimitWarned = false;
      const startedAt = clock.now();
      const predictedMs = Math.max(
        durationSeconds * (options.predictedSpeedRatio ?? 0.2) * 1000,
        1,
      );
      const hardLimitMs = Math.max(5 * 60_000, predictedMs * 3);
      const absoluteLimitMs = Math.max(6 * 60 * 60_000, durationSeconds * 6 * 1000);
      const stallLimitMs = options.model.startsWith('large') ? 5 * 60_000 : 3 * 60_000;

      const emit = (message: string | null) => {
        const lastEndSeconds = segments.reduce(
          (maximum, segment) =>
            Math.max(maximum, segment.endSeconds ?? segment.startSeconds),
          0,
        );
        const ratio =
          durationSeconds > 0 ? Math.min(1, lastEndSeconds / durationSeconds) : 0;
        const elapsedSeconds = Math.max(0, (clock.now() - startedAt) / 1000);
        const etaSeconds =
          ratio > 0.01
            ? Math.max(0, Math.round(elapsedSeconds / ratio - elapsedSeconds))
            : null;
        options.onUpdate?.({
          segments,
          language,
          lastEndSeconds,
          ratio,
          etaSeconds,
          message,
        });
      };

      const internal = new AbortController();
      const onUserAbort = () => internal.abort();
      if (options.signal?.aborted) {
        return {
          state: 'cancelled',
          segments,
          language,
          lastEndSeconds: 0,
          durationSeconds,
          elapsedSeconds: Math.max(0, (clock.now() - runStartedAt) / 1000),
          errorCode: 'cancelled',
          error: 'transcription was cancelled',
          resumed,
        };
      }
      options.signal?.addEventListener('abort', onUserAbort, { once: true });

      const watchdog = setInterval(() => {
        if (internal.signal.aborted) {
          return;
        }
        const current = clock.now();
        if (current - lastSegmentAt >= stallLimitMs) {
          watchdogError = 'stalled';
          internal.abort();
          return;
        }
        const elapsed = current - startedAt;
        if (!hardLimitWarned && elapsed >= hardLimitMs) {
          hardLimitWarned = true;
          if (hardLimitDecision === false) {
            watchdogError = 'hard-limit';
            internal.abort();
            return;
          }
          if (hardLimitDecision === null && options.onHardLimitExceeded) {
            void options
              .onHardLimitExceeded(
                elapsed / 1000,
                Math.max(0, Math.round(predictedMs / 1000)),
              )
              .then((shouldContinue) => {
                hardLimitDecision = shouldContinue;
                if (!shouldContinue && !internal.signal.aborted) {
                  watchdogError = 'hard-limit';
                  internal.abort();
                } else if (shouldContinue) {
                  emit('ユーザーの確認により処理を継続しています。');
                }
              })
              .catch(() => {
                hardLimitDecision = false;
                if (!internal.signal.aborted) {
                  watchdogError = 'hard-limit';
                  internal.abort();
                }
              });
          } else {
            emit('予想より時間がかかっています。処理は続行しています。');
          }
        }
        if (elapsed >= absoluteLimitMs) {
          watchdogError = 'hard-limit';
          internal.abort();
        }
      }, this.watchdogIntervalMs);
      watchdog.unref?.();

      try {
        const whisperPath = await this.locator.whisperPath();
        emit(attempt === 0 ? null : '文字起こしを再開しています。');
        const result = await this.runner({
          command: whisperPath,
          args: buildWhisperArgs({
            modelPath: options.modelPath,
            audioPath: options.audioWavPath,
            outputPrefix,
            offsetMs,
            initialPrompt: options.initialPrompt,
            threads: this.threads,
          }),
          signal: internal.signal,
          killGraceMs: 3000,
          onStdoutLine: (line) => {
            const segment = parseWhisperSegmentLine(line);
            if (!segment) {
              return;
            }
            const now = clock.now();
            lastSegmentAt = now;
            stdoutSegments.push(segment);
            const attemptMerged = attemptSegments(stdoutSegments, [], offsetSeconds);
            segments = mergeSegments(segments, attemptMerged.slice(-1));
            emit(null);
          },
          onStderrLine: (line) => {
            const progress = parseWhisperProgressLine(line);
            if (progress === null) {
              return;
            }
            if (progress > maxProgress) {
              maxProgress = progress;
              lastSegmentAt = clock.now();
              emit(null);
            }
          },
        });

        if (result.aborted && options.signal?.aborted) {
          lastErrorCode = 'cancelled';
          lastError = 'transcription was cancelled';
          break;
        }

        let jsonSegments: TranscriptSegment[] = [];
        let jsonLanguage: string | null = null;
        try {
          const parsed = parseWhisperJson(await readFile(jsonPath, 'utf8'));
          jsonSegments = parsed.segments;
          jsonLanguage = parsed.language;
        } catch {
          jsonSegments = [];
        }
        if (jsonLanguage) {
          language = jsonLanguage;
        }
        if (jsonSegments.length > 0) {
          const stdoutKeys = new Set(
            stdoutSegments.map(
              (segment) =>
                `${segment.startSeconds.toFixed(3)}|${(segment.endSeconds ?? 0).toFixed(3)}|${segment.text}`,
            ),
          );
          segments = segments.filter(
            (segment) =>
              !stdoutKeys.has(
                `${segment.startSeconds.toFixed(3)}|${(segment.endSeconds ?? 0).toFixed(3)}|${segment.text}`,
              ),
          );
        }
        const incoming = attemptSegments(stdoutSegments, jsonSegments, offsetSeconds);
        segments = mergeSegments(segments, incoming);

        if (watchdogError === 'stalled' || watchdogError === 'hard-limit') {
          lastErrorCode = watchdogError;
          lastError =
            watchdogError === 'stalled'
              ? 'whisper.cpp stopped producing output'
              : 'transcription exceeded the hard time limit';
        } else if (result.timedOut) {
          lastErrorCode = 'stalled';
          lastError = 'whisper.cpp timed out';
        } else if (result.code !== 0) {
          const stderr = result.stderr.toLowerCase();
          lastErrorCode =
            stderr.includes('model') && stderr.includes('load')
              ? 'model-missing'
              : 'process-failed';
          lastError = `whisper.cpp exited with code ${result.code}`;
        } else if (segments.every((segment) => segment.text.trim().length === 0)) {
          lastErrorCode = 'empty-output';
          lastError = 'whisper.cpp produced no transcription';
        } else if (!isTranscriptionComplete(segments, durationSeconds)) {
          lastErrorCode = 'incomplete';
          lastError = 'whisper.cpp did not finish the audio';
        } else {
          lastErrorCode = null;
          lastError = null;
        }

        await rm(jsonPath, { force: true }).catch(() => undefined);
      } catch (error) {
        if (error instanceof ProcessStartError) {
          lastErrorCode = 'process-failed';
          lastError = error.message;
        } else if (error instanceof MediaError) {
          lastErrorCode =
            error.code === 'binary-missing'
              ? 'binary-missing'
              : error.code === 'cancelled'
                ? 'cancelled'
                : 'process-failed';
          lastError = error.message;
        } else {
          lastErrorCode = 'process-failed';
          lastError = error instanceof Error ? error.message : String(error);
        }
        await rm(jsonPath, { force: true }).catch(() => undefined);
      } finally {
        clearInterval(watchdog);
        options.signal?.removeEventListener('abort', onUserAbort);
      }

      const lastEndSeconds = segments.reduce(
        (maximum, segment) =>
          Math.max(maximum, segment.endSeconds ?? segment.startSeconds),
        0,
      );
      const complete = lastErrorCode === null;
      if (complete) {
        return {
          state: 'completed',
          segments,
          language,
          lastEndSeconds,
          durationSeconds,
          elapsedSeconds: Math.max(0, (clock.now() - runStartedAt) / 1000),
          errorCode: null,
          error: null,
          resumed,
        };
      }
      if (lastErrorCode === 'cancelled') {
        break;
      }

      const partialCodes: TranscriptionErrorCode[] = [
        'incomplete',
        'stalled',
        'hard-limit',
        'empty-output',
      ];
      const resumableCodes: TranscriptionErrorCode[] = [
        'incomplete',
        'stalled',
        'hard-limit',
      ];
      const partial: TranscriptionOutcome = {
        state:
          lastErrorCode !== null && partialCodes.includes(lastErrorCode)
            ? 'partial'
            : 'failed',
        segments,
        language,
        lastEndSeconds,
        durationSeconds,
        elapsedSeconds: Math.max(0, (clock.now() - runStartedAt) / 1000),
        errorCode: lastErrorCode,
        error: lastError,
        resumed,
      };
      await options.onPartial?.(partial);

      const resumable =
        lastErrorCode !== null &&
        resumableCodes.includes(lastErrorCode) &&
        lastEndSeconds > 0 &&
        durationSeconds - lastEndSeconds > 1;
      if (!resumable || attempt > 0) {
        break;
      }
      resumed = true;
    }

    const lastEndSeconds = segments.reduce(
      (maximum, segment) =>
        Math.max(maximum, segment.endSeconds ?? segment.startSeconds),
      0,
    );
    return {
      state: lastErrorCode === 'cancelled' ? 'cancelled' : 'failed',
      segments,
      language,
      lastEndSeconds,
      durationSeconds,
      elapsedSeconds: Math.max(0, (clock.now() - runStartedAt) / 1000),
      errorCode: lastErrorCode,
      error: lastError,
      resumed,
    };
  }
}
