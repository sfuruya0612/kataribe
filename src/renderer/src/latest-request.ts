/**
 * 非同期処理の応答が最新の要求のものかを判定する。
 * 対応する要求: REQ-TODO-001
 */
export type LatestRequest = {
  begin: () => number;
  isCurrent: (id: number) => boolean;
};

/**
 * 呼び出しごとに世代を進める要求判定器を作る。
 *
 * begin で得た ID は、その後に begin が呼ばれると最新でなくなる。
 */
export function createLatestRequest(): LatestRequest {
  let generation = 0;
  return {
    begin: () => {
      generation += 1;
      return generation;
    },
    isCurrent: (id: number) => id === generation,
  };
}
