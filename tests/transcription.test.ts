import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWhisperArgs,
  isTranscriptionComplete,
  mergeSegments,
  parseWhisperJson,
  parseWhisperProgressLine,
  parseWhisperSegmentLine,
  TranscriptionService,
} from '../src/main/transcription';
import type { RunProcessResult } from '../src/main/process';
import { encodeWavMono16 } from '../src/main/wav';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function processResult(overrides: Partial<RunProcessResult> = {}): RunProcessResult {
  return {
    code: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    aborted: false,
    ...overrides,
  };
}

async function createWav(): Promise<{ root: string; wav: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-transcription-'));
  roots.push(root);
  const wav = join(root, 'audio.16k.wav');
  await writeFile(wav, encodeWavMono16(new Float32Array(3200), 16000));
  return { root, wav };
}

describe('whisper output parsing', () => {
  it('parses segment lines with dot and comma timestamps', () => {
    expect(
      parseWhisperSegmentLine('[00:01:02.500 --> 00:01:05,000]  こんにちは '),
    ).toEqual({
      startSeconds: 62.5,
      endSeconds: 65,
      text: 'こんにちは',
    });
    expect(parseWhisperSegmentLine('not a segment')).toBeNull();
  });

  it('parses progress percentages', () => {
    expect(parseWhisperProgressLine('whisper_print_progress_callback: progress =  42%')).toBe(42);
    expect(parseWhisperProgressLine('progress = 120%')).toBe(100);
    expect(parseWhisperProgressLine('other line')).toBeNull();
  });

  it('parses JSON transcription offsets and language', () => {
    expect(
      parseWhisperJson(
        JSON.stringify({
          result: { language: 'ja' },
          transcription: [
            { offsets: { from: 1000, to: 4500 }, text: ' こんにちは ' },
            { offsets: { from: 4500, to: 9000 }, text: 'さようなら' },
            { offsets: {} },
          ],
        }),
      ),
    ).toEqual({
      language: 'ja',
      segments: [
        { startSeconds: 1, endSeconds: 4.5, text: 'こんにちは' },
        { startSeconds: 4.5, endSeconds: 9, text: 'さようなら' },
      ],
    });
  });

  it('returns empty data for invalid JSON', () => {
    expect(parseWhisperJson('{')).toEqual({ segments: [], language: null });
  });

  it('requires exit, last segment, and non-empty text for completion', () => {
    expect(
      isTranscriptionComplete([{ startSeconds: 0, endSeconds: 9, text: 'a' }], 20),
    ).toBe(true);
    expect(
      isTranscriptionComplete([{ startSeconds: 0, endSeconds: 4, text: 'a' }], 20),
    ).toBe(false);
    expect(
      isTranscriptionComplete([{ startSeconds: 0, endSeconds: 20, text: ' ' }], 20),
    ).toBe(false);
    expect(isTranscriptionComplete([], 20)).toBe(false);
  });

  it('merges segments without duplicates and sorts by start time', () => {
    const merged = mergeSegments(
      [{ startSeconds: 5, endSeconds: 8, text: 'b' }],
      [
        { startSeconds: 5, endSeconds: 8, text: 'b' },
        { startSeconds: 1, endSeconds: 3, text: 'a' },
      ],
    );
    expect(merged.map((segment) => segment.text)).toEqual(['a', 'b']);
  });

  it('builds whisper.cpp arguments', () => {
    const args = buildWhisperArgs({
      modelPath: '/models/ggml-small.bin',
      audioPath: '/tmp/audio.16k.wav',
      outputPrefix: '/tmp/result',
      offsetMs: 1234,
      initialPrompt: 'Kataribe, 会議',
      threads: 4,
    });
    expect(args).toEqual([
      '-m',
      '/models/ggml-small.bin',
      '-f',
      '/tmp/audio.16k.wav',
      '-l',
      'auto',
      '-oj',
      '-of',
      '/tmp/result',
      '-pp',
      '-sns',
      '-nth',
      '0.6',
      '-t',
      '4',
      '-ot',
      '1234',
      '--prompt',
      'Kataribe, 会議',
    ]);
  });
});

