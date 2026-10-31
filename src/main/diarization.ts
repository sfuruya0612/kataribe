import { open } from 'node:fs/promises';
import type { TranscriptSegment } from '../shared/markdown';
import { readWavInfo } from './wav';

type WindowFeatures = {
  rms: number;
  zcr: number;
  pitchHz: number;
};

type SegmentFeatures = {
  rms: number;
  zcr: number;
  pitchHz: number;
};

export type DiarizationOptions = {
  windowSamples?: number;
  windowsPerSegment?: number;
  maxSegments?: number;
};

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function analyzeWindow(samples: Float32Array, sampleRate: number): WindowFeatures {
  if (samples.length < 32) {
    return { rms: 0, zcr: 0, pitchHz: 0 };
  }
  let mean = 0;
  for (const value of samples) {
    mean += value;
  }
  mean /= samples.length;

  let sumSquares = 0;
  let crossings = 0;
  let previous = 0;
  const centered = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] - mean;
    centered[index] = value;
    sumSquares += value * value;
    if (index > 0 && (value >= 0) !== (previous >= 0)) {
      crossings += 1;
    }
    previous = value;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  const zcr = crossings / Math.max(1, samples.length - 1);

  let pitchHz = 0;
  if (rms > 0.003) {
    const minLag = Math.max(2, Math.floor(sampleRate / 800));
    const maxLag = Math.min(centered.length - 2, Math.ceil(sampleRate / 70));
    let bestScore = 0;
    const scores: number[] = new Array(maxLag + 1).fill(0);
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let correlation = 0;
      let energyLeft = 0;
      let energyRight = 0;
      for (let index = 0; index + lag < centered.length; index += 1) {
        const left = centered[index];
        const right = centered[index + lag];
        correlation += left * right;
        energyLeft += left * left;
        energyRight += right * right;
      }
      const denominator = Math.sqrt(energyLeft * energyRight);
      const score = denominator > 0 ? correlation / denominator : 0;
      scores[lag] = score;
      if (score > bestScore) {
        bestScore = score;
      }
    }
    if (bestScore >= 0.28) {
      for (let lag = minLag; lag <= maxLag; lag += 1) {
        if (scores[lag] >= bestScore * 0.9) {
          pitchHz = sampleRate / lag;
          break;
        }
      }
    }
  }
  return { rms, zcr, pitchHz };
}

