import type { SummaryLanguage } from './types';

export type FrontMatterValue = string | number | boolean | null;

export type ParsedMarkdown = {
  frontMatter: Record<string, FrontMatterValue>;
  body: string;
  hasFrontMatter: boolean;
};

export type TranscriptSegment = {
  startSeconds: number;
  endSeconds?: number;
  speaker?: string;
  text: string;
};

export type SummarySectionKey = 'summary' | 'decisions' | 'todo' | 'openQuestions';

export const SUMMARY_HEADINGS: Record<
  SummaryLanguage,
  Record<SummarySectionKey, string>
> = {
  ja: {
    summary: '要約',
    decisions: '決定事項',
    todo: 'ToDo',
    openQuestions: '未決事項',
  },
  en: {
    summary: 'Summary',
    decisions: 'Decisions',
    todo: 'ToDo',
    openQuestions: 'Open Questions',
  },
};

const HEADING_ALIASES: Array<{
  key: SummarySectionKey;
  pattern: RegExp;
}> = [
  { key: 'summary', pattern: /^(要約|summary)$/i },
  { key: 'decisions', pattern: /^(決定事項|decisions?)$/i },
  { key: 'todo', pattern: /^(todo|to-do|todos|to-dos|やること|タスク)$/i },
  {
    key: 'openQuestions',
    pattern: /^(未決事項|open questions?|open issues?)$/i,
  },
];

const SECTION_HEADING_PATTERN = /^##\s+(.+?)\s*$/u;
const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})/u;
const FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,})\s*$/u;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function parseScalar(value: string): FrontMatterValue {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === '~') {
    return null;
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return unquote(trimmed);
}

export function parseFrontMatter(markdown: string): ParsedMarkdown {
  if (!markdown.startsWith('---\n') && !markdown.startsWith('---\r\n')) {
    return { frontMatter: {}, body: markdown, hasFrontMatter: false };
  }
  const normalized = markdown.replaceAll('\r\n', '\n');
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return { frontMatter: {}, body: markdown, hasFrontMatter: false };
  }
  const header = normalized.slice(4, end);
  const body = normalized.slice(end + 5);
  const frontMatter: Record<string, FrontMatterValue> = {};
  for (const line of header.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue;
    }
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (!key) {
      continue;
    }
    frontMatter[key] = parseScalar(line.slice(separator + 1));
  }
  return { frontMatter, body, hasFrontMatter: true };
}

function quoteValue(value: FrontMatterValue): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const text = value.trim();
  if (
    text === '' ||
    /^[\s"'#&*!|>%@`{[\],?:-]/.test(text) ||
    /[:#\n]/.test(text) ||
    /^(true|false|null|~|-?\d+(\.\d+)?)$/i.test(text)
  ) {
    return JSON.stringify(value);
  }
  return value;
}

export function stringifyFrontMatter(
  fields: Record<string, FrontMatterValue>,
  body: string,
): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    lines.push(`${key}: ${quoteValue(value)}`);
  }
  lines.push('---', '');
  const normalizedBody = body.replaceAll('\r\n', '\n').replace(/\s+$/u, '');
  return `${lines.join('\n')}${normalizedBody}${normalizedBody ? '\n' : '\n'}`;
}

export function formatTimestamp(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return [hours, minutes, remainder]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

export function formatDurationHms(seconds: number): string {
  return formatTimestamp(seconds);
}

export function sanitizeTranscriptText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

export function formatTranscriptBody(segments: TranscriptSegment[]): string {
  return segments
    .filter((segment) => sanitizeTranscriptText(segment.text).length > 0)
    .map((segment) => {
      const speaker = segment.speaker?.trim();
      const prefix = speaker ? `${speaker}: ` : '';
      return `[${formatTimestamp(segment.startSeconds)}] ${prefix}${sanitizeTranscriptText(segment.text)}`;
    })
    .join('\n');
}

const TRANSCRIPT_LINE_PATTERN = /^\[(\d{2}):(\d{2}):(\d{2})\]\s?(.*)$/u;

export type ParsedTranscriptLine = {
  lineNumber: number;
  startSeconds: number | null;
  text: string;
};

export function parseTranscriptBody(body: string): ParsedTranscriptLine[] {
  return body.replaceAll('\r\n', '\n').split('\n').map((line, index) => {
    const match = line.match(TRANSCRIPT_LINE_PATTERN);
    if (!match) {
      return {
        lineNumber: index + 1,
        startSeconds: null,
        text: line,
      };
    }
    return {
      lineNumber: index + 1,
      startSeconds:
        Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]),
      text: match[4],
    };
  });
}

export type TranscriptMarkdownInput = {
  title: string;
  startedAt: string;
  durationSeconds: number;
  source: string;
  model: string;
  language: string;
  segments: TranscriptSegment[];
  partial?: boolean;
};

