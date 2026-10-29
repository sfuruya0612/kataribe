class RecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options.processorOptions || {};
    this.chunkFrames = Math.max(
      1,
      Math.round(sampleRate * (processorOptions.chunkSeconds || 10)),
    );
    this.levelIntervalFrames = Math.max(1, Math.round(sampleRate / 10));
    this.chunk = new Float32Array(this.chunkFrames);
    this.chunkOffset = 0;
    this.sequence = 0;
    this.frames = 0;
    this.expectedFrames = 0;
    this.gaps = 0;
    this.maxGapFrames = 0;
    this.firstFrame = null;
    this.lastFrame = null;
    this.lastBlockSize = 0;
    this.channels = 0;
    this.levelPeak = 0;
    this.levelSumSquares = 0;
    this.levelFrames = 0;
    this.stopping = false;
    this.stopped = false;

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'stop') {
        this.stopping = true;
      }
    };
  }

  process(inputs) {
    if (this.stopped) {
      return false;
    }

    const input = inputs[0] || [];
    const channels = input.length;
    const blockSize = channels > 0 ? input[0].length : 0;
    const frame = currentFrame;

    if (this.firstFrame === null) {
      this.firstFrame = frame;
    } else {
      const delta = frame - this.lastFrame;
      if (delta > this.lastBlockSize) {
        this.gaps += 1;
        this.maxGapFrames = Math.max(
          this.maxGapFrames,
          delta - this.lastBlockSize,
        );
      }
    }
    this.lastFrame = frame;
    this.lastBlockSize = blockSize;
    this.frames += blockSize;
    this.expectedFrames = this.lastFrame + this.lastBlockSize - this.firstFrame;
    this.channels = Math.max(this.channels, channels);

    for (let index = 0; index < blockSize; index += 1) {
      let sum = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        sum += input[channel][index];
      }
      const value = channels > 0 ? sum / channels : 0;

      this.chunk[this.chunkOffset] = value;
      this.chunkOffset += 1;

      const absolute = Math.abs(value);
      if (absolute > this.levelPeak) {
        this.levelPeak = absolute;
      }
      this.levelSumSquares += value * value;
      this.levelFrames += 1;

      if (this.chunkOffset >= this.chunkFrames) {
        this.flushChunk();
      }
      if (this.levelFrames >= this.levelIntervalFrames) {
        this.flushLevel();
      }
    }

    if (this.stopping) {
      this.stopped = true;
      const finalChunk = this.takeChunk();
      this.flushLevel();
      this.port.postMessage(
        {
          type: 'stopped',
          stats: this.snapshot(),
          finalChunk,
        },
        finalChunk ? [finalChunk.samples.buffer] : [],
      );
      return false;
    }

    return true;
  }

  takeChunk() {
    if (this.chunkOffset === 0) {
      return null;
    }
    this.sequence += 1;
    const samples = this.chunk.slice(0, this.chunkOffset);
    const chunk = {
      sequence: this.sequence,
      frames: samples.length,
      sampleRate,
      expectedFrames: this.expectedFrames,
      samples,
    };
    this.chunk = new Float32Array(this.chunkFrames);
    this.chunkOffset = 0;
    return chunk;
  }

  flushChunk() {
    const chunk = this.takeChunk();
    if (!chunk) {
      return;
    }
    this.port.postMessage(
      {
        type: 'chunk',
        ...chunk,
      },
      [chunk.samples.buffer],
    );
  }

  flushLevel() {
    if (this.levelFrames === 0) {
      return;
    }
    const rms = Math.sqrt(this.levelSumSquares / this.levelFrames);
    this.port.postMessage({
      type: 'level',
      peak: this.levelPeak,
      rms,
      frames: this.frames,
      expectedFrames: this.expectedFrames,
      gaps: this.gaps,
      maxGapFrames: this.maxGapFrames,
      missedFrames: Math.max(0, this.expectedFrames - this.frames),
      sampleRate,
      channels: this.channels,
      currentTime,
    });
    this.levelPeak = 0;
    this.levelSumSquares = 0;
    this.levelFrames = 0;
  }

  snapshot() {
    return {
      frames: this.frames,
      expectedFrames: this.expectedFrames,
      gaps: this.gaps,
      maxGapFrames: this.maxGapFrames,
      missedFrames: Math.max(0, this.expectedFrames - this.frames),
      sampleRate,
      channels: this.channels,
      currentTime,
    };
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
