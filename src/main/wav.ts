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

export type WavChunk = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  startByte: number;
  byteLength: number;
};

export type WavChunkOptions = {
  maxBytes: number;
  chunkSeconds: number;
  silenceSearchSeconds?: number;
};

const BYTES_PER_SAMPLE = 2;
const SILENCE_FRAME_SECONDS = 0.02;

export async function planWavChunks(
  path: string,
  info: WavInfo,
  options: WavChunkOptions,
): Promise<WavChunk[]> {
  const bytesPerSecond = info.sampleRate * info.channels * (info.bitsPerSample / 8);
  const maxDuration = Math.min(
    options.chunkSeconds,
    options.maxBytes / Math.max(1, bytesPerSecond),
  );
  if (!(maxDuration > 0) || !(info.duration > 0)) {
    return [];
  }
  const blockAlign = Math.max(1, info.channels * (info.bitsPerSample / 8));
  const searchSeconds = Math.max(
    0,
    Math.min(options.silenceSearchSeconds ?? 5, maxDuration / 2),
  );
  const chunks: WavChunk[] = [];
  let startSeconds = 0;
  let index = 0;
  while (startSeconds < info.duration - 1e-6) {
    const targetEnd = Math.min(info.duration, startSeconds + maxDuration);
    const endSeconds =
      targetEnd >= info.duration - 1e-6
        ? info.duration
        : await findQuietBoundary(
            path,
            info,
            startSeconds,
            targetEnd,
            searchSeconds,
            blockAlign,
            bytesPerSecond,
          );
    const startByte = alignByte(startSeconds * bytesPerSecond, blockAlign);
    const endByte = alignByte(endSeconds * bytesPerSecond, blockAlign);
    const byteLength = Math.min(
      endByte - startByte,
      Math.max(0, info.dataSize - startByte),
    );
    if (byteLength <= 0) {
      break;
    }
    chunks.push({
      index,
      startSeconds: startByte / bytesPerSecond,
      endSeconds: (startByte + byteLength) / bytesPerSecond,
      startByte,
      byteLength,
    });
    index += 1;
    startSeconds = (startByte + byteLength) / bytesPerSecond;
    if (index > 10_000) {
      throw new Error('wav chunk plan exceeded the limit');
    }
  }
  return chunks;
}

function alignByte(value: number, blockAlign: number): number {
  return Math.floor(value / blockAlign) * blockAlign;
}

async function findQuietBoundary(
  path: string,
  info: WavInfo,
  startSeconds: number,
  targetSeconds: number,
  searchSeconds: number,
  blockAlign: number,
  bytesPerSecond: number,
): Promise<number> {
  if (
    searchSeconds <= 0 ||
    info.bitsPerSample !== 16 ||
    info.channels < 1
  ) {
    return targetSeconds;
  }
  const fromSeconds = Math.max(
    startSeconds + 0.5,
    targetSeconds - searchSeconds,
  );
  if (targetSeconds - fromSeconds <= 0) {
    return targetSeconds;
  }
  const startByte = alignByte(fromSeconds * bytesPerSecond, blockAlign);
  const endByte = alignByte(targetSeconds * bytesPerSecond, blockAlign);
  const byteLength = endByte - startByte;
  if (byteLength <= 0) {
    return targetSeconds;
  }
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(byteLength);
    await handle.read(buffer, 0, byteLength, info.dataOffset + startByte);
    const frameBytes = Math.max(
      blockAlign,
      alignByte(bytesPerSecond * SILENCE_FRAME_SECONDS, blockAlign),
    );
    const frames: Array<{ offset: number; energy: number }> = [];
    for (let offset = 0; offset + frameBytes <= buffer.length; offset += frameBytes) {
      let energy = 0;
      for (let sample = 0; sample < frameBytes; sample += BYTES_PER_SAMPLE) {
        const value = buffer.readInt16LE(offset + sample);
        energy += value * value;
      }
      frames.push({ offset, energy });
    }
    if (frames.length === 0) {
      return targetSeconds;
    }
    const quietestEnergy = frames.reduce(
      (minimum, frame) => Math.min(minimum, frame.energy),
      Number.POSITIVE_INFINITY,
    );
    // 同じ程度に静かな区間が複数あるときは、目標の境界に最も近いものを選ぶ。
    const threshold = quietestEnergy * 1.05 + 1;
    let quietestOffset = 0;
    for (const frame of frames) {
      if (frame.energy <= threshold) {
        quietestOffset = frame.offset;
      }
    }
    const boundary = startByte + quietestOffset + Math.floor(frameBytes / 2);
    return Math.max(
      startSeconds + 0.5,
      Math.min(targetSeconds, boundary / bytesPerSecond),
    );
  } finally {
    await handle.close();
  }
}

export async function writeWavChunk(
  path: string,
  info: WavInfo,
  chunk: WavChunk,
  outputPath: string,
): Promise<void> {
  if (chunk.byteLength <= 0) {
    throw new Error('wav chunk is empty');
  }
  const source = await open(path, 'r');
  const target = await open(outputPath, 'w', 0o600);
  try {
    const data = Buffer.alloc(chunk.byteLength);
    await source.read(data, 0, chunk.byteLength, info.dataOffset + chunk.startByte);
    await target.write(createWavHeader(data.length, info.sampleRate), 0, WAV_HEADER_BYTES, 0);
    await target.write(data, 0, data.length, WAV_HEADER_BYTES);
  } finally {
    await source.close().catch(() => undefined);
    await target.close().catch(() => undefined);
  }
}

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
