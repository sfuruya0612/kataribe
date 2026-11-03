import type { ReuseModel } from '../shared/types';
import { isReuseModel } from './reuse-models';

export type MeetingAudioRequest = {
  meetingId: string;
  variant: 'raw' | 'enhanced';
  model: ReuseModel | null;
};

const PREFIX = 'kataribe-audio://meeting/';

/**
 * `kataribe-audio` の URL を、会議 ID、音声の種類、モデル ID へ分解する。
 */
export function parseMeetingAudioUrl(rawUrl: string): MeetingAudioRequest | null {
  if (!rawUrl.startsWith(PREFIX)) {
    return null;
  }
  if (rawUrl.includes('?') || rawUrl.includes('#')) {
    return null;
  }
  const rest = rawUrl.slice(PREFIX.length);
  const parts = rest.split('/');
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
