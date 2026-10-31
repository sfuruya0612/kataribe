import { access, chmod, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { runProcess, ProcessStartError } from './process';
import { readWavInfo } from './wav';

export type MediaErrorCode =
  | 'binary-missing'
  | 'process-failed'
  | 'timeout'
  | 'cancelled'
  | 'invalid-output';

export class MediaError extends Error {
  readonly code: MediaErrorCode;

  constructor(code: MediaErrorCode, message: string) {
    super(message);
    this.name = 'MediaError';
    this.code = code;
  }
}

export type BinaryLocatorOptions = {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform: NodeJS.Platform;
  arch: string;
  env?: NodeJS.ProcessEnv;
  pathEnv?: string;
  accessPath?: (path: string) => Promise<boolean>;
};

async function defaultAccess(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export class BinaryLocator {
  private readonly options: BinaryLocatorOptions;
  private readonly accessPath: (path: string) => Promise<boolean>;

  constructor(options: BinaryLocatorOptions) {
    this.options = options;
    this.accessPath = options.accessPath ?? defaultAccess;
  }

  async ffmpegPath(): Promise<string> {
    return this.locate('ffmpeg', 'KATARIBE_FFMPEG_PATH');
  }

  async whisperPath(): Promise<string> {
    const candidates = this.options.platform === 'win32'
      ? ['whisper-cli.exe', 'main.exe', 'whisper.exe']
      : ['whisper-cli', 'whisper'];
    for (const name of candidates) {
      try {
        return await this.locate(name, 'KATARIBE_WHISPER_PATH');
      } catch {
        // Try the next name.
      }
    }
    throw this.missingError('whisper-cli', 'whisper.cpp');
  }

  async multiOutputPath(): Promise<string> {
    if (this.options.platform !== 'darwin') {
      throw new MediaError(
        'binary-missing',
        'Multi-Output Device creation is supported only on macOS',
      );
    }
    return this.locate('kataribe-multi-output', 'KATARIBE_MULTI_OUTPUT_PATH');
  }

  private async locate(binaryName: string, envKey: string): Promise<string> {
    const env = this.options.env ?? process.env;
    const override = env[envKey];
    if (override && (await this.accessPath(resolve(override)))) {
      return resolve(override);
    }

    const binDir = join('bin', this.options.arch);
    const roots = this.options.isPackaged
      ? [this.options.resourcesPath]
      : [this.options.appPath];
    const candidates = roots.flatMap((root) => [
      join(root, binDir, binaryName),
      join(root, 'resources', binDir, binaryName),
      join(root, 'build', binDir, binaryName),
    ]);
    if (binaryName === 'ffmpeg' && !this.options.isPackaged) {
      candidates.push(join(this.options.appPath, 'node_modules', 'ffmpeg-static', 'ffmpeg'));
    }

    for (const candidate of candidates) {
      if (await this.accessPath(candidate)) {
        return candidate;
      }
    }

    const pathValue = this.options.pathEnv ?? env.PATH ?? '';
    for (const entry of pathValue.split(delimiter)) {
      if (!entry) {
        continue;
      }
      const candidate = join(entry, binaryName);
      if (await this.accessPath(candidate)) {
        return candidate;
      }
    }

    throw this.missingError(
      binaryName,
      binaryName === 'ffmpeg'
        ? 'ffmpeg'
        : binaryName.startsWith('whisper')
          ? 'whisper.cpp'
          : 'Multi-Output Device helper',
    );
  }

  private missingError(binaryName: string, label: string): MediaError {
    return new MediaError(
      'binary-missing',
      `${label} が見つかりません。resources/${join('bin', this.options.arch)}/${binaryName} に実行ファイルを置くか、PATH の通った ${binaryName} をインストールしてください。`,
    );
  }
}

export type EncodeOptions = {
  inputPath: string;
  outputPath: string;
  durationSeconds: number;
  bitrateKbps: number;
  signal?: AbortSignal;
  onProgress?: (progress: { ratio: number; etaSeconds: number | null }) => void;
};

export type MediaEncoderOptions = {
  locator: BinaryLocator;
  runner?: typeof runProcess;
  now?: () => number;
  killGraceMs?: number;
};

export function buildMp3Args(
  inputPath: string,
  outputPath: string,
  bitrateKbps: number,
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '44100',
    '-c:a',
    'libmp3lame',
    '-b:a',
    `${bitrateKbps}k`,
    '-map_metadata',
    '-1',
    '-progress',
    'pipe:1',
    '-nostats',
    '-f',
    'mp3',
    outputPath,
  ];
}

export function buildTranscriptionWavArgs(
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    '-progress',
    'pipe:1',
    '-nostats',
    '-f',
    'wav',
    outputPath,
  ];
}

export function parseFfmpegProgressLine(
  line: string,
): { outTimeSeconds: number } | null {
  const match = line.match(/^out_time_(?:us|ms)=(\d+)$/);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }
  return { outTimeSeconds: value / 1_000_000 };
}

export class MediaEncoder {
  private readonly locator: BinaryLocator;
  private readonly runner: typeof runProcess;
  private readonly now: () => number;
  private readonly killGraceMs: number;

  constructor(options: MediaEncoderOptions) {
    this.locator = options.locator;
    this.runner = options.runner ?? runProcess;
    this.now = options.now ?? (() => Date.now());
    this.killGraceMs = options.killGraceMs ?? 3000;
  }

