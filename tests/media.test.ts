import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BinaryLocator,
  buildMp3Args,
  buildDecodeWavArgs,
  buildTranscriptionWavArgs,
  computeWavWaveform,
  MediaEncoder,
  parseFfmpegProgressLine,
} from '../src/main/media';
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

describe('ffmpeg arguments', () => {
  it('builds mono 44.1 kHz mp3 arguments', () => {
    expect(buildMp3Args('/in.wav', '/out.mp3.part', 64)).toEqual([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      '/in.wav',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '44100',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '64k',
      '-map_metadata',
      '-1',
      '-progress',
      'pipe:1',
      '-nostats',
      '-f',
      'mp3',
      '/out.mp3.part',
    ]);
  });

  it('builds mono 16 kHz PCM arguments', () => {
    const args = buildTranscriptionWavArgs('/in.mp3', '/out.wav.part');
    expect(args).toContain('-ar');
    expect(args[args.indexOf('-ar') + 1]).toBe('16000');
    expect(args).toContain('pcm_s16le');
  });

  it('builds mono PCM arguments that keep the input sample rate', () => {
    const args = buildDecodeWavArgs('/in.mp3', '/out.wav.part');
    expect(args).toContain('pcm_s16le');
    expect(args).not.toContain('-ar');
    expect(args).not.toContain('16000');
  });

  it('parses progress lines', () => {
    expect(parseFfmpegProgressLine('out_time_us=1250000')).toEqual({
      outTimeSeconds: 1.25,
    });
    expect(parseFfmpegProgressLine('out_time_ms=2000000')).toEqual({
      outTimeSeconds: 2,
    });
    expect(parseFfmpegProgressLine('progress=continue')).toBeNull();
  });
});

describe('BinaryLocator', () => {
  it('prefers the bundled binary', async () => {
    const locator = new BinaryLocator({
      isPackaged: false,
      resourcesPath: '/res',
      appPath: '/app',
      platform: 'darwin',
      arch: 'arm64',
      env: {},
      pathEnv: '',
      accessPath: async (path) => path === '/app/resources/bin/arm64/ffmpeg',
    });
    expect(await locator.ffmpegPath()).toBe('/app/resources/bin/arm64/ffmpeg');
  });

  it('falls back to PATH for whisper-cli', async () => {
    const locator = new BinaryLocator({
      isPackaged: false,
      resourcesPath: '/res',
      appPath: '/app',
      platform: 'darwin',
      arch: 'arm64',
      env: {},
      pathEnv: '/opt/homebrew/bin:/usr/bin',
      accessPath: async (path) => path === '/opt/homebrew/bin/whisper-cli',
    });
    expect(await locator.whisperPath()).toBe('/opt/homebrew/bin/whisper-cli');
  });

  it('req_diar_001_locates_the_sherpa_onnx_diarization_binary', async () => {
    const locator = new BinaryLocator({
      isPackaged: false,
      resourcesPath: '/res',
      appPath: '/app',
      platform: 'darwin',
      arch: 'arm64',
      env: {},
      pathEnv: '',
      accessPath: async (path) =>
        path === '/app/resources/bin/arm64/sherpa-onnx-offline-speaker-diarization',
    });
    expect(await locator.sherpaDiarizationPath()).toBe(
      '/app/resources/bin/arm64/sherpa-onnx-offline-speaker-diarization',
    );
  });

  it('reports a missing binary with an actionable message', async () => {
    const locator = new BinaryLocator({
      isPackaged: false,
      resourcesPath: '/res',
      appPath: '/app',
      platform: 'darwin',
      arch: 'arm64',
      env: {},
      pathEnv: '',
      accessPath: async () => false,
    });
    await expect(locator.ffmpegPath()).rejects.toMatchObject({
      code: 'binary-missing',
    });
  });
});

describe('MediaEncoder', () => {
  it('writes progress, verifies the output, and renames it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kataribe-media-'));
    roots.push(root);
    const output = join(root, 'audio.mp3');
    const progress: Array<{ ratio: number; etaSeconds: number | null }> = [];
    let now = 0;
    const runner = vi.fn(async (options: Parameters<typeof import('../src/main/process').runProcess>[0]) => {
      now = 5000;
      options.onStdoutLine?.('out_time_us=5000000');
      const target = options.args[options.args.length - 1];
      await writeFile(target, 'encoded');
      return processResult();
    });
    const encoder = new MediaEncoder({
      locator: { ffmpegPath: async () => '/fake/ffmpeg' } as never,
      runner: runner as never,
      now: () => now,
    });
    await encoder.encodeMp3({
      inputPath: '/in.wav',
      outputPath: output,
      durationSeconds: 10,
      bitrateKbps: 64,
      onProgress: (value) => progress.push(value),
    });
    expect(await readFile(output, 'utf8')).toBe('encoded');
    expect(progress.at(-1)?.ratio).toBe(0.5);
  });

  it('classifies a non-zero exit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kataribe-media-'));
    roots.push(root);
    const encoder = new MediaEncoder({
      locator: { ffmpegPath: async () => '/fake/ffmpeg' } as never,
      runner: (async () =>
        processResult({ code: 1, stderr: 'bad input' })) as never,
    });
    await expect(
      encoder.encodeMp3({
        inputPath: '/in.wav',
        outputPath: join(root, 'audio.mp3'),
        durationSeconds: 10,
        bitrateKbps: 64,
      }),
    ).rejects.toMatchObject({ code: 'process-failed' });
  });

  it('classifies cancellation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kataribe-media-'));
    roots.push(root);
    const encoder = new MediaEncoder({
      locator: { ffmpegPath: async () => '/fake/ffmpeg' } as never,
      runner: (async () => processResult({ aborted: true })) as never,
    });
    await expect(
      encoder.encodeMp3({
        inputPath: '/in.wav',
        outputPath: join(root, 'audio.mp3'),
        durationSeconds: 10,
        bitrateKbps: 64,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('computeWavWaveform', () => {
  it('normalizes peaks from a mono 16-bit wav', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kataribe-waveform-'));
    roots.push(root);
    const samples = new Float32Array(4800);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = index < 2400 ? 0.8 : 0.1;
    }
    const path = join(root, 'audio.wav');
    await writeFile(path, encodeWavMono16(samples, 48000));
    const waveform = await computeWavWaveform(path, 24);
    expect(waveform.peaks).toHaveLength(24);
    expect(Math.max(...waveform.peaks)).toBeCloseTo(1, 5);
    expect(waveform.peaks[0]).toBeGreaterThan(waveform.peaks.at(-1) ?? 0);
    expect(waveform.duration).toBeCloseTo(0.1, 5);
  });
});
