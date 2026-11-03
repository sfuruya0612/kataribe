import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWavHeader,
  encodePcm16,
  encodeWavMono16,
  planWavChunks,
  readWavInfo,
  WAV_HEADER_BYTES,
  writeWavChunk,
} from './wav';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('createWavHeader', () => {
  it('writes a mono 16-bit pcm wav header', () => {
    const header = createWavHeader(960, 48000);

    expect(header.length).toBe(WAV_HEADER_BYTES);
    expect(header.toString('ascii', 0, 4)).toBe('RIFF');
    expect(header.readUInt32LE(4)).toBe(36 + 960);
    expect(header.toString('ascii', 8, 12)).toBe('WAVE');
    expect(header.toString('ascii', 12, 16)).toBe('fmt ');
    expect(header.readUInt32LE(16)).toBe(16);
    expect(header.readUInt16LE(20)).toBe(1);
    expect(header.readUInt16LE(22)).toBe(1);
    expect(header.readUInt32LE(24)).toBe(48000);
    expect(header.readUInt32LE(28)).toBe(96000);
    expect(header.readUInt16LE(32)).toBe(2);
    expect(header.readUInt16LE(34)).toBe(16);
    expect(header.toString('ascii', 36, 40)).toBe('data');
    expect(header.readUInt32LE(40)).toBe(960);
  });

  it('rejects an invalid data size', () => {
    expect(() => createWavHeader(-1, 48000)).toThrow('invalid wav data size');
    expect(() => createWavHeader(1.5, 48000)).toThrow('invalid wav data size');
  });

  it('rejects an invalid sample rate', () => {
    expect(() => createWavHeader(0, 0)).toThrow('invalid sample rate');
    expect(() => createWavHeader(0, 48000.5)).toThrow('invalid sample rate');
  });
});

describe('encodePcm16', () => {
  it('converts float samples to signed 16-bit little endian', () => {
    const data = encodePcm16(new Float32Array([0, 1, -1, 0.5, -0.5]));

    expect(data.length).toBe(10);
    expect(data.readInt16LE(0)).toBe(0);
    expect(data.readInt16LE(2)).toBe(32767);
    expect(data.readInt16LE(4)).toBe(-32768);
    expect(data.readInt16LE(6)).toBe(16384);
    expect(data.readInt16LE(8)).toBe(-16384);
  });

  it('clamps samples outside the valid range', () => {
    const data = encodePcm16(new Float32Array([1.5, -1.5]));

    expect(data.readInt16LE(0)).toBe(32767);
    expect(data.readInt16LE(2)).toBe(-32768);
  });

  it('treats missing samples as silence', () => {
    const data = encodePcm16(new Float32Array([Number.NaN]));

    expect(data.readInt16LE(0)).toBe(0);
  });
});

describe('encodeWavMono16', () => {
  it('combines the header and the pcm data', () => {
    const wav = encodeWavMono16(new Float32Array([0, 0.25]), 16000);

    expect(wav.length).toBe(WAV_HEADER_BYTES + 4);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(40)).toBe(4);
    expect(wav.readInt16LE(44)).toBe(0);
    expect(wav.readInt16LE(46)).toBe(8192);
  });
});

describe('planWavChunks and writeWavChunk', () => {
  it('req_trans_001_moves_the_boundary_to_a_quiet_point', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kataribe-wav-'));
    roots.push(root);
    const path = join(root, 'audio.16k.wav');
    const samples = new Float32Array(32000);
    for (let index = 0; index < 16000; index += 1) {
      samples[index] = Math.sin((index / 16000) * 440 * Math.PI * 2) * 0.2;
    }
    await writeFile(path, encodeWavMono16(samples, 16000));
    const info = await readWavInfo(path);
    const chunks = await planWavChunks(path, info, {
      maxBytes: 16000 * 2,
      chunkSeconds: 1,
      silenceSearchSeconds: 0.5,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]?.startSeconds).toBe(0);
    expect(chunks[0]?.endSeconds).toBeGreaterThan(0.9);
    expect(chunks[0]?.endSeconds).toBeLessThanOrEqual(1);
    expect(chunks[1]?.startSeconds).toBe(chunks[0]?.endSeconds);
    expect(chunks.at(-1)?.endSeconds).toBe(2);
    expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(
      info.dataSize,
    );
  });

  it('req_trans_001_respects_the_maximum_request_bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kataribe-wav-'));
    roots.push(root);
    const path = join(root, 'audio.16k.wav');
    await writeFile(path, encodeWavMono16(new Float32Array(32000), 16000));
    const info = await readWavInfo(path);
    const maxBytes = 16000 * 2 * 0.4;
    const chunks = await planWavChunks(path, info, {
      maxBytes,
      chunkSeconds: 10,
      silenceSearchSeconds: 0,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(5);
    for (const chunk of chunks) {
      expect(chunk.byteLength).toBeLessThanOrEqual(maxBytes);
      expect(chunk.byteLength % 2).toBe(0);
    }
    expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(
      info.dataSize,
    );
  });

  it('req_trans_001_writes_the_same_pcm_into_the_chunk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kataribe-wav-'));
    roots.push(root);
    const path = join(root, 'audio.16k.wav');
    const samples = new Float32Array(16000);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = (index % 200) / 200 - 0.5;
    }
    await writeFile(path, encodeWavMono16(samples, 16000));
    const info = await readWavInfo(path);
    const chunk = {
      index: 0,
      startSeconds: 0.25,
      endSeconds: 0.75,
      startByte: 8000,
      byteLength: 16000,
    };
    const output = join(root, 'chunk.wav');
    await writeWavChunk(path, info, chunk, output);
    const chunkInfo = await readWavInfo(output);
    const chunkBytes = await readFile(output);

    expect(chunkInfo.sampleRate).toBe(16000);
    expect(chunkInfo.channels).toBe(1);
    expect(chunkInfo.bitsPerSample).toBe(16);
    expect(chunkInfo.dataSize).toBe(chunk.byteLength);
    expect(chunkBytes.subarray(WAV_HEADER_BYTES)).toEqual(
      encodeWavMono16(samples, 16000).subarray(
        WAV_HEADER_BYTES + 8000,
        WAV_HEADER_BYTES + 24000,
      ),
    );
  });
});
