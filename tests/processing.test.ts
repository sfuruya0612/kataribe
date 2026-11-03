import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiKeyStore } from '../src/main/api-keys';
import { hashFile } from '../src/main/asset-download';
import type {
  DiarizationOptions,
  DiarizationResult,
  DiarizationService,
} from '../src/main/diarization';
import {
  DIARIZATION_CACHE_SCHEMA_VERSION,
  diarizationCachePath,
  readDiarizationCache,
  writeDiarizationCache,
  type DiarizationCache,
} from '../src/main/diarization-cache';
import type { LlmClient } from '../src/main/llm';
import type { EncodeOptions, MediaEncoder } from '../src/main/media';
import { writeMeetingMeta, readMeetingMeta, type MeetingMeta } from '../src/main/meeting-meta';
import { MeetingStore } from '../src/main/meetings';
import {
  createEnhancementFile,
  readEnhancementFile,
  writeEnhancementFile,
} from '../src/main/reuse-metadata';
import { runDiarization } from '../src/main/diarization-run';
import { ProcessingCoordinator } from '../src/main/processing';
import type { ReuseSavedAudioService } from '../src/main/reuse-saved-audio';
import type { ReuseEnhancementService } from '../src/main/reuse-enhancement';
import type {
  TranscribeOptions,
  TranscriptionOutcome,
  TranscriptionService,
} from '../src/main/transcription';
import type { TranscriptionRunner } from '../src/main/transcription-runner';
import { encodeWavMono16 } from '../src/main/wav';
import {
  formatTranscriptMarkdown,
  formatTranslationMarkdown,
  type TranscriptSegment,
} from '../src/shared/markdown';
import { normalizeAppSettings } from '../src/shared/settings';
import type { AppSettings } from '../src/shared/types';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createMeeting() {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-processing-'));
  roots.push(root);
  const saveRoot = join(root, 'Kataribe');
  const meetingId = '00000000-0000-4000-8000-0000000000aa';
  const meetingDir = join(saveRoot, '2026', '2026-10-31_1000_要約テスト');
  await mkdir(meetingDir, { recursive: true });
  const meta: MeetingMeta = {
    schema_version: 1,
    id: meetingId,
    status: 'transcribed',
    title: '要約テスト',
    started_at: '2026-10-31T01:00:00.000Z',
    duration: 60,
    source: { input: 'both' },
    sample_rate: 48000,
    channels: 1,
    bits_per_sample: 16,
    chunks: [],
    expected_samples: 0,
    actual_samples: 0,
    app_version: '0.1.0',
    audio_path: 'audio.mp3',
  };
  await writeMeetingMeta(join(meetingDir, 'meta.json'), meta);
  await writeFile(
    join(meetingDir, 'transcript.md'),
    formatTranscriptMarkdown({
      title: '要約テスト',
      startedAt: meta.started_at,
      durationSeconds: 60,
      source: 'mic+system',
      model: 'small',
      language: 'ja',
      segments: [
        { startSeconds: 1, text: 'リリース時期を決めます。' },
        { startSeconds: 12, text: '担当は田中さんです。' },
      ],
    }),
  );
  return { root, saveRoot, meetingId, meetingDir };
}

function createCoordinator(options: {
  root: string;
  saveRoot: string;
  complete: ReturnType<typeof vi.fn>;
  settings?: Partial<AppSettings>;
  reuseSavedAudio?: ReuseSavedAudioService;
  reuseEnhancement?: ReuseEnhancementService;
  mediaEncoder?: MediaEncoder;
  transcriptionRunner?: TranscriptionRunner;
  diarizationService?: DiarizationService;
}) {
  const meetingStore = new MeetingStore(options.saveRoot);
  const states: string[] = [];
  const coordinator = new ProcessingCoordinator({
    tempRoot: join(options.root, 'tmp'),
    meetingStore,
    apiKeyStore: {
      status: async (profileId: string) => ({
        profileId,
        configured: true,
        host: 'api.openai.com',
        keychainAvailable: true,
        keychainError: null,
      }),
      hostMatches: () => true,
      getKey: async () => 'sk-test',
    } as unknown as ApiKeyStore,
    mediaEncoder: options.mediaEncoder ?? ({} as MediaEncoder),
    transcriptionService: {} as TranscriptionService,
    transcriptionRunner:
      options.transcriptionRunner ?? ({} as TranscriptionRunner),
    diarizationService: options.diarizationService ?? ({} as DiarizationService),
    llmClient: { complete: options.complete } as unknown as LlmClient,
    reuseSavedAudio: options.reuseSavedAudio,
    reuseEnhancement: options.reuseEnhancement,
    settings: () =>
      normalizeAppSettings({
        llmProfiles: [
          {
            id: 'work',
            provider: 'chatgpt',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-5.5',
          },
          {
            id: 'local',
            provider: 'ollama',
            baseUrl: 'http://localhost:11434/v1',
            model: 'qwen3',
          },
        ],
        llmDefaultProfileId: 'work',
        summaryLanguage: 'ja',
        whisperModel: 'small',
        removeFillersBeforeSummary: false,
        ...options.settings,
      }),
    onStateChange: (state) => {
      states.push(`${state.stage}:${state.progress}`);
    },
    onMeetingUpdated: () => undefined,
  });
  return { coordinator, meetingStore, states };
}

const summaryResponse = {
  text: [
    '## 要約',
    '会議の要約です。',
    '## 決定事項',
    '- リリースする',
    '## ToDo',
    '- 資料をまとめる',
    '## 未決事項',
    'なし',
  ].join('\n'),
  inputTokens: 100,
  outputTokens: 40,
  status: 200,
};

