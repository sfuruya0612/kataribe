import { describe, expect, it } from 'vitest';
import { getMediaTypes, isAllowedPermission } from './security';

describe('isAllowedPermission', () => {
  it('allows audio-only media requests', () => {
    expect(isAllowedPermission('media', { mediaTypes: ['audio'] })).toBe(true);
  });

  it('denies media requests that include video', () => {
    expect(isAllowedPermission('media', { mediaTypes: ['audio', 'video'] })).toBe(false);
  });

  it('denies video-only media requests', () => {
    expect(isAllowedPermission('media', { mediaTypes: ['video'] })).toBe(false);
  });

  it('denies media requests without a media type', () => {
    expect(isAllowedPermission('media')).toBe(false);
  });

  it('denies non-media permissions', () => {
    expect(isAllowedPermission('notifications', { mediaTypes: ['audio'] })).toBe(false);
    expect(isAllowedPermission('clipboard-read')).toBe(false);
  });
});

describe('getMediaTypes', () => {
  it('prefers mediaTypes over mediaType', () => {
    expect(getMediaTypes({ mediaTypes: ['audio'], mediaType: 'video' })).toEqual(['audio']);
  });

  it('falls back to mediaType', () => {
    expect(getMediaTypes({ mediaType: 'audio' })).toEqual(['audio']);
  });

  it('returns an empty array when no media type exists', () => {
    expect(getMediaTypes({})).toEqual([]);
  });
});
