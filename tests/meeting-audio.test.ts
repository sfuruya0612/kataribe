/**
 * 会議音声のカスタムプロトコルの URL を検証する。
 * 対応する要求: REQ-ENHANCE-001
 */
import { describe, expect, it } from 'vitest';
import { parseMeetingAudioUrl } from '../src/main/meeting-audio';

describe('parseMeetingAudioUrl', () => {
  it('parses the raw and enhanced audio URLs', () => {
    expect(
      parseMeetingAudioUrl(
        'kataribe-audio://meeting/00000000-0000-4000-8000-000000000001',
      ),
    ).toEqual({
      meetingId: '00000000-0000-4000-8000-000000000001',
      variant: 'raw',
      model: null,
    });
    expect(
      parseMeetingAudioUrl(
        'kataribe-audio://meeting/00000000-0000-4000-8000-000000000001/enhanced/nemotronlabs',
      ),
    ).toEqual({
      meetingId: '00000000-0000-4000-8000-000000000001',
      variant: 'enhanced',
      model: 'nemotronlabs',
    });
  });

  it('rejects unknown variants, models, and queries', () => {
    expect(
      parseMeetingAudioUrl(
        'kataribe-audio://meeting/00000000-0000-4000-8000-000000000001/enhanced/RE-USE',
      ),
    ).toBeNull();
    expect(
      parseMeetingAudioUrl(
        'kataribe-audio://meeting/00000000-0000-4000-8000-000000000001/other/nemotronlabs',
      ),
    ).toBeNull();
    expect(
      parseMeetingAudioUrl(
        'kataribe-audio://meeting/00000000-0000-4000-8000-000000000001?path=/etc/passwd',
      ),
    ).toBeNull();
    expect(parseMeetingAudioUrl('file:///etc/passwd')).toBeNull();
  });
});
