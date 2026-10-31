import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diarizeSegments } from '../src/main/diarization';
import { encodeWavMono16 } from '../src/main/wav';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createSyntheticWav(
  frequencies: number[],
  sampleRate = 16000,
): Promise<{ path: string; segments: Array<{ startSeconds: number; endSeconds: number; text: string }> }> {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-diarization-'));
  roots.push(root);
  const secondsPerSegment = 1;
  const samples = new Float32Array(
    sampleRate * secondsPerSegment * frequencies.length,
  );
  frequencies.forEach((frequency, segmentIndex) => {
    const offset = segmentIndex * sampleRate * secondsPerSegment;
    for (let index = 0; index < sampleRate * secondsPerSegment; index += 1) {
      samples[offset + index] =
        0.35 * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
    }
  });
  const path = join(root, 'audio.16k.wav');
  await writeFile(path, encodeWavMono16(samples, sampleRate));
  return {
    path,
    segments: frequencies.map((_frequency, index) => ({
      startSeconds: index * secondsPerSegment,
      endSeconds: (index + 1) * secondsPerSegment,
      text: `segment-${index}`,
    })),
  };
}

describe('diarizeSegments', () => {
  it('assigns two estimated speakers to alternating synthetic voices', async () => {
    const { path, segments } = await createSyntheticWav([220, 440, 220, 440, 220, 440]);
    const result = await diarizeSegments(path, segments);
    expect(result).not.toBeNull();
    const speakers = result?.map((segment) => segment.speaker);
    expect(new Set(speakers)).toEqual(new Set(['話者A', '話者B']));
    expect(speakers?.[0]).toBe('話者A');
    expect(speakers?.[1]).toBe('話者B');
    expect(speakers?.[2]).toBe('話者A');
  });

  it('does not label a single synthetic voice', async () => {
    const { path, segments } = await createSyntheticWav([220, 220, 220, 220]);
    expect(await diarizeSegments(path, segments)).toBeNull();
  });

  it('does not label fewer than four segments', async () => {
    const { path, segments } = await createSyntheticWav([220, 440, 220]);
    expect(await diarizeSegments(path, segments)).toBeNull();
  });
});
