const statusElement = document.getElementById('status');

function report(payload) {
  if (window.m0 && window.m0.report) {
    window.m0.report(payload);
  }
  statusElement.textContent = JSON.stringify(payload, null, 2);
}

function trackInfo(track) {
  if (!track) return null;
  return {
    label: track.label,
    readyState: track.readyState,
    enabled: track.enabled,
    muted: track.muted,
    settings: track.getSettings(),
  };
}

async function listInputs() {
  const microphoneGranted = window.m0 && window.m0.askMicrophone
    ? await window.m0.askMicrophone()
    : false;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices
    .filter((device) => device.kind === 'audioinput')
    .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  report({ phase: 'devices', microphoneGranted, inputs });
  return devices;
}

const frameCounterWorkletSource = `
class FrameCounterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options.processorOptions || {};
    this.reportIntervalFrames = processorOptions.reportIntervalFrames || sampleRate;
    this.warmupFrames = processorOptions.warmupFrames || 0;
    this.warmupSeen = 0;
    this.started = this.warmupFrames === 0;
    this.stats = {
      name: processorOptions.name || 'input',
      sampleRate,
      channels: 0,
      blocks: 0,
      frames: 0,
      samples: 0,
      nonZero: 0,
      nonZeroFrames: 0,
      peak: 0,
      sumSquares: 0,
      gaps: 0,
      maxGapFrames: 0,
      firstFrame: null,
      lastFrame: null,
      lastBlockSize: 0,
      warmupFrames: processorOptions.warmupFrames || 0,
    };
    this.lastFrame = null;
    this.lastBlockSize = 0;
    this.framesSinceReport = 0;
    this.port.onmessage = (event) => {
      if (event.data === 'stop') {
        this.port.postMessage({ type: 'stopped', stats: this.snapshot() });
      }
    };
  }

  process(inputs) {
    const input = inputs[0] || [];
    const channels = input.length;
    const blockSize = channels > 0 ? input[0].length : 0;
    const frame = currentFrame;
    if (!this.started) {
      this.warmupSeen += blockSize;
      if (this.warmupSeen < this.warmupFrames) {
        return true;
      }
      this.started = true;
      this.stats.firstFrame = frame;
      this.lastFrame = frame;
      this.lastBlockSize = blockSize;
    }
    if (this.stats.firstFrame === null) {
      this.stats.firstFrame = frame;
    }
    if (this.lastFrame !== null) {
      const delta = frame - this.lastFrame;
      if (delta > this.lastBlockSize) {
        this.stats.gaps += 1;
        this.stats.maxGapFrames = Math.max(this.stats.maxGapFrames, delta - this.lastBlockSize);
      }
    }
    this.lastFrame = frame;
    this.lastBlockSize = blockSize;
    this.stats.lastFrame = frame;
    this.stats.lastBlockSize = blockSize;
    this.stats.blocks += 1;
    this.stats.frames += blockSize;
    this.stats.channels = Math.max(this.stats.channels, channels);
    let frameNonZero = false;
    for (let channel = 0; channel < channels; channel += 1) {
      const samples = input[channel];
      for (let index = 0; index < samples.length; index += 1) {
        const value = samples[index];
        const absolute = Math.abs(value);
        if (absolute > this.stats.peak) this.stats.peak = absolute;
        if (absolute > 0) {
          this.stats.nonZero += 1;
          frameNonZero = true;
        }
        this.stats.sumSquares += value * value;
        this.stats.samples += 1;
      }
    }
    if (frameNonZero) this.stats.nonZeroFrames += 1;
    this.framesSinceReport += blockSize;
    if (this.framesSinceReport >= this.reportIntervalFrames) {
      this.framesSinceReport = 0;
      this.port.postMessage({ type: 'progress', stats: this.snapshot() });
    }
    return true;
  }

  snapshot() {
    const expectedFrames = this.stats.firstFrame === null
      ? 0
      : this.stats.lastFrame + this.stats.lastBlockSize - this.stats.firstFrame;
    return {
      ...this.stats,
      expectedFrames,
      missedFrames: Math.max(0, expectedFrames - this.stats.frames),
      rms: Math.sqrt(this.stats.sumSquares / Math.max(this.stats.samples, 1)),
      elapsedAudioSeconds: expectedFrames / sampleRate,
      currentTime,
    };
  }
}

registerProcessor('frame-counter', FrameCounterProcessor);
`;

const workletModules = new WeakMap();

