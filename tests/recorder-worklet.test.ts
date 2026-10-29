import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type PostedMessage = {
  type: 'level' | 'chunk' | 'stopped' | 'gap';
  peak?: number;
  rms?: number;
  sequence?: number;
  frames?: number;
  sampleRate?: number;
  expectedFrames?: number;
  gaps?: number;
  maxGapFrames?: number;
  missedFrames?: number;
  samples?: Float32Array;
  stats?: {
    frames: number;
    expectedFrames: number;
    gaps: number;
    maxGapFrames: number;
    missedFrames: number;
    sampleRate: number;
    channels: number;
    currentTime: number;
  };
  finalChunk?: {
    sequence: number;
    frames: number;
    sampleRate: number;
    expectedFrames: number;
    samples: Float32Array;
  } | null;
};

type ProcessorLike = {
  port: {
    postMessage: (message: PostedMessage) => void;
    onmessage: ((event: { data: unknown }) => void) | null;
  };
  process: (inputs: Float32Array[][]) => boolean;
};

type ProcessorConstructor = new (options: {
  processorOptions: { chunkSeconds: number };
}) => ProcessorLike;

type Harness = {
  processor: ProcessorLike;
  messages: PostedMessage[];
  setFrame: (frame: number) => void;
};

function loadProcessor(chunkSeconds = 10): Harness {
  const messages: PostedMessage[] = [];
  const registry: { processorClass: ProcessorConstructor | null } = {
    processorClass: null,
  };

  const context = {
    sampleRate: 48000,
    currentFrame: 0,
    currentTime: 0,
    AudioWorkletProcessor: class {
      port: {
        postMessage: (message: PostedMessage) => void;
        onmessage: ((event: { data: unknown }) => void) | null;
      };

      constructor() {
        this.port = {
          postMessage: (message: PostedMessage) => {
            messages.push(message);
          },
          onmessage: null,
        };
      }
    },
    registerProcessor: (name: string, ctor: ProcessorConstructor) => {
      if (name !== 'recorder-processor') {
        throw new Error(`unexpected processor name: ${name}`);
      }
      registry.processorClass = ctor;
    },
  };

  const source = readFileSync(
    fileURLToPath(new URL('../src/renderer/public/recorder-worklet.js', import.meta.url)),
    'utf8',
  );
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'recorder-worklet.js' });

  const ProcessorClass = registry.processorClass;
  if (!ProcessorClass) {
    throw new Error('processor was not registered');
  }

  const processor = new ProcessorClass({ processorOptions: { chunkSeconds } });

  return {
    processor,
    messages,
    setFrame: (frame) => {
      context.currentFrame = frame;
      context.currentTime = frame / context.sampleRate;
    },
  };
}

function block(
  harness: Harness,
  startFrame: number,
  channels: Float32Array[] = [new Float32Array(128).fill(0.1)],
): boolean {
  harness.setFrame(startFrame);
  return harness.processor.process([channels]);
}

function stop(harness: Harness): void {
  harness.processor.port.onmessage?.({ data: { type: 'stop' } });
}

describe('recorder worklet', () => {
  it('flushes a 10 second chunk and includes the final chunk in the stopped message', () => {
    const harness = loadProcessor();
    for (let index = 0; index < 3750; index += 1) {
      expect(block(harness, index * 128)).toBe(true);
    }

    const chunks = harness.messages.filter((message) => message.type === 'chunk');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      sequence: 1,
      frames: 480000,
      sampleRate: 48000,
      expectedFrames: 480000,
    });

    stop(harness);
    expect(block(harness, 480000)).toBe(false);

    const stopped = harness.messages.filter((message) => message.type === 'stopped');
    expect(stopped).toHaveLength(1);
    expect(stopped[0].finalChunk).toMatchObject({
      sequence: 2,
      frames: 128,
      sampleRate: 48000,
    });
    expect(stopped[0].stats?.frames).toBe(480128);
    expect(stopped[0].stats?.expectedFrames).toBe(480128);
  });

  it('does not post another stopped message when process is called again', () => {
    const harness = loadProcessor();
    block(harness, 0);
    stop(harness);
    expect(block(harness, 128)).toBe(false);

    const messageCount = harness.messages.length;
    expect(harness.messages.filter((message) => message.type === 'stopped')).toHaveLength(1);

    expect(block(harness, 256)).toBe(false);
    expect(harness.messages.length).toBe(messageCount);
    expect(harness.messages.filter((message) => message.type === 'stopped')).toHaveLength(1);
  });

  it('does not create a final chunk when there is no pending audio', () => {
    const harness = loadProcessor();
    for (let index = 0; index < 3750; index += 1) {
      block(harness, index * 128);
    }

    stop(harness);
    expect(block(harness, 480000, [])).toBe(false);

    const stopped = harness.messages.filter((message) => message.type === 'stopped');
    expect(stopped).toHaveLength(1);
    expect(stopped[0].finalChunk).toBeNull();
    expect(stopped[0].stats?.frames).toBe(480000);
  });

  it('downmixes stereo input to mono', () => {
    const harness = loadProcessor();
    const left = new Float32Array(128).fill(0.5);
    const right = new Float32Array(128).fill(-0.5);

    block(harness, 0, [left, right]);
    stop(harness);
    block(harness, 128, [left, right]);

    const stopped = harness.messages.find((message) => message.type === 'stopped');
    expect(stopped?.finalChunk?.samples[0]).toBe(0);
    expect(stopped?.finalChunk?.samples[127]).toBe(0);
    expect(stopped?.stats?.channels).toBe(2);
  });

  it('counts missed frames when the audio clock jumps', () => {
    const harness = loadProcessor();
    block(harness, 0);
    block(harness, 256);
    for (let index = 0; index < 40; index += 1) {
      block(harness, 384 + index * 128);
    }

    const levels = harness.messages.filter((message) => message.type === 'level');
    expect(levels.length).toBeGreaterThan(0);
    const last = levels.at(-1);
    expect(last).toMatchObject({
      gaps: 1,
      maxGapFrames: 128,
      missedFrames: 128,
      sampleRate: 48000,
      channels: 1,
    });
  });

  it('emits a silence gap before post-resume audio', () => {
    const harness = loadProcessor();
    block(harness, 0);
    harness.processor.port.onmessage?.({ data: { type: 'insertGap', frames: 960 } });
    block(harness, 128);

    const gapIndex = harness.messages.findIndex((message) => message.type === 'gap');
    const chunkIndex = harness.messages.findIndex((message) => message.type === 'chunk');
    expect(gapIndex).toBeGreaterThanOrEqual(0);
    expect(chunkIndex).toBeGreaterThanOrEqual(0);
    expect(chunkIndex).toBeLessThan(gapIndex);
    expect(harness.messages[gapIndex].frames).toBe(960);
  });

  it('reports peak and RMS at the level interval', () => {
    const harness = loadProcessor();
    for (let index = 0; index < 38; index += 1) {
      block(harness, index * 128);
    }

    const levels = harness.messages.filter((message) => message.type === 'level');
    expect(levels.length).toBeGreaterThan(0);
    expect(levels[0].peak).toBeCloseTo(0.1, 5);
    expect(levels[0].rms).toBeCloseTo(0.1, 5);
  });
});
