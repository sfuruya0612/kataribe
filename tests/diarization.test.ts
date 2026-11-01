/**
 * 話者分離の出力解析、話者割り当て、子プロセス起動を検証する。
 * 対応する要求: REQ-DIAR-001
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assignSpeakerTurns,
  DiarizationService,
  limitSpeakerTurns,
  parseDiarizationOutput,
  parseDiarizationProgressLine,
  turnsToCache,
  type DiarizationModels,
  type DiarizationTurn,
} from '../src/main/diarization';
import {
  DIARIZATION_CACHE_SCHEMA_VERSION,
  type DiarizationCache,
} from '../src/main/diarization-cache';
import type { DiarizationModelPaths } from '../src/main/diarization-models';
import { encodeWavMono16 } from '../src/main/wav';
import type { TranscriptSegment } from '../src/shared/markdown';

const roots: string[] = [];
const originalMode = process.env.KATARIBE_DIARIZATION_MODE;
const originalArgsFile = process.env.KATARIBE_DIARIZATION_ARGS_FILE;

afterEach(async () => {
  if (originalMode === undefined) {
    delete process.env.KATARIBE_DIARIZATION_MODE;
  } else {
    process.env.KATARIBE_DIARIZATION_MODE = originalMode;
  }
  if (originalArgsFile === undefined) {
    delete process.env.KATARIBE_DIARIZATION_ARGS_FILE;
  } else {
    process.env.KATARIBE_DIARIZATION_ARGS_FILE = originalArgsFile;
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-diarization-'));
  roots.push(root);
  return root;
}

function segment(startSeconds: number, endSeconds: number, text: string): TranscriptSegment {
  return { startSeconds, endSeconds, text };
}

function turn(startSeconds: number, endSeconds: number, speaker: string): DiarizationTurn {
  return { startSeconds, endSeconds, speaker };
}

describe('parseDiarizationProgressLine', () => {
  it('parses progress percentages and clamps the range', () => {
    expect(parseDiarizationProgressLine('progress 1.30%')).toBeCloseTo(0.013);
    expect(parseDiarizationProgressLine('progress 100.00%')).toBe(1);
    expect(parseDiarizationProgressLine('progress 0%')).toBe(0);
    expect(parseDiarizationProgressLine('progress 120%')).toBe(1);
    expect(parseDiarizationProgressLine('progress = 50%')).toBeNull();
    expect(parseDiarizationProgressLine('Started')).toBeNull();
  });
});

describe('parseDiarizationOutput', () => {
  it('reads turns and ignores configuration and progress lines', () => {
    const output = [
      'OfflineSpeakerDiarizationConfig(segmentation=...)',
      'Started',
      'progress 50.00%',
      '0.318 -- 6.865 speaker_00',
      '7.017 -- 10.747 speaker_01',
      '11.455 -- 13.632 speaker_01',
      'Duration : 56.861 s',
    ].join('\n');

    expect(parseDiarizationOutput(output)).toEqual([
      turn(0.318, 6.865, 'speaker_00'),
      turn(7.017, 10.747, 'speaker_01'),
      turn(11.455, 13.632, 'speaker_01'),
    ]);
  });

  it('accepts confidence suffixes on turn lines', () => {
    const output = [
      '0.000 -- 1.000 speaker_00 confidence=0.912',
      '1.000 -- 2.000 speaker_01 confidence=n/a',
    ].join('\n');

    expect(parseDiarizationOutput(output)).toEqual([
      turn(0, 1, 'speaker_00'),
      turn(1, 2, 'speaker_01'),
    ]);
  });

  it('drops invalid ranges and sorts by start time', () => {
    const output = [
      '5.000 -- 4.000 speaker_00',
      '2.000 -- 4.000 speaker_01',
      '0.000 -- 1.000 speaker_02',
      '-1.000 -- 1.000 speaker_03',
      'not a turn',
    ].join('\n');

    expect(parseDiarizationOutput(output)).toEqual([
      turn(0, 1, 'speaker_02'),
      turn(2, 4, 'speaker_01'),
    ]);
  });
});

describe('assignSpeakerTurns', () => {
  it('labels speakers in first-appearance order', () => {
    const turns = [
      turn(0, 1, 'speaker_01'),
      turn(1, 2, 'speaker_00'),
      turn(2, 3, 'speaker_01'),
    ];
    const segments = [
      segment(0, 1, 'one'),
      segment(1, 2, 'two'),
      segment(2, 3, 'three'),
    ];

    expect(assignSpeakerTurns(segments, turns)?.segments).toEqual([
      { ...segments[0], speaker: '話者A' },
      { ...segments[1], speaker: '話者B' },
      { ...segments[2], speaker: '話者A' },
    ]);
  });

  it('selects the speaker with the largest overlap', () => {
    const turns = [turn(0, 1.5, 'speaker_00'), turn(1.5, 3, 'speaker_01')];
    const segments = [segment(0, 1.6, 'mostly A'), segment(1.4, 3, 'mostly B')];

    expect(assignSpeakerTurns(segments, turns)?.segments).toEqual([
      { ...segments[0], speaker: '話者A' },
      { ...segments[1], speaker: '話者B' },
    ]);
  });

  it('uses the nearest turn within one second when there is no overlap', () => {
    const turns = [turn(0, 1, 'speaker_00'), turn(2, 3, 'speaker_01')];
    const segments = [segment(3.5, 4, 'near'), segment(10, 11, 'far')];

    expect(assignSpeakerTurns(segments, turns)?.segments).toEqual([
      { ...segments[0], speaker: '話者A' },
      { ...segments[1] },
    ]);
  });

  it('labels by the first labeled transcript line, not by turn start', () => {
    const turns = [
      turn(0, 1, 'speaker_01'),
      turn(1, 2, 'speaker_00'),
      turn(2, 3, 'speaker_01'),
    ];
    const segments = [
      segment(1, 2, 'first visible'),
      segment(2, 3, 'second visible'),
    ];

    expect(assignSpeakerTurns(segments, turns)?.segments).toEqual([
      { ...segments[0], speaker: '話者A' },
      { ...segments[1], speaker: '話者B' },
    ]);
  });

  it('returns null for fewer than two speakers', () => {
    expect(
      assignSpeakerTurns([segment(0, 1, 'one')], [turn(0, 1, 'speaker_00')]),
    ).toBeNull();
    expect(assignSpeakerTurns([segment(0, 1, 'one')], [])).toBeNull();
  });

  it('uses cluster names and skips them when assigning auto labels', () => {
    const turns = [turn(0, 1, 'speaker_00'), turn(1, 2, 'speaker_01')];
    const segments = [segment(0, 1, 'one'), segment(1, 2, 'two')];

    const named = assignSpeakerTurns(segments, turns, {
      speaker_00: '田中',
    });
    expect(named?.segments).toEqual([
      { ...segments[0], speaker: '田中' },
      { ...segments[1], speaker: '話者A' },
    ]);
    expect(named?.labels).toEqual({
      田中: 'speaker_00',
      話者A: 'speaker_01',
    });

    const collision = assignSpeakerTurns(segments, turns, {
      speaker_00: '話者A',
    });
    expect(collision?.segments).toEqual([
      { ...segments[0], speaker: '話者A' },
      { ...segments[1], speaker: '話者B' },
    ]);
  });

  it('caps more than ten speakers at ten labels', () => {
    const turns = Array.from({ length: 11 }, (_, index) =>
      turn(index, index + 1, `speaker_${String(index).padStart(2, '0')}`),
    );
    const segments = Array.from({ length: 11 }, (_, index) =>
      segment(index, index + 1, `text ${index}`),
    );

    const result = assignSpeakerTurns(segments, turns);
    expect(result).not.toBeNull();
    const labels = new Set(result?.segments.map((item) => item.speaker));
    expect(labels.size).toBe(10);
    expect(labels.has('話者11')).toBe(false);
  });
});

describe('limitSpeakerTurns', () => {
  it('reassigns the shortest speaker to the nearest kept turn', () => {
    const turns = [
      turn(0, 10, 'long'),
      turn(10, 11, 'short'),
      turn(1, 9, 'middle'),
    ];
    const limited = limitSpeakerTurns(turns, 2);

    expect(new Set(limited.map((item) => item.speaker))).toEqual(
      new Set(['long', 'middle']),
    );
    expect(limited[1]).toEqual(turn(10, 11, 'long'));
  });
});

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'diarization-cli.cjs',
);

async function createWav(root: string, sampleRate = 16000): Promise<string> {
  const samples = new Float32Array(sampleRate * 4);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 0.2;
  }
  const path = join(root, 'audio.wav');
  await writeFile(path, encodeWavMono16(samples, sampleRate));
  return path;
}

function createModels(calls: string[] = []): DiarizationModels {
  const paths: DiarizationModelPaths = {
    segmentation: '/tmp/segmentation.onnx',
    embedding: '/tmp/embedding.onnx',
  };
  return {
    ensureInstalled: async () => {
      calls.push('ensureInstalled');
      return paths;
    },
    modelHashes: () => ({
      segmentation: 'a'.repeat(64),
      embedding: 'b'.repeat(64),
    }),
  };
}

describe('DiarizationService', () => {
  it('runs the CLI with the automatic threshold and labels segments', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    const argsFile = join(root, 'args.txt');
    await writeFile(argsFile, '');
    process.env.KATARIBE_DIARIZATION_ARGS_FILE = argsFile;
    delete process.env.KATARIBE_DIARIZATION_MODE;
    const progress: number[] = [];
    const service = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(),
      threads: 2,
    });

    const result = await service.diarize(
      wavPath,
      [segment(0, 1, 'one'), segment(1, 2, 'two'), segment(2, 3, 'three')],
      {
        numSpeakers: 'auto',
        onProgress: (value) => {
          if (value.phase === 'diarization' && value.progress !== null) {
            progress.push(value.progress);
          }
        },
      },
    );

    expect(result?.segments.map((item) => item.speaker)).toEqual([
      '話者A',
      '話者B',
      '話者A',
    ]);
    expect(progress).toEqual([0, 0.5, 1]);
    const args = await readFile(argsFile, 'utf8');
    expect(args).toContain('--segmentation.pyannote-model=/tmp/segmentation.onnx');
    expect(args).toContain('--embedding.model=/tmp/embedding.onnx');
    expect(args).toContain('--segmentation.num-threads=2');
    expect(args).toContain('--clustering.cluster-threshold=0.9');
    expect(args).not.toContain('--clustering.num-clusters');
  });

  it('reuses cached turns and names without starting the CLI', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    delete process.env.KATARIBE_DIARIZATION_MODE;
    const firstService = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(),
    });
    const segments = [segment(0, 1, 'one'), segment(1, 2, 'two')];
    const first = await firstService.diarize(wavPath, segments, {
      numSpeakers: 'auto',
    });
    if (first === null) {
      throw new Error('the first diarization did not return labels');
    }
    const audioSha256 = 'd'.repeat(64);
    const cache: DiarizationCache = {
      schema_version: DIARIZATION_CACHE_SCHEMA_VERSION,
      key: { ...first.cacheKey, audio_sha256: audioSha256 },
      turns: turnsToCache(first.turns),
      names: { speaker_00: '田中' },
      labels: first.labels,
    };
    let binaryCalls = 0;
    const modelCalls: string[] = [];
    const cachedService = new DiarizationService({
      locator: {
        sherpaDiarizationPath: async () => {
          binaryCalls += 1;
          return fixturePath;
        },
      },
      models: createModels(modelCalls),
    });

    const hit = await cachedService.diarize(
      wavPath,
      [segment(0.2, 1.2, 'one'), segment(1.4, 1.9, 'two')],
      {
        numSpeakers: 'auto',
        cache,
        audioSha256,
      },
    );

    expect(hit?.cacheHit).toBe(true);
    expect(binaryCalls).toBe(0);
    expect(modelCalls).toEqual([]);
    expect(hit?.segments.map((item) => item.speaker)).toEqual([
      '田中',
      '話者A',
    ]);
    expect(hit?.names).toEqual({ speaker_00: '田中' });
  });

  it('runs the CLI and drops names when the threads cache key changes', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    delete process.env.KATARIBE_DIARIZATION_MODE;
    const firstService = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(),
      threads: 2,
    });
    const segments = [segment(0, 1, 'one'), segment(1, 2, 'two')];
    const first = await firstService.diarize(wavPath, segments, {
      numSpeakers: 'auto',
    });
    if (first === null) {
      throw new Error('the first diarization did not return labels');
    }
    const cache: DiarizationCache = {
      schema_version: DIARIZATION_CACHE_SCHEMA_VERSION,
      key: first.cacheKey,
      turns: turnsToCache(first.turns),
      names: { speaker_00: '田中' },
      labels: first.labels,
    };
    let binaryCalls = 0;
    const modelCalls: string[] = [];
    const changedService = new DiarizationService({
      locator: {
        sherpaDiarizationPath: async () => {
          binaryCalls += 1;
          return fixturePath;
        },
      },
      models: createModels(modelCalls),
      threads: 3,
    });

    const result = await changedService.diarize(wavPath, segments, {
      numSpeakers: 'auto',
      cache,
    });

    expect(result?.cacheHit).toBe(false);
    expect(binaryCalls).toBe(1);
    expect(modelCalls).toEqual(['ensureInstalled']);
    expect(result?.names).toEqual({});
    expect(result?.segments.map((item) => item.speaker)).toEqual([
      '話者A',
      '話者B',
    ]);
  });

  it('passes a fixed speaker count', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    const argsFile = join(root, 'args.txt');
    await writeFile(argsFile, '');
    process.env.KATARIBE_DIARIZATION_ARGS_FILE = argsFile;
    delete process.env.KATARIBE_DIARIZATION_MODE;
    const service = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(),
    });

    await service.diarize(wavPath, [segment(0, 1, 'one')], {
      numSpeakers: 3,
    });

    expect(await readFile(argsFile, 'utf8')).toContain('--clustering.num-clusters=3');
  });

  it('labels segments from confidence-suffixed turn lines', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    process.env.KATARIBE_DIARIZATION_MODE = 'confidence';
    const service = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(),
    });

    const result = await service.diarize(
      wavPath,
      [segment(0, 1, 'one'), segment(1, 2, 'two')],
      { numSpeakers: 'auto' },
    );

    expect(result?.segments.map((item) => item.speaker)).toEqual(['話者A', '話者B']);
  });

  it('reruns with ten clusters when automatic detection finds more than ten', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    const argsFile = join(root, 'args.txt');
    await writeFile(argsFile, '');
    process.env.KATARIBE_DIARIZATION_ARGS_FILE = argsFile;
    process.env.KATARIBE_DIARIZATION_MODE = 'many';
    const service = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(),
    });
    const segments = Array.from({ length: 11 }, (_, index) =>
      segment(index, index + 1, `text ${index}`),
    );

    const result = await service.diarize(wavPath, segments, { numSpeakers: 'auto' });

    expect(result).not.toBeNull();
    expect(new Set(result?.segments.map((item) => item.speaker)).size).toBe(10);
    expect(result?.segments.some((item) => item.speaker === '話者11')).toBe(false);
    const args = await readFile(argsFile, 'utf8');
    expect(args.match(/--clustering.num-clusters=10/gu)).toHaveLength(1);
  });

  it('returns null when the CLI produces no turns', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    process.env.KATARIBE_DIARIZATION_MODE = 'empty';
    const service = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(),
    });

    expect(
      await service.diarize(wavPath, [segment(0, 1, 'one')], {
        numSpeakers: 'auto',
      }),
    ).toBeNull();
  });

  it('rejects when the CLI fails', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    process.env.KATARIBE_DIARIZATION_MODE = 'fail';
    const service = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(),
    });

    await expect(
      service.diarize(wavPath, [segment(0, 1, 'one')], { numSpeakers: 'auto' }),
    ).rejects.toThrow(/synthetic failure/u);
  });

  it('stops the process when the caller cancels', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    process.env.KATARIBE_DIARIZATION_MODE = 'cancel';
    const controller = new AbortController();
    const service = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(),
    });

    const result = await service.diarize(
      wavPath,
      [segment(0, 1, 'one')],
      {
        numSpeakers: 'auto',
        signal: controller.signal,
        onProgress: (value) => {
          if (value.phase === 'diarization' && (value.progress ?? 0) > 0) {
            controller.abort();
          }
        },
      },
    );

    expect(result).toBeNull();
  });

  it('does not start the CLI for audio that is not 16 kHz mono PCM', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root, 48000);
    const calls: string[] = [];
    const service = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(calls),
    });

    expect(
      await service.diarize(wavPath, [segment(0, 1, 'one')], {
        numSpeakers: 'auto',
      }),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it('keeps more than the process capture limit', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    process.env.KATARIBE_DIARIZATION_MODE = 'long';
    const service = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(),
    });
    const segments = Array.from({ length: 3000 }, (_, index) =>
      segment(index, index + 1, `text ${index}`),
    );

    const result = await service.diarize(wavPath, segments, {
      numSpeakers: 'auto',
    });

    expect(result).not.toBeNull();
    expect(result?.segments).toHaveLength(3000);
    expect(result?.segments[0].speaker).toBe('話者A');
    expect(result?.segments[1].speaker).toBe('話者B');
    expect(result?.segments[2999].speaker).toBe('話者B');
  });

  it('falls back to the first result when the ten-cluster retry fails', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    process.env.KATARIBE_DIARIZATION_MODE = 'many-fail-rerun';
    const service = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(),
    });
    const segments = Array.from({ length: 11 }, (_, index) =>
      segment(index, index + 1, `text ${index}`),
    );

    const result = await service.diarize(wavPath, segments, {
      numSpeakers: 'auto',
    });

    expect(result).not.toBeNull();
    expect(new Set(result?.segments.map((item) => item.speaker)).size).toBe(10);
    expect(result?.segments.some((item) => item.speaker === '話者11')).toBe(false);
  });

  it('resolves the binary before downloading the models', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    const calls: string[] = [];
    const service = new DiarizationService({
      locator: {
        sherpaDiarizationPath: async () => {
          throw new Error('sherpa-onnx missing');
        },
      },
      models: createModels(calls),
    });

    await expect(
      service.diarize(wavPath, [segment(0, 1, 'one')], {
        numSpeakers: 'auto',
      }),
    ).rejects.toThrow(/missing/u);
    expect(calls).toEqual([]);
  });

  it('returns null for empty segments without resolving the models', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    const calls: string[] = [];
    const service = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(calls),
    });

    expect(
      await service.diarize(wavPath, [], { numSpeakers: 'auto' }),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it('returns null when the CLI finds only one speaker', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    process.env.KATARIBE_DIARIZATION_MODE = 'one';
    const service = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(),
    });

    expect(
      await service.diarize(wavPath, [segment(0, 1, 'one')], {
        numSpeakers: 'auto',
      }),
    ).toBeNull();
  });

  it('returns null when the ten-cluster rerun is cancelled', async () => {
    const root = await createRoot();
    const wavPath = await createWav(root);
    process.env.KATARIBE_DIARIZATION_MODE = 'many-cancel-rerun';
    const controller = new AbortController();
    const service = new DiarizationService({
      locator: { sherpaDiarizationPath: async () => fixturePath },
      models: createModels(),
    });
    const segments = Array.from({ length: 11 }, (_, index) =>
      segment(index, index + 1, `text ${index}`),
    );

    const result = await service.diarize(wavPath, segments, {
      numSpeakers: 'auto',
      signal: controller.signal,
      onProgress: (value) => {
        if (value.phase === 'diarization' && value.progress === 0.01) {
          controller.abort();
        }
      },
    });

    expect(result).toBeNull();
  });
});
