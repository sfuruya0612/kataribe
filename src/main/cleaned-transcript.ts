import { createHash } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  formatDurationHms,
  parseFrontMatter,
  stringifyFrontMatter,
} from '../shared/markdown';
import type {
  CleanedTranscriptDocument,
  CleanedTranscriptState,
} from '../shared/types';
import { writePrivateText } from './private-file';

export const CLEANED_TRANSCRIPT_FILE = 'transcript.cleaned.md';

const CLEANED_TRANSCRIPT_STATES: CleanedTranscriptState[] = [
  'completed',
  'partial',
  'failed',
];

/**
 * 文字起こし本文のハッシュを返す。
 * クリーニング済み文字起こしが現在の transcript.md に対応するかを判定する。
 */
export function hashTranscriptBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export function cleanedTranscriptPath(meetingDir: string): string {
  return join(meetingDir, CLEANED_TRANSCRIPT_FILE);
}

function toState(value: unknown): CleanedTranscriptState | null {
  return CLEANED_TRANSCRIPT_STATES.includes(value as CleanedTranscriptState)
    ? (value as CleanedTranscriptState)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function readCleanedTranscript(
  meetingDir: string,
): Promise<CleanedTranscriptDocument | null> {
  const path = cleanedTranscriptPath(meetingDir);
  let markdown: string;
  try {
    markdown = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseFrontMatter(markdown);
  const sourceHash = asString(parsed.frontMatter.source_sha256);
  if (!sourceHash) {
    return null;
  }
  const updatedAt = await stat(path)
    .then((info) => info.mtime.toISOString())
    .catch(() => null);
  return {
    markdown,
    body: parsed.body.trim(),
    sourceHash,
    state: toState(parsed.frontMatter.cleanup_state),
    generatedAt: asString(parsed.frontMatter.generated_at),
    provider: asString(parsed.frontMatter.provider),
    model: asString(parsed.frontMatter.model),
    updatedAt,
  };
}

export type WriteCleanedTranscriptInput = {
  title: string;
  startedAt: string;
  durationSeconds: number;
  language: string | null;
  sourceBody: string;
  body: string;
  state: CleanedTranscriptState;
  provider: string;
  model: string;
  generatedAt: string;
};

export async function writeCleanedTranscript(
  meetingDir: string,
  input: WriteCleanedTranscriptInput,
): Promise<void> {
  const fields: Record<string, string | number | boolean | null> = {
    title: input.title,
    date: input.startedAt,
    duration: formatDurationHms(input.durationSeconds),
    source: 'transcript.md',
    source_sha256: hashTranscriptBody(input.sourceBody),
    provider: input.provider,
    model: input.model,
    generated_at: input.generatedAt,
    cleanup_state: input.state,
  };
  if (input.language) {
    fields.language = input.language;
  }
  await writePrivateText(
    cleanedTranscriptPath(meetingDir),
    stringifyFrontMatter(fields, input.body),
  );
}

export async function removeCleanedTranscript(meetingDir: string): Promise<void> {
  await rm(cleanedTranscriptPath(meetingDir), { force: true });
}
