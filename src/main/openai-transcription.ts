import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildOpenAiTranscriptionEndpoint,
  openAiModelHasSegmentTimestamps,
  parseOpenAiTranscriptionResponse,
} from '../shared/openai-transcription';
import type { OpenAiTranscriptionModel } from '../shared/types';
import { estimateTokens } from '../shared/llm';
import { t } from './i18n';
import {
  mergeSegments,
  type TranscriptionErrorCode,
  type TranscriptionOutcome,
  type TranscriptionProgress,
} from './transcription';
import {
  planWavChunks,
  readWavInfo,
  writeWavChunk,
  type WavChunk,
  type WavInfo,
} from './wav';

// OpenAI の文字起こし API は whisper-1 で verbose_json、gpt-4o 系で json だけを返す。
// 25 MiB の上限と response_format は将来変わりうるため、モデルを追加するときに公式リファレンスを再確認する。
export const OPENAI_MAX_REQUEST_BYTES = 25 * 1024 * 1024;
export const OPENAI_CHUNK_SECONDS = 600;
const MAX_PROMPT_TOKENS = 200;
const DEFAULT_TIMEOUT_MS = 300_000;

export type OpenAiTranscriptionOptions = {
  audioWavPath: string;
  tempDir: string;
  durationSeconds: number;
  model: OpenAiTranscriptionModel;
  endpoint: string;
  apiKey: string;
  initialPrompt?: string;
  signal?: AbortSignal;
  onUpdate?: (progress: TranscriptionProgress) => void;
  onPartial?: (outcome: TranscriptionOutcome) => void | Promise<void>;
};

export type OpenAiTranscriptionServiceOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxAttempts?: number;
  chunkSeconds?: number;
  maxBytes?: number;
  timeoutMs?: number;
};

export type MultipartFile = {
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
};

export type MultipartBody = {
  body: Buffer;
  contentType: string;
};

type PreparedTranscription = {
  info: WavInfo;
  chunks: WavChunk[];
  chunkDir: string;
  durationSeconds: number;
};

type ChunkRunResult = {
  segments: TranscriptionOutcome['segments'];
  language: string;
  completedChunks: number;
  errorCode: TranscriptionErrorCode | null;
  error: string | null;
};

class OpenAiTranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;
  readonly retryable: boolean;

  constructor(code: TranscriptionErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'OpenAiTranscriptionError';
    this.code = code;
    this.retryable = retryable;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeMultipartValue(value: string): string {
  return value.replaceAll('"', '%22').replaceAll('\r', '').replaceAll('\n', '');
}

/**
 * OpenAI の文字起こし API 用の multipart/form-data を組み立てる。
 */
export function buildMultipartBody(
  fields: ReadonlyArray<readonly [string, string]>,
  file: MultipartFile,
): MultipartBody {
  const boundary = `----kataribe-${randomUUID()}`;
  const parts: Buffer[] = [];
  for (const [name, value] of fields) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartValue(name)}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartValue(file.field)}"; filename="${escapeMultipartValue(file.filename)}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      'utf8',
    ),
  );
  parts.push(file.data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(30_000, seconds * 1000);
    }
  }
  return Math.min(8_000, 1000 * 2 ** attempt);
}

/**
 * 用語集を OpenAI の文字起こし API のプロンプト上限に収める。
 */
export function truncateTranscriptionPrompt(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (estimateTokens(trimmed) <= MAX_PROMPT_TOKENS) {
    return trimmed;
  }
  let result = '';
  for (const char of trimmed) {
    if (estimateTokens(result + char) > MAX_PROMPT_TOKENS) {
      break;
    }
    result += char;
  }
  return result;
}

