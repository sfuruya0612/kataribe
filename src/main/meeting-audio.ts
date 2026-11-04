import type { ReuseModel } from '../shared/types';
import { isReuseModel } from './reuse-models';

export type MeetingAudioRequest = {
  meetingId: string;
  variant: 'raw' | 'enhanced';
  model: ReuseModel | null;
};

const PREFIX = 'kataribe-audio://meeting/';
const VERSION_QUERY = /^v=[A-Za-z0-9._%~-]{1,128}$/u;

/**
 * 会議音声の URL から、`meeting/` より後ろのパスを取り出す。
 *
 * バージョンは再生するファイルを特定せず、キャッシュを分けるためだけに使う。
 * 任意のクエリを受け付けると、パスやモデルの指定を URL から広げられない
 * という前提が崩れるため、`v` だけを受け付ける。
 */
function audioPathFromUrl(rawUrl: string): string | null {
  if (rawUrl.includes('#')) {
    return null;
  }
  const queryIndex = rawUrl.indexOf('?');
  const path = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  const query = queryIndex === -1 ? null : rawUrl.slice(queryIndex + 1);
  if (query !== null && !VERSION_QUERY.test(query)) {
    return null;
  }
  if (!path.startsWith(PREFIX)) {
    return null;
  }
  return path.slice(PREFIX.length);
}

/**
 * `kataribe-audio` の URL を、会議 ID、音声の種類、モデル ID へ分解する。
 */
export function parseMeetingAudioUrl(rawUrl: string): MeetingAudioRequest | null {
  const path = audioPathFromUrl(rawUrl);
  if (path === null) {
    return null;
  }
  const parts = path.split('/');
  let meetingId: string;
  try {
    meetingId = decodeURIComponent(parts[0] ?? '');
  } catch {
    return null;
  }
  if (meetingId.length === 0 || meetingId.includes('/')) {
    return null;
  }
  if (parts.length === 1) {
    return { meetingId, variant: 'raw', model: null };
  }
  if (parts.length !== 3 || parts[1] !== 'enhanced') {
    return null;
  }
  const model = parts[2];
  if (!isReuseModel(model)) {
    return null;
  }
  return { meetingId, variant: 'enhanced', model };
}
