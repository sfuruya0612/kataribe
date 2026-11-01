import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SpeakerCount } from '../shared/types';

export const DIARIZATION_CACHE_SCHEMA_VERSION = 1;
export const DIARIZATION_CACHE_FILE = 'diarization.json';

export type DiarizationCacheKey = {
  audio_sha256: string;
  segmentation_sha256: string;
  embedding_sha256: string;
  speaker_count: SpeakerCount;
  cluster_threshold: number;
  threads: number;
};

export type DiarizationCacheTurn = {
  start: number;
  end: number;
  cluster: string;
};

export type DiarizationCache = {
  schema_version: number;
  key: DiarizationCacheKey;
  turns: DiarizationCacheTurn[];
  names: Record<string, string>;
  labels: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function isSpeakerCount(value: unknown): value is SpeakerCount {
  return (
    value === 'auto' ||
    (typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= 10)
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([key, item]) => isNonEmptyString(key) && isNonEmptyString(item),
  );
}

function parseKey(value: unknown): DiarizationCacheKey | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isSha256(value.audio_sha256) ||
    !isSha256(value.segmentation_sha256) ||
    !isSha256(value.embedding_sha256) ||
    !isSpeakerCount(value.speaker_count) ||
    typeof value.cluster_threshold !== 'number' ||
    !Number.isFinite(value.cluster_threshold) ||
    value.cluster_threshold < 0 ||
    value.cluster_threshold > 1 ||
    typeof value.threads !== 'number' ||
    !Number.isInteger(value.threads) ||
    value.threads <= 0
  ) {
    return null;
  }
  return {
    audio_sha256: value.audio_sha256,
    segmentation_sha256: value.segmentation_sha256,
    embedding_sha256: value.embedding_sha256,
    speaker_count: value.speaker_count,
    cluster_threshold: value.cluster_threshold,
    threads: value.threads,
  };
}

function parseTurns(value: unknown): DiarizationCacheTurn[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const turns: DiarizationCacheTurn[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    if (
      typeof item.start !== 'number' ||
      !Number.isFinite(item.start) ||
      item.start < 0 ||
      typeof item.end !== 'number' ||
      !Number.isFinite(item.end) ||
      item.end <= item.start ||
      !isNonEmptyString(item.cluster)
    ) {
      return null;
    }
    turns.push({
      start: item.start,
      end: item.end,
      cluster: item.cluster,
    });
  }
  return turns;
}

function parseCache(value: unknown): DiarizationCache | null {
  if (!isRecord(value) || value.schema_version !== DIARIZATION_CACHE_SCHEMA_VERSION) {
    return null;
  }
  const key = parseKey(value.key);
  const turns = parseTurns(value.turns);
  if (
    key === null ||
    turns === null ||
    !isStringRecord(value.names) ||
    !isStringRecord(value.labels)
  ) {
    return null;
  }
  const nameValues = Object.values(value.names);
  const labelValues = Object.values(value.labels);
  if (
    new Set(nameValues).size !== nameValues.length ||
    new Set(labelValues).size !== labelValues.length
  ) {
    return null;
  }
  return {
    schema_version: DIARIZATION_CACHE_SCHEMA_VERSION,
    key,
    turns,
    names: value.names,
    labels: value.labels,
  };
}

/**
 * 会議フォルダの話者分離キャッシュのパスを返す。
 */
export function diarizationCachePath(meetingDir: string): string {
  return join(meetingDir, DIARIZATION_CACHE_FILE);
}

/**
 * 話者分離キャッシュを読み込む。ない場合と不正な場合は null を返す。
 */
export async function readDiarizationCache(
  path: string,
): Promise<DiarizationCache | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(
        `failed to read speaker diarization cache: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const cache = parseCache(parsed);
    if (cache === null) {
      console.error('speaker diarization cache is invalid');
    }
    return cache;
  } catch (error) {
    console.error(
      `failed to parse speaker diarization cache: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * 話者分離キャッシュを一時ファイル経由で保存する。
 */
export async function writeDiarizationCache(
  path: string,
  cache: DiarizationCache,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  const handle = await open(temporary, 'w', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(cache, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

/**
 * 2 つのキャッシュキーが同じ話者分離の入力を表すか返す。
 */
export function matchesCacheKey(
  left: DiarizationCacheKey,
  right: DiarizationCacheKey,
): boolean {
  return (
    left.audio_sha256 === right.audio_sha256 &&
    left.segmentation_sha256 === right.segmentation_sha256 &&
    left.embedding_sha256 === right.embedding_sha256 &&
    left.speaker_count === right.speaker_count &&
    left.cluster_threshold === right.cluster_threshold &&
    left.threads === right.threads
  );
}

/**
 * 再割り当て前後のクラスタ ID から、表示名の置換対応を作る。
 */
export function buildLabelMapping(
  previous: DiarizationCache,
  next: DiarizationCache,
): Map<string, string> {
  const displayByCluster = new Map(
    Object.entries(next.labels).map(([display, cluster]) => [cluster, display] as const),
  );
  const mapping = new Map<string, string>();
  for (const [display, cluster] of Object.entries(previous.labels)) {
    const nextDisplay = displayByCluster.get(cluster);
    if (nextDisplay !== undefined && nextDisplay !== display) {
      mapping.set(display, nextDisplay);
    }
  }
  return mapping;
}