export function formatTranscriptMarkdown(input: TranscriptMarkdownInput): string {
  const fields: Record<string, FrontMatterValue> = {
    title: input.title,
    date: input.startedAt,
    duration: formatDurationHms(input.durationSeconds),
    source: input.source,
    model: input.model,
    language: input.language,
  };
  if (input.partial) {
    fields.partial = true;
  }
  return stringifyFrontMatter(fields, formatTranscriptBody(input.segments));
}

export type TranslationMarkdownInput = {
  title: string;
  startedAt: string;
  durationSeconds: number;
  source: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: SummaryLanguage;
  provider: string;
  generatedAt: string;
  segments: TranscriptSegment[];
  partial?: boolean;
};

export function formatTranslationMarkdown(
  input: TranslationMarkdownInput,
): string {
  const fields: Record<string, FrontMatterValue> = {
    title: input.title,
    date: input.startedAt,
    duration: formatDurationHms(input.durationSeconds),
    source: input.source,
    model: input.model,
    language: input.targetLanguage,
    source_language: input.sourceLanguage,
    provider: input.provider,
    generated_at: input.generatedAt,
  };
  if (input.partial) {
    fields.partial = true;
  }
  return stringifyFrontMatter(fields, formatTranscriptBody(input.segments));
}

function normalizeTodoContent(content: string): string {
  const lines = content.split('\n');
  const hasCheckbox = lines.some((line) => /^\s*[-*]\s+\[[ xX]\]\s+/.test(line));
  if (hasCheckbox) {
    return content;
  }
  return lines
    .map((line) => {
      if (/^\s*[-*]\s+\S/.test(line)) {
        return line.replace(/^(\s*)[-*]\s+/, '$1- [ ] ');
      }
      return line;
    })
    .join('\n');
}

function cleanSectionContent(content: string): string {
  return content.replace(/^\s*\n/, '').replace(/\s+$/u, '');
}

export type NormalizedSummary = {
  body: string;
  language: SummaryLanguage;
  missingSections: SummarySectionKey[];
};

export function normalizeSummaryMarkdown(
  raw: string,
  language: SummaryLanguage,
): NormalizedSummary {
  let text = raw.replaceAll('\r\n', '\n').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z0-9_-]*\n/, '').replace(/\n```$/u, '');
  }

  const sections: Record<SummarySectionKey, string[]> = {
    summary: [],
    decisions: [],
    todo: [],
    openQuestions: [],
  };
  const extraBlocks: Array<{ heading: string; content: string[] }> = [];
  let current: SummarySectionKey | null = 'summary';
  let currentExtra: { heading: string; content: string[] } | null = null;
  let sawHeading = false;

  for (const line of text.split('\n')) {
    const heading = line.match(SECTION_HEADING_PATTERN);
    if (heading) {
      if (currentExtra) {
        extraBlocks.push(currentExtra);
        currentExtra = null;
      }
      sawHeading = true;
      const title = heading[1].trim();
      const alias = HEADING_ALIASES.find((entry) => entry.pattern.test(title));
      if (alias) {
        current = alias.key;
      } else {
        current = null;
        currentExtra = { heading: title, content: [] };
      }
      continue;
    }
    if (currentExtra) {
      currentExtra.content.push(line);
    } else if (current) {
      sections[current].push(line);
    }
  }
  if (currentExtra) {
    extraBlocks.push(currentExtra);
  }
  if (!sawHeading) {
    sections.summary = [text];
  }

  const missingSections: SummarySectionKey[] = [];
  const headings = SUMMARY_HEADINGS[language];
  const blocks: string[] = [];
  for (const key of ['summary', 'decisions', 'todo', 'openQuestions'] as const) {
    let content = cleanSectionContent(sections[key].join('\n'));
    if (key === 'todo') {
      content = normalizeTodoContent(content);
    }
    if (!content) {
      missingSections.push(key);
    }
    blocks.push(`## ${headings[key]}${content ? `\n\n${content}` : ''}`);
  }

  for (const block of extraBlocks) {
    const content = cleanSectionContent(block.content.join('\n'));
    if (content) {
      blocks.push(`## ${block.heading}\n\n${content}`);
    }
  }

  return {
    body: `${blocks.join('\n\n').replace(/\s+$/u, '')}\n`,
    language,
    missingSections,
  };
}

export function formatSummaryMarkdown(input: {
  title: string;
  date: string;
  provider: string;
  model: string;
  generatedAt: string;
  language: SummaryLanguage;
  body: string;
  extraFields?: Record<string, FrontMatterValue>;
}): string {
  const normalized = normalizeSummaryMarkdown(input.body, input.language);
  return stringifyFrontMatter(
    {
      ...(input.extraFields ?? {}),
      title: input.title,
      date: input.date,
      provider: input.provider,
      model: input.model,
      generated_at: input.generatedAt,
      language: input.language,
    },
    normalized.body,
  );
}

/** 要約の ToDo セクションにあるチェックボックス項目。 */
export type TodoItem = {
  lineNumber: number;
  checked: boolean;
  text: string;
};

