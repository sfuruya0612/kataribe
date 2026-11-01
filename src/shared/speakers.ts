import { translate } from './i18n';
import type { UiLanguage } from './types';

const SPEAKER_LABELS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
] as const;

const MAX_SPEAKER_NAME_LENGTH = 40;
const TRANSCRIPT_LINE = /^\[\d{2}:\d{2}:\d{2}\]\s?(.*)$/u;
const AUTO_SPEAKER_NAME = /^話者(?:[A-J]|\d+)$/u;

/**
 * 話者の並び順から表示ラベルを作る。
 */
export function speakerLabel(index: number): string {
  const normalized = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const letter = SPEAKER_LABELS[normalized];
  return `話者${letter ?? String(normalized + 1)}`;
}

function parseSpeakerName(line: string): string | null {
  const content = line.match(TRANSCRIPT_LINE)?.[1] ?? null;
  if (content === null) {
    return null;
  }
  const separator = content.indexOf(': ');
  if (separator <= 0 || separator > MAX_SPEAKER_NAME_LENGTH) {
    return null;
  }
  const name = content.slice(0, separator).trim();
  if (
    name.length === 0 ||
    name.length > MAX_SPEAKER_NAME_LENGTH ||
    name.includes(':') ||
    name.includes('[') ||
    name.includes(']') ||
    name.includes('\n') ||
    name.includes('\r')
  ) {
    return null;
  }
  return name;
}

function collectSpeakerNames(
  body: string,
  accept: (name: string) => boolean,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of body.split('\n')) {
    const name = parseSpeakerName(line.replace(/\r$/u, ''));
    if (name === null || !accept(name) || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * 文字起こしの本文から、自動ラベルまたは既知の話者名を最初に現れた順に取り出す。
 */
export function extractTranscriptSpeakers(
  body: string,
  knownNames: readonly string[] = [],
): string[] {
  const known = new Set(
    knownNames.map((name) => name.trim()).filter((name) => name.length > 0),
  );
  return collectSpeakerNames(
    body,
    (name) => AUTO_SPEAKER_NAME.test(name) || known.has(name),
  );
}

/**
 * 既知の話者名が古いときに、本文のラベル数が期待値と一致する場合だけ復旧する。
 */
export function recoverTranscriptSpeakers(
  body: string,
  expectedCount: number,
): string[] {
  if (expectedCount < 2) {
    return [];
  }
  const names = collectSpeakerNames(body, () => true);
  return names.length === expectedCount ? names : [];
}

/**
 * 話者名の入力を検証し、前後の空白を除いた名前を返す。
 */
export function validateSpeakerNames(
  names: readonly string[],
  locale: UiLanguage = 'ja',
): string[] {
  const trimmed = names.map((name) => name.trim());
  const seen = new Set<string>();
  for (const name of trimmed) {
    if (name.length === 0) {
      throw new Error(translate(locale, '話者名を空にすることはできません。'));
    }
    if (name.length > MAX_SPEAKER_NAME_LENGTH) {
      throw new Error(
        translate(locale, '話者名は {max} 文字以内にしてください。', {
          max: MAX_SPEAKER_NAME_LENGTH,
        }),
      );
    }
    if (name.includes(':')) {
      throw new Error(
        translate(locale, '話者名にコロンを含めることはできません。'),
      );
    }
    if (name.includes('\n') || name.includes('\r')) {
      throw new Error(
        translate(locale, '話者名に改行を含めることはできません。'),
      );
    }
    if (name.includes('[') || name.includes(']')) {
      throw new Error(
        translate(locale, '話者名に角括弧を含めることはできません。'),
      );
    }
    if (seen.has(name)) {
      throw new Error(translate(locale, '話者名が重複しています。'));
    }
    seen.add(name);
  }
  return trimmed;
}

function renameLine(line: string, entries: ReadonlyArray<readonly [string, string]>): string {
  const carriageReturn = line.endsWith('\r') ? '\r' : '';
  const content = carriageReturn ? line.slice(0, -1) : line;
  const timestamp = content.match(/^(\[\d{2}:\d{2}:\d{2}\]\s?)(.*)$/u);
  if (!timestamp) {
    return line;
  }
  const prefix = timestamp[1];
  const rest = timestamp[2];
  for (const [oldName, newName] of entries) {
    if (oldName === newName || !rest.startsWith(`${oldName}: `)) {
      continue;
    }
    return `${prefix}${newName}: ${rest.slice(oldName.length + 2)}${carriageReturn}`;
  }
  return line;
}

/**
 * 文字起こしの行頭にある話者名を置換する。
 */
export function renameTranscriptSpeakers(
  markdown: string,
  mapping: ReadonlyMap<string, string>,
): string {
  const entries = [...mapping.entries()].sort(
    ([left], [right]) => right.length - left.length,
  );
  return markdown
    .split('\n')
    .map((line) => renameLine(line, entries))
    .join('\n');
}
