import type {
  EnhancementFile,
  EnhancementState,
} from '../../shared/types';

/** 1 行の要約に使う音声強調の状態。`warning` は状態を読めなかったことを表す。 */
export type EnhancementDisplayState = EnhancementState | 'warning';

function entryStates(enhancement: EnhancementFile): EnhancementState[] {
  const saved = Object.values(enhancement.saved_audio).flatMap((entry) =>
    entry === undefined ? [] : [entry.state],
  );
  const models = Object.values(enhancement.transcription.models).flatMap(
    (entry) => (entry === undefined ? [] : [entry.state]),
  );
  return [...saved, enhancement.transcription.raw.state, ...models];
}

/**
 * 音声強調の状態を、1 行の要約に使う 1 つの状態へ畳み込む。
 *
 * 失敗と中断は利用者が対処する必要があるため、成功より先に表示する。
 * 実行中はほかの状態が混在していても、いま進行していることを優先する。
 */
export function summarizeEnhancement(
  enhancement: EnhancementFile | null,
  warning: string | null,
): EnhancementDisplayState | null {
  if (warning !== null) {
    return 'warning';
  }
  if (enhancement === null) {
    return null;
  }
  const states = entryStates(enhancement);
  if (states.includes('running')) {
    return 'running';
  }
  if (states.includes('failed')) {
    return 'failed';
  }
  if (states.includes('interrupted')) {
    return 'interrupted';
  }
  if (states.includes('succeeded')) {
    return 'succeeded';
  }
  if (states.includes('cancelled')) {
    return 'cancelled';
  }
  return 'pending';
}

/**
 * 音声強調の状態に対応するチップの class を返す。
 */
export function enhancementStateClass(state: EnhancementDisplayState): string {
  switch (state) {
    case 'succeeded':
      return 'status-summarized';
    case 'failed':
    case 'interrupted':
    case 'warning':
      return 'status-error';
    case 'running':
      return 'status-transcribing';
    default:
      return 'status-idle';
  }
}
