import { readdir, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  EnhancementFile,
  EnhancementState,
  ReuseDiskUsage,
  ReuseModel,
} from '../shared/types';
import { REUSE_MODELS } from '../shared/types';
import {
  readMeetingMeta,
  updateMeetingMeta,
  type MeetingMeta,
} from './meeting-meta';
import type { MeetingStore } from './meetings';
import {
  emptyTranscriptionEntry,
  readEnhancementFile,
  updateMetaEnhancement,
  writeEnhancementFile,
} from './reuse-metadata';

export type EnhancementInvalidationScope = 'saved-audio' | 'comparison' | 'all';

const MINIMUM_FREE_BYTES = 64 * 1024 * 1024;
const ENHANCED_TEMP_FILE = 'audio.16k.enhanced.wav';
const DECODED_TEMP_FILE = 'audio.decoded.wav';

/**
 * 音声強調を開始する前に必要な空き容量を満たしているか確認する。
 */
export class EnhancementDiskSpaceError extends Error {
  readonly requiredBytes: number;
  readonly availableBytes: number;

  constructor(requiredBytes: number, availableBytes: number) {
    super(
      `not enough disk space for speech enhancement: need ${requiredBytes} bytes, have ${availableBytes}`,
    );
    this.name = 'EnhancementDiskSpaceError';
    this.requiredBytes = requiredBytes;
    this.availableBytes = availableBytes;
  }
}

async function defaultFreeBytes(path: string): Promise<number> {
  const info = await statfs(path);
  return info.bavail * info.bsize;
}

export async function assertEnhancementDiskSpace(
  inputBytes: number,
  tempDir: string,
  options: {
    freeBytes?: (path: string) => Promise<number>;
    minimumFreeBytes?: number;
  } = {},
): Promise<{ requiredBytes: number; availableBytes: number }> {
  const freeBytes = options.freeBytes ?? defaultFreeBytes;
  const requiredBytes =
    Math.max(0, Math.ceil(inputBytes)) * 3 +
    (options.minimumFreeBytes ?? MINIMUM_FREE_BYTES);
  const availableBytes = await freeBytes(tempDir);
  if (availableBytes < requiredBytes) {
    throw new EnhancementDiskSpaceError(requiredBytes, availableBytes);
  }
  return { requiredBytes, availableBytes };
}

function isRecoveryTranscriptionState(state: unknown): boolean {
  return (
    state === 'partial' ||
    state === 'failed' ||
    state === 'cancelled' ||
    state === 'interrupted'
  );
}

function comparisonIncomplete(file: EnhancementFile | null): boolean {
  if (!file || file.transcription.source_input_sha256 === null) {
    return false;
  }
  const states: Array<EnhancementState | undefined> = [
    file.transcription.raw.state,
    ...REUSE_MODELS.map((model) => file.transcription.models[model]?.state),
  ];
  return states.some(
    (state) => state !== undefined && state !== 'succeeded',
  );
}

/**
 * 失敗、キャンセル、中断のあとに再試行できるデータを残すかを判定する。
 */
export function shouldKeepRecoveryData(
  meta: MeetingMeta,
  enhancement: EnhancementFile | null,
): boolean {
  if (meta.status === 'error') {
    return true;
  }
  if (isRecoveryTranscriptionState(meta.transcription?.state)) {
    return true;
  }
  return comparisonIncomplete(enhancement);
}

async function readMeta(meetingDir: string): Promise<MeetingMeta | null> {
  try {
    return await readMeetingMeta(join(meetingDir, 'meta.json'));
  } catch {
    return null;
  }
}

/**
 * 会議の一時ファイルを削除する。復旧に必要な chunks と 16 kHz WAV は残す。
 */
