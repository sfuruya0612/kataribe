import type {
  EnhancementCancelMessage,
  EnhancementStartMessage,
} from '../../../shared/reuse';

type WorkerResponse =
  | { type: 'progress'; requestId: string; progress: number }
  | { type: 'chunk'; requestId: string; index: number; samples: Float32Array }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; message: string; cancelled: boolean };

let bridgeCleanup: (() => void) | null = null;

function logError(error: unknown): void {
  console.error(
    `enhancement bridge failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * Main からの音声強調要求と、専用 Worker の間を取り持つ。
 *
 * アプリの起動時に 1 回だけ呼び、返された関数を破棄時に呼ぶ。
 */
export function startEnhancementBridge(): () => void {
  if (bridgeCleanup) {
    return bridgeCleanup;
  }
  let worker: Worker | null = null;
  let activeRequestId: string | null = null;

  const ensureWorker = (): Worker => {
    if (worker) {
      return worker;
    }
    const created = new Worker(
      new URL('./enhancement.worker.ts', import.meta.url),
      { type: 'module' },
    );
    created.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        void window.kataribe
          .reportEnhancementProgress(message.requestId, message.progress)
          .catch(logError);
        return;
      }
      if (message.type === 'chunk') {
        void window.kataribe
          .sendEnhancementChunk(
            message.requestId,
            message.index,
            message.samples,
          )
          .then(() => {
            created.postMessage({
              type: 'chunk-ack',
              index: message.index,
            });
          })
          .catch((error: unknown) => {
            activeRequestId = null;
            worker?.terminate();
            worker = null;
            void window.kataribe
              .reportEnhancementError(
                message.requestId,
                error instanceof Error ? error.message : String(error),
              )
              .catch(logError);
          });
        return;
      }
      if (message.type === 'done') {
        activeRequestId = null;
        void window.kataribe
          .reportEnhancementDone(message.requestId)
          .catch(logError);
        return;
      }
      activeRequestId = null;
      void window.kataribe
        .reportEnhancementError(message.requestId, message.message)
        .catch(logError);
    };
    created.onerror = (event) => {
      const requestId = activeRequestId;
      activeRequestId = null;
      if (requestId) {
        void window.kataribe
          .reportEnhancementError(
            requestId,
            event.message || 'the enhancement worker failed',
          )
          .catch(logError);
      }
    };
    worker = created;
    return created;
  };

  const onStart = (message: EnhancementStartMessage): void => {
    if (activeRequestId !== null) {
      void window.kataribe
        .reportEnhancementError(
          message.requestId,
          'another enhancement job is running',
        )
        .catch(logError);
      return;
    }
    activeRequestId = message.requestId;
    try {
      ensureWorker().postMessage({ type: 'start', payload: message });
    } catch (error) {
      activeRequestId = null;
      void window.kataribe
        .reportEnhancementError(
          message.requestId,
          error instanceof Error ? error.message : String(error),
        )
        .catch(logError);
    }
  };

  const onCancel = (message: EnhancementCancelMessage): void => {
    worker?.postMessage({ type: 'cancel', requestId: message.requestId });
  };

  const unsubscribeStart = window.kataribe.onEnhancementStart(onStart);
  const unsubscribeCancel = window.kataribe.onEnhancementCancel(onCancel);
  void window.kataribe.reportEnhancementReady().catch(logError);
  const stop = () => {
    unsubscribeStart();
    unsubscribeCancel();
    worker?.terminate();
    worker = null;
    activeRequestId = null;
    if (bridgeCleanup === stop) {
      bridgeCleanup = null;
    }
  };
  bridgeCleanup = stop;
  return stop;
}
