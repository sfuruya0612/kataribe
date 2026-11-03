/**
 * 音声強調サービスがチャンクを順に書き、WAV を完成させることを検証する。
 * 対応する要求: REQ-ENHANCE-001、共通基盤
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EnhancementStartMessage } from '../src/shared/reuse';
import {
  ReuseEnhancementService,
  type ReuseEnhancementRequest,
} from '../src/main/reuse-enhancement';
import {
  ReuseModelManager,
  type ReuseModelDefinition,
} from '../src/main/reuse-models';
import { ReuseTempTokenStore } from '../src/main/reuse-protocol';
import {
  encodePcm16,
  encodeWavMono16,
  readWavInfo,
  WAV_HEADER_BYTES,
} from '../src/main/wav';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-reuse-enhancement-'));
  roots.push(root);
  const modelData = Buffer.from('model weights');
  const definition: ReuseModelDefinition = {
    id: 'nemotronlabs',
    label: 'NVIDIA NemotronLabs RE-USE',
    license: 'OpenMDW-1.1',
    fileName: 'nemotronlabs.safetensors',
    url: 'https://example.com/model.safetensors',
    sizeBytes: modelData.length,
    sha256: createHash('sha256').update(modelData).digest('hex'),
  };
  const modelsDir = join(root, 'models', 'reuse');
  await (await import('node:fs/promises')).mkdir(modelsDir, { recursive: true });
  await writeFile(join(modelsDir, definition.fileName), modelData);
  const modelManager = new ReuseModelManager({
    modelsDir,
    definitions: [definition],
  });
  const inputPath = join(root, 'input.wav');
  const samples = new Float32Array([0, 0.5, -0.5, 0.25, 0, 0.1, -0.1, 0.2, 0.3, -0.3]);
  await writeFile(inputPath, encodeWavMono16(samples, 16_000));
  return {
    root,
    inputPath,
    outputPath: join(root, 'output.wav'),
    modelManager,
  };
}

async function waitForStart(
  messages: EnhancementStartMessage[],
): Promise<EnhancementStartMessage> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const message = messages[0];
    if (message) {
      return message;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('enhancement did not start');
}

describe('ReuseEnhancementService', () => {
  it('writes chunks in order and completes the WAV header and length', async () => {
    const { inputPath, outputPath, modelManager } = await createWorkspace();
    const starts: EnhancementStartMessage[] = [];
    const progress: number[] = [];
    const cancelled: string[] = [];
    const tempTokens = new ReuseTempTokenStore();
    const service = new ReuseEnhancementService({
      tempTokens,
      modelManager,
      sendStart: (message) => {
        starts.push(message);
        return true;
      },
      sendCancel: (message) => cancelled.push(message.requestId),
      createRequestId: () => 'request-1',
    });
    const request: ReuseEnhancementRequest = {
      inputPath,
      outputPath,
      model: 'nemotronlabs',
      onProgress: (value) => progress.push(value),
    };
    const promise = service.enhance(request);
    const start = await waitForStart(starts);
    expect(start).toMatchObject({
      requestId: 'request-1',
      model: 'nemotronlabs',
      sampleRate: 16_000,
      channels: 1,
      bitsPerSample: 16,
      totalFrames: 10,
      chunkSeconds: 5,
      hopSeconds: 2.5,
      crossfadeSeconds: 0.5,
      modelUrl: 'kataribe-model://reuse/nemotronlabs',
    });
    expect(start.tempUrl).toMatch(/^kataribe-temp:\/\/enhance\/[A-Za-z0-9-]+$/u);

    const first = new Float32Array([0, 0.5, -0.5]);
    const second = new Float32Array([0.25, 0, 0.1, -0.1]);
    const third = new Float32Array([0.2, 0.3, -0.3]);
    await service.handleChunk('request-1', 0, first);
    service.handleProgress('request-1', 0.5);
    await service.handleChunk('request-1', 1, second);
    await service.handleChunk('request-1', 2, third);
    await service.handleDone('request-1');
    await promise;

    const info = await readWavInfo(outputPath);
    expect(info).toMatchObject({
      sampleRate: 16_000,
      channels: 1,
      bitsPerSample: 16,
      dataSize: 20,
    });
    const output = await readFile(outputPath);
    expect(output.subarray(WAV_HEADER_BYTES)).toEqual(
      encodePcm16(new Float32Array([...first, ...second, ...third])),
    );
    expect(progress).toEqual([0.5]);
    expect(cancelled).toEqual([]);
    await expect(stat(`${outputPath}.part`)).rejects.toThrow();
  });

  it('rejects a chunk that arrives out of order and leaves no output', async () => {
    const { inputPath, outputPath, modelManager } = await createWorkspace();
    const starts: EnhancementStartMessage[] = [];
    const service = new ReuseEnhancementService({
      tempTokens: new ReuseTempTokenStore(),
      modelManager,
      sendStart: (message) => {
        starts.push(message);
        return true;
      },
      sendCancel: () => undefined,
      createRequestId: () => 'request-2',
    });
    const promise = service.enhance({
      inputPath,
      outputPath,
      model: 'nemotronlabs',
    });
    await waitForStart(starts);
    await expect(
      service.handleChunk('request-2', 1, new Float32Array([1, 1, 1])),
    ).rejects.toThrow(/out of order/u);
    await expect(promise).rejects.toThrow(/out of order/u);
    await expect(stat(outputPath)).rejects.toThrow();
    await expect(stat(`${outputPath}.part`)).rejects.toThrow();
  });

  it('cancels an active enhancement and removes the partial file', async () => {
    const { inputPath, outputPath, modelManager } = await createWorkspace();
    const starts: EnhancementStartMessage[] = [];
    const cancelled: string[] = [];
    const service = new ReuseEnhancementService({
      tempTokens: new ReuseTempTokenStore(),
      modelManager,
      sendStart: (message) => {
        starts.push(message);
        return true;
      },
      sendCancel: (message) => cancelled.push(message.requestId),
      createRequestId: () => 'request-3',
    });
    const promise = service.enhance({
      inputPath,
      outputPath,
      model: 'nemotronlabs',
    });
    await waitForStart(starts);
    expect(await service.cancel()).toBe(true);
    await expect(promise).rejects.toThrow(/cancelled/u);
    expect(cancelled).toEqual(['request-3']);
    await expect(stat(outputPath)).rejects.toThrow();
    await expect(stat(`${outputPath}.part`)).rejects.toThrow();
    expect(service.isBusy()).toBe(false);
  });

  it('fails when the renderer is unavailable', async () => {
    const { inputPath, outputPath, modelManager } = await createWorkspace();
    const service = new ReuseEnhancementService({
      tempTokens: new ReuseTempTokenStore(),
      modelManager,
      sendStart: () => false,
      sendCancel: () => undefined,
    });
    await expect(
      service.enhance({
        inputPath,
        outputPath,
        model: 'nemotronlabs',
      }),
    ).rejects.toThrow(/main window is not available/u);
    await expect(stat(outputPath)).rejects.toThrow();
  });

  it('rejects an input that is not 16-bit PCM', async () => {
    const { root, outputPath, modelManager } = await createWorkspace();
    const inputPath = join(root, 'invalid.wav');
    await writeFile(inputPath, 'not a wav');
    const service = new ReuseEnhancementService({
      tempTokens: new ReuseTempTokenStore(),
      modelManager,
      sendStart: () => true,
      sendCancel: () => undefined,
    });
    await expect(
      service.enhance({
        inputPath,
        outputPath,
        model: 'nemotronlabs',
      }),
    ).rejects.toThrow();
  });
});
