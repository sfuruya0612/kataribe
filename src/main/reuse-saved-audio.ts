import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  EnhancementAudioSource,
  EnhancementFile,
  EnhancementSavedAudio,
  ReuseModel,
} from '../shared/types';
import { hashFile } from './asset-download';
import { MediaError, type MediaEncoder } from './media';
import { readMeetingMeta, updateMeetingMeta, writeMeetingMeta } from './meeting-meta';
import { assertEnhancementDiskSpace } from './reuse-cleanup';
import type { ReuseEnhancementService } from './reuse-enhancement';
import {
  createEnhancementFile,
  readEnhancementFile,
  updateMetaEnhancement,
  writeEnhancementFile,
} from './reuse-metadata';
import { getReuseModelDefinition, type ReuseModelManager } from './reuse-models';
import { readWavInfo } from './wav';

export type ReuseSavedAudioRequest = {
  meetingId: string;
  meetingDir: string;
  audioPath: string;
  sourceWavPath: string | null;
  model: ReuseModel;
  bitrateKbps: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

export type ReuseSavedAudioServiceOptions = {
  enhancement: ReuseEnhancementService;
  modelManager: ReuseModelManager;
  mediaEncoder: MediaEncoder;
  tempRoot: string;
  now?: () => number;
};

const SETTINGS = {
  chunk_seconds: 5,
  hop_seconds: 2.5,
  crossfade_seconds: 0.5,
};

function isCancelled(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof MediaError && error.code === 'cancelled')
  );
}

/**
 * 保存音声を RE-USE で強調し、mp3 を一時ファイル経由で置き換える。
 */
export class ReuseSavedAudioService {
  private readonly enhancement: ReuseEnhancementService;
  private readonly modelManager: ReuseModelManager;
  private readonly mediaEncoder: MediaEncoder;
  private readonly tempRoot: string;
  private readonly now: () => number;

  constructor(options: ReuseSavedAudioServiceOptions) {
    this.enhancement = options.enhancement;
    this.modelManager = options.modelManager;
    this.mediaEncoder = options.mediaEncoder;
    this.tempRoot = options.tempRoot;
    this.now = options.now ?? (() => Date.now());
  }

  async enhance(request: ReuseSavedAudioRequest): Promise<void> {
    const metaPath = join(request.meetingDir, 'meta.json');
    const meta = await readMeetingMeta(metaPath);
    const source = await this.readSource(request.audioPath);
    const read = await readEnhancementFile(request.meetingDir);
    const file: EnhancementFile =
      read.state === 'ok' ? read.file : createEnhancementFile(source);
    if (read.state === 'ok') {
      file.source = source;
    }
    const startedAt = this.now();
    const startedIso = new Date(startedAt).toISOString();
    const input = request.sourceWavPath
      ? await this.readInput(request.sourceWavPath)
      : source;
    const entry: EnhancementSavedAudio = {
      state: 'running',
      model_sha256: getReuseModelDefinition(request.model).sha256,
      input,
      output: null,
      settings: { ...SETTINGS },
      started_at: startedIso,
      finished_at: null,
      elapsed_seconds: null,
      error: null,
    };
    file.saved_audio[request.model] = entry;
    await this.save(metaPath, request.meetingDir, file);

    const tempDir = join(this.tempRoot, request.meetingId);
    await mkdir(tempDir, { recursive: true, mode: 0o700 });
    const decodedPath = join(tempDir, 'audio.decoded.wav');
    const enhancedPath = join(tempDir, 'audio.enhanced.wav');
    const finalPath = join(
      request.meetingDir,
      `audio.enhanced.${request.model}.mp3`,
    );
    const nextPath = `${finalPath}.next`;
    let inputWav = request.sourceWavPath;
    try {
      if (inputWav === null) {
        const sourceBytes = (await stat(request.audioPath)).size;
        await assertEnhancementDiskSpace(sourceBytes * 10, tempDir);
        await this.mediaEncoder.decodeToWav({
          inputPath: request.audioPath,
          outputPath: decodedPath,
          durationSeconds: meta.duration,
          bitrateKbps: request.bitrateKbps,
          signal: request.signal,
        });
        inputWav = decodedPath;
      }
      const info = await readWavInfo(inputWav);
      await assertEnhancementDiskSpace(info.dataSize, tempDir);

      await this.enhancement.enhance({
        inputPath: inputWav,
        outputPath: enhancedPath,
        model: request.model,
        signal: request.signal,
        onProgress: (progress) => request.onProgress?.(progress * 0.8),
      });
      const enhancedInfo = await readWavInfo(enhancedPath);
      await this.mediaEncoder.encodeMp3({
        inputPath: enhancedPath,
        outputPath: nextPath,
        durationSeconds: enhancedInfo.duration,
        bitrateKbps: request.bitrateKbps,
        signal: request.signal,
        onProgress: ({ ratio }) => request.onProgress?.(0.8 + ratio * 0.2),
      });
      await rename(nextPath, finalPath);

      const finishedAt = this.now();
      entry.state = 'succeeded';
      entry.output = {
        path: basename(finalPath),
        sha256: await hashFile(finalPath),
      };
      entry.finished_at = new Date(finishedAt).toISOString();
      entry.elapsed_seconds = Math.max(0, (finishedAt - startedAt) / 1000);
      entry.error = null;
      await this.save(metaPath, request.meetingDir, file);
      request.onProgress?.(1);
    } catch (error) {
      const finishedAt = this.now();
      entry.state = isCancelled(error, request.signal) ? 'cancelled' : 'failed';
      entry.finished_at = new Date(finishedAt).toISOString();
      entry.elapsed_seconds = Math.max(0, (finishedAt - startedAt) / 1000);
      entry.error = error instanceof Error ? error.message : String(error);
      await this.save(metaPath, request.meetingDir, file).catch(() => undefined);
      throw error;
    } finally {
      await rm(enhancedPath, { force: true }).catch(() => undefined);
      await rm(decodedPath, { force: true }).catch(() => undefined);
      await rm(nextPath, { force: true }).catch(() => undefined);
    }
  }

  private async readSource(audioPath: string): Promise<EnhancementAudioSource> {
    return {
      path: basename(audioPath),
      sha256: await hashFile(audioPath),
      sample_rate: 44_100,
      channels: 1,
    };
  }

  private async readInput(path: string): Promise<EnhancementAudioSource> {
    const info = await readWavInfo(path);
    return {
      path: basename(path),
      sha256: await hashFile(path),
      sample_rate: info.sampleRate,
      channels: info.channels,
    };
  }

  private async save(
    metaPath: string,
    meetingDir: string,
    file: EnhancementFile,
  ): Promise<void> {
    await writeEnhancementFile(meetingDir, file);
    const meta = await readMeetingMeta(metaPath);
    updateMetaEnhancement(meta, file);
    await writeMeetingMeta(metaPath, meta);
  }
}
