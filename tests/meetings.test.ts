import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeWavMono16 } from '../src/main/wav';
import { MeetingStore } from '../src/main/meetings';

const roots: string[] = [];

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-meetings-'));
  roots.push(root);
  return { root, store: new MeetingStore(root) };
}

async function createMeeting(
  root: string,
  id: string,
  overrides: Record<string, unknown> = {},
  audio?: Buffer,
) {
  const meetingDir = join(root, '2026', `2026-10-29_1400_${id}`);
  await mkdir(meetingDir, { recursive: true });
  const meta = {
    schema_version: 1,
    id,
    status: 'encoding',
    title: '週次定例',
    started_at: '2026-10-29T05:00:00.000Z',
    duration: 0.1,
    source: { input: 'both' },
    sample_rate: 48000,
    chunks: [{ sequence: 1, file: '000001.wav', frames: 4800 }],
    actual_samples: 4800,
    expected_samples: 4800,
    audio_path: 'audio.wav',
    ...overrides,
  };
  await writeFile(join(meetingDir, 'meta.json'), JSON.stringify(meta));
  if (audio) {
    await writeFile(join(meetingDir, 'audio.wav'), audio);
  }
  return meetingDir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('MeetingStore', () => {
  it('lists meetings from meta.json and generates audio URLs', async () => {
    const { root, store } = await createStore();
    await createMeeting(root, '00000000-0000-4000-8000-000000000001', {}, Buffer.alloc(44));

    const meetings = await store.list();
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      title: '週次定例',
      status: 'encoding',
      inputSource: 'both',
      sampleRate: 48000,
      duration: 0.1,
      chunkCount: 1,
    });
    expect(meetings[0].audioUrl).toContain('kataribe-audio://meeting/');
  });

  it('returns null when audio.wav is missing', async () => {
    const { root, store } = await createStore();
    const meetingDir = await createMeeting(
      root,
      '00000000-0000-4000-8000-000000000002',
    );
    await rm(join(meetingDir, 'audio.wav'), { force: true });

    const meetings = await store.list();
    expect(meetings[0].audioUrl).toBeNull();
    expect(await store.audioPath(meetings[0].id)).toBeNull();
  });

  it('computes a waveform from the wav file', async () => {
    const { root, store } = await createStore();
    const samples = new Float32Array(4800);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = index < 2400 ? 0.8 : 0.1;
    }
    const meetingDir = await createMeeting(
      root,
      '00000000-0000-4000-8000-000000000003',
      {},
      encodeWavMono16(samples, 48000),
    );

    const waveform = await store.waveform(
      '00000000-0000-4000-8000-000000000003',
      24,
    );
    expect(waveform.peaks).toHaveLength(24);
    expect(waveform.duration).toBeCloseTo(0.1, 5);
    expect(Math.max(...waveform.peaks)).toBeCloseTo(1, 5);
    expect(waveform.peaks[0]).toBeGreaterThan(waveform.peaks.at(-1) ?? 0);

    expect(await store.audioPath('00000000-0000-4000-8000-000000000003')).toBe(
      join(meetingDir, 'audio.wav'),
    );
  });

  it('ignores folders without a readable meta.json', async () => {
    const { root, store } = await createStore();
    await mkdir(join(root, '2026', 'broken'), { recursive: true });
    expect(await store.list()).toEqual([]);
  });

  it('returns an empty waveform for an unknown meeting', async () => {
    const { store } = await createStore();
    expect(await store.waveform('missing')).toEqual({ peaks: [], duration: 0 });
  });
});
