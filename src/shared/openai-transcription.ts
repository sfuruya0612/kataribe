/**
 * OpenAI の文字起こし API のモデル、エンドポイント、応答の解析を扱う。
 */
import type { OpenAiTranscriptionModel } from './types';
import type { TranscriptSegment } from './markdown';

export const OPENAI_TRANSCRIPTION_MODELS = [
  'whisper-1',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
] as const satisfies readonly OpenAiTranscriptionModel[];

export const DEFAULT_OPENAI_TRANSCRIPTION_MODEL: OpenAiTranscriptionModel = 'whisper-1';

export const OPENAI_TRANSCRIPTION_CHUNK_SECONDS = 600;

const LANGUAGE_CODES: Readonly<Record<string, string>> = {
  japanese: 'ja',
  english: 'en',
  chinese: 'zh',
  korean: 'ko',
  german: 'de',
  french: 'fr',
  spanish: 'es',
  italian: 'it',
  portuguese: 'pt',
  russian: 'ru',
};

export function isOpenAiTranscriptionModel(
  value: unknown,
): value is OpenAiTranscriptionModel {
  return OPENAI_TRANSCRIPTION_MODELS.includes(value as OpenAiTranscriptionModel);
}

export function normalizeOpenAiTranscriptionModel(
  value: unknown,
): OpenAiTranscriptionModel {
  return isOpenAiTranscriptionModel(value)
    ? value
    : DEFAULT_OPENAI_TRANSCRIPTION_MODEL;
}

export function openAiModelHasSegmentTimestamps(
  model: OpenAiTranscriptionModel,
): boolean {
  return model === 'whisper-1';
}

export function buildOpenAiTranscriptionEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, '');
  if (!trimmed) {
    return '';
  }
  return /\/audio\/transcriptions$/iu.test(trimmed)
    ? trimmed
    : `${trimmed}/audio/transcriptions`;
}

export function normalizeOpenAiLanguage(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return LANGUAGE_CODES[normalized] ?? normalized;
}

export function estimateOpenAiChunkCount(
  durationSeconds: number,
  chunkSeconds = OPENAI_TRANSCRIPTION_CHUNK_SECONDS,
): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(durationSeconds / Math.max(1, chunkSeconds)));
}

type OpenAiVerboseSegment = {
  start?: unknown;
  end?: unknown;
  text?: unknown;
};

type OpenAiTranscriptionJson = {
  text?: unknown;
  language?: unknown;
  segments?: unknown;
};

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseOpenAiTranscriptionResponse(
  text: string,
  model: OpenAiTranscriptionModel,
  offsetSeconds: number,
  chunkDurationSeconds: number,
): { segments: TranscriptSegment[]; language: string | null } {
  let data: OpenAiTranscriptionJson;
  try {
    data = JSON.parse(text) as OpenAiTranscriptionJson;
  } catch {
    return { segments: [], language: null };
  }

  const language = normalizeOpenAiLanguage(data.language);
  const body = typeof data.text === 'string' ? data.text.trim() : '';
  const rawSegments = Array.isArray(data.segments)
    ? (data.segments as OpenAiVerboseSegment[])
    : [];

  if (model !== 'whisper-1') {
    return body
      ? {
          segments: [
            {
              startSeconds: offsetSeconds,
              endSeconds: offsetSeconds + Math.max(0, chunkDurationSeconds),
              text: body,
            },
          ],
          language: null,
        }
      : { segments: [], language: null };
  }

  const segments: TranscriptSegment[] = [];
  for (const entry of rawSegments) {
    const start = toFiniteNumber(entry.start);
    const end = toFiniteNumber(entry.end);
    const value = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (start === null || end === null || end < start || value.length === 0) {
      continue;
    }
    const absoluteStart = offsetSeconds + start;
    const absoluteEnd = Math.min(
      offsetSeconds + Math.max(0, chunkDurationSeconds),
      offsetSeconds + end,
    );
    if (absoluteEnd < absoluteStart) {
      continue;
    }
    segments.push({
      startSeconds: absoluteStart,
      endSeconds: absoluteEnd,
      text: value,
    });
  }

  if (segments.length > 0) {
    return { segments, language };
  }
  return body
    ? {
        segments: [
          {
            startSeconds: offsetSeconds,
            endSeconds: offsetSeconds + Math.max(0, chunkDurationSeconds),
            text: body,
          },
        ],
        language,
      }
    : { segments: [], language };
}