describe('ProcessingCoordinator summary flow', () => {
  it('previews, confirms, and writes summary.md with a previous backup', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    const complete = vi.fn(async () => summaryResponse);
    const { coordinator, meetingStore } = createCoordinator({ root, saveRoot, complete });

    const preview = await coordinator.createSummaryPreview(meetingId);
    expect(preview).toMatchObject({
      provider: 'chatgpt',
      model: 'gpt-5.5',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      language: 'ja',
      partial: false,
    });
    expect(preview.text).toContain('リリース時期');
    expect(preview.estimatedTokens).toBeGreaterThan(0);
    expect(preview.cleanupEnabled).toBe(false);
    expect(preview.cleanupEstimatedTokens).toBe(0);
    expect(complete).not.toHaveBeenCalled();

    const result = await coordinator.generateSummary(meetingId, preview.token);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.summary.body).toContain('## 要約');
    expect(result.summary.body).toContain('- [ ] 資料をまとめる');
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 40 });
    expect(result.cleanup.state).toBe('skipped');

    const summaryPath = join(meetingDir, 'summary.md');
    const markdown = await readFile(summaryPath, 'utf8');
    expect(markdown).toContain('provider: chatgpt');
    expect(markdown).toContain('model: gpt-5.5');
    const meta = JSON.parse(await readFile(join(meetingDir, 'meta.json'), 'utf8'));
    expect(meta.status).toBe('summarized');
    expect(meta.summary.state).toBe('completed');
    const detail = await meetingStore.detail(meetingId);
    expect(detail?.summary?.body).toContain('会議の要約です。');

    await expect(
      coordinator.generateSummary(meetingId, preview.token),
    ).rejects.toThrow('確認トークンが無効');
  });

  it('req_summary_002_cleans_before_summary_and_records_the_result', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    await writeFile(
      join(meetingDir, 'transcript.md'),
      formatTranscriptMarkdown({
        title: '要約テスト',
        startedAt: '2026-10-31T01:00:00.000Z',
        durationSeconds: 60,
        source: 'mic+system',
        model: 'small',
        language: 'ja',
        segments: [
          {
            startSeconds: 1,
            endSeconds: 2,
            speaker: '話者A',
            text: 'あー、リリース時期を決めます。',
          },
          {
            startSeconds: 12,
            endSeconds: 13,
            speaker: '話者B',
            text: 'なるほど、担当は田中さんです。',
          },
        ],
      }),
    );
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        text: '[00:00:01] 話者A: リリース時期を決めます。\n[00:00:12] 話者B: 担当は田中さんです。',
        inputTokens: 10,
        outputTokens: 5,
        status: 200,
      })
      .mockResolvedValueOnce(summaryResponse);
    const { coordinator } = createCoordinator({
      root,
      saveRoot,
      complete,
      settings: { removeFillersBeforeSummary: true },
    });

    const preview = await coordinator.createSummaryPreview(meetingId);
    expect(preview.cleanupEnabled).toBe(true);
    expect(preview.cleanupEstimatedTokens).toBeGreaterThan(0);

    const result = await coordinator.generateSummary(meetingId, preview.token);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0].user).not.toContain('なるほど');
    expect(result.cleanup.state).toBe('completed');
    const meta = JSON.parse(await readFile(join(meetingDir, 'meta.json'), 'utf8'));
    expect(meta.summary.cleanup).toMatchObject({
      state: 'completed',
      chunks: 1,
      fallback_chunks: 0,
    });
    expect(meta.summary.usage).toEqual({ input_tokens: 110, output_tokens: 45 });
  });

  it('uses the selected LLM profile for preview and generation', async () => {
    const { root, saveRoot, meetingId } = await createMeeting();
    const complete = vi.fn(async () => summaryResponse);
    const { coordinator } = createCoordinator({ root, saveRoot, complete });
    const preview = await coordinator.createSummaryPreview(meetingId, 'local');
    expect(preview).toMatchObject({
      profileId: 'local',
      provider: 'ollama',
      model: 'qwen3',
      endpoint: 'http://localhost:11434/v1/chat/completions',
    });
    await coordinator.generateSummary(meetingId, preview.token);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown LLM profile', async () => {
    const { root, saveRoot, meetingId } = await createMeeting();
    const { coordinator } = createCoordinator({
      root,
      saveRoot,
      complete: vi.fn(),
    });
    await expect(
      coordinator.createSummaryPreview(meetingId, 'missing'),
    ).rejects.toThrow('LLM プロファイルが設定されていません');
  });

  it('backs up an existing summary before regenerating', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    await writeFile(join(meetingDir, 'summary.md'), 'old summary\n');
    const complete = vi.fn(async () => summaryResponse);
    const { coordinator } = createCoordinator({ root, saveRoot, complete });
    const preview = await coordinator.createSummaryPreview(meetingId);
    await coordinator.generateSummary(meetingId, preview.token);
    expect(await readFile(join(meetingDir, 'summary.previous.md'), 'utf8')).toBe(
      'old summary\n',
    );
  });

  it('rejects a token when the transcript changed', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    const complete = vi.fn(async () => summaryResponse);
    const { coordinator } = createCoordinator({ root, saveRoot, complete });
    const preview = await coordinator.createSummaryPreview(meetingId);
    await writeFile(join(meetingDir, 'transcript.md'), 'changed transcript\n');
    await expect(
      coordinator.generateSummary(meetingId, preview.token),
    ).rejects.toThrow('文字起こしが変更されました');
    expect(complete).not.toHaveBeenCalled();
  });

  it('generates a meeting title when the title is still untitled', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    const metaPath = join(meetingDir, 'meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    meta.title = 'タイトル未入力';
    await writeFile(metaPath, JSON.stringify(meta));
    const complete = vi
      .fn()
      .mockResolvedValueOnce(summaryResponse)
      .mockResolvedValueOnce({
        text: 'リリース計画の定例',
        inputTokens: 5,
        outputTokens: 3,
        status: 200,
      });
    const { coordinator } = createCoordinator({ root, saveRoot, complete });
    const preview = await coordinator.createSummaryPreview(meetingId);
    const result = await coordinator.generateSummary(meetingId, preview.token);
    expect(result.meeting.title).toBe('リリース計画の定例');
    expect(result.meeting.meetingDir).not.toBe(meetingDir);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('requires a transcript and an API key for the preview', async () => {
    const { root, saveRoot, meetingId } = await createMeeting();
    const complete = vi.fn();
    const { coordinator } = createCoordinator({ root, saveRoot, complete });
    await rm(join(saveRoot, '2026', '2026-10-31_1000_要約テスト', 'transcript.md'));
    await expect(coordinator.createSummaryPreview(meetingId)).rejects.toThrow(
      '文字起こしがありません',
    );
  });
});

describe('ProcessingCoordinator translation flow', () => {
  it('previews and writes transcript.en.md', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    const complete = vi.fn(async () => ({
      text: [
        '[00:00:01] We will decide the release date.',
        '[00:00:12] Tanaka is the owner.',
      ].join('\n'),
      inputTokens: 20,
      outputTokens: 12,
      status: 200,
    }));
    const { coordinator, meetingStore } = createCoordinator({
      root,
      saveRoot,
      complete,
    });
    const preview = await coordinator.createTranslationPreview(meetingId, 'en');
    expect(preview).toMatchObject({
      targetLanguage: 'en',
      sourceLanguage: 'ja',
      provider: 'chatgpt',
    });
    expect(complete).not.toHaveBeenCalled();

    const result = await coordinator.generateTranslation(
      meetingId,
      preview.token,
    );
    expect(result.translation.language).toBe('en');
    expect(result.translation.body).toContain('We will decide');
    const markdown = await readFile(
      join(meetingDir, 'transcript.en.md'),
      'utf8',
    );
    expect(markdown).toContain('language: en');
    expect(markdown).toContain('source_language: ja');
    const meta = JSON.parse(await readFile(join(meetingDir, 'meta.json'), 'utf8'));
    expect(meta.translations.en.state).toBe('completed');
    const detail = await meetingStore.detail(meetingId);
    expect(detail?.translations.en?.body).toContain('Tanaka is the owner');
  });

  it('rejects translation into the same language', async () => {
    const { root, saveRoot, meetingId } = await createMeeting();
    const { coordinator } = createCoordinator({
      root,
      saveRoot,
      complete: vi.fn(),
    });
    await expect(
      coordinator.createTranslationPreview(meetingId, 'ja'),
    ).rejects.toThrow('同じ言語');
  });
});

