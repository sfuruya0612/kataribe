import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  RecordingCaptureStats,
  RecordingChunk,
  RecordingEvent,
} from '../shared/types';
import { RecordingManager } from './recording';

type Fixture = {
  root: string;
  saveRoot: string;
  tempRoot: string;
  manager: RecordingManager;
  blockerStarts: number;
  blockerStops: number[];
};

const fixtures: string[] = [];

async function createFixture(now = new Date(2026, 9, 29, 14, 5, 30)): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-recording-'));
  fixtures.push(root);
  const saveRoot = join(root, 'Kataribe');
  const tempRoot = join(root, 'tmp');
  const blockerStops: number[] = [];
  let blockerStarts = 0;
  const manager = new RecordingManager({
    saveRoot,
    tempRoot,
    appVersion: '0.1.0',
    now: () => now,
    blocker: {
      start: () => {
        blockerStarts += 1;
        return blockerStarts;
      },
      stop: (id) => {
        blockerStops.push(id);
      },
    },
  });

  return {
    root,
    saveRoot,
    tempRoot,
    manager,
    get blockerStarts() {
      return blockerStarts;
    },
    blockerStops,
  };
}

function createChunk(
  sequence: number,
  frames: number,
  expectedFrames = frames,
  sampleRate = 48000,
): RecordingChunk {
  return {
    sequence,
    frames,
    expectedFrames,
    sampleRate,
    samples: new Float32Array(frames).fill(0.25),
  };
}

function createStats(
  frames: number,
  expectedFrames: number,
  sampleRate = 48000,
): RecordingCaptureStats {
  return {
    frames,
    expectedFrames,
    gaps: 0,
    maxGapFrames: 0,
    missedFrames: Math.max(0, expectedFrames - frames),
    sampleRate,
    channels: 1,
    currentTime: expectedFrames / sampleRate,
  };
}

