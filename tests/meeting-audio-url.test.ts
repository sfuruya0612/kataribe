/**
 * 会議音声の URL が、ファイルの同一性を表すバージョンを持つことを検証する。
 * 対応する要求: REQ-ENHANCE-001
 */
import { describe, expect, it } from 'vitest';
import {
  enhancedMeetingAudioUrl,
  meetingAudioUrl,
} from '../src/shared/meeting-audio-url';

describe('meeting audio URLs', () => {
  it('builds the raw URL with and without a version', () => {
    expect(meetingAudioUrl('meeting-id')).toBe(
      'kataribe-audio://meeting/meeting-id',
    );
    expect(meetingAudioUrl('meeting-id', '1700000000000-1234')).toBe(
      'kataribe-audio://meeting/meeting-id?v=1700000000000-1234',
    );
  });

  it('builds the enhanced URL with the model and version', () => {
    expect(
      enhancedMeetingAudioUrl('meeting-id', 'nemotronlabs', 'abc123'),
    ).toBe(
      'kataribe-audio://meeting/meeting-id/enhanced/nemotronlabs?v=abc123',
    );
    expect(enhancedMeetingAudioUrl('meeting-id', 'nemotronlabs')).toBe(
      'kataribe-audio://meeting/meeting-id/enhanced/nemotronlabs',
    );
  });

  it('encodes the meeting ID and version in the query', () => {
    expect(meetingAudioUrl('meeting id', 'a b')).toBe(
      'kataribe-audio://meeting/meeting%20id?v=a%20b',
    );
  });
});
