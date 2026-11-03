import {
  chmod,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { frontMatterString, parseFrontMatter } from '../shared/markdown';
import type {
  EnhancementAudioSource,
  EnhancementFile,
  EnhancementSavedAudio,
  EnhancementState,
  EnhancementTranscriptionEntry,
  EnhancementTranscriptionSettings,
  ReuseModel,
} from '../shared/types';
import { REUSE_MODELS } from '../shared/types';
import { hashFile } from './asset-download';
import type { MeetingMeta, MeetingMetaEnhancement } from './meeting-meta';
import {
  getReuseModelDefinition,
  isReuseModel,
} from './reuse-models';

export const ENHANCEMENT_SCHEMA_VERSION = 1;
export const ENHANCEMENT_FILE_NAME = 'enhancement.json';

const DEFAULT_SETTINGS = {
  chunk_seconds: 5,
  hop_seconds: 2.5,
  crossfade_seconds: 0.5,
};

const STATES: readonly EnhancementState[] = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
];

export type EnhancementReadResult =
  | { state: 'ok'; file: EnhancementFile }
  | { state: 'missing' }
  | { state: 'broken'; error: string };

export type EnhancementLoadResult = {
  file: EnhancementFile | null;
  warning: string | null;
};

function emptyTranscriptionSettings(
  overrides: Partial<EnhancementTranscriptionSettings> = {},
): EnhancementTranscriptionSettings {
  return {
    engine: 'whisper-cpp',
    whisper_model: '',
    chunk_seconds: null,
    hop_seconds: null,
    crossfade_seconds: null,
    ...overrides,
  };
}

export function emptyTranscriptionEntry(
  state: EnhancementState = 'pending',
): EnhancementTranscriptionEntry {
  return {
    state,
    path: null,
    input_sha256: '',
    output_sha256: null,
    model: null,
    model_sha256: null,
    settings: emptyTranscriptionSettings(),
    chars: null,
    started_at: null,
    finished_at: null,
    elapsed_seconds: null,
    error: null,
  };
}

export function createEnhancementFile(
  source: EnhancementAudioSource,
): EnhancementFile {
  return {
    schema_version: ENHANCEMENT_SCHEMA_VERSION,
    source,
    saved_audio: {},
    transcription: {
      source_input_sha256: null,
      raw: emptyTranscriptionEntry(),
      models: {},
      primary: { source: 'raw', path: null },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isState(value: unknown): value is EnhancementState {
  return STATES.includes(value as EnhancementState);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function isAudioSource(value: unknown): value is EnhancementAudioSource {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.path === 'string' &&
    value.path.length > 0 &&
    isSha256(value.sha256) &&
    Number.isInteger(value.sample_rate) &&
    (value.sample_rate as number) > 0 &&
    (value.channels === 1 || value.channels === 2)
  );
}

function isSettings(value: unknown): value is EnhancementTranscriptionSettings {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.engine === 'whisper-cpp' || value.engine === 'openai') &&
    typeof value.whisper_model === 'string' &&
    (value.chunk_seconds === null || isNonNegativeNumber(value.chunk_seconds)) &&
    (value.hop_seconds === null || isNonNegativeNumber(value.hop_seconds)) &&
    (value.crossfade_seconds === null || isNonNegativeNumber(value.crossfade_seconds))
  );
}

function isEnhancementSettings(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeNumber(value.chunk_seconds) &&
    isNonNegativeNumber(value.hop_seconds) &&
    isNonNegativeNumber(value.crossfade_seconds)
  );
}

function isSavedAudio(value: unknown): value is EnhancementSavedAudio {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isState(value.state) &&
    isSha256(value.model_sha256) &&
    isAudioSource(value.input) &&
    (value.output === null ||
      (isRecord(value.output) &&
        typeof value.output.path === 'string' &&
        isSha256(value.output.sha256))) &&
    isEnhancementSettings(value.settings) &&
    (value.started_at === null || typeof value.started_at === 'string') &&
    (value.finished_at === null || typeof value.finished_at === 'string') &&
    (value.elapsed_seconds === null || isNonNegativeNumber(value.elapsed_seconds)) &&
    isNullableString(value.error)
  );
}

