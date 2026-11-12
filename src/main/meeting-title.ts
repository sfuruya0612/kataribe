/**
 * 会議タイトルを生成し、結果と失敗理由を meta.json に残す。
 */
import { join } from 'node:path';
import { DEFAULT_MEETING_TITLE, sanitizeMeetingTitle } from '../shared/title';
import type { MeetingSummary, SummaryLanguage } from '../shared/types';
import { t } from './i18n';
import type { LlmClient } from './llm';
import { updateMeetingMeta, type MeetingMeta } from './meeting-meta';
import type { MeetingStore } from './meetings';
import { generateMeetingTitle } from './summary';

const MAX_TITLE_GENERATION_ERROR_LENGTH = 2000;

export type TitleGenerationUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

export type GenerateAndSaveMeetingTitleOptions = {
  meetingStore: MeetingStore;
  client: LlmClient;
  meeting: MeetingSummary;
  transcriptBody: string;
  language: SummaryLanguage;
  kind: 'openai' | 'anthropic';
  endpoint: string;
  apiKey: string;
  model: string;
  provider: string;
  signal?: AbortSignal;
  now: () => Date;
  usage?: TitleGenerationUsage;
};

function addNullable(left: number | null, right: number | null): number | null {
  if (left === null && right === null) {
    return null;
  }
  return (left ?? 0) + (right ?? 0);
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_TITLE_GENERATION_ERROR_LENGTH,
  );
}

async function updateTitleGenerationMeta(
  meetingStore: MeetingStore,
  meetingId: string,
  update: (meta: MeetingMeta) => void,
): Promise<void> {
  const current = await meetingStore.find(meetingId);
  if (!current) {
    return;
  }
  await updateMeetingMeta(join(current.meetingDir, 'meta.json'), update);
}

function writeUsage(meta: MeetingMeta, usage: TitleGenerationUsage): void {
  if (!meta.summary) {
    return;
  }
  meta.summary.usage = {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
  };
}

export async function generateAndSaveMeetingTitle(
  options: GenerateAndSaveMeetingTitleOptions,
): Promise<MeetingSummary> {
  await updateMeetingMeta(
    join(options.meeting.meetingDir, 'meta.json'),
    (meta) => {
      meta.title_generation = {
        state: 'running',
        provider: options.provider,
        model: options.model,
        started_at: options.now().toISOString(),
      };
    },
  );

  try {
    const generated = await generateMeetingTitle({
      client: options.client,
      transcriptBody: options.transcriptBody,
      language: options.language,
      kind: options.kind,
      endpoint: options.endpoint,
      apiKey: options.apiKey,
      model: options.model,
      signal: options.signal,
    });
    if (options.usage) {
      options.usage.inputTokens = addNullable(
        options.usage.inputTokens,
        generated.inputTokens,
      );
      options.usage.outputTokens = addNullable(
        options.usage.outputTokens,
        generated.outputTokens,
      );
    }
    if (options.signal?.aborted) {
      throw new Error('title generation was cancelled');
    }
    const title = sanitizeMeetingTitle(generated.title);
    if (title === DEFAULT_MEETING_TITLE) {
      throw new Error(t('生成されたタイトルが空です。'));
    }
    return await options.meetingStore.updateTitle(
      options.meeting.id,
      title,
      (meta) => {
        meta.title_generation = {
          state: 'completed',
          provider: options.provider,
          model: options.model,
          generated_at: options.now().toISOString(),
        };
        if (options.usage) {
          writeUsage(meta, options.usage);
        }
      },
    );
  } catch (error) {
    if (options.signal?.aborted) {
      await updateTitleGenerationMeta(
        options.meetingStore,
        options.meeting.id,
        (meta) => {
          delete meta.title_generation;
          if (options.usage) {
            writeUsage(meta, options.usage);
          }
        },
      ).catch((persistError: unknown) => {
        console.error(
          `failed to clear cancelled title generation: ${errorMessage(persistError)}`,
        );
      });
      throw error;
    }

    const message = errorMessage(error);
    await updateTitleGenerationMeta(
      options.meetingStore,
      options.meeting.id,
      (meta) => {
        meta.title_generation = {
          state: 'failed',
          provider: options.provider,
          model: options.model,
          generated_at: options.now().toISOString(),
          error: message,
        };
        if (options.usage) {
          writeUsage(meta, options.usage);
        }
      },
    ).catch((persistError: unknown) => {
      console.error(
        `failed to persist title generation failure: ${errorMessage(persistError)}`,
      );
    });
    throw error;
  }
}
