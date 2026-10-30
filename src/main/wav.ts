import { open } from 'node:fs/promises';

export const WAV_HEADER_BYTES = 44;
export const WAV_CHANNELS = 1;
export const WAV_BITS_PER_SAMPLE = 16;

export function createWavHeader(dataSize: number, sampleRate: number): Buffer {
  if (!Number.isInteger(dataSize) || dataSize < 0) {
    throw new Error('invalid wav data size');
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error('invalid sample rate');
  }

  const header = Buffer.alloc(WAV_HEADER_BYTES);
  const byteRate = sampleRate * WAV_CHANNELS * (WAV_BITS_PER_SAMPLE / 8);
  const blockAlign = WAV_CHANNELS * (WAV_BITS_PER_SAMPLE / 8);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(WAV_CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(WAV_BITS_PER_SAMPLE, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}

export function encodePcm16(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const raw = samples[index] ?? 0;
    if (!Number.isFinite(raw)) {
      continue;
    }
    const value = Math.max(-1, Math.min(1, raw));
    const pcm = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
    data.writeInt16LE(pcm, index * 2);
  }
  return data;
}

export function encodeWavMono16(samples: Float32Array, sampleRate: number): Buffer {
  const data = encodePcm16(samples);
  return Buffer.concat([createWavHeader(data.length, sampleRate), data]);
}

export type WavInfo = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
  duration: number;
};

export async function readWavInfo(path: string): Promise<WavInfo> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    const headerSize = Math.min(info.size, 1024 * 1024);
    const header = Buffer.alloc(headerSize);
    const result = await handle.read(header, 0, headerSize, 0);
    if (
      result.bytesRead < 12 ||
      header.toString('ascii', 0, 4) !== 'RIFF' ||
      header.toString('ascii', 8, 12) !== 'WAVE'
    ) {
      throw new Error('unsupported wav file');
    }

    let offset = 12;
    let channels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let dataOffset = -1;
    let dataSize = 0;

    while (offset + 8 <= result.bytesRead) {
      const id = header.toString('ascii', offset, offset + 4);
      const size = header.readUInt32LE(offset + 4);
      const body = offset + 8;
      if (id === 'fmt ') {
        if (body + 16 > result.bytesRead) {
          throw new Error('truncated wav fmt chunk');
        }
        const audioFormat = header.readUInt16LE(body);
        if (audioFormat !== 1 && audioFormat !== 0xfffe) {
          throw new Error('unsupported wav encoding');
        }
        channels = header.readUInt16LE(body + 2);
        sampleRate = header.readUInt32LE(body + 4);
        bitsPerSample = header.readUInt16LE(body + 14);
      } else if (id === 'data') {
        dataOffset = body;
        dataSize = size;
        break;
      }
      offset = body + size + (size % 2);
    }

    if (
      dataOffset < 0 ||
      sampleRate <= 0 ||
      channels <= 0 ||
      bitsPerSample <= 0
    ) {
      throw new Error('invalid wav header');
    }
    const available = Math.max(0, Math.min(dataSize, info.size - dataOffset));
    return {
      sampleRate,
      channels,
      bitsPerSample,
      dataOffset,
      dataSize: available,
      duration: available / (sampleRate * channels * (bitsPerSample / 8)),
    };
  } finally {
    await handle.close();
  }
}
