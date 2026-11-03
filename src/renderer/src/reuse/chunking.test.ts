/**
 * 音声強調のチャンク計画、PCM 変換、クロスフェードを検証する。
 * 対応する要求: REQ-ENHANCE-001、共通基盤
 */
import { describe, expect, it } from 'vitest';
import {
  ChunkCrossfader,
  chunkByteRange,
  mixPcm16ToMono,
  pcmTotalFrames,
  planEnhancementChunks,
} from './chunking';

describe('planEnhancementChunks', () => {
  it('plans 5 second chunks with a 2.5 second hop and a 0.5 second crossfade', () => {
    const plan = planEnhancementChunks(100, 10);
    expect(plan.chunkFrames).toBe(50);
    expect(plan.hopFrames).toBe(25);
    expect(plan.crossfadeFrames).toBe(5);
    expect(plan.chunks).toEqual([
      {
        index: 0,
        startFrame: 0,
        endFrame: 50,
        outputStartFrame: 0,
        outputEndFrame: 25,
      },
      {
        index: 1,
        startFrame: 25,
        endFrame: 75,
        outputStartFrame: 25,
        outputEndFrame: 50,
      },
      {
        index: 2,
        startFrame: 50,
        endFrame: 100,
        outputStartFrame: 50,
        outputEndFrame: 75,
      },
      {
        index: 3,
        startFrame: 50,
        endFrame: 100,
        outputStartFrame: 75,
        outputEndFrame: 100,
      },
    ]);
  });

  it('keeps every output range inside its chunk and covers the whole input', () => {
    const plan = planEnhancementChunks(1234, 16);
    expect(plan.chunks[0]?.outputStartFrame).toBe(0);
    expect(plan.chunks.at(-1)?.outputEndFrame).toBe(1234);
    let nextStart = 0;
    for (const chunk of plan.chunks) {
      expect(chunk.startFrame).toBeLessThanOrEqual(chunk.outputStartFrame);
      expect(chunk.outputEndFrame).toBeLessThanOrEqual(chunk.endFrame);
      expect(chunk.outputStartFrame).toBe(nextStart);
      expect(chunk.outputEndFrame).toBeGreaterThan(chunk.outputStartFrame);
      nextStart = chunk.outputEndFrame;
    }
  });

  it('uses one chunk when the input is shorter than the chunk', () => {
    expect(planEnhancementChunks(20, 10).chunks).toEqual([
      {
        index: 0,
        startFrame: 0,
        endFrame: 20,
        outputStartFrame: 0,
        outputEndFrame: 20,
      },
    ]);
  });

  it('returns no chunks for empty input', () => {
    expect(planEnhancementChunks(0, 16).chunks).toEqual([]);
  });
});

describe('PCM helpers', () => {
  it('computes frames and byte ranges for interleaved PCM', () => {
    const info = { dataOffset: 44, dataSize: 16, channels: 2 };
    expect(pcmTotalFrames(info)).toBe(4);
    expect(
      chunkByteRange(info, {
        index: 0,
        startFrame: 1,
        endFrame: 3,
        outputStartFrame: 0,
        outputEndFrame: 2,
      }),
    ).toEqual({ startByte: 48, endByte: 55 });
  });

  it('mixes stereo PCM to mono', () => {
    const samples = new Int16Array([1000, -1000, 2000, 0]);
    const bytes = new Uint8Array(samples.buffer);
    expect(mixPcm16ToMono(bytes, 2)).toEqual(
      new Float32Array([0, 1000 / 32768]),
    );
  });
});

describe('ChunkCrossfader', () => {
  it('keeps the first chunk unchanged and linearly blends the next one', () => {
    const crossfader = new ChunkCrossfader(5);
    const first = crossfader.blend(new Float32Array([1, 1, 1, 1, 1, 1]));
    expect([...first]).toEqual([1, 1, 1, 1, 1, 1]);

    const second = crossfader.blend(new Float32Array([2, 2, 2, 2, 2, 2]));
    expect(second[0]).toBeCloseTo(1 * (5 / 6) + 2 * (1 / 6), 5);
    expect(second[4]).toBeCloseTo(1 * (1 / 6) + 2 * (5 / 6), 5);
    expect(second[5]).toBe(2);
  });
});
