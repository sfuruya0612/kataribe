/** 音声強調のチャンク計画。フレームは WAV のデータ先頭からのサンプル位置。 */
export type EnhancementChunk = {
  index: number;
  startFrame: number;
  endFrame: number;
  outputStartFrame: number;
  outputEndFrame: number;
};

/** 強調に使う PCM の情報。 */
export type EnhancementPcmInfo = {
  dataOffset: number;
  dataSize: number;
  channels: number;
};

export type EnhancementChunkOptions = {
  chunkSeconds?: number;
  hopSeconds?: number;
  crossfadeSeconds?: number;
};

export type EnhancementChunkPlan = {
  chunks: EnhancementChunk[];
  chunkFrames: number;
  hopFrames: number;
  crossfadeFrames: number;
  totalFrames: number;
};

const DEFAULT_CHUNK_SECONDS = 5;
const DEFAULT_HOP_SECONDS = 2.5;
const DEFAULT_CROSSFADE_SECONDS = 0.5;

export function pcmTotalFrames(info: EnhancementPcmInfo): number {
  const blockAlign = info.channels * 2;
  return blockAlign > 0 ? Math.floor(info.dataSize / blockAlign) : 0;
}

/**
 * 5 秒のチャンク、2.5 秒のホップ、0.5 秒のクロスフェードで出力区間を計画する。
 *
 * チャンクはモデルに渡す前後の文脈、出力区間は実際に書き出すホップ幅である。
 * 最後のチャンクは末尾に合わせ、出力区間が重複しないようにする。
 */
export function planEnhancementChunks(
  totalFrames: number,
  sampleRate: number,
  options: EnhancementChunkOptions = {},
): EnhancementChunkPlan {
  const chunkFrames = Math.max(
    1,
    Math.floor((options.chunkSeconds ?? DEFAULT_CHUNK_SECONDS) * sampleRate),
  );
  const hopFrames = Math.max(
    1,
    Math.floor((options.hopSeconds ?? DEFAULT_HOP_SECONDS) * sampleRate),
  );
  const crossfadeFrames = Math.min(
    hopFrames,
    Math.max(
      0,
      Math.floor((options.crossfadeSeconds ?? DEFAULT_CROSSFADE_SECONDS) * sampleRate),
    ),
  );
  if (totalFrames <= 0) {
    return { chunks: [], chunkFrames, hopFrames, crossfadeFrames, totalFrames: 0 };
  }
  if (totalFrames <= chunkFrames) {
    return {
      chunks: [
        {
          index: 0,
          startFrame: 0,
          endFrame: totalFrames,
          outputStartFrame: 0,
          outputEndFrame: totalFrames,
        },
      ],
      chunkFrames,
      hopFrames,
      crossfadeFrames,
      totalFrames,
    };
  }

  const chunks: EnhancementChunk[] = [];
  let outputStart = 0;
  while (outputStart < totalFrames) {
    const requestedEnd = Math.min(totalFrames, outputStart + hopFrames);
    const last = requestedEnd >= totalFrames;
    const startFrame = last
      ? Math.max(0, totalFrames - chunkFrames)
      : outputStart;
    chunks.push({
      index: chunks.length,
      startFrame,
      endFrame: Math.min(totalFrames, startFrame + chunkFrames),
      outputStartFrame: outputStart,
      outputEndFrame: requestedEnd,
    });
    outputStart = requestedEnd;
  }
  return {
    chunks,
    chunkFrames,
    hopFrames,
    crossfadeFrames,
    totalFrames,
  };
}

/** チャンクが読む WAV データのバイト範囲を返す。`endByte` は範囲に含む。 */
export function chunkByteRange(
  info: EnhancementPcmInfo,
  chunk: EnhancementChunk,
): { startByte: number; endByte: number } {
  const blockAlign = info.channels * 2;
  const startByte = info.dataOffset + chunk.startFrame * blockAlign;
  const endByte = info.dataOffset + chunk.endFrame * blockAlign - 1;
  return { startByte, endByte };
}

/** 16 bit PCM のバイト列をモノラルの Float32Array へ変換する。 */
export function mixPcm16ToMono(
  bytes: Uint8Array,
  channels: number,
): Float32Array {
  if (channels < 1) {
    throw new Error('channels must be positive');
  }
  const blockAlign = channels * 2;
  const frames = Math.floor(bytes.byteLength / blockAlign);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += view.getInt16(frame * blockAlign + channel * 2, true);
    }
    samples[frame] = sum / channels / 32768;
  }
  return samples;
}

/**
 * 前のチャンクの末尾と次のチャンクの先頭を線形にクロスフェードする。
 *
 * `blend` に渡したチャンクの先頭 `crossfadeFrames` だけを前の末尾と混ぜ、
 * 末尾は次のチャンク用に保持する。
 */
export class ChunkCrossfader {
  private readonly crossfadeFrames: number;
  private tail: Float32Array | null = null;

  constructor(crossfadeFrames: number) {
    this.crossfadeFrames = Math.max(0, Math.floor(crossfadeFrames));
  }

  blend(samples: Float32Array): Float32Array {
    const out = new Float32Array(samples.length);
    out.set(samples);
    if (this.tail !== null && this.crossfadeFrames > 0) {
      const length = Math.min(
        this.crossfadeFrames,
        out.length,
        this.tail.length,
      );
      for (let index = 0; index < length; index += 1) {
        const weight = (index + 1) / (length + 1);
        out[index] = this.tail[index] * (1 - weight) + samples[index] * weight;
      }
    }
    const tailLength = Math.min(this.crossfadeFrames, samples.length);
    this.tail =
      tailLength > 0
        ? samples.slice(samples.length - tailLength)
        : null;
    return out;
  }
}
