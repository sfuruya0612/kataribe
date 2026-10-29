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