export async function cleanupMeetingTemp(
  tempRoot: string,
  meetingId: string,
  meetingDir: string,
): Promise<void> {
  const directory = join(tempRoot, meetingId);
  const meta = await readMeta(meetingDir);
  const read = await readEnhancementFile(meetingDir);
  const enhancement = read.state === 'ok' ? read.file : null;
  const keepRecovery = meta !== null && shouldKeepRecoveryData(meta, enhancement);
  await rm(join(directory, ENHANCED_TEMP_FILE), { force: true }).catch(
    () => undefined,
  );
  await rm(join(directory, DECODED_TEMP_FILE), { force: true }).catch(
    () => undefined,
  );
  if (!keepRecovery) {
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

/**
 * 起動時に、復旧データを持たない会議の tmp ディレクトリを削除する。
 */
export async function cleanupOrphanedTempDirs(
  tempRoot: string,
  meetingStore: MeetingStore,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(tempRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const meetings = new Map(
    (await meetingStore.list()).map((meeting) => [meeting.id, meeting]),
  );
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'children') {
      continue;
    }
    const meeting = meetings.get(entry.name);
    if (meeting) {
      const meta = await readMeta(meeting.meetingDir);
      const read = await readEnhancementFile(meeting.meetingDir);
      if (
        meta !== null &&
        shouldKeepRecoveryData(
          meta,
          read.state === 'ok' ? read.file : null,
        )
      ) {
        continue;
      }
    }
    await rm(join(tempRoot, entry.name), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    removed.push(entry.name);
  }
  return removed;
}

export async function removeMeetingTemp(
  tempRoot: string,
  meetingId: string,
): Promise<void> {
  await rm(join(tempRoot, meetingId), { recursive: true, force: true }).catch(
    () => undefined,
  );
}

async function deleteFiles(
  meetingDir: string,
  names: readonly string[],
): Promise<void> {
  await Promise.all(
    names.map((name) => rm(join(meetingDir, name), { force: true })),
  );
}

function savedAudioNames(): string[] {
  return REUSE_MODELS.map((model) => `audio.enhanced.${model}.mp3`);
}

function comparisonNames(): string[] {
  return [
    'transcript.raw.md',
    ...REUSE_MODELS.map((model) => `transcript.${model}.md`),
    ENHANCED_TEMP_FILE,
  ];
}

/**
 * 古い強調音声と比較用の文字起こしを削除し、enhancement.json と meta.json を更新する。
 */
export async function invalidateEnhancement(
  meetingDir: string,
  scope: EnhancementInvalidationScope,
  reason: string,
): Promise<void> {
  const names: string[] = [];
  if (scope === 'saved-audio' || scope === 'all') {
    names.push(...savedAudioNames());
  }
  if (scope === 'comparison' || scope === 'all') {
    names.push(...comparisonNames());
  }
  if (scope === 'all') {
    names.push('transcript.previous.md');
  }
  await deleteFiles(meetingDir, names);

  const read = await readEnhancementFile(meetingDir);
  if (read.state === 'ok') {
    const file = read.file;
    if (scope === 'saved-audio' || scope === 'all') {
      file.saved_audio = {};
    }
    if (scope === 'comparison' || scope === 'all') {
      file.transcription.source_input_sha256 = null;
      file.transcription.raw = emptyTranscriptionEntry();
      file.transcription.models = {};
      file.transcription.primary = { source: 'raw', path: null };
    }
    await writeEnhancementFile(meetingDir, file);
    await updateMeetingMeta(join(meetingDir, 'meta.json'), (meta) => {
      updateMetaEnhancement(meta, file);
    }).catch(() => undefined);
  }
  console.info(`invalidated speech enhancement (${scope}): ${reason}`);
}

/**
 * 保存済みの強調音声の使用量を、会議フォルダから集計する。
 */
export async function scanSavedAudioUsage(
  meetingStore: MeetingStore,
): Promise<ReuseDiskUsage> {
  let bytes = 0;
  let meetings = 0;
  for (const meeting of await meetingStore.list()) {
    const read = await readEnhancementFile(meeting.meetingDir);
    if (read.state !== 'ok') {
      continue;
    }
    let meetingBytes = 0;
    for (const model of REUSE_MODELS) {
      const entry = read.file.saved_audio[model];
      if (!entry?.output) {
        continue;
      }
      try {
        const info = await stat(join(meeting.meetingDir, entry.output.path));
        meetingBytes += info.size;
      } catch {
        // Missing files are ignored. They are removed by invalidation.
      }
    }
    if (meetingBytes > 0) {
      bytes += meetingBytes;
      meetings += 1;
    }
  }
  return { bytes, meetings };
}

export async function deleteAllSavedAudio(
  meetingStore: MeetingStore,
): Promise<ReuseDiskUsage> {
  const before = await scanSavedAudioUsage(meetingStore);
  for (const meeting of await meetingStore.list()) {
    await invalidateEnhancement(
      meeting.meetingDir,
      'saved-audio',
      'the user deleted enhanced audio from settings',
    );
  }
  return before;
}

export function isSavedAudioModel(value: unknown): value is ReuseModel {
  return REUSE_MODELS.includes(value as ReuseModel);
}

export type EnhancementReconcileOptions = {
  audioSha256: string;
  modelSha256?: Partial<Record<ReuseModel, string>>;
  comparisonInputSha256?: string | null;
  comparisonEnabled?: boolean;
  transcriptionEngine?: 'whisper-cpp' | 'openai';
};

/**
 * 入力音声、モデルの重み、比較セッションの入力が変わったときに古い派生物を削除する。
 */
export async function reconcileEnhancement(
  meetingDir: string,
  options: EnhancementReconcileOptions,
): Promise<EnhancementInvalidationScope | null> {
  const read = await readEnhancementFile(meetingDir);
  if (read.state !== 'ok') {
    return null;
  }
  const file = read.file;
  const reasons: string[] = [];
  let scope: EnhancementInvalidationScope | null = null;
  if (file.source.sha256 !== options.audioSha256) {
    reasons.push('audio.mp3 changed');
    scope = 'all';
  }
  for (const model of REUSE_MODELS) {
    const expected = options.modelSha256?.[model];
    if (!expected) {
      continue;
    }
    const saved = file.saved_audio[model];
    const comparison = file.transcription.models[model];
    if (
      (saved && saved.model_sha256 !== expected) ||
      (comparison &&
        comparison.model_sha256 !== null &&
        comparison.model_sha256 !== expected)
    ) {
      reasons.push(`${model} weights changed`);
      scope = 'all';
      break;
    }
  }
  if (scope === null) {
    if (
      options.comparisonEnabled === false ||
      options.transcriptionEngine === 'openai'
    ) {
      reasons.push('comparison is disabled');
      scope = 'comparison';
    } else if (
      options.comparisonInputSha256 !== undefined &&
      file.transcription.source_input_sha256 !== null &&
      file.transcription.source_input_sha256 !== options.comparisonInputSha256
    ) {
      reasons.push('comparison input changed');
      scope = 'comparison';
    }
  }
  if (scope === null) {
    return null;
  }
  await invalidateEnhancement(meetingDir, scope, reasons.join(', '));
  return scope;
}
