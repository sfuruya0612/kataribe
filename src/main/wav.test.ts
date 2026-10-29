import { describe, expect, it } from 'vitest';
import {
  createWavHeader,
  encodePcm16,
  encodeWavMono16,
  WAV_HEADER_BYTES,
} from './wav';

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
