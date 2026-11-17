/**
 * 要約ペインの幅の制限、保存、読み込みを検証する。
 * 対応する要求: REQ-CHAT-001 (会議詳細の閲覧性)
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SUMMARY_PANE_WIDTH,
  MAX_SUMMARY_PANE_WIDTH,
  MIN_SUMMARY_PANE_WIDTH,
  SUMMARY_PANE_WIDTH_STORAGE_KEY,
  clampSummaryPaneWidth,
  readStoredSummaryPaneWidth,
  storeSummaryPaneWidth,
  type StorageLike,
} from './summary-pane-width';

function storageWith(value: string | null): StorageLike {
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
  };
}

describe('clampSummaryPaneWidth', () => {
  it('keeps the width between the minimum and the available maximum', () => {
    expect(clampSummaryPaneWidth(100, 1200)).toBe(MIN_SUMMARY_PANE_WIDTH);
    expect(clampSummaryPaneWidth(900, 1200)).toBe(MAX_SUMMARY_PANE_WIDTH);
    expect(clampSummaryPaneWidth(900, 1000)).toBe(574);
    expect(clampSummaryPaneWidth(500, 800)).toBe(374);
    expect(clampSummaryPaneWidth(300, 600)).toBe(MIN_SUMMARY_PANE_WIDTH);
  });

  it('falls back to the default for a non-finite width', () => {
    expect(clampSummaryPaneWidth(Number.NaN, 1200)).toBe(
      DEFAULT_SUMMARY_PANE_WIDTH,
    );
    expect(clampSummaryPaneWidth(Number.POSITIVE_INFINITY, 1200)).toBe(
      DEFAULT_SUMMARY_PANE_WIDTH,
    );
  });

  it('never exceeds the global maximum', () => {
    expect(clampSummaryPaneWidth(10_000, 10_000)).toBe(MAX_SUMMARY_PANE_WIDTH);
  });
});

describe('readStoredSummaryPaneWidth', () => {
  it('returns the default when there is no storage or value', () => {
    expect(readStoredSummaryPaneWidth(null)).toBe(DEFAULT_SUMMARY_PANE_WIDTH);
    expect(readStoredSummaryPaneWidth(storageWith(null))).toBe(
      DEFAULT_SUMMARY_PANE_WIDTH,
    );
  });

  it('returns a valid stored width and clamps it', () => {
    expect(readStoredSummaryPaneWidth(storageWith('430'))).toBe(430);
    expect(readStoredSummaryPaneWidth(storageWith('100'))).toBe(
      MIN_SUMMARY_PANE_WIDTH,
    );
    expect(readStoredSummaryPaneWidth(storageWith('9999'))).toBe(
      MAX_SUMMARY_PANE_WIDTH,
    );
  });

  it('returns the default for an invalid value', () => {
    expect(readStoredSummaryPaneWidth(storageWith('abc'))).toBe(
      DEFAULT_SUMMARY_PANE_WIDTH,
    );
    expect(readStoredSummaryPaneWidth(storageWith(''))).toBe(
      DEFAULT_SUMMARY_PANE_WIDTH,
    );
  });

  it('returns the default when storage throws', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('unavailable');
      }),
      setItem: vi.fn(),
    };
    expect(readStoredSummaryPaneWidth(storage)).toBe(
      DEFAULT_SUMMARY_PANE_WIDTH,
    );
  });
});

describe('storeSummaryPaneWidth', () => {
  it('writes the clamped width', () => {
    const storage = storageWith(null);
    storeSummaryPaneWidth(storage, 430);
    expect(storage.setItem).toHaveBeenCalledWith(
      SUMMARY_PANE_WIDTH_STORAGE_KEY,
      '430',
    );
    storeSummaryPaneWidth(storage, 9999);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      SUMMARY_PANE_WIDTH_STORAGE_KEY,
      String(MAX_SUMMARY_PANE_WIDTH),
    );
  });

  it('ignores missing storage and storage errors', () => {
    expect(() => storeSummaryPaneWidth(null, 430)).not.toThrow();
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new Error('unavailable');
      }),
    };
    expect(() => storeSummaryPaneWidth(storage, 430)).not.toThrow();
  });
});