export async function diarizeSegments(
  wavPath: string,
  segments: TranscriptSegment[],
  options: DiarizationOptions = {},
): Promise<TranscriptSegment[] | null> {
  const usable = segments.filter(
    (segment) =>
      segment.text.trim().length > 0 &&
      (segment.endSeconds ?? segment.startSeconds) > segment.startSeconds,
  );
  if (usable.length < 4) {
    return null;
  }
  const maxSegments = options.maxSegments ?? 400;
  if (usable.length > maxSegments) {
    return null;
  }

  const info = await readWavInfo(wavPath);
  if (info.channels !== 1 || info.bitsPerSample !== 16 || info.sampleRate <= 0) {
    return null;
  }
  const windowSamples = options.windowSamples ?? 1024;
  const windowsPerSegment = options.windowsPerSegment ?? 8;
  const handle = await open(wavPath, 'r');
  const buffer = Buffer.alloc(windowSamples * 2);
  const features: SegmentFeatures[] = [];
  try {
    for (const segment of usable) {
      const start = Math.max(0, segment.startSeconds);
      const end = Math.min(
        info.duration,
        segment.endSeconds ?? segment.startSeconds + 1,
      );
      const duration = Math.max(0, end - start);
      const frameStart = Math.floor(start * info.sampleRate);
      const frameEnd = Math.max(frameStart + 1, Math.floor(end * info.sampleRate));
      const windowList: WindowFeatures[] = [];
      const span = Math.max(0, frameEnd - frameStart - windowSamples);
      const positions =
        span <= 0
          ? [frameStart]
          : Array.from({ length: windowsPerSegment }, (_, index) =>
              frameStart +
              Math.floor((span * (index + 0.5)) / Math.max(1, windowsPerSegment)),
            );
      for (const position of positions) {
        const bytes = Math.min(
          windowSamples * 2,
          Math.max(0, (info.dataOffset + frameEnd * 2) - (info.dataOffset + position * 2)),
        );
        if (bytes < 64) {
          continue;
        }
        const result = await handle.read(
          buffer,
          0,
          bytes,
          info.dataOffset + position * 2,
        );
        if (result.bytesRead < 64) {
          continue;
        }
        const samples = new Float32Array(Math.floor(result.bytesRead / 2));
        for (let index = 0; index < samples.length; index += 1) {
          samples[index] = buffer.readInt16LE(index * 2) / 32768;
        }
        windowList.push(analyzeWindow(samples, info.sampleRate));
      }
      if (windowList.length === 0) {
        features.push({ rms: 0, zcr: 0, pitchHz: 0 });
        continue;
      }
      const voiced = windowList
        .map((window) => window.pitchHz)
        .filter((pitch) => pitch > 0);
      features.push({
        rms: median(windowList.map((window) => window.rms)),
        zcr: median(windowList.map((window) => window.zcr)),
        pitchHz: voiced.length >= 2 ? median(voiced) : 0,
      });
      if (duration <= 0) {
        features[features.length - 1] = { rms: 0, zcr: 0, pitchHz: 0 };
      }
    }
  } finally {
    await handle.close();
  }

  const rows = features.map((feature) => [
    Math.log10(feature.rms + 1e-6),
    feature.zcr,
    feature.pitchHz > 0 ? feature.pitchHz / 220 : 0,
  ]);
  const means = [0, 0, 0];
  const stds = [0, 0, 0];
  for (let column = 0; column < 3; column += 1) {
    means[column] =
      rows.reduce((sum, row) => sum + row[column], 0) / rows.length;
    const variance =
      rows.reduce(
        (sum, row) => sum + (row[column] - means[column]) ** 2,
        0,
      ) / rows.length;
    stds[column] = Math.sqrt(variance);
  }
  const normalized = rows.map((row) =>
    row.map((value, column) =>
      stds[column] > 1e-6 ? (value - means[column]) / stds[column] : 0,
    ),
  );

  let centroidA = [...normalized[0]];
  let farthest = 0;
  let farthestDistance = -1;
  for (let index = 1; index < normalized.length; index += 1) {
    const distance = Math.sqrt(
      normalized[index].reduce(
        (sum, value, column) => sum + (value - centroidA[column]) ** 2,
        0,
      ),
    );
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthest = index;
    }
  }
  if (farthestDistance < 0.5) {
    return null;
  }
  let centroidB = [...normalized[farthest]];
  let assignments: number[] = [];
  for (let iteration = 0; iteration < 20; iteration += 1) {
    assignments = normalized.map((row) => {
      const distanceAValue = Math.sqrt(
        row.reduce((sum, value, column) => sum + (value - centroidA[column]) ** 2, 0),
      );
      const distanceBValue = Math.sqrt(
        row.reduce((sum, value, column) => sum + (value - centroidB[column]) ** 2, 0),
      );
      return distanceAValue <= distanceBValue ? 0 : 1;
    });
    const groups = [0, 1].map((group) =>
      normalized.filter((_row, index) => assignments[index] === group),
    );
    if (groups[0].length === 0 || groups[1].length === 0) {
      return null;
    }
    const nextA = [0, 0, 0].map(
      (_value, column) =>
        groups[0].reduce((sum, row) => sum + row[column], 0) / groups[0].length,
    );
    const nextB = [0, 0, 0].map(
      (_value, column) =>
        groups[1].reduce((sum, row) => sum + row[column], 0) / groups[1].length,
    );
    const shift = Math.max(
      Math.sqrt(
        nextA.reduce((sum, value, column) => sum + (value - centroidA[column]) ** 2, 0),
      ),
      Math.sqrt(
        nextB.reduce((sum, value, column) => sum + (value - centroidB[column]) ** 2, 0),
      ),
    );
    centroidA = nextA;
    centroidB = nextB;
    if (shift < 0.001) {
      break;
    }
  }

  const counts = [0, 0];
  for (const assignment of assignments) {
    counts[assignment] += 1;
  }
  const separation = Math.sqrt(
    centroidA.reduce(
      (sum, value, column) => sum + (value - centroidB[column]) ** 2,
      0,
    ),
  );
  if (counts[0] < 2 || counts[1] < 2 || separation < 0.75) {
    return null;
  }

  const firstOccurrence = new Map<number, number>();
  for (const assignment of assignments) {
    if (!firstOccurrence.has(assignment)) {
      firstOccurrence.set(assignment, firstOccurrence.size);
    }
  }
  if (firstOccurrence.size < 2) {
    return null;
  }

  const bySegment = new Map<TranscriptSegment, number>();
  let usableIndex = 0;
  for (const segment of segments) {
    if (usable.includes(segment)) {
      bySegment.set(segment, assignments[usableIndex]);
      usableIndex += 1;
    }
  }
  return segments.map((segment) => {
    const cluster = bySegment.get(segment);
    if (cluster === undefined) {
      return segment;
    }
    const order = firstOccurrence.get(cluster) ?? 0;
    return {
      ...segment,
      speaker: order === 0 ? '話者A' : '話者B',
    };
  });
}
