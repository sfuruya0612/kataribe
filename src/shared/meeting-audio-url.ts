import type { ReuseModel } from './types';

const MEETING_AUDIO_ORIGIN = 'kataribe-audio://meeting';

function withVersion(url: string, version: string | null): string {
  return version === null || version.length === 0
    ? url
    : `${url}?v=${encodeURIComponent(version)}`;
}

/**
 * 会議の生音声を返すカスタムプロトコルの URL を作る。
 *
 * バージョンは音声ファイルの更新時刻とサイズから作り、同じ URL の
 * 応答がキャッシュされたままにならないようにする。
 */
export function meetingAudioUrl(
  meetingId: string,
  version: string | null = null,
): string {
  return withVersion(
    `${MEETING_AUDIO_ORIGIN}/${encodeURIComponent(meetingId)}`,
    version,
  );
}

/**
 * 会議の強調音声を返すカスタムプロトコルの URL を作る。
 *
 * バージョンには強調音声の SHA-256 を使い、再実行でファイルを
 * 置き換えたときに前の応答を再生しないようにする。
 */
export function enhancedMeetingAudioUrl(
  meetingId: string,
  model: ReuseModel,
  version: string | null = null,
): string {
  return withVersion(
    `${meetingAudioUrl(meetingId)}/enhanced/${encodeURIComponent(model)}`,
    version,
  );
}