function readMeta(meetingDir: string): Promise<Record<string, unknown>> {
  return readFile(join(meetingDir, 'meta.json'), 'utf8').then(
    (text) => JSON.parse(text) as Record<string, unknown>,
  );
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('RecordingManager', () => {
  it('starts a session and writes meta.json', async () => {
    const fixture = await createFixture();

    const session = await fixture.manager.start({
      inputSource: 'both',
      sampleRate: 48000,
      microphoneLabel: 'FIFINE K670',
      systemLabel: 'BlackHole 2ch',
      clippingConfig: {
        peakThreshold: 0.99,
        intervalsToWarn: 4,
        recoveryIntervals: 6,
      },
      silenceConfig: {
        windowSeconds: 4,
        rmsThreshold: 0.004,
        graceSeconds: 20,
      },
    });

    expect(session.meetingId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(session.meetingDir).toBe(
      join(fixture.saveRoot, '2026', '2026-10-29_1405_タイトル未入力'),
    );

    const meta = await readMeta(session.meetingDir);
    expect(meta.schema_version).toBe(1);
    expect(meta.id).toBe(session.meetingId);
    expect(meta.status).toBe('recording');
    expect(meta.title).toBe('タイトル未入力');
    expect(meta.started_at).toBe(new Date(2026, 9, 29, 14, 5, 30).toISOString());
    expect(meta.duration).toBe(0);
    expect(meta.sample_rate).toBe(48000);
    expect(meta.channels).toBe(1);
    expect(meta.bits_per_sample).toBe(16);
    expect(meta.chunks).toEqual([]);
    expect(meta.actual_samples).toBe(0);
    expect(meta.expected_samples).toBe(0);
    expect(meta.events).toEqual([]);
    expect(meta.clipping_config).toEqual({
      peakThreshold: 0.99,
      intervalsToWarn: 4,
      recoveryIntervals: 6,
    });
    expect(meta.silence_config).toEqual({
      windowSeconds: 4,
      rmsThreshold: 0.004,
      graceSeconds: 20,
    });
    expect(meta.app_version).toBe('0.1.0');
    expect(meta.source).toEqual({
      input: 'both',
      microphone: 'FIFINE K670',
      system: 'BlackHole 2ch',
    });

    expect(fixture.blockerStarts).toBe(1);
    expect((await stat(session.meetingDir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(session.meetingDir, 'meta.json'))).mode & 0o777).toBe(0o600);
    expect((await readdir(fixture.tempRoot)).length).toBe(1);
  });

  it('writes wav chunks in order and merges them on stop', async () => {
    const fixture = await createFixture();
    const session = await fixture.manager.start({
      inputSource: 'microphone',
      sampleRate: 48000,
    });

    await fixture.manager.appendChunk(createChunk(1, 480, 512));
    await fixture.manager.appendChunk(createChunk(2, 240, 512));

    const chunksDir = join(fixture.tempRoot, session.meetingId, 'chunks');
    expect((await readdir(chunksDir)).sort()).toEqual(['000001.wav', '000002.wav']);
    expect((await stat(join(chunksDir, '000001.wav'))).size).toBe(44 + 480 * 2);

    const metaWhileRecording = await readMeta(session.meetingDir);
    expect(metaWhileRecording.status).toBe('recording');
    expect(metaWhileRecording.actual_samples).toBe(720);
    expect(metaWhileRecording.expected_samples).toBe(512);
    expect(metaWhileRecording.duration).toBeCloseTo(0.015, 6);

    const result = await fixture.manager.stop(
      createStats(720, 1024),
    );

    expect(result.status).toBe('encoding');
    expect(result.hadChunkFailure).toBe(false);
    expect(result.actualSamples).toBe(720);
    expect(result.expectedSamples).toBe(1024);
    expect(result.captureStats?.missedFrames).toBe(304);

    const merged = await readFile(result.audioPath);
    expect(merged.length).toBe(44 + 720 * 2);
    expect(merged.toString('ascii', 0, 4)).toBe('RIFF');
    expect(merged.readUInt32LE(4)).toBe(36 + 720 * 2);
    expect(merged.toString('ascii', 8, 12)).toBe('WAVE');
    expect(merged.readUInt16LE(22)).toBe(1);
    expect(merged.readUInt32LE(24)).toBe(48000);
    expect(merged.readUInt32LE(40)).toBe(720 * 2);
    expect(merged.readInt16LE(44)).toBe(8192);
    expect(merged.readInt16LE(44 + 720 * 2 - 2)).toBe(8192);

    const meta = await readMeta(session.meetingDir);
    expect(meta.status).toBe('encoding');
    expect(meta.audio_path).toBe('audio.wav');
    expect(meta.ended_at).toBe(new Date(2026, 9, 29, 14, 5, 30).toISOString());
    expect(meta.actual_samples).toBe(720);
    expect(meta.expected_samples).toBe(1024);
    expect(meta.capture_stats).toEqual({
      frames: 720,
      expected_frames: 1024,
      gaps: 0,
      max_gap_frames: 0,
      missed_frames: 304,
      sample_rate: 48000,
      channels: 1,
      current_time: 1024 / 48000,
    });

    expect(await readdir(join(fixture.tempRoot))).toEqual([]);
    expect(fixture.blockerStops).toEqual([1]);
    expect((await readdir(session.meetingDir)).sort()).toEqual([
      'audio.wav',
      'meta.json',
    ]);
    expect((await stat(result.audioPath)).mode & 0o777).toBe(0o600);
  });

  it('serializes concurrent chunk writes', async () => {
    const fixture = await createFixture();
    const session = await fixture.manager.start({
      inputSource: 'system',
      sampleRate: 48000,
    });

    await Promise.all([
      fixture.manager.appendChunk(createChunk(1, 480)),
      fixture.manager.appendChunk(createChunk(2, 240)),
    ]);

    const meta = await readMeta(session.meetingDir);
    expect(meta.actual_samples).toBe(720);
    expect((meta.chunks as Array<{ sequence: number; file: string }>).map((chunk) => ({
      sequence: chunk.sequence,
      file: chunk.file,
    }))).toEqual([
      { sequence: 1, file: '000001.wav' },
      { sequence: 2, file: '000002.wav' },
    ]);
  });

  it('rejects duplicate starts, out-of-order chunks, and mismatched samples', async () => {
    const fixture = await createFixture();
    await fixture.manager.start({
      inputSource: 'microphone',
      sampleRate: 48000,
    });

    await expect(
      fixture.manager.start({ inputSource: 'microphone', sampleRate: 48000 }),
    ).rejects.toThrow('a recording is already in progress');

    await expect(
      fixture.manager.appendChunk({ ...createChunk(1, 480), sequence: 0 }),
    ).rejects.toThrow('chunk sequence is invalid');
    await expect(
      fixture.manager.appendChunk(createChunk(1, 480, 480, 44100)),
    ).rejects.toThrow('chunk sample rate does not match the session');
    await expect(
      fixture.manager.appendChunk({
        ...createChunk(1, 480),
        samples: new Float32Array(479),
      }),
    ).rejects.toThrow('chunk frame count does not match sample count');

    await expect(fixture.manager.appendChunk(createChunk(5, 480))).resolves.toEqual({
      file: '000001.wav',
      frames: 480,
    });
  });

  it('assigns sequential files to chunks received in source order', async () => {
    const fixture = await createFixture();
    const session = await fixture.manager.start({
      inputSource: 'microphone',
      sampleRate: 48000,
    });

    await fixture.manager.appendChunk(createChunk(5, 480));
    await fixture.manager.appendChunk(createChunk(2, 240));

    const meta = await readMeta(session.meetingDir);
    expect(
      (meta.chunks as Array<{ sequence: number; file: string }>).map((chunk) => ({
        sequence: chunk.sequence,
        file: chunk.file,
      })),
    ).toEqual([
      { sequence: 1, file: '000001.wav' },
      { sequence: 2, file: '000002.wav' },
    ]);
  });

  it('inserts a silence gap and keeps expected samples aligned', async () => {
    const fixture = await createFixture();
    const session = await fixture.manager.start({
      inputSource: 'system',
      sampleRate: 48000,
    });

    await fixture.manager.appendChunk(createChunk(1, 480, 480));
    await fixture.manager.appendGap(960);
    await fixture.manager.appendChunk(createChunk(2, 240, 720));

    const metaWhileRecording = await readMeta(session.meetingDir);
    expect(metaWhileRecording.actual_samples).toBe(1680);
    expect(metaWhileRecording.expected_samples).toBe(1680);
    expect(metaWhileRecording.gap_samples).toBe(960);

    const result = await fixture.manager.stop(createStats(720, 720));
    expect(result.actualSamples).toBe(1680);
    expect(result.expectedSamples).toBe(1680);

    const merged = await readFile(result.audioPath);
    expect(merged.length).toBe(44 + 1680 * 2);
    const gapStart = 44 + 480 * 2;
    expect(merged.subarray(gapStart, gapStart + 960 * 2).every((value) => value === 0)).toBe(
      true,
    );
  });

  it('rejects a gap without an active recording', async () => {
    const fixture = await createFixture();
    await expect(fixture.manager.appendGap(480)).rejects.toThrow(
      'no recording is in progress',
    );
  });

  it('marks a stop without chunks as an error and removes the temporary session', async () => {
    const fixture = await createFixture();
    const session = await fixture.manager.start({
      inputSource: 'microphone',
      sampleRate: 48000,
    });

    await expect(fixture.manager.stop()).rejects.toThrow('no audio chunks were recorded');

    const meta = await readMeta(session.meetingDir);
    expect(meta.status).toBe('error');
    expect(fixture.manager.getState().status).toBe('error');
    expect(await readdir(fixture.tempRoot)).toEqual([]);
    expect(fixture.blockerStops).toEqual([1]);
  });

  it('uses a suffix when the meeting folder already exists', async () => {
    const fixture = await createFixture();
    const first = await fixture.manager.start({
      inputSource: 'microphone',
      sampleRate: 48000,
    });
    await fixture.manager.appendChunk(createChunk(1, 100));
    await fixture.manager.stop();

    const second = await fixture.manager.start({
      inputSource: 'microphone',
      sampleRate: 48000,
    });

    expect(first.meetingDir).toContain('2026-10-29_1405_タイトル未入力');
    expect(second.meetingDir).toContain('2026-10-29_1405_タイトル未入力_2');
  });

  it('lists and recovers a session left behind after a crash', async () => {
    const fixture = await createFixture();
    const session = await fixture.manager.start({
      inputSource: 'both',
      sampleRate: 48000,
    });
    await fixture.manager.appendChunk(createChunk(1, 480, 512));
    await fixture.manager.appendChunk(createChunk(2, 480, 1024));

    const recoverable = await fixture.manager.listRecoverable();
    expect(recoverable).toEqual([
      {
        meetingId: session.meetingId,
        meetingDir: session.meetingDir,
        startedAt: new Date(2026, 9, 29, 14, 5, 30).toISOString(),
        inputSource: 'both',
        sampleRate: 48000,
        chunks: 2,
        actualSamples: 960,
      },
    ]);

    const recoveryManager = new RecordingManager({
      saveRoot: fixture.saveRoot,
      tempRoot: fixture.tempRoot,
      appVersion: '0.1.0',
      now: () => new Date(2026, 9, 29, 15, 0, 0),
      blocker: {
        start: () => 99,
        stop: () => undefined,
      },
    });
    const recovered = await recoveryManager.recover(session.meetingId);

    expect(recovered.status).toBe('encoding');
    expect(recovered.meetingDir).toBe(session.meetingDir);
    expect(recovered.actualSamples).toBe(960);
    expect(recovered.expectedSamples).toBe(1024);
    expect((await stat(recovered.audioPath)).size).toBe(44 + 960 * 2);

    const meta = await readMeta(session.meetingDir);
    expect(meta.status).toBe('encoding');
    expect(meta.audio_path).toBe('audio.wav');
    expect(meta.ended_at).toBe(new Date(2026, 9, 29, 15, 0, 0).toISOString());
    expect(await readdir(fixture.tempRoot)).toEqual([]);
  });

  it('records device events in meta.json', async () => {
    const fixture = await createFixture();
    const session = await fixture.manager.start({
      inputSource: 'both',
      sampleRate: 48000,
    });
    const event: RecordingEvent = {
      at: new Date(2026, 9, 29, 14, 5, 35).toISOString(),
      kind: 'device-lost',
      device: 'microphone',
      severity: 'warning',
      message: 'マイクが切断されました。システム音声の録音を続けます。',
    };

    expect(await fixture.manager.recordEvent(event)).toBe(true);
    let meta = await readMeta(session.meetingDir);
    expect(meta.events).toEqual([event]);

    await fixture.manager.appendChunk(createChunk(1, 100));
    await fixture.manager.stop();
    meta = await readMeta(session.meetingDir);
    expect(meta.events).toEqual([event]);
  });

  it('creates an error meta for a failed start', async () => {
    const fixture = await createFixture();
    const event: RecordingEvent = {
      at: new Date(2026, 9, 29, 14, 5, 30).toISOString(),
      kind: 'permission-denied',
      device: 'microphone',
      severity: 'error',
      message: 'マイクの使用が許可されていません。',
    };

    const failure = await fixture.manager.recordStartupFailure(
      {
        inputSource: 'microphone',
        sampleRate: 48000,
        microphoneLabel: 'FIFINE K670',
      },
      event,
    );

    expect(failure.meetingDir).toContain('2026-10-29_1405_タイトル未入力');
    const meta = await readMeta(failure.meetingDir);
    expect(meta.status).toBe('error');
    expect(meta.duration).toBe(0);
    expect(meta.chunks).toEqual([]);
    expect(meta.events).toEqual([event]);
    expect(meta.source).toEqual({
      input: 'microphone',
      microphone: 'FIFINE K670',
    });
    expect(fixture.manager.getState().status).toBe('error');
    expect(fixture.manager.getLastMeetingDir()).toBe(failure.meetingDir);
    expect((await stat(failure.metaPath)).mode & 0o777).toBe(0o600);
  });

  it('does not record an event without an active session', async () => {
    const fixture = await createFixture();
    expect(
      await fixture.manager.recordEvent({
        at: new Date().toISOString(),
        kind: 'device-lost',
        device: 'microphone',
        severity: 'warning',
        message: 'lost',
      }),
    ).toBe(false);
  });

  it('rejects a startup failure while recording', async () => {
    const fixture = await createFixture();
    await fixture.manager.start({ inputSource: 'microphone', sampleRate: 48000 });
    await expect(
      fixture.manager.recordStartupFailure(
        { inputSource: 'microphone', sampleRate: 48000 },
        {
          at: new Date().toISOString(),
          kind: 'permission-denied',
          device: 'microphone',
          severity: 'error',
          message: 'denied',
        },
      ),
    ).rejects.toThrow('a recording is already in progress');
  });

  it('rejects an invalid meeting id during recovery', async () => {
    const fixture = await createFixture();
    await expect(fixture.manager.recover('../../etc')).rejects.toThrow('invalid meeting id');
    await expect(
      fixture.manager.recover('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow();
  });
});
