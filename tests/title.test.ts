import { describe, expect, it } from 'vitest';
import { sanitizeMeetingTitle } from '../src/shared/title';

describe('sanitizeMeetingTitle', () => {
  it('keeps Japanese titles and normalizes spaces', () => {
    expect(sanitizeMeetingTitle('  週次   定例  ')).toBe('週次 定例');
  });

  it('replaces filename separators and control characters', () => {
    expect(sanitizeMeetingTitle('A/B:C*D?E"F<G>H|I')).toBe(
      'A_B_C_D_E_F_G_H_I',
    );
    expect(sanitizeMeetingTitle('a\u0000b')).toBe('a_b');
  });

  it('removes leading and trailing dots', () => {
    expect(sanitizeMeetingTitle('...会議...')).toBe('会議');
    expect(sanitizeMeetingTitle('..')).toBe('タイトル未入力');
  });

  it('truncates to 120 UTF-8 bytes without breaking characters', () => {
    const title = sanitizeMeetingTitle('あ'.repeat(100));
    expect(new TextEncoder().encode(title).length).toBeLessThanOrEqual(120);
    expect(title.length).toBeGreaterThan(0);
    expect(title).toBe('あ'.repeat(40));
  });

  it('uses the fallback for an empty title', () => {
    expect(sanitizeMeetingTitle('   ')).toBe('タイトル未入力');
  });
});