describe('ProcessingCoordinator interrupted recovery', () => {  it('marks unfinished transcription as interrupted', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    const metaPath = join(meetingDir, 'meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    meta.status = 'transcribing';
    meta.transcription = {
      state: 'running',
      last_segment_end: 10,
    };
    await writeFile(metaPath, JSON.stringify(meta));
    const complete = vi.fn();
    const { coordinator } = createCoordinator({ root, saveRoot, complete });
    await coordinator.markInterruptedMeetings();
    const updated = JSON.parse(await readFile(metaPath, 'utf8'));
    expect(updated.status).toBe('error');
    expect(updated.transcription.state).toBe('interrupted');
    expect(updated.transcription.partial).toBe(true);
    expect(updated.error).toContain('中断');
    expect(updated.id).toBe(meetingId);
  });

  it('recovers a transcription that actually reached the end', async () => {
    const { root, saveRoot, meetingDir } = await createMeeting();
    const metaPath = join(meetingDir, 'meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    meta.status = 'transcribing';
    meta.transcription = { state: 'running', last_segment_end: 50 };
    await writeFile(metaPath, JSON.stringify(meta));
    const complete = vi.fn();
    const { coordinator } = createCoordinator({ root, saveRoot, complete });
    await coordinator.markInterruptedMeetings();
    const updated = JSON.parse(await readFile(metaPath, 'utf8'));
    expect(updated.status).toBe('transcribed');
    expect(updated.transcription.state).toBe('completed');
    expect(updated.transcription.partial).toBe(false);
  });

  it('marks an interrupted enhancement and its enhancement.json entries', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    const metaPath = join(meetingDir, 'meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    meta.status = 'enhancing';
    await writeFile(metaPath, JSON.stringify(meta));
    const source = {
      path: 'audio.mp3',
      sha256: 'a'.repeat(64),
      sample_rate: 48_000,
      channels: 1,
    };
    const file = createEnhancementFile(source);
    file.saved_audio.nemotronlabs = {
      state: 'running',
      model_sha256: 'b'.repeat(64),
      input: source,
      output: null,
      settings: { chunk_seconds: 5, hop_seconds: 2.5, crossfade_seconds: 0.5 },
      started_at: '2026-11-03T00:00:00.000Z',
      finished_at: null,
      elapsed_seconds: null,
      error: null,
    };
    await writeEnhancementFile(meetingDir, file);

    const complete = vi.fn();
    const { coordinator } = createCoordinator({ root, saveRoot, complete });
    await coordinator.markInterruptedMeetings();

    const updated = JSON.parse(await readFile(metaPath, 'utf8'));
    expect(updated.status).toBe('error');
    expect(updated.error).toContain('音声強調');
    expect(updated.id).toBe(meetingId);
    expect(updated.enhancement?.savedAudioState).toBe('interrupted');
    const enhancement = await readEnhancementFile(meetingDir);
    expect(enhancement.state).toBe('ok');
    expect(
      enhancement.state === 'ok'
        ? enhancement.file.saved_audio.nemotronlabs?.state
        : null,
    ).toBe('interrupted');
  });
});

describe('saved audio enhancement queue', () => {
  it('rejects a second enhancement for the same meeting and restores the status', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    await writeFile(join(meetingDir, 'audio.mp3'), 'audio');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enhance = vi.fn(async () => {
      await gate;
    });
    const complete = vi.fn();
    const { coordinator } = createCoordinator({
      root,
      saveRoot,
      complete,
      reuseSavedAudio: { enhance } as unknown as ReuseSavedAudioService,
    });
    const first = coordinator.requestSavedAudioEnhancement(
      meetingId,
      'nemotronlabs',
    );
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (coordinator.getState().stage === 'enhancing') {
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    expect(coordinator.getState().stage).toBe('enhancing');
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await readMeetingMeta(join(meetingDir, 'meta.json'))).status === 'enhancing') {
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    expect((await readMeetingMeta(join(meetingDir, 'meta.json'))).status).toBe(
      'enhancing',
    );
    await expect(
      coordinator.requestSavedAudioEnhancement(meetingId, 'nemotronlabs'),
    ).rejects.toThrow(/already queued/u);
    release();
    await first;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (coordinator.getState().stage === null) {
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    expect(coordinator.getState().stage).toBeNull();
    expect((await readMeetingMeta(join(meetingDir, 'meta.json'))).status).toBe(
      'transcribed',
    );
    expect(enhance).toHaveBeenCalledTimes(1);
  });

  it('removes stale derivatives when the saved audio changes before re-enhancement', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    await writeFile(join(meetingDir, 'audio.mp3'), 'changed audio');
    await writeFile(join(meetingDir, 'transcript.raw.md'), 'old raw');
    await writeFile(
      join(meetingDir, 'transcript.nemotronlabs.md'),
      'old enhanced',
    );
    await writeFile(
      join(meetingDir, 'audio.enhanced.nemotronlabs.mp3'),
      'old enhanced audio',
    );
    await writeEnhancementFile(
      meetingDir,
      createEnhancementFile({
        path: 'audio.mp3',
        sha256: '0'.repeat(64),
        sample_rate: 44100,
        channels: 1,
      }),
    );
    const enhance = vi.fn(async () => undefined);
    const { coordinator } = createCoordinator({
      root,
      saveRoot,
      complete: vi.fn(),
      reuseSavedAudio: { enhance } as unknown as ReuseSavedAudioService,
    });

    await coordinator.requestSavedAudioEnhancement(
      meetingId,
      'nemotronlabs',
    );

    expect(enhance).toHaveBeenCalledTimes(1);
    await expect(
      readFile(join(meetingDir, 'transcript.raw.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(join(meetingDir, 'transcript.nemotronlabs.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(join(meetingDir, 'audio.enhanced.nemotronlabs.mp3')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('transcription comparison flow', () => {
  it('saves raw and enhanced snapshots and makes the enhanced result primary', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    await writeFile(join(meetingDir, 'audio.mp3'), 'audio');
    const outcome = (text: string): TranscriptionOutcome => ({
      state: 'completed',
      segments: [{ startSeconds: 0, endSeconds: 1, text }],
      language: 'ja',
      lastEndSeconds: 1,
      durationSeconds: 1,
      elapsedSeconds: 0.5,
      errorCode: null,
      error: null,
      resumed: false,
    });
    const runner = {
      plan: vi.fn(async () => ({
        resolution: {
          engine: 'whisper-cpp' as const,
          modelLabel: 'small',
          fallbackReason: null,
        },
        failure: null,
        localModel: 'small' as const,
        localModelPath: '/model',
        openAiModel: null,
        openAiEndpoint: null,
        openAiApiKey: null,
      })),
      run: vi.fn(async (options: { audioWavPath: string }) => ({
        outcome: outcome(
          options.audioWavPath.includes('enhanced')
            ? 'enhanced text'
            : 'raw text',
        ),
        resolution: {
          engine: 'whisper-cpp' as const,
          modelLabel: 'small',
          fallbackReason: null,
        },
      })),
    } as unknown as TranscriptionRunner;
    const mediaEncoder = {
      createTranscriptionWav: async ({
        outputPath,
      }: {
        outputPath: string;
      }) => {
        await writeFile(
          outputPath,
          encodeWavMono16(new Float32Array(16_000), 16_000),
        );
      },
    } as unknown as MediaEncoder;
    const reuseEnhancement = {
      enhance: async ({ outputPath }: { outputPath: string }) => {
        await writeFile(
          outputPath,
          encodeWavMono16(new Float32Array(16_000), 16_000),
        );
      },
    } as unknown as ReuseEnhancementService;
    const complete = vi.fn();
    const { coordinator } = createCoordinator({
      root,
      saveRoot,
      complete,
      settings: {
        enhanceBeforeTranscription: true,
        speakerDiarization: false,
      },
      transcriptionRunner: runner,
      mediaEncoder,
      reuseEnhancement,
    });

    await coordinator.requestTranscription(meetingId);
    expect(
      (await readFile(join(meetingDir, 'transcript.md'), 'utf8')).includes(
        'enhanced text',
      ),
    ).toBe(true);
    expect(
      (await readFile(join(meetingDir, 'transcript.raw.md'), 'utf8')).includes(
        'raw text',
      ),
    ).toBe(true);
    expect(
      (
        await readFile(join(meetingDir, 'transcript.nemotronlabs.md'), 'utf8')
      ).includes('enhanced text'),
    ).toBe(true);
    const read = await readEnhancementFile(meetingDir);
    expect(read.state).toBe('ok');
    expect(
      read.state === 'ok' ? read.file.transcription.raw.state : null,
    ).toBe('succeeded');
    expect(
      read.state === 'ok'
        ? read.file.transcription.models.nemotronlabs?.state
        : null,
    ).toBe('succeeded');
    expect(
      read.state === 'ok' ? read.file.transcription.primary : null,
    ).toEqual({
      source: 'nemotronlabs',
      path: 'transcript.md',
    });
    const meta = await readMeetingMeta(join(meetingDir, 'meta.json'));
    expect(meta.status).toBe('transcribed');
    expect(meta.enhancement?.hasRawTranscript).toBe(true);
    expect(meta.enhancement?.transcriptModels).toEqual(['nemotronlabs']);
    expect(runner.plan).toHaveBeenCalledTimes(1);
  });

  it('runs speaker diarization only on the primary transcript', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    await writeFile(join(meetingDir, 'audio.mp3'), 'audio');
    const outcome = (text: string): TranscriptionOutcome => ({
      state: 'completed',
      segments: [{ startSeconds: 0, endSeconds: 1, text }],
      language: 'ja',
      lastEndSeconds: 1,
      durationSeconds: 1,
      elapsedSeconds: 0.5,
      errorCode: null,
      error: null,
      resumed: false,
    });
    const runner = {
      plan: vi.fn(async () => ({
        resolution: {
          engine: 'whisper-cpp' as const,
          modelLabel: 'small',
          fallbackReason: null,
        },
        failure: null,
        localModel: 'small' as const,
        localModelPath: '/model',
        openAiModel: null,
        openAiEndpoint: null,
        openAiApiKey: null,
      })),
      run: vi.fn(async (options: { audioWavPath: string }) => ({
        outcome: outcome(
          options.audioWavPath.includes('enhanced')
            ? 'enhanced text'
            : 'raw text',
        ),
        resolution: {
          engine: 'whisper-cpp' as const,
          modelLabel: 'small',
          fallbackReason: null,
        },
      })),
    } as unknown as TranscriptionRunner;
    const diarize = vi.fn(
      async (
        _wavPath: string,
        segments: TranscriptSegment[],
        options: DiarizationOptions,
      ) => ({
        ...diarizationResult(options, false),
        segments: segments.map((segment) => ({
          ...segment,
          speaker: '田中',
        })),
      }),
    );
    const mediaEncoder = {
      createTranscriptionWav: async ({
        outputPath,
      }: {
        outputPath: string;
      }) => {
        await writeFile(
          outputPath,
          encodeWavMono16(new Float32Array(16_000), 16_000),
        );
      },
    } as unknown as MediaEncoder;
    const reuseEnhancement = {
      enhance: async ({ outputPath }: { outputPath: string }) => {
        await writeFile(
          outputPath,
          encodeWavMono16(new Float32Array(16_000), 16_000),
        );
      },
    } as unknown as ReuseEnhancementService;
    const { coordinator } = createCoordinator({
      root,
      saveRoot,
      complete: vi.fn(),
      settings: {
        enhanceBeforeTranscription: true,
        speakerDiarization: true,
      },
      transcriptionRunner: runner,
      mediaEncoder,
      reuseEnhancement,
      diarizationService: { diarize } as unknown as DiarizationService,
    });

    await coordinator.requestTranscription(meetingId);

    expect(diarize).toHaveBeenCalledTimes(1);
    expect(diarize.mock.calls[0]?.[0]).toContain('enhanced');
    expect(
      await readFile(join(meetingDir, 'transcript.raw.md'), 'utf8'),
    ).not.toContain('田中');
    expect(
      await readFile(
        join(meetingDir, 'transcript.nemotronlabs.md'),
        'utf8',
      ),
    ).not.toContain('田中');
    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toContain(
      '田中',
    );
  });

  it('sends the enhanced audio once to OpenAI without a comparison', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    await writeFile(join(meetingDir, 'audio.mp3'), 'audio');
    const outcome: TranscriptionOutcome = {
      state: 'completed',
      segments: [{ startSeconds: 0, endSeconds: 1, text: 'openai text' }],
      language: 'ja',
      lastEndSeconds: 1,
      durationSeconds: 1,
      elapsedSeconds: 0.5,
      errorCode: null,
      error: null,
      resumed: false,
    };
    const run = vi.fn(async () => ({
      outcome,
      resolution: {
        engine: 'openai' as const,
        modelLabel: 'openai/whisper-1',
        fallbackReason: null,
      },
    }));
    const runner = {
      plan: vi.fn(async () => ({
        resolution: {
          engine: 'openai' as const,
          modelLabel: 'openai/whisper-1',
          fallbackReason: null,
        },
        failure: null,
        localModel: null,
        localModelPath: null,
        openAiModel: 'whisper-1',
        openAiEndpoint: 'https://api.openai.com/v1/audio/transcriptions',
        openAiApiKey: 'sk-test',
      })),
      run,
    } as unknown as TranscriptionRunner;
    const mediaEncoder = {
      createTranscriptionWav: async ({
        outputPath,
      }: {
        outputPath: string;
      }) => {
        await writeFile(
          outputPath,
          encodeWavMono16(new Float32Array(16_000), 16_000),
        );
      },
    } as unknown as MediaEncoder;
    const enhance = vi.fn(async ({ outputPath }: { outputPath: string }) => {
      await writeFile(
        outputPath,
        encodeWavMono16(new Float32Array(16_000), 16_000),
      );
    });
    const { coordinator } = createCoordinator({
      root,
      saveRoot,
      complete: vi.fn(),
      settings: {
        enhanceBeforeTranscription: true,
        speakerDiarization: false,
        transcriptionEngine: 'openai',
        openaiTranscriptionProfileId: 'work',
      },
      transcriptionRunner: runner,
      mediaEncoder,
      reuseEnhancement: { enhance } as unknown as ReuseEnhancementService,
    });

    await coordinator.requestTranscription(meetingId);

    expect(run).toHaveBeenCalledTimes(1);
    expect(enhance).toHaveBeenCalledTimes(1);
    await expect(
      readFile(join(meetingDir, 'transcript.raw.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(join(meetingDir, 'transcript.nemotronlabs.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toContain(
      'openai text',
    );
  });

  it('saves a partial transcript when neither side completes', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    await writeFile(join(meetingDir, 'audio.mp3'), 'audio');
    const partial: TranscriptionOutcome = {
      state: 'partial',
      segments: [{ startSeconds: 0, endSeconds: 1, text: 'raw partial' }],
      language: 'ja',
      lastEndSeconds: 1,
      durationSeconds: 1,
      elapsedSeconds: 0.5,
      errorCode: 'process-failed',
      error: 'raw failed',
      resumed: false,
    };
    const failed: TranscriptionOutcome = {
      ...partial,
      state: 'failed',
      segments: [],
      error: 'enhanced failed',
    };
    const runner = {
      plan: vi.fn(async () => ({
        resolution: {
          engine: 'whisper-cpp' as const,
          modelLabel: 'small',
          fallbackReason: null,
        },
        failure: null,
        localModel: 'small' as const,
        localModelPath: '/model',
        openAiModel: null,
        openAiEndpoint: null,
        openAiApiKey: null,
      })),
      run: vi.fn(async (options: { audioWavPath: string }) => ({
        outcome: options.audioWavPath.includes('enhanced') ? failed : partial,
        resolution: {
          engine: 'whisper-cpp' as const,
          modelLabel: 'small',
          fallbackReason: null,
        },
      })),
    } as unknown as TranscriptionRunner;
    const mediaEncoder = {
      createTranscriptionWav: async ({
        outputPath,
      }: {
        outputPath: string;
      }) => {
        await writeFile(
          outputPath,
          encodeWavMono16(new Float32Array(16_000), 16_000),
        );
      },
    } as unknown as MediaEncoder;
    const reuseEnhancement = {
      enhance: async ({ outputPath }: { outputPath: string }) => {
        await writeFile(
          outputPath,
          encodeWavMono16(new Float32Array(16_000), 16_000),
        );
      },
    } as unknown as ReuseEnhancementService;
    const { coordinator } = createCoordinator({
      root,
      saveRoot,
      complete: vi.fn(),
      settings: {
        enhanceBeforeTranscription: true,
        speakerDiarization: false,
      },
      transcriptionRunner: runner,
      mediaEncoder,
      reuseEnhancement,
    });

    await coordinator.requestTranscription(meetingId);

    const transcript = await readFile(join(meetingDir, 'transcript.md'), 'utf8');
    expect(transcript).toContain('raw partial');
    expect(transcript).toContain('partial: true');
    await expect(
      readFile(join(meetingDir, 'transcript.raw.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(join(meetingDir, 'transcript.nemotronlabs.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const meta = await readMeetingMeta(join(meetingDir, 'meta.json'));
    expect(meta.transcription?.state).toBe('partial');
    expect(meta.transcription?.partial).toBe(true);
  });

  it('records the enhancement failure and keeps the raw transcript', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    await writeFile(join(meetingDir, 'audio.mp3'), 'audio');
    const outcome: TranscriptionOutcome = {
      state: 'completed',
      segments: [{ startSeconds: 0, endSeconds: 1, text: 'raw text' }],
      language: 'ja',
      lastEndSeconds: 1,
      durationSeconds: 1,
      elapsedSeconds: 0.5,
      errorCode: null,
      error: null,
      resumed: false,
    };
    const runner = {
      plan: vi.fn(async () => ({
        resolution: {
          engine: 'whisper-cpp' as const,
          modelLabel: 'small',
          fallbackReason: null,
        },
        failure: null,
        localModel: 'small' as const,
        localModelPath: '/model',
        openAiModel: null,
        openAiEndpoint: null,
        openAiApiKey: null,
      })),
      run: vi.fn(async () => ({
        outcome,
        resolution: {
          engine: 'whisper-cpp' as const,
          modelLabel: 'small',
          fallbackReason: null,
        },
      })),
    } as unknown as TranscriptionRunner;
    const mediaEncoder = {
      createTranscriptionWav: async ({
        outputPath,
      }: {
        outputPath: string;
      }) => {
        await writeFile(
          outputPath,
          encodeWavMono16(new Float32Array(16_000), 16_000),
        );
      },
    } as unknown as MediaEncoder;
    const reuseEnhancement = {
      enhance: async () => {
        throw new Error('gpu unavailable');
      },
    } as unknown as ReuseEnhancementService;
    const { coordinator } = createCoordinator({
      root,
      saveRoot,
      complete: vi.fn(),
      settings: {
        enhanceBeforeTranscription: true,
        speakerDiarization: false,
      },
      transcriptionRunner: runner,
      mediaEncoder,
      reuseEnhancement,
    });

    await coordinator.requestTranscription(meetingId);

    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toContain(
      'raw text',
    );
    expect(runner.run).toHaveBeenCalledTimes(1);
    const read = await readEnhancementFile(meetingDir);
    expect(read.state).toBe('ok');
    expect(
      read.state === 'ok'
        ? read.file.transcription.models.nemotronlabs
        : null,
    ).toMatchObject({
      state: 'failed',
      error: 'gpu unavailable',
    });
  });

  it('keeps the previous transcript when a re-run fails on one side', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    await writeFile(join(meetingDir, 'audio.mp3'), 'audio');
    await writeFile(join(meetingDir, 'transcript.md'), 'OLD TRANSCRIPT');
    const runner = {
      plan: vi.fn(async () => ({
        resolution: {
          engine: 'whisper-cpp' as const,
          modelLabel: 'small',
          fallbackReason: null,
        },
        failure: null,
        localModel: 'small' as const,
        localModelPath: '/model',
        openAiModel: null,
        openAiEndpoint: null,
        openAiApiKey: null,
      })),
      run: vi.fn(async (options: { audioWavPath: string }) => ({
        outcome: options.audioWavPath.includes('enhanced')
          ? {
              state: 'failed' as const,
              segments: [],
              language: 'ja',
              lastEndSeconds: 0,
              durationSeconds: 1,
              elapsedSeconds: 0.5,
              errorCode: 'process-failed' as const,
              error: 'enhanced failed',
              resumed: false,
            }
          : {
              state: 'completed' as const,
              segments: [{ startSeconds: 0, endSeconds: 1, text: 'raw text' }],
              language: 'ja',
              lastEndSeconds: 1,
              durationSeconds: 1,
              elapsedSeconds: 0.5,
              errorCode: null,
              error: null,
              resumed: false,
            },
        resolution: {
          engine: 'whisper-cpp' as const,
          modelLabel: 'small',
          fallbackReason: null,
        },
      })),
    } as unknown as TranscriptionRunner;
    const mediaEncoder = {
      createTranscriptionWav: async ({
        outputPath,
      }: {
        outputPath: string;
      }) => {
        await writeFile(
          outputPath,
          encodeWavMono16(new Float32Array(16_000), 16_000),
        );
      },
    } as unknown as MediaEncoder;
    const reuseEnhancement = {
      enhance: async ({ outputPath }: { outputPath: string }) => {
        await writeFile(
          outputPath,
          encodeWavMono16(new Float32Array(16_000), 16_000),
        );
      },
    } as unknown as ReuseEnhancementService;
    const complete = vi.fn();
    const { coordinator } = createCoordinator({
      root,
      saveRoot,
      complete,
      settings: {
        enhanceBeforeTranscription: true,
        speakerDiarization: false,
      },
      transcriptionRunner: runner,
      mediaEncoder,
      reuseEnhancement,
    });

    await coordinator.requestTranscriptionComparison(meetingId);
    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toBe(
      'OLD TRANSCRIPT',
    );
    expect(
      await readFile(join(meetingDir, 'transcript.previous.md'), 'utf8'),
    ).toBe('OLD TRANSCRIPT');
    expect((await readMeetingMeta(join(meetingDir, 'meta.json'))).status).toBe(
      'transcribed',
    );
  });

  it('clears a queued comparison marker when enqueue rejects', async () => {
    const { root, saveRoot, meetingId, meetingDir } = await createMeeting();
    await writeFile(join(meetingDir, 'audio.mp3'), 'audio');
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const outcome: TranscriptionOutcome = {
      state: 'completed',
      segments: [{ startSeconds: 0, endSeconds: 1, text: 'text' }],
      language: 'ja',
      lastEndSeconds: 1,
      durationSeconds: 1,
      elapsedSeconds: 0.5,
      errorCode: null,
      error: null,
      resumed: false,
    };
    const resolution = {
      engine: 'whisper-cpp' as const,
      modelLabel: 'small',
      fallbackReason: null,
    };
    const runner = {
      plan: vi.fn(async () => ({
        resolution,
        failure: null,
        localModel: 'small' as const,
        localModelPath: '/model',
        openAiModel: null,
        openAiEndpoint: null,
        openAiApiKey: null,
      })),
      run: vi.fn(async () => {
        markStarted();
        await gate;
        return { outcome, resolution };
      }),
    } as unknown as TranscriptionRunner;
    const mediaEncoder = {
      createTranscriptionWav: async ({
        outputPath,
      }: {
        outputPath: string;
      }) => {
        await writeFile(
          outputPath,
          encodeWavMono16(new Float32Array(16_000), 16_000),
        );
      },
    } as unknown as MediaEncoder;
    const { coordinator } = createCoordinator({
      root,
      saveRoot,
      complete: vi.fn(),
      settings: {
        enhanceBeforeTranscription: false,
        speakerDiarization: false,
      },
      transcriptionRunner: runner,
      mediaEncoder,
    });

    const first = coordinator.requestTranscription(meetingId);
    await started;
    await expect(
      coordinator.requestTranscriptionComparison(meetingId),
    ).rejects.toThrow(/already queued/u);
    release();
    await first;

    await vi.waitFor(async () => {
      await coordinator.requestTranscription(meetingId);
    });

    expect(runner.run).toHaveBeenCalledTimes(2);
    expect((await readMeetingMeta(join(meetingDir, 'meta.json'))).status).toBe(
      'transcribed',
    );
  });
});

describe('runDiarization', () => {
  const segments = [
    { startSeconds: 0, endSeconds: 1, text: 'one' },
    { startSeconds: 1, endSeconds: 2, text: 'two' },
  ];

  it('req_diar_001_counts_the_labels_returned_by_the_service', async () => {
    const service = {
      diarize: async () => ({
        segments: [
          { ...segments[0], speaker: '話者A' },
          { ...segments[1], speaker: '話者B' },
        ],
        turns: [
          { startSeconds: 0, endSeconds: 1, speaker: 'speaker_00' },
          { startSeconds: 1, endSeconds: 2, speaker: 'speaker_01' },
        ],
        names: {},
        labels: { 話者A: 'speaker_00', 話者B: 'speaker_01' },
        cacheHit: true,
        cacheKey: {
          audio_sha256: 'a'.repeat(64),
          segmentation_sha256: 'b'.repeat(64),
          embedding_sha256: 'c'.repeat(64),
      input_kind: 'raw',
      enhancement_model_sha256: null,
      enhancement_settings: null,
          speaker_count: 'auto',
          cluster_threshold: 0.9,
          threads: 4,
        },
      }),
    } as unknown as DiarizationService;

    const result = await runDiarization({
      service,
      wavPath: '/tmp/audio.wav',
      segments,
      numSpeakers: 'auto',
      signal: new AbortController().signal,
    });

    expect(result.segments).toEqual([
      { ...segments[0], speaker: '話者A' },
      { ...segments[1], speaker: '話者B' },
    ]);
    expect(result.meta).toEqual({ state: 'completed', speakers: 2 });
    expect(result.cacheHit).toBe(true);
    expect(result.cache).toEqual({
      schema_version: 2,
      key: {
        audio_sha256: 'a'.repeat(64),
        segmentation_sha256: 'b'.repeat(64),
        embedding_sha256: 'c'.repeat(64),
      input_kind: 'raw',
      enhancement_model_sha256: null,
      enhancement_settings: null,
        speaker_count: 'auto',
        cluster_threshold: 0.9,
        threads: 4,
      },
      turns: [
        { start: 0, end: 1, cluster: 'speaker_00' },
        { start: 1, end: 2, cluster: 'speaker_01' },
      ],
      names: {},
      labels: { 話者A: 'speaker_00', 話者B: 'speaker_01' },
    });
  });

  it('req_diar_001_keeps_the_original_segments_when_the_service_returns_null', async () => {
    const service = { diarize: async () => null } as unknown as DiarizationService;

    const result = await runDiarization({
      service,
      wavPath: '/tmp/audio.wav',
      segments,
      numSpeakers: 'auto',
      signal: new AbortController().signal,
    });

    expect(result.segments).toEqual(segments);
    expect(result.meta).toEqual({ state: 'completed', speakers: 0 });
    expect(result.cache).toBeNull();
    expect(result.cacheHit).toBe(false);
  });

  it('req_diar_001_keeps_the_original_segments_and_records_the_error_when_the_service_fails', async () => {
    const service = {
      diarize: async () => {
        throw new Error('model download failed');
      },
    } as unknown as DiarizationService;

    const result = await runDiarization({
      service,
      wavPath: '/tmp/audio.wav',
      segments,
      numSpeakers: 'auto',
      signal: new AbortController().signal,
    });

    expect(result.segments).toEqual(segments);
    expect(result.meta).toEqual({
      state: 'failed',
      error: 'model download failed',
    });
    expect(result.cache).toBeNull();
    expect(result.cacheHit).toBe(false);
  });

  it('req_diar_001_records_a_cancellation_as_a_failed_diarization', async () => {
    const controller = new AbortController();
    controller.abort();
    const service = { diarize: async () => null } as unknown as DiarizationService;

    const result = await runDiarization({
      service,
      wavPath: '/tmp/audio.wav',
      segments,
      numSpeakers: 'auto',
      signal: controller.signal,
    });

    expect(result.segments).toEqual(segments);
    expect(result.meta).toEqual({
      state: 'failed',
      error: 'speaker diarization was cancelled',
    });
  });
});

const transcriptionOutcome: TranscriptionOutcome = {
  state: 'completed',
  segments: [
    { startSeconds: 1, endSeconds: 2, text: '一つ目です。' },
    { startSeconds: 2, endSeconds: 3, text: '二つ目です。' },
  ],
  language: 'ja',
  lastEndSeconds: 3,
  durationSeconds: 4,
  elapsedSeconds: 2,
  errorCode: null,
  error: null,
  resumed: false,
};

function diarizationResult(
  options: DiarizationOptions,
  cacheHit: boolean,
  names: Record<string, string> = { speaker_00: '田中', speaker_01: '佐藤' },
): DiarizationResult {
  return {
    segments: [
      { startSeconds: 1, endSeconds: 2, speaker: '田中', text: '一つ目です。' },
      { startSeconds: 2, endSeconds: 3, speaker: '佐藤', text: '二つ目です。' },
    ],
    turns: [
      { startSeconds: 1, endSeconds: 2, speaker: 'speaker_00' },
      { startSeconds: 2, endSeconds: 3, speaker: 'speaker_01' },
    ],
    names,
    labels: { 田中: 'speaker_00', 佐藤: 'speaker_01' },
    cacheHit,
    cacheKey: {
      audio_sha256: options.audioSha256 ?? 'a'.repeat(64),
      segmentation_sha256: 'b'.repeat(64),
      embedding_sha256: 'c'.repeat(64),
      input_kind: options.inputKind ?? 'raw',
      enhancement_model_sha256: options.enhancementModelSha256 ?? null,
      enhancement_settings: options.enhancementSettings ?? null,
      speaker_count: options.numSpeakers,
      cluster_threshold: 0.9,
      threads: 4,
    },
  };
}

async function createDiarizationMeeting() {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-processing-diarization-'));
  roots.push(root);
  const saveRoot = join(root, 'Kataribe');
  const meetingId = '00000000-0000-4000-8000-0000000000ab';
  const meetingDir = join(saveRoot, '2026', '2026-11-01_0900_話者キャッシュ');
  await mkdir(meetingDir, { recursive: true });
  const audioPath = join(meetingDir, 'audio.mp3');
  await writeFile(audioPath, Buffer.from('mp3-data'));
  const audioHash = await hashFile(audioPath);
  const meta: MeetingMeta = {
    schema_version: 1,
    id: meetingId,
    status: 'transcribed',
    title: '話者キャッシュ',
    started_at: '2026-11-01T00:00:00.000Z',
    duration: 4,
    source: { input: 'both' },
    sample_rate: 16000,
    channels: 1,
    bits_per_sample: 16,
    chunks: [],
    expected_samples: 64000,
    actual_samples: 64000,
    app_version: '0.1.0',
    audio_path: 'audio.mp3',
    speakers: ['話者A', '話者B'],
  };
  await writeMeetingMeta(join(meetingDir, 'meta.json'), meta);
  const previousCache: DiarizationCache = {
    schema_version: DIARIZATION_CACHE_SCHEMA_VERSION,
    key: {
      audio_sha256: audioHash,
      segmentation_sha256: 'b'.repeat(64),
      embedding_sha256: 'c'.repeat(64),
      input_kind: 'raw',
      enhancement_model_sha256: null,
      enhancement_settings: null,
      speaker_count: 'auto',
      cluster_threshold: 0.9,
      threads: 4,
    },
    turns: [
      { start: 1, end: 2, cluster: 'speaker_00' },
      { start: 2, end: 3, cluster: 'speaker_01' },
    ],
    names: { speaker_00: '田中' },
    labels: { 話者A: 'speaker_00', 話者B: 'speaker_01' },
  };
  const cachePath = diarizationCachePath(meetingDir);
  await writeDiarizationCache(cachePath, previousCache);
  await writeFile(
    join(meetingDir, 'transcript.ja.md'),
    formatTranslationMarkdown({
      title: meta.title,
      startedAt: meta.started_at,
      durationSeconds: meta.duration,
      source: 'mic+system',
      model: 'small',
      sourceLanguage: 'ja',
      targetLanguage: 'ja',
      provider: 'chatgpt',
      generatedAt: '2026-11-01T00:01:00.000Z',
      segments: [
        { startSeconds: 1, endSeconds: 2, speaker: '話者A', text: '一つ目です。' },
        { startSeconds: 2, endSeconds: 3, text: 'ラベルなしの行です。' },
      ],
    }),
  );
  return { root, saveRoot, meetingId, meetingDir, cachePath, previousCache, audioHash };
}

function createDiarizationCoordinator(options: {
  root: string;
  saveRoot: string;
  diarize: (
    wavPath: string,
    segments: TranscriptSegment[],
    options: DiarizationOptions,
  ) => Promise<DiarizationResult | null>;
  runner?: TranscriptionRunner;
  settings?: Partial<AppSettings>;
}) {
  const meetingStore = new MeetingStore(options.saveRoot);
  const calls: Array<{
    wavPath: string;
    segments: TranscriptSegment[];
    options: DiarizationOptions;
  }> = [];
  const coordinator = new ProcessingCoordinator({
    tempRoot: join(options.root, 'tmp'),
    meetingStore,
    apiKeyStore: {
      status: async (profileId: string) => ({
        profileId,
        configured: true,
        host: 'api.openai.com',
        keychainAvailable: true,
        keychainError: null,
      }),
      hostMatches: () => true,
      getKey: async () => 'sk-test',
    } as unknown as ApiKeyStore,
    mediaEncoder: {
      createTranscriptionWav: async (encode: EncodeOptions) => {
        await writeFile(
          encode.outputPath,
          encodeWavMono16(new Float32Array(16000 * 4), 16000),
        );
      },
    } as unknown as MediaEncoder,
    transcriptionService: {
      transcribe: async (_options: TranscribeOptions) => transcriptionOutcome,
    } as unknown as TranscriptionService,
    transcriptionRunner:
      options.runner ??
      ({
        run: async () => ({
          outcome: transcriptionOutcome,
          resolution: {
            engine: 'whisper-cpp' as const,
            modelLabel: 'small',
            fallbackReason: null,
          },
        }),
      } as unknown as TranscriptionRunner),
    diarizationService: {
      diarize: async (
        wavPath: string,
        segments: TranscriptSegment[],
        diarizationOptions: DiarizationOptions,
      ) => {
        calls.push({ wavPath, segments, options: diarizationOptions });
        return options.diarize(wavPath, segments, diarizationOptions);
      },
    } as unknown as DiarizationService,
    llmClient: {
      complete: async () => ({
        text: '',
        inputTokens: 0,
        outputTokens: 0,
        status: 200,
      }),
    } as unknown as LlmClient,
    settings: () =>
      normalizeAppSettings({
        llmProfiles: [
          {
            id: 'work',
            provider: 'chatgpt',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-5.5',
          },
        ],
        llmDefaultProfileId: 'work',
        summaryLanguage: 'ja',
        whisperModel: 'small',
        speakerDiarization: true,
        speakerCount: 'auto',
        removeFillersBeforeSummary: false,
        ...options.settings,
      }),
    onStateChange: () => undefined,
    onMeetingUpdated: () => undefined,
  });
  return { coordinator, meetingStore, calls };
}

describe('ProcessingCoordinator diarization cache', () => {
  it('req_diar_002_reuses_the_cache_and_keeps_names_in_transcript_and_translation', async () => {
    const setup = await createDiarizationMeeting();
    const { coordinator, calls } = createDiarizationCoordinator({
      root: setup.root,
      saveRoot: setup.saveRoot,
      diarize: async (_wavPath, _segments, options) =>
        diarizationResult(options, true, {
          speaker_00: '田中',
          speaker_01: '佐藤',
          speaker_02: '鈴木',
        }),
    });

    await coordinator.requestTranscription(setup.meetingId);

    expect(calls).toHaveLength(1);
    expect(calls[0].options.cache).toEqual(setup.previousCache);
    expect(calls[0].options.audioSha256).toBe(setup.audioHash);
    const transcript = await readFile(join(setup.meetingDir, 'transcript.md'), 'utf8');
    expect(transcript).toContain('田中: 一つ目です。');
    expect(transcript).toContain('佐藤: 二つ目です。');
    const translation = await readFile(
      join(setup.meetingDir, 'transcript.ja.md'),
      'utf8',
    );
    expect(translation).toContain('田中: 一つ目です。');
    expect(translation).not.toContain('話者A');
    expect(translation).toContain('ラベルなしの行です。');
    const meta = JSON.parse(
      await readFile(join(setup.meetingDir, 'meta.json'), 'utf8'),
    );
    expect(meta.status).toBe('transcribed');
    expect(meta.speakers).toEqual(['田中', '佐藤']);
    expect(meta.diarization).toEqual({ state: 'completed', speakers: 2 });
    const cache = await readDiarizationCache(setup.cachePath);
    expect(cache?.names).toEqual({ speaker_00: '田中', speaker_01: '佐藤' });
    expect(cache?.labels).toEqual({ 田中: 'speaker_00', 佐藤: 'speaker_01' });
    expect(cache?.key.audio_sha256).toBe(setup.audioHash);
  });

  it('req_diar_002_keeps_the_transcript_when_the_cache_cannot_be_written', async () => {
    const setup = await createDiarizationMeeting();
    await rm(setup.cachePath, { force: true });
    await mkdir(setup.cachePath);
    const { coordinator } = createDiarizationCoordinator({
      root: setup.root,
      saveRoot: setup.saveRoot,
      diarize: async (_wavPath, _segments, options) =>
        diarizationResult(options, false),
    });

    await coordinator.requestTranscription(setup.meetingId);

    const transcript = await readFile(join(setup.meetingDir, 'transcript.md'), 'utf8');
    expect(transcript).toContain('田中: 一つ目です。');
    const meta = JSON.parse(
      await readFile(join(setup.meetingDir, 'meta.json'), 'utf8'),
    );
    expect(meta.status).toBe('transcribed');
    expect(meta.speakers).toEqual(['田中', '佐藤']);
    expect(meta.diarization).toEqual({ state: 'completed', speakers: 2 });
  });

  it('req_diar_002_keeps_the_cache_and_transcript_when_diarization_fails', async () => {
    const setup = await createDiarizationMeeting();
    const { coordinator } = createDiarizationCoordinator({
      root: setup.root,
      saveRoot: setup.saveRoot,
      diarize: async () => {
        throw new Error('diarization failed');
      },
    });

    await coordinator.requestTranscription(setup.meetingId);

    const transcript = await readFile(join(setup.meetingDir, 'transcript.md'), 'utf8');
    expect(transcript).toContain('一つ目です。');
    expect(transcript).not.toContain('田中');
    expect(await readDiarizationCache(setup.cachePath)).toEqual(setup.previousCache);
    const meta = JSON.parse(
      await readFile(join(setup.meetingDir, 'meta.json'), 'utf8'),
    );
    expect(meta.status).toBe('transcribed');
    expect(meta.diarization).toEqual({
      state: 'failed',
      error: 'diarization failed',
    });
    expect(meta.speakers).toBeUndefined();
  });

  it('req_diar_002_keeps_the_cache_after_a_cancelled_diarization', async () => {
    const setup = await createDiarizationMeeting();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let notifyStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const { coordinator } = createDiarizationCoordinator({
      root: setup.root,
      saveRoot: setup.saveRoot,
      diarize: async () => {
        notifyStarted();
        await gate;
        return null;
      },
    });

    const pending = coordinator.requestTranscription(setup.meetingId);
    await started;
    coordinator.cancel();
    release();
    await pending;

    expect(await readDiarizationCache(setup.cachePath)).toEqual(setup.previousCache);
    const meta = JSON.parse(
      await readFile(join(setup.meetingDir, 'meta.json'), 'utf8'),
    );
    expect(meta.diarization).toEqual({
      state: 'failed',
      error: 'speaker diarization was cancelled',
    });
    const transcript = await readFile(join(setup.meetingDir, 'transcript.md'), 'utf8');
    expect(transcript).toContain('一つ目です。');
    expect(transcript).not.toContain('田中');
  });
});

describe('ProcessingCoordinator transcription engine metadata', () => {
  it('req_trans_001_records_the_openai_engine_and_model', async () => {
    const setup = await createDiarizationMeeting();
    const runner = {
      run: async () => ({
        outcome: transcriptionOutcome,
        resolution: {
          engine: 'openai' as const,
          modelLabel: 'openai/whisper-1',
          fallbackReason: null,
        },
      }),
    } as unknown as TranscriptionRunner;
    const { coordinator } = createDiarizationCoordinator({
      root: setup.root,
      saveRoot: setup.saveRoot,
      diarize: async (_wavPath, _segments, options) =>
        diarizationResult(options, false),
      runner,
    });

    await coordinator.requestTranscription(setup.meetingId);

    const meta = await readMeetingMeta(join(setup.meetingDir, 'meta.json'));
    expect(meta.transcription?.state).toBe('completed');
    expect(meta.transcription?.engine).toBe('openai');
    expect(meta.transcription?.model).toBe('openai/whisper-1');
    const transcript = await readFile(
      join(setup.meetingDir, 'transcript.md'),
      'utf8',
    );
    expect(transcript).toContain('model: openai/whisper-1');
  });

  it('req_trans_001_reports_a_failed_openai_transcription', async () => {
    const setup = await createDiarizationMeeting();
    const failedOutcome: TranscriptionOutcome = {
      state: 'failed',
      segments: [],
      language: 'auto',
      lastEndSeconds: 0,
      durationSeconds: 4,
      elapsedSeconds: 0,
      errorCode: 'openai-config',
      error: 'invalid key',
      resumed: false,
    };
    const runner = {
      run: async () => ({
        outcome: failedOutcome,
        resolution: {
          engine: 'openai' as const,
          modelLabel: 'openai/whisper-1',
          fallbackReason: null,
        },
      }),
    } as unknown as TranscriptionRunner;
    const { coordinator } = createDiarizationCoordinator({
      root: setup.root,
      saveRoot: setup.saveRoot,
      diarize: async (_wavPath, _segments, options) =>
        diarizationResult(options, false),
      runner,
    });

    await coordinator.requestTranscription(setup.meetingId);

    const meta = await readMeetingMeta(join(setup.meetingDir, 'meta.json'));
    expect(meta.status).toBe('error');
    expect(meta.transcription?.state).toBe('failed');
    expect(meta.transcription?.engine).toBe('openai');
    expect(meta.transcription?.model).toBe('openai/whisper-1');
    expect(meta.error).toContain('OpenAI');
  });

  it('req_trans_001_saves_a_partial_openai_transcription', async () => {
    const setup = await createDiarizationMeeting();
    const partialOutcome: TranscriptionOutcome = {
      state: 'partial',
      segments: [{ startSeconds: 1, endSeconds: 2, text: '前半です。' }],
      language: 'ja',
      lastEndSeconds: 2,
      durationSeconds: 4,
      elapsedSeconds: 1,
      errorCode: 'openai-server',
      error: 'server error',
      resumed: false,
    };
    const runner = {
      run: async (runOptions: {
        onPartial?: (outcome: TranscriptionOutcome) => void | Promise<void>;
      }) => {
        await runOptions.onPartial?.(partialOutcome);
        return {
          outcome: partialOutcome,
          resolution: {
            engine: 'openai' as const,
            modelLabel: 'openai/whisper-1',
            fallbackReason: null,
          },
        };
      },
    } as unknown as TranscriptionRunner;
    const { coordinator } = createDiarizationCoordinator({
      root: setup.root,
      saveRoot: setup.saveRoot,
      diarize: async (_wavPath, _segments, options) =>
        diarizationResult(options, false),
      runner,
    });

    await coordinator.requestTranscription(setup.meetingId);

    const meta = await readMeetingMeta(join(setup.meetingDir, 'meta.json'));
    expect(meta.status).toBe('error');
    expect(meta.transcription?.state).toBe('partial');
    expect(meta.transcription?.engine).toBe('openai');
    expect(meta.transcription?.partial).toBe(true);
    const transcript = await readFile(
      join(setup.meetingDir, 'transcript.md'),
      'utf8',
    );
    expect(transcript).toContain('partial: true');
    expect(transcript).toContain('前半です。');
  });
});