async function ensureFrameCounterModule(audioContext) {
  if (!workletModules.has(audioContext)) {
    const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(frameCounterWorkletSource)}`;
    workletModules.set(audioContext, audioContext.audioWorklet.addModule(url));
  }
  await workletModules.get(audioContext);
}

async function createFrameCounter(audioContext, source, name) {
  await ensureFrameCounterModule(audioContext);
  const node = new AudioWorkletNode(audioContext, 'frame-counter', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCountMode: 'max',
    processorOptions: {
      name,
      reportIntervalFrames: Math.max(1, Math.round(audioContext.sampleRate)),
      // 起動直後の 1 秒はカウンタの数え落としがあるため、ウォームアップとして除外する。
      warmupFrames: Math.max(0, Math.round(audioContext.sampleRate * 1)),
    },
  });
  const sink = audioContext.createGain();
  sink.gain.value = 0;
  source.connect(node);
  node.connect(sink);
  sink.connect(audioContext.destination);
  const state = {
    node,
    sink,
    stats: null,
    resolveStop: null,
  };
  node.port.onmessage = (event) => {
    const data = event.data || {};
    if (data.stats) {
      state.stats = data.stats;
    }
    if (data.type === 'stopped' && state.resolveStop) {
      state.resolveStop(data.stats || state.stats);
    }
  };
  return state;
}

function stopFrameCounter(state) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(state.stats), 2000);
    state.resolveStop = (stats) => {
      clearTimeout(timeout);
      resolve(stats || state.stats);
    };
    state.node.port.postMessage('stop');
  });
}

function disposeFrameCounter(state) {
  try {
    state.node.disconnect();
  } catch (_) {
    // already disconnected
  }
  try {
    state.sink.disconnect();
  } catch (_) {
    // already disconnected
  }
}

async function measure(audioContext, audioTrack, durationMs) {
  const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
  const counter = await createFrameCounter(audioContext, source, 'input');
  const startedAt = performance.now();

  await new Promise((resolve) => setTimeout(resolve, durationMs));
  const stats = await stopFrameCounter(counter);
  const elapsedMs = Math.round(performance.now() - startedAt);

  disposeFrameCounter(counter);
  source.disconnect();
  return {
    elapsedMs,
    ...stats,
    readyState: audioTrack.readyState,
    muted: audioTrack.muted,
  };
}

async function attemptCapture(attempt) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: { width: 2, height: 2, frameRate: 1 },
  });

  const audioTrack = stream.getAudioTracks()[0];
  const videoTrack = stream.getVideoTracks()[0];
  report({
    phase: 'stream',
    attempt,
    audioTrack: trackInfo(audioTrack),
    videoTrack: trackInfo(videoTrack),
  });

  if (!audioTrack || audioTrack.readyState === 'ended') {
    stream.getTracks().forEach((track) => track.stop());
    return { ok: false, reason: 'no live audio track' };
  }

  const audioContext = new AudioContext();
  await audioContext.resume();

  const before = await measure(audioContext, audioTrack, 5000);
  report({ phase: 'before_video_stop', attempt, ...before });

  if (videoTrack) {
    videoTrack.stop();
  }
  const after = await measure(audioContext, audioTrack, 3000);
  report({ phase: 'after_video_stop', attempt, ...after });

  audioTrack.stop();
  await audioContext.close();

  return {
    ok: before.peak > 0 || after.peak > 0,
    before,
    after,
    videoStopKeptAudio: after.peak > 0,
  };
}

async function startM0() {
  report({ phase: 'start' });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await attemptCapture(attempt);
      report({ phase: 'attempt_result', attempt, ...result });
      if (result.ok) {
        report({ phase: 'summary', done: true, ok: true, attempt, ...result });
        return;
      }
    } catch (error) {
      report({
        phase: 'attempt_error',
        attempt,
        error: String(error && error.stack ? error.stack : error),
        name: error && error.name,
        message: error && error.message,
      });
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  report({ phase: 'summary', done: true, ok: false });
}

async function startBlackHole(durationMs = 5000) {
  report({ phase: 'blackhole_start', durationMs });

  try {
    const devices = await listInputs();

    const blackHole = devices.find(
      (device) =>
        device.kind === 'audioinput'
        && device.deviceId !== 'default'
        && device.deviceId !== 'communications'
        && /blackhole/i.test(device.label),
    );
    if (!blackHole) {
      report({
        phase: 'blackhole_summary',
        done: true,
        ok: false,
        error: 'BlackHole input not found',
      });
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: blackHole.deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const audioTrack = stream.getAudioTracks()[0];
    report({ phase: 'blackhole_stream', track: trackInfo(audioTrack) });

    if (!audioTrack || audioTrack.readyState === 'ended') {
      stream.getTracks().forEach((track) => track.stop());
      report({
        phase: 'blackhole_summary',
        done: true,
        ok: false,
        error: 'BlackHole audio track is not live',
      });
      return;
    }

    const audioContext = new AudioContext();
    await audioContext.resume();
    const measured = await measure(audioContext, audioTrack, durationMs);
    report({ phase: 'blackhole_measure', ...measured });

    audioTrack.stop();
    await audioContext.close();
    report({
      phase: 'blackhole_summary',
      done: true,
      ok: measured.peak > 0,
      ...measured,
    });
  } catch (error) {
    report({
      phase: 'blackhole_summary',
      done: true,
      ok: false,
      error: String(error && error.stack ? error.stack : error),
      name: error && error.name,
      message: error && error.message,
    });
  }
}

async function measureMany(audioContext, entries, durationMs, onProgress) {
  const counters = [];
  for (const entry of entries) {
    counters.push({
      name: entry.name,
      counter: await createFrameCounter(audioContext, entry.source, entry.name),
    });
  }
  const startedAt = performance.now();

  const progress = onProgress
    ? setInterval(() => {
        const snapshot = {};
        for (const { name, counter } of counters) {
          snapshot[name] = counter.stats || {};
        }
        onProgress(Math.round(performance.now() - startedAt), snapshot);
      }, 60000)
    : null;

  await new Promise((resolve) => setTimeout(resolve, durationMs));
  if (progress) {
    clearInterval(progress);
  }

  const stats = {};
  for (const { name, counter } of counters) {
    stats[name] = await stopFrameCounter(counter);
    disposeFrameCounter(counter);
  }
  return stats;
}

async function startMix(durationMs = 5000) {
  report({ phase: 'mix_start', durationMs });

  try {
    const devices = await listInputs();

    const blackHole = devices.find(
      (device) =>
        device.kind === 'audioinput'
        && device.deviceId !== 'default'
        && device.deviceId !== 'communications'
        && /blackhole/i.test(device.label),
    );
    const microphone = devices.find(
      (device) =>
        device.kind === 'audioinput'
        && device.deviceId !== 'default'
        && device.deviceId !== 'communications'
        && /macbook|built-in|マイク|microphone/i.test(device.label)
        && !/blackhole/i.test(device.label),
    );

    if (!blackHole || !microphone) {
      report({
        phase: 'mix_summary',
        done: true,
        ok: false,
        error: 'BlackHole or microphone input not found',
      });
      return;
    }

    const blackHoleStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: blackHole.deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: microphone.deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    report({
      phase: 'mix_streams',
      blackhole: trackInfo(blackHoleStream.getAudioTracks()[0]),
      microphone: trackInfo(microphoneStream.getAudioTracks()[0]),
    });

    const audioContext = new AudioContext();
    await audioContext.resume();

    const blackHoleSource = audioContext.createMediaStreamSource(blackHoleStream);
    const microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
    const mixedGain = audioContext.createGain();
    mixedGain.gain.value = 0.5;
    const sink = audioContext.createGain();
    sink.gain.value = 0;

    blackHoleSource.connect(mixedGain);
    microphoneSource.connect(mixedGain);
    mixedGain.connect(sink);
    sink.connect(audioContext.destination);

    const stats = await measureMany(
      audioContext,
      [
        { name: 'blackhole', source: blackHoleSource },
        { name: 'microphone', source: microphoneSource },
        { name: 'mixed', source: mixedGain },
      ],
      durationMs,
      (elapsedMs, snapshot) => {
        report({ phase: 'mix_progress', elapsedMs, ...snapshot });
      },
    );

    report({ phase: 'mix_measure', ...stats });

    blackHoleStream.getTracks().forEach((track) => track.stop());
    microphoneStream.getTracks().forEach((track) => track.stop());
    await audioContext.close();

    report({
      phase: 'mix_summary',
      done: true,
      ok: stats.blackhole.peak > 0 && stats.microphone.peak > 0 && stats.mixed.peak > 0,
      ...stats,
    });
  } catch (error) {
    report({
      phase: 'mix_summary',
      done: true,
      ok: false,
      error: String(error && error.stack ? error.stack : error),
      name: error && error.name,
      message: error && error.message,
    });
  }
}

window.startM0 = startM0;
window.startBlackHole = startBlackHole;
window.startMix = startMix;
