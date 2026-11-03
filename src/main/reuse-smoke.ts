import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReuseModel } from '../shared/types';
import type { ReuseEnhancementService } from './reuse-enhancement';
import type { ReuseModelManager } from './reuse-models';
import { encodePcm16, encodeWavMono16, readWavInfo } from './wav';

export type ReuseSmokeRun = {
  elapsedMs: number;
  frames: number;
  sampleRate: number;
  changedSamples: number;
  maxDifference: number;
  extrapolated60MinutesMs: number;
};

export type ReuseSmokeResult = {
  runs: ReuseSmokeRun[];
};

export type ReuseSmokeOptions = {
  service: ReuseEnhancementService;
  modelManager: ReuseModelManager;
  outputDir: string;
  model: ReuseModel;
  waitForBridge: () => Promise<void>;
  sampleRates?: number[];
  seconds?: number;
  now?: () => number;
};

function createSmokeSignal(sampleRate: number, seconds: number): Float32Array {
  const frames = Math.floor(sampleRate * seconds);
  const samples = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    const time = index / sampleRate;
    samples[index] =
      Math.sin(2 * Math.PI * 440 * time) * 0.3 +
      Math.sin(2 * Math.PI * 1234 * time) * 0.05 +
      Math.sin(2 * Math.PI * 37 * time) * 0.01;
  }
  return samples;
}

async function runOne(
  options: ReuseSmokeOptions,
  sampleRate: number,
  seconds: number,
): Promise<ReuseSmokeRun> {
  const now = options.now ?? (() => Date.now());
  const inputPath = join(
    options.outputDir,
    `reuse-smoke-input-${sampleRate}.wav`,
  );
  const outputPath = join(
    options.outputDir,
    `reuse-smoke-output-${sampleRate}.wav`,
  );
  const inputSamples = createSmokeSignal(sampleRate, seconds);
  await writeFile(inputPath, encodeWavMono16(inputSamples, sampleRate));
  try {
    const startedAt = now();
    await options.service.enhance({
      inputPath,
      outputPath,
      model: options.model,
    });
    const elapsedMs = now() - startedAt;
    const info = await readWavInfo(outputPath);
    if (info.sampleRate !== sampleRate) {
      throw new Error(
        `output sample rate is ${info.sampleRate}, expected ${sampleRate}`,
      );
    }
    if (info.dataSize !== inputSamples.length * 2) {
      throw new Error(
        `output has ${info.dataSize} data bytes, expected ${inputSamples.length * 2}`,
      );
    }
    const output = await readFile(outputPath);
    const inputPcm = encodePcm16(inputSamples);
    const outputPcm = output.subarray(44);
    let changedSamples = 0;
    let maxDifference = 0;
    for (let offset = 0; offset + 1 < outputPcm.length; offset += 2) {
      const inputValue = inputPcm.readInt16LE(offset);
      const outputValue = outputPcm.readInt16LE(offset);
      const difference = Math.abs(inputValue - outputValue);
      if (difference > 0) {
        changedSamples += 1;
      }
      maxDifference = Math.max(maxDifference, difference);
    }
    if (changedSamples === 0 || maxDifference < 8) {
      throw new Error('the enhanced output is identical to the input');
    }
    return {
      elapsedMs,
      frames: inputSamples.length,
      sampleRate,
      changedSamples,
      maxDifference,
      extrapolated60MinutesMs: Math.round(
        (elapsedMs / Math.max(1, inputSamples.length / sampleRate)) * 3600,
      ),
    };
  } finally {
    await rm(inputPath, { force: true }).catch(() => undefined);
    await rm(outputPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Electron 上で短い WAV を複数のサンプルレートで強調し、出力と処理時間を確認する。
 */
export async function runReuseSmokeTest(
  options: ReuseSmokeOptions,
): Promise<ReuseSmokeResult> {
  const installed = await options.modelManager.installedPath(options.model);
  if (!installed) {
    throw new Error('the speech enhancement model is not installed');
  }
  await mkdir(options.outputDir, { recursive: true, mode: 0o700 });
  await options.waitForBridge();
  const seconds = options.seconds ?? 2;
  const sampleRates = options.sampleRates ?? [16_000, 44_100, 48_000];
  const runs: ReuseSmokeRun[] = [];
  for (const sampleRate of sampleRates) {
    runs.push(await runOne(options, sampleRate, seconds));
  }
  return { runs };
}
