import { describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../src/shared/types';
import { normalizeAppSettings } from '../src/shared/settings';
import { TranscriptionRunner } from '../src/main/transcription-runner';
import type {
  TranscribeOptions,
  TranscriptionOutcome,
} from '../src/main/transcription';
import type { OpenAiTranscriptionOptions } from '../src/main/openai-transcription';

/**
 * 対応する要求: REQ-TRANS-001
 * 文字起こしエンジンの解決、確認、フォールバックを固定する。
 */

function settings(patch: Partial<AppSettings> = {}): AppSettings {
  return normalizeAppSettings({
    llmProfiles: [
      {
        id: 'work',
        provider: 'chatgpt',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.5',
      },
    ],
    llmDefaultProfileId: 'work',
    whisperModel: 'small',
    ...patch,
  });
}

function outcome(text: string): TranscriptionOutcome {
  return {
    state: 'completed',
    segments: [{ startSeconds: 0, endSeconds: 1, text }],
    language: 'ja',
    lastEndSeconds: 1,
    durationSeconds: 1,
    elapsedSeconds: 0.5,
    errorCode: null,
    error: null,
    resumed: false,
  };
}

function createRunner(options: {
  settings: AppSettings;
  localOutcome?: TranscriptionOutcome;
  openAiOutcome?: TranscriptionOutcome;
  confirm?: (details: {
    host: string;
    model: string;
    durationSeconds: number;
    chunkCount: number;
  }) => Promise<boolean>;
  installedPath?: string | null;
  apiKey?: string | null;
}) {
  const local = vi.fn(async (_options: TranscribeOptions) =>
    options.localOutcome ?? outcome('local'),
  );
  const openai = vi.fn(async (_options: OpenAiTranscriptionOptions) =>
    options.openAiOutcome ?? outcome('openai'),
  );
  const runner = new TranscriptionRunner({
    settings: () => options.settings,
    apiKeyStore: {
      getKey: async () => (options.apiKey === undefined ? 'sk-test' : options.apiKey),
    },
    modelManager: {
      installedPath: async () =>
        options.installedPath === undefined ? '/models/small.bin' : options.installedPath,
    },
    localService: { transcribe: local },
    openAiService: { transcribe: openai },
    confirmCloudTranscription: options.confirm,
  });
  return { runner, local, openai };
}

const baseOptions = {
  meetingId: '00000000-0000-4000-8000-0000000000aa',
  tempDir: '/tmp',
  audioWavPath: '/tmp/audio.16k.wav',
  durationSeconds: 600,
  signal: new AbortController().signal,
};

describe('TranscriptionRunner', () => {
  it('req_trans_001_uses_the_local_service_by_default', async () => {
    const { runner, local, openai } = createRunner({
      settings: settings(),
    });
    const result = await runner.run(baseOptions);
    expect(local).toHaveBeenCalledTimes(1);
    expect(openai).not.toHaveBeenCalled();
    expect(result.resolution).toEqual({
      engine: 'whisper-cpp',
      modelLabel: 'small',
      fallbackReason: null,
    });
    expect(result.outcome.segments[0]?.text).toBe('local');
  });

  it('req_trans_001_confirms_and_uses_the_openai_service', async () => {
    const confirm = vi.fn(async () => true);
    const { runner, local, openai } = createRunner({
      settings: settings({ transcriptionEngine: 'openai' }),
      confirm,
    });
    const resolved: unknown[] = [];
    const result = await runner.run({
      ...baseOptions,
      onResolved: (value) => resolved.push(value),
    });
    expect(confirm).toHaveBeenCalledWith({
      host: 'api.openai.com',
      model: 'whisper-1',
      durationSeconds: 600,
      chunkCount: 1,
      audioVariant: 'raw',
    });
    expect(local).not.toHaveBeenCalled();
    expect(openai).toHaveBeenCalledTimes(1);
    expect(openai.mock.calls[0]?.[0]).toMatchObject({
      endpoint: 'https://api.openai.com/v1/audio/transcriptions',
      model: 'whisper-1',
      apiKey: 'sk-test',
    });
    expect(result.resolution).toEqual({
      engine: 'openai',
      modelLabel: 'openai/whisper-1',
      fallbackReason: null,
    });
    expect(resolved).toEqual([
      { engine: 'openai', modelLabel: 'openai/whisper-1', fallbackReason: null },
    ]);
  });

  it('req_trans_001_reuses_one_plan_without_confirming_twice', async () => {
    const confirm = vi.fn(async () => true);
    const { runner, openai } = createRunner({
      settings: settings({ transcriptionEngine: 'openai' }),
      confirm,
    });
    const plan = await runner.plan({
      durationSeconds: 600,
      preferredAudio: 'enhanced',
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({
      host: 'api.openai.com',
      model: 'whisper-1',
      durationSeconds: 600,
      chunkCount: 1,
      audioVariant: 'enhanced',
    });
    expect(plan.resolution.engine).toBe('openai');
    await runner.run(baseOptions, plan);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(openai).toHaveBeenCalledTimes(1);
  });

  it('req_trans_001_falls_back_to_local_when_the_upload_is_declined', async () => {
    const { runner, local, openai } = createRunner({
      settings: settings({ transcriptionEngine: 'openai' }),
      confirm: async () => false,
    });
    const result = await runner.run(baseOptions);
    expect(openai).not.toHaveBeenCalled();
    expect(local).toHaveBeenCalledTimes(1);
    expect(result.resolution).toEqual({
      engine: 'whisper-cpp',
      modelLabel: 'small',
      fallbackReason: 'cloud-declined',
    });
  });

  it('req_trans_001_reports_a_missing_chatgpt_profile_without_uploading', async () => {
    const { runner, openai } = createRunner({
      settings: settings({
        transcriptionEngine: 'openai',
        openaiTranscriptionProfileId: '',
        llmProfiles: [],
      }),
      confirm: async () => true,
    });
    const result = await runner.run(baseOptions);
    expect(openai).not.toHaveBeenCalled();
    expect(result.outcome.state).toBe('failed');
    expect(result.outcome.errorCode).toBe('openai-config');
    expect(result.resolution.engine).toBe('openai');
  });

  it('req_trans_001_reports_a_missing_api_key_without_uploading', async () => {
    const { runner, openai } = createRunner({
      settings: settings({ transcriptionEngine: 'openai' }),
      confirm: async () => true,
      apiKey: null,
    });
    const result = await runner.run(baseOptions);
    expect(openai).not.toHaveBeenCalled();
    expect(result.outcome.errorCode).toBe('openai-config');
  });

  it('req_trans_001_reports_a_missing_local_model', async () => {
    const { runner, local } = createRunner({
      settings: settings({ transcriptionEngine: 'whisper-cpp' }),
      installedPath: null,
    });
    const resolved: unknown[] = [];
    const result = await runner.run({
      ...baseOptions,
      onResolved: (value) => resolved.push(value),
    });
    expect(local).not.toHaveBeenCalled();
    expect(result.outcome.state).toBe('failed');
    expect(result.outcome.errorCode).toBe('model-missing');
    expect(resolved).toEqual([
      { engine: 'whisper-cpp', modelLabel: 'small', fallbackReason: null },
    ]);
  });

  it('req_trans_001_refuses_openai_without_a_confirmation_callback', async () => {
    const { runner, openai } = createRunner({
      settings: settings({ transcriptionEngine: 'openai' }),
    });
    const result = await runner.run(baseOptions);
    expect(openai).not.toHaveBeenCalled();
    expect(result.outcome.errorCode).toBe('openai-config');
  });
});
