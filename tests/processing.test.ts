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
import { writeMeetingMeta, type MeetingMeta } from '../src/main/meeting-meta';
import { MeetingStore } from '../src/main/meetings';
import type { ModelManager } from '../src/main/models';
import { runDiarization } from '../src/main/diarization-run';
import { ProcessingCoordinator } from '../src/main/processing';
import type {
  TranscribeOptions,
  TranscriptionOutcome,
  TranscriptionService,
} from '../src/main/transcription';
import { encodeWavMono16 } from '../src/main/wav';
import {
  formatTranscriptMarkdown,
  formatTranslationMarkdown,
  type TranscriptSegment,
} from '../src/shared/markdown';
import { normalizeAppSettings } from '../src/shared/settings';

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
}) {
  const meetingStore = new MeetingStore(options.saveRoot);
  const states: string[] = [];
  const coordinator = new ProcessingCoordinator({
    tempRoot: join(options.root, 'tmp'),
    meetingStore,
    modelManager: {} as ModelManager,
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
    mediaEncoder: {} as MediaEncoder,
    transcriptionService: {} as TranscriptionService,
    diarizationService: {} as DiarizationService,
    llmClient: { complete: options.complete } as unknown as LlmClient,
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
    expect(complete).not.toHaveBeenCalled();

    const result = await coordinator.generateSummary(meetingId, preview.token);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.summary.body).toContain('## 要約');
    expect(result.summary.body).toContain('- [ ] 資料をまとめる');
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 40 });

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
      schema_version: 1,
      key: {
        audio_sha256: 'a'.repeat(64),
        segmentation_sha256: 'b'.repeat(64),
        embedding_sha256: 'c'.repeat(64),
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
    modelManager: {
      installedPath: async () => '/tmp/ggml-small.bin',
    } as unknown as ModelManager,
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
