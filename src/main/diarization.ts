import { availableParallelism } from 'node:os';
import type { DiarizationModelProgress, SpeakerCount } from '../shared/types';
import type { TranscriptSegment } from '../shared/markdown';
import { speakerLabel } from '../shared/speakers';
import type {
  DiarizationModelManager,
  DiarizationModelPaths,
} from './diarization-models';
import type { BinaryLocator } from './media';
import { runProcess } from './process';
import { readWavInfo } from './wav';

export type DiarizationTurn = {
  startSeconds: number;
  endSeconds: number;
  speaker: string;
};

export type DiarizationProgressPhase = 'models' | 'diarization';

export type DiarizationProgress = {
  phase: DiarizationProgressPhase;
  progress: number | null;
};

export type DiarizationOptions = {
  numSpeakers: SpeakerCount;
  signal?: AbortSignal;
  onProgress?: (progress: DiarizationProgress) => void;
};

export type DiarizationModels = Pick<DiarizationModelManager, 'ensureInstalled'>;

export type DiarizationBinaryLocator = Pick<BinaryLocator, 'sherpaDiarizationPath'>;

type DiarizationCommandResult = {
  output: string;
};

export type DiarizationServiceOptions = {
  locator: DiarizationBinaryLocator;
  models: DiarizationModels;
  threads?: number;
  inactivityTimeoutMs?: number;
  maxSpeakers?: number;
};

const DEFAULT_MAX_SPEAKERS = 10;
const DEFAULT_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const CLUSTER_THRESHOLD = 0.9;
const NEAREST_TURN_SECONDS = 1;

const TURN_PATTERN =
  /^\s*(\d+(?:\.\d+)?)\s+--\s+(\d+(?:\.\d+)?)\s+(\S+)\s*$/u;
const PROGRESS_PATTERN = /^progress\s+(\d+(?:\.\d+)?)%\s*$/u;

/**
 * sherpa-onnx の進捗行を 0〜1 の値に変換する。
 */
export function parseDiarizationProgressLine(line: string): number | null {
  const match = line.match(PROGRESS_PATTERN);
  if (!match) {
    return null;
  }
  const value = Number(match[1]) / 100;
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

/**
 * sherpa-onnx の話者ターン出力を解析する。
 */
export function parseDiarizationOutput(output: string): DiarizationTurn[] {
  const turns: DiarizationTurn[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(TURN_PATTERN);
    if (!match) {
      continue;
    }
    const startSeconds = Number(match[1]);
    const endSeconds = Number(match[2]);
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      startSeconds < 0 ||
      endSeconds <= startSeconds
    ) {
      continue;
    }
    turns.push({ startSeconds, endSeconds, speaker: match[3] });
  }
  return turns.sort((left, right) => left.startSeconds - right.startSeconds);
}

function uniqueSpeakers(turns: readonly DiarizationTurn[]): number {
  return new Set(turns.map((turn) => turn.speaker)).size;
}

function turnDistance(
  segmentStart: number,
  segmentEnd: number,
  turn: DiarizationTurn,
): number {
  if (turn.endSeconds <= segmentStart) {
    return segmentStart - turn.endSeconds;
  }
  if (turn.startSeconds >= segmentEnd) {
    return turn.startSeconds - segmentEnd;
  }
  return 0;
}

function durationsBySpeaker(
  turns: readonly DiarizationTurn[],
): Map<string, number> {
  const durations = new Map<string, number>();
  for (const turn of turns) {
    durations.set(
      turn.speaker,
      (durations.get(turn.speaker) ?? 0) + (turn.endSeconds - turn.startSeconds),
    );
  }
  return durations;
}

function firstStartBySpeaker(
  turns: readonly DiarizationTurn[],
): Map<string, number> {
  const starts = new Map<string, number>();
  for (const turn of turns) {
    const current = starts.get(turn.speaker);
    starts.set(
      turn.speaker,
      current === undefined ? turn.startSeconds : Math.min(current, turn.startSeconds),
    );
  }
  return starts;
}

/**
 * 話者数を上限に抑え、あふれた話者のターンを最も近い残存ターンへ割り当てる。
 */
