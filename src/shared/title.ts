const INVALID_FILENAME = /[/\\:*?"<>|\u0000-\u001f]/gu;
const MAX_TITLE_BYTES = 120;

export const DEFAULT_MEETING_TITLE = 'タイトル未入力';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 会議の開始日をローカル日付の YYYY-MM-DD にする。
 * 録音時のフォルダ作成と同じ日付を使う。
 */
export function formatMeetingDatePrefix(startedAt: string): string | null {
  const date = new Date(startedAt);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;
}

/**
 * タイトル先頭の YYYY-MM-DD と区切り文字を分ける。
 * 日付がない場合と、日付の後ろが空の場合は null を返す。
 */
export function splitMeetingDatePrefix(
  title: string,
): { date: string; title: string } | null {
  const match = title.match(/^(\d{4}-\d{2}-\d{2})(?:[_\-\s]+)(.+)$/u);
  if (!match) {
    return null;
  }
  const rest = match[2].trim();
  if (!rest) {
    return null;
  }
  return { date: match[1], title: rest };
}

/**
 * タイトルの先頭に会議の開始日を付ける。
 * LLM がタイトルへ日付を付けている場合は、その日付を会議の開始日に置き換える。
 */
export function addMeetingDatePrefix(title: string, startedAt: string): string {
  const date = formatMeetingDatePrefix(startedAt);
  if (!date) {
    return title;
  }
  const split = splitMeetingDatePrefix(title);
  return `${date}_${split ? split.title : title}`;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) {
    return value;
  }
  let result = '';
  for (const char of value) {
    const next = result + char;
    if (encoder.encode(next).length > maxBytes) {
      break;
    }
    result = next;
  }
  return result;
}

export function sanitizeMeetingTitle(
  raw: string,
  fallback = DEFAULT_MEETING_TITLE,
): string {
  let value = raw
    .normalize('NFC')
    .replace(INVALID_FILENAME, '_')
    .replace(/\s+/gu, ' ')
    .trim();
  value = value.replace(/^\.+/u, '').replace(/\.+$/u, '').trim();
  value = truncateUtf8(value, MAX_TITLE_BYTES).trim();
  if (!value) {
    return fallback;
  }
  return value;
}
