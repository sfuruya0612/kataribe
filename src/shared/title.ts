const INVALID_FILENAME = /[/\\:*?"<>|\u0000-\u001f]/gu;
const MAX_TITLE_BYTES = 120;

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
  fallback = 'タイトル未入力',
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