function isTranscriptionEntry(value: unknown): value is EnhancementTranscriptionEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isState(value.state) &&
    isNullableString(value.path) &&
    typeof value.input_sha256 === 'string' &&
    isNullableString(value.output_sha256) &&
    isNullableString(value.model) &&
    isNullableString(value.model_sha256) &&
    isSettings(value.settings) &&
    (value.chars === null || isNonNegativeNumber(value.chars)) &&
    (value.started_at === null || typeof value.started_at === 'string') &&
    (value.finished_at === null || typeof value.finished_at === 'string') &&
    (value.elapsed_seconds === null || isNonNegativeNumber(value.elapsed_seconds)) &&
    isNullableString(value.error)
  );
}

function isTranscription(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (!isNullableString(value.source_input_sha256) || !isTranscriptionEntry(value.raw) || !isRecord(value.models)) {
    return false;
  }
  for (const [key, entry] of Object.entries(value.models)) {
    if (!isReuseModel(key) || !isTranscriptionEntry(entry)) {
      return false;
    }
  }
  if (!isRecord(value.primary)) {
    return false;
  }
  return (
    (value.primary.source === 'raw' || isReuseModel(value.primary.source)) &&
    isNullableString(value.primary.path)
  );
}

/**
 * `enhancement.json` の値を検証し、型付きの値として返す。
 */
export function validateEnhancementFile(value: unknown): EnhancementFile {
  if (!isRecord(value) || value.schema_version !== ENHANCEMENT_SCHEMA_VERSION) {
    throw new Error('unsupported enhancement schema version');
  }
  if (!isAudioSource(value.source)) {
    throw new Error('invalid enhancement source');
  }
  if (!isRecord(value.saved_audio)) {
    throw new Error('invalid enhancement saved audio');
  }
  for (const [key, entry] of Object.entries(value.saved_audio)) {
    if (!isReuseModel(key) || !isSavedAudio(entry)) {
      throw new Error('invalid enhancement saved audio entry');
    }
  }
  if (!isTranscription(value.transcription)) {
    throw new Error('invalid enhancement transcription');
  }
  return value as EnhancementFile;
}

/**
 * `enhancement.json` を読み、存在しない場合と壊れている場合を区別する。
 */