describe('TranscriptionService', () => {
  it('returns a completed transcript from JSON output', async () => {
    const { root, wav } = await createWav();
    const runner = vi.fn(async (options: Parameters<typeof import('../src/main/process').runProcess>[0]) => {
      const prefix = options.args[options.args.indexOf('-of') + 1];
      await writeFile(
        `${prefix}.json`,
        JSON.stringify({
          result: { language: 'ja' },
          transcription: [{ offsets: { from: 0, to: 19000 }, text: '会議の内容' }],
        }),
      );
      options.onStdoutLine?.('[00:00:00.000 --> 00:00:09.000] 会議の');
      options.onStdoutLine?.('[00:00:10.000 --> 00:00:19.000] 内容');
      return processResult();
    });
    const service = new TranscriptionService({
      locator: {
        whisperPath: async () => '/fake/whisper-cli',
      } as never,
      runner: runner as never,
    });

    const outcome = await service.transcribe({
      meetingId: '00000000-0000-4000-8000-000000000001',
      tempDir: root,
      audioWavPath: wav,
      model: 'small',
      modelPath: '/models/small.bin',
      durationSeconds: 20,
    });
    expect(outcome.state).toBe('completed');
    expect(outcome.language).toBe('ja');
    expect(outcome.segments).toEqual([
      { startSeconds: 0, endSeconds: 19, text: '会議の内容' },
    ]);
  });

  it('resumes once with --offset-t when the first run is incomplete', async () => {
    const { root, wav } = await createWav();
    let calls = 0;
    const offsets: number[] = [];
    const onPartial = vi.fn(async () => undefined);
    const runner = vi.fn(async (options: Parameters<typeof import('../src/main/process').runProcess>[0]) => {
      calls += 1;
      const offsetIndex = options.args.indexOf('-ot');
      offsets.push(offsetIndex >= 0 ? Number(options.args[offsetIndex + 1]) : 0);
      if (calls === 1) {
        options.onStdoutLine?.('[00:00:00.000 --> 00:00:02.000] 前半');
      } else {
        options.onStdoutLine?.('[00:00:06.000 --> 00:00:20.000] 後半');
      }
      return processResult();
    });
    const service = new TranscriptionService({
      locator: { whisperPath: async () => '/fake/whisper-cli' } as never,
      runner: runner as never,
    });

    const outcome = await service.transcribe({
      meetingId: '00000000-0000-4000-8000-000000000002',
      tempDir: root,
      audioWavPath: wav,
      model: 'small',
      modelPath: '/models/small.bin',
      durationSeconds: 20,
      onPartial,
    });
    expect(outcome.state).toBe('completed');
    expect(outcome.resumed).toBe(true);
    expect(calls).toBe(2);
    expect(offsets).toEqual([0, 2000]);
    expect(onPartial).toHaveBeenCalledTimes(1);
    expect(outcome.segments.map((segment) => segment.text)).toEqual(['前半', '後半']);
  });

  it('returns partial when the second run is still incomplete', async () => {
    const { root, wav } = await createWav();
    const runner = vi.fn(async (options: Parameters<typeof import('../src/main/process').runProcess>[0]) => {
      options.onStdoutLine?.('[00:00:00.000 --> 00:00:02.000] 途中');
      return processResult();
    });
    const service = new TranscriptionService({
      locator: { whisperPath: async () => '/fake/whisper-cli' } as never,
      runner: runner as never,
    });

    const outcome = await service.transcribe({
      meetingId: '00000000-0000-4000-8000-000000000003',
      tempDir: root,
      audioWavPath: wav,
      model: 'small',
      modelPath: '/models/small.bin',
      durationSeconds: 60,
    });
    expect(outcome.state).toBe('failed');
    expect(outcome.errorCode).toBe('incomplete');
    expect(outcome.segments).toHaveLength(1);
  });

  it('classifies a non-zero exit as a process failure', async () => {
    const { root, wav } = await createWav();
    const service = new TranscriptionService({
      locator: { whisperPath: async () => '/fake/whisper-cli' } as never,
      runner: (async () =>
        processResult({
          code: 2,
          stderr: 'failed to load model',
        })) as never,
    });
    const outcome = await service.transcribe({
      meetingId: '00000000-0000-4000-8000-000000000004',
      tempDir: root,
      audioWavPath: wav,
      model: 'small',
      modelPath: '/models/small.bin',
      durationSeconds: 20,
    });
    expect(outcome.state).toBe('failed');
    expect(outcome.errorCode).toBe('model-missing');
  });
});