export function limitSpeakerTurns(
  turns: readonly DiarizationTurn[],
  maxSpeakers: number,
): DiarizationTurn[] {
  const limit = Math.max(1, Math.floor(maxSpeakers));
  const durations = durationsBySpeaker(turns);
  if (durations.size <= limit) {
    return [...turns];
  }
  const starts = firstStartBySpeaker(turns);
  const ranked = [...durations.keys()].sort(
    (left, right) =>
      (durations.get(right) ?? 0) - (durations.get(left) ?? 0) ||
      (starts.get(left) ?? 0) - (starts.get(right) ?? 0),
  );
  const kept = new Set(ranked.slice(0, limit));
  const keptTurns = turns.filter((turn) => kept.has(turn.speaker));
  if (keptTurns.length === 0) {
    return [];
  }
  return turns.map((turn) => {
    if (kept.has(turn.speaker)) {
      return turn;
    }
    const midpoint = (turn.startSeconds + turn.endSeconds) / 2;
    let nearest = keptTurns[0];
    let nearestDistance = Math.abs(
      midpoint - (nearest.startSeconds + nearest.endSeconds) / 2,
    );
    for (const candidate of keptTurns.slice(1)) {
      const distance = Math.abs(
        midpoint - (candidate.startSeconds + candidate.endSeconds) / 2,
      );
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    return { ...turn, speaker: nearest.speaker };
  });
}

/**
 * 文字起こしセグメントへ話者ターンを割り当て、話者 A から順にラベルを付ける。
 */
export function assignSpeakerTurns(
  segments: readonly TranscriptSegment[],
  turns: readonly DiarizationTurn[],
  maxSpeakers = DEFAULT_MAX_SPEAKERS,
): TranscriptSegment[] | null {
  if (turns.length === 0 || uniqueSpeakers(turns) < 2) {
    return null;
  }
  const limited = limitSpeakerTurns(turns, maxSpeakers);
  const starts = firstStartBySpeaker(limited);
  const turnOrder = [...starts.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([speaker]) => speaker);
  const orderIndex = new Map(
    turnOrder.map((speaker, index) => [speaker, index] as const),
  );
  const assigned = segments.map((segment) => {
    const start = Math.max(0, segment.startSeconds);
    const end = Math.max(start, segment.endSeconds ?? start + 1);
    const overlaps = new Map<string, number>();
    for (const turn of limited) {
      const overlap = Math.min(end, turn.endSeconds) - Math.max(start, turn.startSeconds);
      if (overlap > 0) {
        overlaps.set(turn.speaker, (overlaps.get(turn.speaker) ?? 0) + overlap);
      }
    }
    let selected: string | null = null;
    let bestOverlap = 0;
    for (const [speaker, overlap] of overlaps) {
      if (
        overlap > bestOverlap ||
        (overlap === bestOverlap &&
          selected !== null &&
          (orderIndex.get(speaker) ?? 0) < (orderIndex.get(selected) ?? 0))
      ) {
        selected = speaker;
        bestOverlap = overlap;
      }
    }
    if (selected === null) {
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const turn of limited) {
        const distance = turnDistance(start, end, turn);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          selected = turn.speaker;
        }
      }
      if (nearestDistance > NEAREST_TURN_SECONDS) {
        selected = null;
      }
    }
    return selected;
  });

  const labels = new Map<string, string>();
  for (const speaker of assigned) {
    if (speaker === null || labels.has(speaker)) {
      continue;
    }
    labels.set(speaker, speakerLabel(labels.size));
  }
  if (labels.size === 0) {
    return null;
  }
  return segments.map((segment, index) => {
    const speaker = assigned[index];
    if (speaker === null) {
      return { ...segment };
    }
    return { ...segment, speaker: labels.get(speaker) ?? speaker };
  });
}

