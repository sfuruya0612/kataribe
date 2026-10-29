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

function measure(audioContext, audioTrack, durationMs) {
  return new Promise((resolve) => {
    const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    let frames = 0;
    let nonZero = 0;
    let peak = 0;
    let sumSquares = 0;
    const startedAt = performance.now();

    const interval = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      for (const value of samples) {
        const absolute = Math.abs(value);
        if (absolute > peak) peak = absolute;
        if (absolute > 0) nonZero += 1;
        sumSquares += value * value;
        frames += 1;
      }
    }, 100);

    setTimeout(() => {
      clearInterval(interval);
      source.disconnect();
      resolve({
        elapsedMs: Math.round(performance.now() - startedAt),
        peak,
        rms: Math.sqrt(sumSquares / Math.max(frames, 1)),
        frames,
        nonZero,
        readyState: audioTrack.readyState,
        muted: audioTrack.muted,
      });
    }, durationMs);
  });
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
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((track) => track.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices
      .filter((device) => device.kind === 'audioinput')
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
    report({ phase: 'devices', inputs });

    const blackHole = devices.find(
      (device) => device.kind === 'audioinput' && /blackhole/i.test(device.label),
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

function measureMany(context, entries, durationMs, onProgress) {
  return new Promise((resolve) => {
    const stats = {};
    for (const entry of entries) {
      stats[entry.name] = {
        peak: 0,
        rms: 0,
        frames: 0,
        nonZero: 0,
        sumSquares: 0,
      };
    }
    const samples = new Float32Array(2048);
    const startedAt = performance.now();

    const interval = setInterval(() => {
      for (const entry of entries) {
        entry.analyser.getFloatTimeDomainData(samples);
        const current = stats[entry.name];
        for (const value of samples) {
          const absolute = Math.abs(value);
          if (absolute > current.peak) current.peak = absolute;
          if (absolute > 0) current.nonZero += 1;
          current.sumSquares += value * value;
          current.frames += 1;
        }
      }
    }, 100);

    const progress = onProgress
      ? setInterval(() => {
          const snapshot = {};
          for (const [name, current] of Object.entries(stats)) {
            snapshot[name] = {
              peak: current.peak,
              frames: current.frames,
              nonZero: current.nonZero,
            };
          }
          onProgress(Math.round(performance.now() - startedAt), snapshot);
        }, 60000)
      : null;

    setTimeout(() => {
      clearInterval(interval);
      if (progress) clearInterval(progress);
      for (const entry of entries) {
        const current = stats[entry.name];
        current.rms = Math.sqrt(current.sumSquares / Math.max(current.frames, 1));
        delete current.sumSquares;
      }
      resolve(stats);
    }, durationMs);
  });
}

async function startMix(durationMs = 5000) {
  report({ phase: 'mix_start', durationMs });

  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((track) => track.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices
      .filter((device) => device.kind === 'audioinput')
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
    report({ phase: 'devices', inputs });

    const blackHole = devices.find(
      (device) => device.kind === 'audioinput' && /blackhole/i.test(device.label),
    );
    const microphone = devices.find(
      (device) =>
        device.kind === 'audioinput'
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

    const audioContext = new AudioContext();
    await audioContext.resume();

    const blackHoleSource = audioContext.createMediaStreamSource(blackHoleStream);
    const microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
    const blackHoleAnalyser = audioContext.createAnalyser();
    const microphoneAnalyser = audioContext.createAnalyser();
    const mixedAnalyser = audioContext.createAnalyser();
    blackHoleAnalyser.fftSize = 2048;
    microphoneAnalyser.fftSize = 2048;
    mixedAnalyser.fftSize = 2048;

    const mixedGain = audioContext.createGain();
    mixedGain.gain.value = 0.5;
    const sink = audioContext.createGain();
    sink.gain.value = 0;

    blackHoleSource.connect(blackHoleAnalyser);
    microphoneSource.connect(microphoneAnalyser);
    blackHoleSource.connect(mixedGain);
    microphoneSource.connect(mixedGain);
    mixedGain.connect(mixedAnalyser);
    mixedAnalyser.connect(sink);
    sink.connect(audioContext.destination);

    const stats = await measureMany(
      audioContext,
      [
        { name: 'blackhole', analyser: blackHoleAnalyser },
        { name: 'microphone', analyser: microphoneAnalyser },
        { name: 'mixed', analyser: mixedAnalyser },
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