/** チェックボックスを書き換えられなかった理由。 */
export type SetTodoCheckedFailure =
  | 'line-out-of-range'
  | 'not-checkbox'
  | 'text-mismatch'
  | 'not-todo';

/** チェックボックスの書き換え結果。 */
export type SetTodoCheckedResult =
  | { ok: true; markdown: string }
  | { ok: false; reason: SetTodoCheckedFailure };

const TODO_CHECKBOX_PATTERN = /^(\s*[-*]\s+)\[([ xX])\](.*)$/u;

type CodeFence = {
  marker: string;
  length: number;
};

function openingCodeFence(line: string): CodeFence | null {
  const match = line.match(FENCE_OPEN_PATTERN);
  if (!match) {
    return null;
  }
  return { marker: match[1][0], length: match[1].length };
}

function closesCodeFence(line: string, fence: CodeFence): boolean {
  const match = line.match(FENCE_CLOSE_PATTERN);
  return (
    match !== null &&
    match[1][0] === fence.marker &&
    match[1].length === fence.length
  );
}

function isTodoHeading(title: string): boolean {
  const todo = HEADING_ALIASES.find((entry) => entry.key === 'todo');
  return todo !== undefined && todo.pattern.test(title);
}

function parseTodoLine(line: string, lineNumber: number): TodoItem | null {
  const match = line.match(TODO_CHECKBOX_PATTERN);
  if (!match) {
    return null;
  }
  const text = match[3].trim();
  if (text.length === 0) {
    return null;
  }
  return { lineNumber, checked: match[2] !== ' ', text };
}

/**
 * 要約本文の ToDo セクションにあるチェックボックス行を返す。
 *
 * 行番号は front matter を除いた本文の先頭を 0 とする。
 */
export function parseTodoItems(body: string): TodoItem[] {
  const items: TodoItem[] = [];
  let inTodoSection = false;
  let fence: CodeFence | null = null;
  const lines = body.replaceAll('\r\n', '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (closesCodeFence(line, fence)) {
        fence = null;
      }
      continue;
    }
    const opening = openingCodeFence(line);
    if (opening) {
      fence = opening;
      continue;
    }
    const heading = line.match(SECTION_HEADING_PATTERN);
    if (heading) {
      inTodoSection = isTodoHeading(heading[1].trim());
      continue;
    }
    if (!inTodoSection) {
      continue;
    }
    const item = parseTodoLine(line, index);
    if (item) {
      items.push(item);
    }
  }
  return items;
}

/**
 * 要約 Markdown の指定行が一覧の項目と一致するときだけ、チェックボックスを書き換える。
 *
 * front matter と内容はそのまま残し、改行コードは LF に正規化する。行番号、行の形式、
 * 本文が ToDo セクションの項目と一致しないときは書き換えず、理由を返す。
 */
export function setTodoChecked(
  markdown: string,
  lineNumber: number,
  expectedText: string,
  checked: boolean,
): SetTodoCheckedResult {
  const normalized = markdown.replaceAll('\r\n', '\n');
  const parsed = parseFrontMatter(markdown);
  const frontMatterEnd = parsed.hasFrontMatter
    ? normalized.indexOf('\n---\n', 4)
    : -1;
  const prefix =
    frontMatterEnd === -1 ? '' : normalized.slice(0, frontMatterEnd + 5);
  const body =
    frontMatterEnd === -1 ? normalized : normalized.slice(frontMatterEnd + 5);
  const lines = body.split('\n');
  if (
    !Number.isInteger(lineNumber) ||
    lineNumber < 0 ||
    lineNumber >= lines.length
  ) {
    return { ok: false, reason: 'line-out-of-range' };
  }
  const line = lines[lineNumber];
  const match = line.match(TODO_CHECKBOX_PATTERN);
  if (!match) {
    return { ok: false, reason: 'not-checkbox' };
  }
  if (match[3].trim() !== expectedText) {
    return { ok: false, reason: 'text-mismatch' };
  }
  const isTodoItem = parseTodoItems(body).some(
    (item) => item.lineNumber === lineNumber && item.text === expectedText,
  );
  if (!isTodoItem) {
    return { ok: false, reason: 'not-todo' };
  }
  const checkboxIndex = match[1].length + 1;
  lines[lineNumber] = `${line.slice(0, checkboxIndex)}${
    checked ? 'x' : ' '
  }${line.slice(checkboxIndex + 1)}`;
  return { ok: true, markdown: `${prefix}${lines.join('\n')}` };
}

export function detectSummaryLanguage(markdown: string): SummaryLanguage {
  const parsed = parseFrontMatter(markdown);
  const value = parsed.frontMatter.language;
  if (value === 'ja' || value === 'en') {
    return value;
  }
  return /^##\s+(Summary|Decisions|Open Questions)\s*$/m.test(parsed.body)
    ? 'en'
    : 'ja';
}

export function frontMatterString(
  parsed: ParsedMarkdown,
  key: string,
): string | null {
  const value = parsed.frontMatter[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
