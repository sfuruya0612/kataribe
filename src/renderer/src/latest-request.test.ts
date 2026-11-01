/**
 * 非同期処理の最新応答だけを採用する判定を検証する。
 * 対応する要求: REQ-TODO-001
 */
import { describe, expect, it } from 'vitest';
import { createLatestRequest } from './latest-request';

describe('req_todo_001_latest_request', () => {
  it('keeps only the most recent request current', () => {
    const latest = createLatestRequest();
    const first = latest.begin();

    expect(latest.isCurrent(first)).toBe(true);

    const second = latest.begin();

    expect(latest.isCurrent(first)).toBe(false);
    expect(latest.isCurrent(second)).toBe(true);
  });
});