export async function readEnhancementFile(
  meetingDir: string,
): Promise<EnhancementReadResult> {
  const path = join(meetingDir, ENHANCEMENT_FILE_NAME);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return { state: 'missing' };
    }
    return {
      state: 'broken',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    return { state: 'ok', file: validateEnhancementFile(JSON.parse(text) as unknown) };
  } catch (error) {
    return {
      state: 'broken',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * `enhancement.json` を一時ファイルと rename で書き、失敗時は以前のファイルを残す。
 */
export async function writeEnhancementFile(
  meetingDir: string,
  file: EnhancementFile,
): Promise<void> {
  const validated = validateEnhancementFile(file);
  const path = join(meetingDir, ENHANCEMENT_FILE_NAME);
  const tempPath = `${path}.tmp`;
  const handle = await open(tempPath, 'w', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(tempPath, 0o600);
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await syncDirectory(dirname(path));
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch {
    // Some file systems do not support fsync on a directory.
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
  }
}

function latestState(
  entries: Array<EnhancementState | undefined>,
): EnhancementState | null {
  return entries.find((state) => state !== undefined) ?? null;
}

/**
 * `enhancement.json` から、`meta.json` に持つ要約を作る。
 */
export function metaEnhancementFromFile(
  file: EnhancementFile,
): MeetingMetaEnhancement {
  const savedAudioModels = REUSE_MODELS.filter(
    (model) => file.saved_audio[model]?.state === 'succeeded',
  );
  const transcriptModels = REUSE_MODELS.filter(
    (model) => file.transcription.models[model]?.state === 'succeeded',
  );
  return {
    savedAudioModels,
    savedAudioState:
      latestState(
        REUSE_MODELS.map((model) => file.saved_audio[model]?.state),
      ) ?? undefined,
    hasRawTranscript: file.transcription.raw.state === 'succeeded',
    transcriptModels,
    primarySource: file.transcription.primary.source,
  };
}

/**
 * `meta.json` の音声強調の要約を `enhancement.json` から更新する。
 */
export function updateMetaEnhancement(
  meta: MeetingMeta,
  file: EnhancementFile,
): void {
  meta.enhancement = metaEnhancementFromFile(file);
}

function modelSha(model: ReuseModel): string {
  return getReuseModelDefinition(model).sha256;
}

async function fileHash(path: string): Promise<string | null> {
  try {
    return await hashFile(path);
  } catch {
    return null;
  }
}

async function rebuiltSavedAudio(
  meetingDir: string,
  source: EnhancementAudioSource,
): Promise<EnhancementFile['saved_audio']> {
  const result: EnhancementFile['saved_audio'] = {};
  let names: string[];
  try {
    names = await readdir(meetingDir);
  } catch {
    return result;
  }
  for (const model of REUSE_MODELS) {
    const fileName = `audio.enhanced.${model}.mp3`;
    if (!names.includes(fileName)) {
      continue;
    }
    const path = join(meetingDir, fileName);
    const sha256 = await fileHash(path);
    if (!sha256) {
      continue;
    }
    const info = await stat(path);
    result[model] = {
      state: 'succeeded',
      model_sha256: modelSha(model),
      input: source,
      output: { path: fileName, sha256 },
      settings: { ...DEFAULT_SETTINGS },
      started_at: null,
      finished_at: info.mtime.toISOString(),
      elapsed_seconds: null,
      error: null,
    };
  }
  return result;
}

async function rebuiltTranscriptionEntry(
  meetingDir: string,
  fileName: string,
  source: EnhancementAudioSource,
  model: string | null,
): Promise<EnhancementTranscriptionEntry | null> {
  let markdown: string;
  try {
    markdown = await readFile(join(meetingDir, fileName), 'utf8');
  } catch {
    return null;
  }
  const parsed = parseFrontMatter(markdown);
  const sha256 = await fileHash(join(meetingDir, fileName));
  if (!sha256) {
    return null;
  }
  return {
    state: 'succeeded',
    path: fileName,
    input_sha256: source.sha256,
    output_sha256: sha256,
    model: frontMatterString(parsed, 'model') ?? model,
    model_sha256: null,
    settings: emptyTranscriptionSettings({
      whisper_model: frontMatterString(parsed, 'model') ?? '',
    }),
    chars: parsed.body.length,
    started_at: null,
    finished_at: null,
    elapsed_seconds: null,
    error: null,
  };
}

/**
 * 壊れた `enhancement.json` を会議フォルダの派生物から再構築する。
 */
export async function rebuildEnhancementFile(
  meetingDir: string,
  source: EnhancementAudioSource,
): Promise<EnhancementFile | null> {
  const savedAudio = await rebuiltSavedAudio(meetingDir, source);
  const raw = await rebuiltTranscriptionEntry(
    meetingDir,
    'transcript.raw.md',
    source,
    null,
  );
  const enhanced = await rebuiltTranscriptionEntry(
    meetingDir,
    'transcript.nemotronlabs.md',
    source,
    null,
  );
  if (enhanced) {
    enhanced.model_sha256 = modelSha('nemotronlabs');
  }
  if (
    Object.keys(savedAudio).length === 0 &&
    raw === null &&
    enhanced === null
  ) {
    return null;
  }
  const models: Partial<Record<ReuseModel, EnhancementTranscriptionEntry>> = {};
  if (enhanced) {
    models.nemotronlabs = enhanced;
  }
  const primarySource: 'raw' | ReuseModel = enhanced ? 'nemotronlabs' : 'raw';
  const primaryPath = enhanced
    ? 'transcript.md'
    : raw
      ? 'transcript.md'
      : null;
  return {
    schema_version: ENHANCEMENT_SCHEMA_VERSION,
    source,
    saved_audio: savedAudio,
    transcription: {
      source_input_sha256: raw?.input_sha256 ?? enhanced?.input_sha256 ?? null,
      raw: raw ?? emptyTranscriptionEntry(),
      models,
      primary: { source: primarySource, path: primaryPath },
    },
  };
}

/**
 * `enhancement.json` を読み、壊れていれば派生物から再構築する。
 * 再構築できないときは警告を返し、会議フォルダは変更しない。
 */
export async function loadEnhancementFile(
  meetingDir: string,
  source: EnhancementAudioSource,
): Promise<EnhancementLoadResult> {
  const read = await readEnhancementFile(meetingDir);
  if (read.state === 'ok') {
    return { file: read.file, warning: null };
  }
  if (read.state === 'missing') {
    return { file: null, warning: null };
  }
  const rebuilt = await rebuildEnhancementFile(meetingDir, source);
  if (!rebuilt) {
    return {
      file: null,
      warning: `enhancement.json is broken and could not be rebuilt: ${read.error}`,
    };
  }
  await writeEnhancementFile(meetingDir, rebuilt);
  return { file: rebuilt, warning: null };
}


export function isAllowedEnhancementPath(name: string): boolean {
  return REUSE_MODELS.some(
    (model) =>
      name === `audio.enhanced.${model}.mp3` ||
      name === `transcript.${model}.md`,
  );
}
