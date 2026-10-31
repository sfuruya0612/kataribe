import { randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type {
  InputSource,
  RecordingCaptureStats,
  RecordingChunk,
  RecordingEvent,
  RecordingSession,
  RecordingStartupFailureResult,
  RecordingState,
  RecordingStatus,
  RecordingStopResult,
  RecoverableRecording,
  StartRecordingOptions,
} from '../shared/types';
import {
  isValidMeetingId,
  readMeetingMeta,
  toMeetingMetaStats,
  writeMeetingMeta,
  type MeetingMeta,
  type MeetingMetaChunk,
} from './meeting-meta';
import {
  createWavHeader,
  encodeWavMono16,
  WAV_CHANNELS,
  WAV_BITS_PER_SAMPLE,
} from './wav';

type SessionFile = {
  meeting_id: string;
  meeting_dir: string;
  meta_path: string;
  started_at: string;
};

type ActiveSession = {
  meetingId: string;
  meetingDir: string;
  tempDir: string;
  chunksDir: string;
  metaPath: string;
  meta: MeetingMeta;
  blockerId: number;
  failed: boolean;
};

export type PowerSaveBlockerAdapter = {
  start: () => number;
  stop: (id: number) => void;
};

export type RecordingManagerOptions = {
  saveRoot: string;
  tempRoot: string;
  appVersion: string;
  blocker: PowerSaveBlockerAdapter;
  now?: () => Date;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch {
    // Some file systems do not support fsync on a directory.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function writePrivateFile(path: string, data: string | Buffer): Promise<void> {
  const tempPath = `${path}.tmp`;
  const handle = await open(tempPath, 'w', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(tempPath, 0o600);
  await rename(tempPath, path);
  await syncDirectory(dirname(path));
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function chunkFileName(sequence: number): string {
  return `${String(sequence).padStart(6, '0')}.wav`;
}

export class RecordingManager {
  private active: ActiveSession | null = null;
  private lastMeetingDir: string | null = null;
  private lastStatus: RecordingStatus = 'idle';
  private operationQueue: Promise<unknown> = Promise.resolve();
  private saveRoot: string;
  private readonly tempRoot: string;
  private readonly appVersion: string;
  private readonly blocker: PowerSaveBlockerAdapter;
  private readonly now: () => Date;

  constructor(options: RecordingManagerOptions) {
    this.saveRoot = resolve(options.saveRoot);
    this.tempRoot = resolve(options.tempRoot);
    this.appVersion = options.appVersion;
    this.blocker = options.blocker;
    this.now = options.now ?? (() => new Date());
  }

  getLastMeetingDir(): string | null {
    return this.lastMeetingDir;
  }

  getSaveRoot(): string {
    return this.saveRoot;
  }

  setSaveRoot(saveRoot: string): void {
    if (this.active) {
      throw new Error('cannot change the save root while recording');
    }
    this.saveRoot = resolve(saveRoot);
  }

  getState(): RecordingState {
    return {
      status: this.active ? 'recording' : this.lastStatus,
      session: this.active
        ? {
            meetingId: this.active.meetingId,
            meetingDir: this.active.meetingDir,
            startedAt: this.active.meta.started_at,
            sampleRate: this.active.meta.sample_rate,
            inputSource: this.active.meta.source.input,
          }
        : null,
      lastMeetingDir: this.lastMeetingDir,
    };
  }

  start(options: StartRecordingOptions): Promise<RecordingSession> {
    return this.enqueue(() => this.startInternal(options));
  }

  appendChunk(chunk: RecordingChunk): Promise<{ file: string; frames: number }> {
    return this.enqueue(() => this.appendChunkInternal(chunk));
  }

  appendGap(frames: number): Promise<{ file: string; frames: number }> {
    return this.enqueue(() => this.appendGapInternal(frames));
  }

  stop(stats?: RecordingCaptureStats): Promise<RecordingStopResult> {
    return this.enqueue(() => this.stopInternal(stats));
  }

  recover(meetingId: string): Promise<RecordingStopResult> {
    return this.enqueue(() => this.recoverInternal(meetingId));
  }

  recordEvent(event: RecordingEvent): Promise<boolean> {
    return this.enqueue(() => this.recordEventInternal(event));
  }

  recordStartupFailure(
    options: StartRecordingOptions,
    event: RecordingEvent,
  ): Promise<RecordingStartupFailureResult> {
    return this.enqueue(() => this.recordStartupFailureInternal(options, event));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async startInternal(options: StartRecordingOptions): Promise<RecordingSession> {
    if (this.active) {
      throw new Error('a recording is already in progress');
    }
    if (!Number.isFinite(options.sampleRate) || !Number.isInteger(options.sampleRate)) {
      throw new Error('invalid sample rate');
    }
    if (options.sampleRate < 8000 || options.sampleRate > 192000) {
      throw new Error('sample rate is out of range');
    }
    if (!['microphone', 'system', 'both'].includes(options.inputSource)) {
      throw new Error('invalid input source');
    }

    const now = this.now();
    const meetingDir = await this.createMeetingDir(now);
    const meetingId = randomUUID();
    const tempDir = join(this.tempRoot, meetingId);
    const chunksDir = join(tempDir, 'chunks');
    const metaPath = join(meetingDir, 'meta.json');

    const meta: MeetingMeta = {
      schema_version: 1,
      id: meetingId,
      status: 'recording',
      title: 'タイトル未入力',
      started_at: now.toISOString(),
      duration: 0,
      source: {
        input: options.inputSource,
        microphone: options.microphoneLabel,
        system: options.systemLabel,
      },
      sample_rate: options.sampleRate,
      channels: WAV_CHANNELS,
      bits_per_sample: WAV_BITS_PER_SAMPLE,
      chunks: [],
      expected_samples: 0,
      actual_samples: 0,
      gap_samples: 0,
      events: [],
      clipping_config: options.clippingConfig,
      silence_config: options.silenceConfig,
      app_version: this.appVersion,
    };

    let blockerId: number | null = null;
    try {
      await ensurePrivateDirectory(tempDir);
      await ensurePrivateDirectory(chunksDir);
      await writeMeetingMeta(metaPath, meta);

      const sessionFile: SessionFile = {
        meeting_id: meetingId,
        meeting_dir: meetingDir,
        meta_path: metaPath,
        started_at: meta.started_at,
      };
      await writePrivateFile(
        join(tempDir, 'session.json'),
        `${JSON.stringify(sessionFile, null, 2)}\n`,
      );

      blockerId = this.blocker.start();
      this.active = {
        meetingId,
        meetingDir,
        tempDir,
        chunksDir,
        metaPath,
        meta,
        blockerId,
        failed: false,
      };
      this.lastMeetingDir = meetingDir;
      this.lastStatus = 'recording';
      console.log(`recording started: ${meetingId}`);

      return {
        meetingId,
        meetingDir,
        startedAt: meta.started_at,
        sampleRate: options.sampleRate,
        inputSource: options.inputSource,
      };
    } catch (error) {
      if (blockerId !== null) {
        this.blocker.stop(blockerId);
      }
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      await rm(meetingDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async appendChunkInternal(
    chunk: RecordingChunk,
  ): Promise<{ file: string; frames: number }> {
    const active = this.active;
    if (!active) {
      throw new Error('no recording is in progress');
    }
    if (!Number.isInteger(chunk.frames) || chunk.frames <= 0) {
      throw new Error('chunk has no frames');
    }
    if (chunk.sampleRate !== active.meta.sample_rate) {
      throw new Error('chunk sample rate does not match the session');
    }
    if (!Number.isInteger(chunk.expectedFrames) || chunk.expectedFrames < chunk.frames) {
      throw new Error('chunk expected frames are invalid');
    }
    if (!Number.isInteger(chunk.sequence) || chunk.sequence <= 0) {
      throw new Error('chunk sequence is invalid');
    }

    const samples = chunk.samples instanceof Float32Array
      ? chunk.samples
      : new Float32Array(chunk.samples);
    if (samples.length !== chunk.frames) {
      throw new Error('chunk frame count does not match sample count');
    }

    const sequence = active.meta.chunks.length + 1;
    const file = chunkFileName(sequence);
    const wav = encodeWavMono16(samples, active.meta.sample_rate);

    try {
      await writePrivateFile(join(active.chunksDir, file), wav);
      active.meta.chunks.push({
        sequence,
        file,
        frames: chunk.frames,
        expected_frames: chunk.expectedFrames + (active.meta.gap_samples ?? 0),
      });
      active.meta.actual_samples += chunk.frames;
      active.meta.expected_samples = Math.max(
        active.meta.expected_samples,
        chunk.expectedFrames + (active.meta.gap_samples ?? 0),
      );
      active.meta.duration = active.meta.actual_samples / active.meta.sample_rate;
      await writeMeetingMeta(active.metaPath, active.meta);
      return { file, frames: chunk.frames };
    } catch (error) {
      active.failed = true;
      console.error(`failed to append chunk: ${errorMessage(error)}`);
      throw error;
    }
  }

  private async appendGapInternal(frames: number): Promise<{ file: string; frames: number }> {
    const active = this.active;
    if (!active) {
      throw new Error('no recording is in progress');
    }
    if (!Number.isInteger(frames) || frames <= 0) {
      throw new Error('gap has no frames');
    }
    if (frames > active.meta.sample_rate * 4 * 60 * 60) {
      throw new Error('gap is too long');
    }

    const sequence = active.meta.chunks.length + 1;
    const file = chunkFileName(sequence);
    const data = Buffer.alloc(frames * 2, 0);
    const wav = Buffer.concat([createWavHeader(data.length, active.meta.sample_rate), data]);

    try {
      await writePrivateFile(join(active.chunksDir, file), wav);
      active.meta.gap_samples = (active.meta.gap_samples ?? 0) + frames;
      active.meta.actual_samples += frames;
      active.meta.expected_samples += frames;
      active.meta.chunks.push({
        sequence,
        file,
        frames,
        expected_frames: active.meta.expected_samples,
      });
      active.meta.duration = active.meta.actual_samples / active.meta.sample_rate;
      await writeMeetingMeta(active.metaPath, active.meta);
      return { file, frames };
    } catch (error) {
      active.failed = true;
      console.error(`failed to append silence gap: ${errorMessage(error)}`);
      throw error;
    }
  }

  private async stopInternal(stats?: RecordingCaptureStats): Promise<RecordingStopResult> {
    const active = this.active;
    if (!active) {
      throw new Error('no recording is in progress');
    }

    this.active = null;
    this.lastStatus = 'encoding';
    try {
      this.blocker.stop(active.blockerId);
    } catch (error) {
      console.error(`failed to stop power save blocker: ${errorMessage(error)}`);
    }
    console.log(`recording stopped: ${active.meetingId}`);

    const endedAt = this.now();
    active.meta.ended_at = endedAt.toISOString();
    if (stats) {
      active.meta.capture_stats = toMeetingMetaStats(stats);
      active.meta.expected_samples = Math.max(
        active.meta.expected_samples,
        stats.expectedFrames + (active.meta.gap_samples ?? 0),
      );
    }
    active.meta.duration = active.meta.actual_samples / active.meta.sample_rate;

    if (active.meta.chunks.length === 0) {
      active.meta.status = 'error';
      await writeMeetingMeta(active.metaPath, active.meta).catch(() => undefined);
      await rm(active.tempDir, { recursive: true, force: true }).catch(() => undefined);
      this.lastStatus = 'error';
      throw new Error('no audio chunks were recorded');
    }

    try {
      const audioPath = join(active.meetingDir, 'audio.wav');
      await this.mergeChunks(active.meta, active.chunksDir, audioPath);
      active.meta.status = 'encoding';
      active.meta.audio_path = 'audio.wav';
      await writeMeetingMeta(active.metaPath, active.meta);
      await rm(active.tempDir, { recursive: true, force: true });
      this.lastStatus = 'encoding';
      this.lastMeetingDir = active.meetingDir;

      return {
        meetingId: active.meetingId,
        meetingDir: active.meetingDir,
        audioPath,
        startedAt: active.meta.started_at,
        status: 'encoding',
        sampleRate: active.meta.sample_rate,
        actualSamples: active.meta.actual_samples,
        expectedSamples: active.meta.expected_samples,
        captureStats: stats,
        hadChunkFailure: active.failed,
      };
    } catch (error) {
      active.meta.status = 'error';
      await writeMeetingMeta(active.metaPath, active.meta).catch(() => undefined);
      this.lastStatus = 'error';
      throw error;
    }
  }

  async listRecoverable(): Promise<RecoverableRecording[]> {
    await ensurePrivateDirectory(this.tempRoot);
    const entries = await readdir(this.tempRoot, { withFileTypes: true });
    const recordings: RecoverableRecording[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      try {
        const tempDir = join(this.tempRoot, entry.name);
        const session = await readJson<SessionFile>(join(tempDir, 'session.json'));
        if (session.meeting_id !== entry.name || !isValidMeetingId(session.meeting_id)) {
          continue;
        }
        if (!isInside(this.saveRoot, session.meeting_dir)) {
          continue;
        }
        const meta = await readMeetingMeta(session.meta_path);
        if (meta.id !== session.meeting_id) {
          continue;
        }
        if (meta.status !== 'recording' && meta.status !== 'error') {
          continue;
        }
        if (meta.chunks.length === 0) {
          continue;
        }
        const chunksDir = join(tempDir, 'chunks');
        const complete = await Promise.all(
          meta.chunks.map(async (chunk: MeetingMetaChunk) => {
            try {
              const info = await stat(join(chunksDir, chunk.file));
              return info.size === 44 + chunk.frames * 2;
            } catch {
              return false;
            }
          }),
        );
        if (complete.some((value: boolean) => !value)) {
          continue;
        }

        recordings.push({
          meetingId: session.meeting_id,
          meetingDir: session.meeting_dir,
          startedAt: meta.started_at,
          inputSource: meta.source.input,
          sampleRate: meta.sample_rate,
          chunks: meta.chunks.length,
          actualSamples: meta.actual_samples,
        });
      } catch {
        // Ignore incomplete session directories.
      }
    }

    recordings.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    return recordings;
  }

  private async recoverInternal(meetingId: string): Promise<RecordingStopResult> {
    if (!isValidMeetingId(meetingId)) {
      throw new Error('invalid meeting id');
    }
    if (this.active) {
      throw new Error('cannot recover while recording');
    }

    const tempDir = join(this.tempRoot, meetingId);
    const session = await readJson<SessionFile>(join(tempDir, 'session.json'));
    if (session.meeting_id !== meetingId) {
      throw new Error('session id does not match');
    }
    if (!isInside(this.saveRoot, session.meeting_dir)) {
      throw new Error('session directory is outside the save root');
    }

    const meta = await readMeetingMeta(session.meta_path);
    if (meta.id !== meetingId) {
      throw new Error('meta id does not match');
    }
    if (meta.status !== 'recording' && meta.status !== 'error') {
      throw new Error('recording is not recoverable');
    }
    const hadChunkFailure = meta.status === 'error';
    if (meta.chunks.length === 0) {
      throw new Error('recording has no chunks');
    }

    const audioPath = join(session.meeting_dir, 'audio.wav');
    const chunksDir = join(tempDir, 'chunks');
    await this.mergeChunks(meta, chunksDir, audioPath);

    meta.status = 'encoding';
    meta.ended_at = meta.ended_at ?? this.now().toISOString();
    meta.audio_path = 'audio.wav';
    meta.duration = meta.actual_samples / meta.sample_rate;
    await writeMeetingMeta(session.meta_path, meta);
    await rm(tempDir, { recursive: true, force: true });

    this.lastStatus = 'encoding';
    this.lastMeetingDir = session.meeting_dir;
    console.log(`recording recovered: ${meetingId}`);

    return {
      meetingId,
      meetingDir: session.meeting_dir,
      audioPath,
      startedAt: meta.started_at,
      status: 'encoding',
      sampleRate: meta.sample_rate,
      actualSamples: meta.actual_samples,
      expectedSamples: meta.expected_samples,
      captureStats: meta.capture_stats
        ? {
            frames: meta.capture_stats.frames,
            expectedFrames: meta.capture_stats.expected_frames,
            gaps: meta.capture_stats.gaps,
            maxGapFrames: meta.capture_stats.max_gap_frames,
            missedFrames: meta.capture_stats.missed_frames,
            sampleRate: meta.capture_stats.sample_rate,
            channels: meta.capture_stats.channels,
            currentTime: meta.capture_stats.current_time,
          }
        : undefined,
      hadChunkFailure,
    };
  }

  private async recordEventInternal(event: RecordingEvent): Promise<boolean> {
    const active = this.active;
    if (!active) {
      return false;
    }
    active.meta.events = active.meta.events ?? [];
    active.meta.events.push(event);
    try {
      await writeMeetingMeta(active.metaPath, active.meta);
      return true;
    } catch (error) {
      active.failed = true;
      console.error(`failed to record recording event: ${errorMessage(error)}`);
      throw error;
    }
  }

  private async recordStartupFailureInternal(
    options: StartRecordingOptions,
    event: RecordingEvent,
  ): Promise<RecordingStartupFailureResult> {
    if (this.active) {
      throw new Error('a recording is already in progress');
    }
    if (!Number.isFinite(options.sampleRate) || !Number.isInteger(options.sampleRate)) {
      throw new Error('invalid sample rate');
    }
    if (options.sampleRate < 8000 || options.sampleRate > 192000) {
      throw new Error('sample rate is out of range');
    }
    if (!['microphone', 'system', 'both'].includes(options.inputSource)) {
      throw new Error('invalid input source');
    }

    const now = this.now();
    const meetingDir = await this.createMeetingDir(now);
    const meetingId = randomUUID();
    const metaPath = join(meetingDir, 'meta.json');
    const meta: MeetingMeta = {
      schema_version: 1,
      id: meetingId,
      status: 'error',
      title: 'タイトル未入力',
      started_at: now.toISOString(),
      ended_at: now.toISOString(),
      duration: 0,
      source: {
        input: options.inputSource,
        microphone: options.microphoneLabel,
        system: options.systemLabel,
      },
      sample_rate: options.sampleRate,
      channels: WAV_CHANNELS,
      bits_per_sample: WAV_BITS_PER_SAMPLE,
      chunks: [],
      expected_samples: 0,
      actual_samples: 0,
      gap_samples: 0,
      events: [event],
      clipping_config: options.clippingConfig,
      silence_config: options.silenceConfig,
      app_version: this.appVersion,
    };

    try {
      await writeMeetingMeta(metaPath, meta);
    } catch (error) {
      await rm(meetingDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    this.lastStatus = 'error';
    this.lastMeetingDir = meetingDir;
    return { meetingId, meetingDir, metaPath };
  }

  private async createMeetingDir(now: Date): Promise<string> {
    const year = String(now.getFullYear());
    const date = `${year}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
    const base = `${date}_${time}_タイトル未入力`;
    const yearRoot = join(this.saveRoot, year);
    await ensurePrivateDirectory(yearRoot);

    let name = base;
    let index = 2;
    while (await this.pathExists(join(yearRoot, name))) {
      name = `${base}_${index}`;
      index += 1;
    }

    const meetingDir = join(yearRoot, name);
    await mkdir(meetingDir, { mode: 0o700 });
    await chmod(meetingDir, 0o700);
    return meetingDir;
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  private async mergeChunks(meta: MeetingMeta, chunksDir: string, audioPath: string): Promise<void> {
    const totalFrames = meta.chunks.reduce((sum, chunk) => sum + chunk.frames, 0);
    if (totalFrames <= 0) {
      throw new Error('no audio frames to merge');
    }

    const tempPath = `${audioPath}.tmp`;
    const handle = await open(tempPath, 'w', 0o600);
    try {
      await handle.write(createWavHeader(totalFrames * 2, meta.sample_rate));
      for (let index = 0; index < meta.chunks.length; index += 1) {
        const chunk = meta.chunks[index];
        if (chunk.sequence !== index + 1) {
          throw new Error('chunk sequence is not continuous');
        }
        const data = await readFile(join(chunksDir, chunk.file));
        const expectedBytes = 44 + chunk.frames * 2;
        if (data.length !== expectedBytes) {
          throw new Error(`chunk size mismatch: ${chunk.file}`);
        }
        await handle.write(data.subarray(44));
      }
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
    await handle.close();
    await chmod(tempPath, 0o600);
    await rename(tempPath, audioPath);
    await syncDirectory(dirname(audioPath));
  }
}