function errorForStatus(
  status: number,
  detail: string,
): OpenAiTranscriptionError {
  const suffix = detail ? `: ${detail.slice(0, 500)}` : '';
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return new OpenAiTranscriptionError(
      'openai-config',
      `OpenAI transcription configuration error: HTTP ${status}${suffix}`,
    );
  }
  if (status === 413) {
    return new OpenAiTranscriptionError(
      'file-too-large',
      `OpenAI transcription request is too large: HTTP 413${suffix}`,
    );
  }
  if (status === 429) {
    return new OpenAiTranscriptionError(
      'openai-rate-limit',
      `OpenAI transcription rate limit: HTTP 429${suffix}`,
      true,
    );
  }
  if (status === 408 || status >= 500) {
    return new OpenAiTranscriptionError(
      'openai-server',
      `OpenAI transcription server error: HTTP ${status}${suffix}`,
      true,
    );
  }
  return new OpenAiTranscriptionError(
    'openai-failed',
    `OpenAI transcription failed: HTTP ${status}${suffix}`,
  );
}

function validateResponseJson(text: string): void {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new OpenAiTranscriptionError(
      'openai-failed',
      'OpenAI transcription response is not valid JSON',
      true,
    );
  }
  if (typeof data !== 'object' || data === null) {
    throw new OpenAiTranscriptionError(
      'openai-failed',
      'OpenAI transcription response is not an object',
      true,
    );
  }
  const value = data as { text?: unknown; segments?: unknown };
  if (typeof value.text !== 'string' && !Array.isArray(value.segments)) {
    throw new OpenAiTranscriptionError(
      'openai-failed',
      'OpenAI transcription response has no text or segments',
      true,
    );
  }
}

function emptyOutcome(
  state: TranscriptionOutcome['state'],
  errorCode: TranscriptionErrorCode | null,
  error: string | null,
  durationSeconds: number,
  elapsedSeconds: number,
): TranscriptionOutcome {
  return {
    state,
    segments: [],
    language: 'auto',
    lastEndSeconds: 0,
    durationSeconds,
    elapsedSeconds,
    errorCode,
    error,
    resumed: false,
  };
}

/**
 * OpenAI の文字起こし API を呼び、区間ごとの結果を 1 つの文字起こしに結合する。
 */
export class OpenAiTranscriptionService {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxAttempts: number;
  private readonly chunkSeconds: number;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;

  constructor(options: OpenAiTranscriptionServiceOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => Date.now());
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.chunkSeconds = Math.max(1, options.chunkSeconds ?? OPENAI_CHUNK_SECONDS);
    this.maxBytes = Math.max(1, options.maxBytes ?? OPENAI_MAX_REQUEST_BYTES);
    this.timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  async transcribe(options: OpenAiTranscriptionOptions): Promise<TranscriptionOutcome> {
    const startedAt = this.now();
    const endpoint = buildOpenAiTranscriptionEndpoint(options.endpoint);
    if (!endpoint || !options.apiKey.trim()) {
      return emptyOutcome(
        'failed',
        'openai-config',
        'OpenAI transcription endpoint or API key is not configured',
        options.durationSeconds,
        0,
      );
    }
    const prepared = await this.prepare(options);
    if ('outcome' in prepared) {
      return prepared.outcome;
    }
    try {
      const run = await this.runChunks(options, endpoint, prepared, startedAt);
      return await this.finish(options, run, prepared.durationSeconds, startedAt);
    } finally {
      await rm(prepared.chunkDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  private async prepare(
    options: OpenAiTranscriptionOptions,
  ): Promise<PreparedTranscription | { outcome: TranscriptionOutcome }> {
    let info: WavInfo;
    try {
      info = await readWavInfo(options.audioWavPath);
    } catch (error) {
      return {
        outcome: emptyOutcome(
          'failed',
          'invalid-audio',
          `failed to read the transcription wav: ${error instanceof Error ? error.message : String(error)}`,
          options.durationSeconds,
          0,
        ),
      };
    }
    const durationSeconds =
      options.durationSeconds > 0 ? options.durationSeconds : info.duration;
    let chunks: WavChunk[];
    try {
      chunks = await planWavChunks(options.audioWavPath, info, {
        maxBytes: this.maxBytes,
        chunkSeconds: this.chunkSeconds,
      });
    } catch (error) {
      return {
        outcome: emptyOutcome(
          'failed',
          'invalid-audio',
          `failed to split the transcription wav: ${error instanceof Error ? error.message : String(error)}`,
          durationSeconds,
          0,
        ),
      };
    }
    if (chunks.length === 0) {
      return {
        outcome: emptyOutcome(
          'failed',
          'invalid-audio',
          'transcription wav has no audio',
          durationSeconds,
          0,
        ),
      };
    }
    await mkdir(options.tempDir, { recursive: true, mode: 0o700 });
    const chunkDir = await mkdtemp(join(options.tempDir, 'openai-chunks-'));
    return { info, chunks, chunkDir, durationSeconds };
  }

  private async runChunks(
    options: OpenAiTranscriptionOptions,
    endpoint: string,
    prepared: PreparedTranscription,
    startedAt: number,
  ): Promise<ChunkRunResult> {
    let segments = mergeSegments([], []);
    let language = 'auto';
    let errorCode: TranscriptionErrorCode | null = null;
    let error: string | null = null;
    let completedChunks = 0;

    for (const chunk of prepared.chunks) {
      if (options.signal?.aborted) {
        errorCode = 'cancelled';
        error = 'OpenAI transcription was cancelled';
        break;
      }
      const chunkPath = join(prepared.chunkDir, `chunk-${chunk.index}.wav`);
      await writeWavChunk(options.audioWavPath, prepared.info, chunk, chunkPath);
      try {
        const result = await this.requestChunk(options, endpoint, chunk, chunkPath);
        const parsed = parseOpenAiTranscriptionResponse(
          result,
          options.model,
          chunk.startSeconds,
          chunk.endSeconds - chunk.startSeconds,
        );
        if (parsed.language && language === 'auto') {
          language = parsed.language;
        }
        segments = mergeSegments(segments, parsed.segments);
        completedChunks += 1;
        emitProgress(
          options,
          segments,
          language,
          chunk,
          prepared.chunks.length,
          prepared.durationSeconds,
        );
        await options.onPartial?.(
          this.outcome(
            'partial',
            segments,
            language,
            prepared.durationSeconds,
            startedAt,
            null,
            null,
          ),
        );
      } catch (caught) {
        const mapped =
          caught instanceof OpenAiTranscriptionError
            ? caught
            : new OpenAiTranscriptionError(
                'openai-network',
                caught instanceof Error ? caught.message : String(caught),
                true,
              );
        errorCode = mapped.code;
        error = mapped.message;
        break;
      } finally {
        await rm(chunkPath, { force: true }).catch(() => undefined);
      }
    }
    return { segments, language, completedChunks, errorCode, error };
  }

  private async finish(
    options: OpenAiTranscriptionOptions,
    run: ChunkRunResult,
    durationSeconds: number,
    startedAt: number,
  ): Promise<TranscriptionOutcome> {
    if (run.errorCode === null) {
      if (run.segments.every((segment) => segment.text.trim().length === 0)) {
        return this.outcome(
          'failed',
          run.segments,
          run.language,
          durationSeconds,
          startedAt,
          'empty-output',
          'OpenAI transcription produced no text',
        );
      }
      return this.outcome(
        'completed',
        run.segments,
        run.language,
        durationSeconds,
        startedAt,
        null,
        null,
      );
    }
    if (run.errorCode === 'cancelled') {
      const partial = this.outcome(
        'cancelled',
        run.segments,
        run.language,
        durationSeconds,
        startedAt,
        run.errorCode,
        run.error,
      );
      await options.onPartial?.(partial);
      return partial;
    }
    const state =
      run.completedChunks > 0 && run.segments.length > 0 ? 'partial' : 'failed';
    const partial = this.outcome(
      state,
      run.segments,
      run.language,
      durationSeconds,
      startedAt,
      run.errorCode,
      run.error,
    );
    if (run.segments.length > 0) {
      await options.onPartial?.(partial);
    }
    return partial;
  }

  private outcome(
    state: TranscriptionOutcome['state'],
    segments: TranscriptionOutcome['segments'],
    language: string,
    durationSeconds: number,
    startedAt: number,
    errorCode: TranscriptionErrorCode | null,
    error: string | null,
  ): TranscriptionOutcome {
    return {
      state,
      segments,
      language,
      lastEndSeconds: segments.reduce(
        (maximum, segment) =>
          Math.max(maximum, segment.endSeconds ?? segment.startSeconds),
        0,
      ),
      durationSeconds,
      elapsedSeconds: Math.max(0, (this.now() - startedAt) / 1000),
      errorCode,
      error,
      resumed: false,
    };
  }

  private async requestChunk(
    options: OpenAiTranscriptionOptions,
    endpoint: string,
    chunk: WavChunk,
    chunkPath: string,
  ): Promise<string> {
    const data = await readFile(chunkPath);
    const fields: Array<readonly [string, string]> = [
      ['model', options.model],
      [
        'response_format',
        openAiModelHasSegmentTimestamps(options.model) ? 'verbose_json' : 'json',
      ],
    ];
    if (openAiModelHasSegmentTimestamps(options.model)) {
      fields.push(['temperature', '0']);
    }
    const prompt = truncateTranscriptionPrompt(options.initialPrompt ?? '');
    if (prompt) {
      fields.push(['prompt', prompt]);
    }
    const multipart = buildMultipartBody(fields, {
      field: 'file',
      filename: `audio-${chunk.index + 1}.wav`,
      contentType: 'audio/wav',
      data,
    });

    let lastError: OpenAiTranscriptionError | null = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      if (options.signal?.aborted) {
        throw new OpenAiTranscriptionError(
          'cancelled',
          'OpenAI transcription was cancelled',
        );
      }
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      timeout.unref?.();
      try {
        const response = await this.fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': multipart.contentType,
            accept: 'application/json',
          },
          body: new Uint8Array(multipart.body),
          signal: controller.signal,
          redirect: 'error',
        });
        const text = await response.text();
        if (response.ok) {
          validateResponseJson(text);
          return text;
        }
        const error = errorForStatus(response.status, text);
        if (!error.retryable || attempt + 1 >= this.maxAttempts) {
          throw error;
        }
        lastError = error;
        await this.sleep(
          retryDelayMs(attempt, response.headers.get('retry-after')),
        );
      } catch (error) {
        if (options.signal?.aborted) {
          throw new OpenAiTranscriptionError(
            'cancelled',
            'OpenAI transcription was cancelled',
          );
        }
        if (error instanceof OpenAiTranscriptionError) {
          if (!error.retryable || attempt + 1 >= this.maxAttempts) {
            throw error;
          }
          lastError = error;
          await this.sleep(retryDelayMs(attempt, null));
          continue;
        }
        const wrapped = new OpenAiTranscriptionError(
          'openai-network',
          `OpenAI transcription request failed: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
        if (attempt + 1 >= this.maxAttempts) {
          throw wrapped;
        }
        lastError = wrapped;
        await this.sleep(retryDelayMs(attempt, null));
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', onAbort);
      }
    }
    throw lastError ?? new OpenAiTranscriptionError('openai-failed', 'OpenAI transcription failed');
  }
}

function emitProgress(
  options: OpenAiTranscriptionOptions,
  segments: TranscriptionOutcome['segments'],
  language: string,
  chunk: WavChunk,
  chunkCount: number,
  durationSeconds: number,
): void {
  const lastEndSeconds = segments.reduce(
    (maximum, segment) =>
      Math.max(maximum, segment.endSeconds ?? segment.startSeconds),
    chunk.endSeconds,
  );
  options.onUpdate?.({
    segments,
    language,
    lastEndSeconds,
    ratio:
      chunk.index === chunkCount - 1
        ? 1
        : durationSeconds > 0
          ? Math.max(0, Math.min(1, chunk.endSeconds / durationSeconds))
          : 0,
    etaSeconds: null,
    message: t('文字起こしをしています（{index}/{total}）', {
      index: chunk.index + 1,
      total: chunkCount,
    }),
  });
}