function buildArgs(
  wavPath: string,
  paths: DiarizationModelPaths,
  threads: number,
  numSpeakers: SpeakerCount | number,
): string[] {
  const args = [
    `--segmentation.pyannote-model=${paths.segmentation}`,
    `--embedding.model=${paths.embedding}`,
    `--segmentation.num-threads=${threads}`,
    `--embedding.num-threads=${threads}`,
  ];
  if (numSpeakers === 'auto') {
    args.push(`--clustering.cluster-threshold=${CLUSTER_THRESHOLD}`);
  } else {
    args.push(`--clustering.num-clusters=${numSpeakers}`);
  }
  args.push(wavPath);
  return args;
}

/**
 * sherpa-onnx の子プロセスを起動し、話者分離を実行する。
 */
export class DiarizationService {
  private readonly locator: DiarizationBinaryLocator;
  private readonly models: DiarizationModels;
  private readonly threads: number;
  private readonly inactivityTimeoutMs: number;
  readonly maxSpeakers: number;

  constructor(options: DiarizationServiceOptions) {
    this.locator = options.locator;
    this.models = options.models;
    this.threads =
      options.threads ?? Math.max(1, Math.min(4, availableParallelism()));
    this.inactivityTimeoutMs =
      options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
    this.maxSpeakers = options.maxSpeakers ?? DEFAULT_MAX_SPEAKERS;
  }

  async diarize(
    wavPath: string,
    segments: readonly TranscriptSegment[],
    options: DiarizationOptions,
  ): Promise<TranscriptSegment[] | null> {
    if (segments.length === 0) {
      return null;
    }
    const info = await readWavInfo(wavPath);
    if (
      info.channels !== 1 ||
      info.bitsPerSample !== 16 ||
      info.sampleRate !== 16000
    ) {
      return null;
    }
    const binary = await this.locator.sherpaDiarizationPath();
    const paths = await this.models.ensureInstalled(
      options.signal,
      (progress: DiarizationModelProgress) => {
        options.onProgress?.({ phase: 'models', progress: progress.progress });
      },
    );
    const first = await this.runOnce(
      binary,
      wavPath,
      paths,
      options,
      options.numSpeakers,
    );
    if (first === null) {
      return null;
    }
    let turns = parseDiarizationOutput(first.output);
    if (
      options.numSpeakers === 'auto' &&
      uniqueSpeakers(turns) > this.maxSpeakers
    ) {
      try {
        const second = await this.runOnce(
          binary,
          wavPath,
          paths,
          options,
          this.maxSpeakers,
        );
        if (second !== null) {
          const limitedTurns = parseDiarizationOutput(second.output);
          if (uniqueSpeakers(limitedTurns) >= 2) {
            turns = limitedTurns;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`speaker diarization retry failed: ${message}`);
      }
    }
    return assignSpeakerTurns(segments, turns, this.maxSpeakers);
  }

  private async runOnce(
    binary: string,
    wavPath: string,
    paths: DiarizationModelPaths,
    options: DiarizationOptions,
    numSpeakers: SpeakerCount | number,
  ): Promise<DiarizationCommandResult | null> {
    if (options.signal?.aborted) {
      return null;
    }
    const controller = new AbortController();
    const outputLines: string[] = [];
    let timedOut = false;
    let timer: NodeJS.Timeout | null = null;
    const resetTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.inactivityTimeoutMs);
      timer.unref?.();
    };
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    resetTimer();
    options.onProgress?.({ phase: 'diarization', progress: 0 });
    try {
      const result = await runProcess({
        command: binary,
        args: buildArgs(wavPath, paths, this.threads, numSpeakers),
        signal: controller.signal,
        onStdoutLine: (line) => outputLines.push(line),
        onStderrLine: (line) => {
          const progress = parseDiarizationProgressLine(line);
          if (progress === null) {
            return;
          }
          resetTimer();
          options.onProgress?.({ phase: 'diarization', progress });
        },
      });
      if (timedOut) {
        throw new Error('speaker diarization timed out');
      }
      if (options.signal?.aborted || result.aborted) {
        return null;
      }
      if (result.code !== 0) {
        throw new Error(
          `speaker diarization failed: ${result.stderr.trim() || `exit code ${result.code ?? 'unknown'}`}`,
        );
      }
      return { output: outputLines.join('\n') };
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}
