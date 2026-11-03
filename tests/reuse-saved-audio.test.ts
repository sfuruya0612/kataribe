/**
 * 保存音声の強調、mp3 の置き換え、失敗時の既存ファイル保持を検証する。
 * 対応する要求: REQ-ENHANCE-001
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EnhancementStartMessage } from '../src/shared/reuse';
import { BinaryLocator, MediaEncoder } from '../src/main/media';
import { writeMeetingMeta, readMeetingMeta, type MeetingMeta } from '../src/main/meeting-meta';
import {
  ReuseEnhancementService,
  type ReuseEnhancementServiceOptions,
} from '../src/main/reuse-enhancement';
import { ReuseModelManager, type ReuseModelDefinition } from '../src/main/reuse-models';
import { ReuseTempTokenStore } from '../src/main/reuse-protocol';
import { ReuseSavedAudioService } from '../src/main/reuse-saved-audio';
import { readEnhancementFile } from '../src/main/reuse-metadata';
import { encodeWavMono16, readWavInfo } from '../src/main/wav';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function createSignal(sampleRate = 16_000): Float32Array {
  const samples = new Float32Array(sampleRate);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.3;
  }
  return samples;
}

function decodeMono(
  buffer: Buffer,
  info: Awaited<ReturnType<typeof readWavInfo>>,
): Float32Array {
  const frames = Math.floor(info.dataSize / (info.channels * 2));
  const samples = new Float32Array(frames);
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset + info.dataOffset,
    info.dataSize,
  );
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < info.channels; channel += 1) {
      sum += view.getInt16((frame * info.channels + channel) * 2, true);
    }
    samples[frame] = sum / info.channels / 32768;
  }
  return samples;
}

async function createWorkspace(failEnhancement = false) {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-saved-audio-'));
  roots.push(root);
  const meetingDir = join(root, 'meeting');
  const tempRoot = join(root, 'tmp');
  const meetingId = '00000000-0000-4000-8000-0000000000f1';
  await (await import('node:fs/promises')).mkdir(meetingDir, { recursive: true });
  const modelData = Buffer.from('model');
  const definition: ReuseModelDefinition = {
    id: 'nemotronlabs',
    label: 'NVIDIA NemotronLabs RE-USE',
    license: 'OpenMDW-1.1',
    fileName: 'nemotronlabs.safetensors',
    url: 'https://example.com/model.safetensors',
    sizeBytes: modelData.length,
    sha256: createHash('sha256').update(modelData).digest('hex'),
  };
  const modelsDir = join(root, 'models');
  await (await import('node:fs/promises')).mkdir(modelsDir, { recursive: true });
  await writeFile(join(modelsDir, definition.fileName), modelData);
  const modelManager = new ReuseModelManager({
    modelsDir,
    definitions: [definition],
  });
  const ffmpeg = join(process.cwd(), 'resources', 'bin', 'arm64', 'ffmpeg');
  const mediaEncoder = new MediaEncoder({
    locator: new BinaryLocator({
      isPackaged: false,
      resourcesPath: root,
      appPath: process.cwd(),
      platform: process.platform,
      arch: process.arch,
      env: { KATARIBE_FFMPEG_PATH: ffmpeg },
    }),
  });
  const sourceWav = join(meetingDir, 'audio.wav');
  const audioPath = join(meetingDir, 'audio.mp3');
  await writeFile(sourceWav, encodeWavMono16(createSignal(), 16_000));
  await mediaEncoder.encodeMp3({
    inputPath: sourceWav,
    outputPath: audioPath,
    durationSeconds: 1,
    bitrateKbps: 64,
  });
  const meta: MeetingMeta = {
    schema_version: 1,
    id: meetingId,
    status: 'summarized',
    title: '保存音声のテスト',
    started_at: '2026-11-03T00:00:00.000Z',
    duration: 1,
    source: { input: 'both' },
    sample_rate: 48_000,
    channels: 1,
    bits_per_sample: 16,
    chunks: [],
    expected_samples: 16_000,
    actual_samples: 16_000,
    app_version: '0.1.0',
    audio_path: 'audio.mp3',
  };
  await writeMeetingMeta(join(meetingDir, 'meta.json'), meta);

  const tempTokens = new ReuseTempTokenStore();
  let service: ReuseEnhancementService;
  const sendStart = (message: EnhancementStartMessage): boolean => {
    void (async () => {
      if (failEnhancement) {
        service.handleError(message.requestId, 'GPU failed');
        return;
      }
      const token = message.tempUrl.split('/').at(-1) ?? '';
      const inputPath = tempTokens.resolve(token);
      if (!inputPath) {
        service.handleError(message.requestId, 'input token is missing');
        return;
      }
      const info = await readWavInfo(inputPath);
      const samples = decodeMono(await readFile(inputPath), info);
      await service.handleChunk(message.requestId, 0, samples);
      await service.handleDone(message.requestId);
    })().catch(() => undefined);
    return true;
  };
  const options: ReuseEnhancementServiceOptions = {
    tempTokens,
    modelManager,
    sendStart,
    sendCancel: () => undefined,
  };
  service = new ReuseEnhancementService(options);
  const savedAudio = new ReuseSavedAudioService({
    enhancement: service,
    modelManager,
    mediaEncoder,
    tempRoot,
    now: () => 1_000,
  });
  return {
    root,
    meetingDir,
    meetingId,
    sourceWav,
    audioPath,
    modelManager,
    savedAudio,
  };
}

describe('ReuseSavedAudioService', () => {
  it('creates the enhanced mp3 from the recorded WAV and updates the metadata', async () => {
    const { meetingDir, meetingId, sourceWav, savedAudio, audioPath } =
      await createWorkspace();
    await savedAudio.enhance({
      meetingId,
      meetingDir,
      audioPath,
      sourceWavPath: sourceWav,
      model: 'nemotronlabs',
      bitrateKbps: 64,
    });
    const enhanced = join(meetingDir, 'audio.enhanced.nemotronlabs.mp3');
    expect((await stat(enhanced)).size).toBeGreaterThan(0);
    const read = await readEnhancementFile(meetingDir);
    expect(read.state).toBe('ok');
    expect(read.state === 'ok' ? read.file.saved_audio.nemotronlabs?.state : null)
      .toBe('succeeded');
    expect(read.state === 'ok' ? read.file.saved_audio.nemotronlabs?.output?.path : null)
      .toBe('audio.enhanced.nemotronlabs.mp3');
    const meta = await readMeetingMeta(join(meetingDir, 'meta.json'));
    expect(meta.enhancement?.savedAudioModels).toEqual(['nemotronlabs']);
    expect((await stat(audioPath)).size).toBeGreaterThan(0);
  });

  it('decodes audio.mp3 when re-running and replaces the existing file', async () => {
    const { meetingDir, meetingId, savedAudio, audioPath } = await createWorkspace();
    const enhanced = join(meetingDir, 'audio.enhanced.nemotronlabs.mp3');
    await writeFile(enhanced, 'old enhanced audio');
    await savedAudio.enhance({
      meetingId,
      meetingDir,
      audioPath,
      sourceWavPath: null,
      model: 'nemotronlabs',
      bitrateKbps: 64,
    });
    expect((await readFile(enhanced)).toString('utf8')).not.toBe(
      'old enhanced audio',
    );
    expect((await stat(enhanced)).size).toBeGreaterThan(0);
  });

  it('keeps the previous mp3 when enhancement fails', async () => {
    const { meetingDir, meetingId, savedAudio, audioPath } =
      await createWorkspace(true);
    const enhanced = join(meetingDir, 'audio.enhanced.nemotronlabs.mp3');
    await writeFile(enhanced, 'old enhanced audio');
    await expect(
      savedAudio.enhance({
        meetingId,
        meetingDir,
        audioPath,
        sourceWavPath: null,
        model: 'nemotronlabs',
        bitrateKbps: 64,
      }),
    ).rejects.toThrow(/GPU failed/u);
    expect(await readFile(enhanced, 'utf8')).toBe('old enhanced audio');
    const read = await readEnhancementFile(meetingDir);
    expect(read.state).toBe('ok');
    expect(read.state === 'ok' ? read.file.saved_audio.nemotronlabs?.state : null)
      .toBe('failed');
    expect(read.state === 'ok' ? read.file.saved_audio.nemotronlabs?.error : null)
      .toContain('GPU failed');
  });
});