  async encodeMp3(options: EncodeOptions): Promise<void> {
    if (!Number.isInteger(options.bitrateKbps) || options.bitrateKbps <= 0) {
      throw new MediaError('process-failed', 'invalid mp3 bitrate');
    }
    const output = await this.prepareOutput(options.outputPath);
    await this.runFfmpeg({
      args: buildMp3Args(options.inputPath, output.tempPath, options.bitrateKbps),
      outputPath: output.tempPath,
      finalPath: options.outputPath,
      durationSeconds: options.durationSeconds,
      signal: options.signal,
      onProgress: options.onProgress,
    });
  }

  async createTranscriptionWav(options: EncodeOptions): Promise<void> {
    const output = await this.prepareOutput(options.outputPath);
    await this.runFfmpeg({
      args: buildTranscriptionWavArgs(options.inputPath, output.tempPath),
      outputPath: output.tempPath,
      finalPath: options.outputPath,
      durationSeconds: options.durationSeconds,
      signal: options.signal,
      onProgress: options.onProgress,
    });
  }

  private async prepareOutput(
    outputPath: string,
  ): Promise<{ tempPath: string }> {
    const directory = dirname(resolve(outputPath));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await rm(outputPath, { force: true }).catch(() => undefined);
    const tempPath = `${outputPath}.part`;
    await rm(tempPath, { force: true }).catch(() => undefined);
    return { tempPath };
  }

  private async runFfmpeg(options: {
    args: string[];
    outputPath: string;
    finalPath: string;
    durationSeconds: number;
    signal?: AbortSignal;
    onProgress?: (progress: { ratio: number; etaSeconds: number | null }) => void;
  }): Promise<void> {
    const ffmpeg = await this.locator.ffmpegPath();
    const startedAt = this.now();
    const timeoutMs = Math.max(5 * 60_000, options.durationSeconds * 5 * 1000);
    let result;
    try {
      result = await this.runner({
        command: ffmpeg,
        args: options.args,
        signal: options.signal,
        timeoutMs,
        killGraceMs: this.killGraceMs,
        onStdoutLine: (line) => {
          const progress = parseFfmpegProgressLine(line);
          if (!progress) {
            return;
          }
          const ratio =
            options.durationSeconds > 0
              ? Math.max(
                  0,
                  Math.min(1, progress.outTimeSeconds / options.durationSeconds),
                )
              : null;
          const elapsedSeconds = Math.max(0, (this.now() - startedAt) / 1000);
          const etaSeconds =
            ratio && ratio > 0.01
              ? Math.max(0, Math.round(elapsedSeconds / ratio - elapsedSeconds))
              : null;
          options.onProgress?.({
            ratio: ratio ?? 0,
            etaSeconds,
          });
        },
      });
    } catch (error) {
      await rm(options.outputPath, { force: true }).catch(() => undefined);
      if (error instanceof ProcessStartError) {
        throw new MediaError('process-failed', error.message);
      }
      throw error;
    }

    if (result.aborted) {
      await rm(options.outputPath, { force: true }).catch(() => undefined);
      throw new MediaError('cancelled', 'audio conversion was cancelled');
    }
    if (result.timedOut) {
      await rm(options.outputPath, { force: true }).catch(() => undefined);
      throw new MediaError('timeout', 'ffmpeg timed out');
    }
    if (result.code !== 0) {
      await rm(options.outputPath, { force: true }).catch(() => undefined);
      throw new MediaError(
        'process-failed',
        `ffmpeg exited with code ${result.code}`,
      );
    }

    try {
      const info = await stat(options.outputPath);
      if (!info.isFile() || info.size === 0) {
        throw new Error('empty output');
      }
    } catch {
      throw new MediaError('invalid-output', 'ffmpeg did not produce an output file');
    }

    await chmod(options.outputPath, 0o600);
    await rename(options.outputPath, options.finalPath);
  }
}

export type WavWaveform = {
  peaks: number[];
  duration: number;
};

export async function computeWavWaveform(
  path: string,
  bars = 96,
): Promise<WavWaveform> {
  const info = await readWavInfo(path);
  if (info.channels !== 1 || info.bitsPerSample !== 16) {
    throw new MediaError('invalid-output', 'waveform requires mono 16-bit wav');
  }
  const frames = Math.floor(info.dataSize / 2);
  const barCount = Math.min(160, Math.max(24, Math.round(bars)));
  if (frames <= 0) {
    return { peaks: [], duration: 0 };
  }
  const framesPerBar = Math.max(1, Math.floor(frames / barCount));
  const readFrames = Math.min(8192, framesPerBar);
  const buffer = Buffer.alloc(readFrames * 2);
  const peaks: number[] = [];
  const handle = await open(path, 'r');
  try {
    for (let index = 0; index < barCount; index += 1) {
      const startFrame = index * framesPerBar;
      const result = await handle.read(
        buffer,
        0,
        readFrames * 2,
        info.dataOffset + startFrame * 2,
      );
      let peak = 0;
      for (let offset = 0; offset + 1 < result.bytesRead; offset += 2) {
        peak = Math.max(peak, Math.abs(buffer.readInt16LE(offset)) / 32768);
      }
      peaks.push(peak);
    }
  } finally {
    await handle.close();
  }
  const maxPeak = Math.max(...peaks);
  return {
    peaks:
      maxPeak > 0.0001
        ? peaks.map((peak) => Math.min(1, peak / maxPeak))
        : peaks,
    duration: info.duration,
  };
}
