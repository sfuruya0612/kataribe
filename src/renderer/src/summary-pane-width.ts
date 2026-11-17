export const DEFAULT_SUMMARY_PANE_WIDTH = 280;
export const MIN_SUMMARY_PANE_WIDTH = 240;
export const MAX_SUMMARY_PANE_WIDTH = 640;
export const MIN_LEFT_PANE_WIDTH = 420;
export const DETAIL_RESIZER_WIDTH = 6;
export const SUMMARY_PANE_WIDTH_STEP = 16;
export const SUMMARY_PANE_WIDTH_STORAGE_KEY = 'kataribe.summaryPaneWidth';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * 要約ペインの幅を、左のペインの最小幅と全体の幅に収める。
 */
export function clampSummaryPaneWidth(
  width: number,
  containerWidth: number,
): number {
  if (!Number.isFinite(width)) {
    return DEFAULT_SUMMARY_PANE_WIDTH;
  }
  const availableMax = Number.isFinite(containerWidth)
    ? Math.floor(containerWidth) - DETAIL_RESIZER_WIDTH - MIN_LEFT_PANE_WIDTH
    : MAX_SUMMARY_PANE_WIDTH;
  const max = Math.max(
    MIN_SUMMARY_PANE_WIDTH,
    Math.min(MAX_SUMMARY_PANE_WIDTH, availableMax),
  );
  return Math.min(max, Math.max(MIN_SUMMARY_PANE_WIDTH, Math.round(width)));
}

export function readStoredSummaryPaneWidth(
  storage?: StorageLike | null,
): number {
  let target: StorageLike | null;
  try {
    target =
      storage === undefined
        ? typeof window === 'undefined'
          ? null
          : window.localStorage
        : storage;
  } catch {
    return DEFAULT_SUMMARY_PANE_WIDTH;
  }
  if (!target) {
    return DEFAULT_SUMMARY_PANE_WIDTH;
  }
  try {
    const raw = target.getItem(SUMMARY_PANE_WIDTH_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SUMMARY_PANE_WIDTH;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return DEFAULT_SUMMARY_PANE_WIDTH;
    }
    return Math.min(
      MAX_SUMMARY_PANE_WIDTH,
      Math.max(MIN_SUMMARY_PANE_WIDTH, Math.round(value)),
    );
  } catch {
    return DEFAULT_SUMMARY_PANE_WIDTH;
  }
}

export function storeSummaryPaneWidth(
  storage: StorageLike | null,
  width: number,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(
      SUMMARY_PANE_WIDTH_STORAGE_KEY,
      String(clampSummaryPaneWidth(width, Number.POSITIVE_INFINITY)),
    );
  } catch {
    // プライベートモードや容量超過で localStorage が使えない場合は無視する。
  }
}
