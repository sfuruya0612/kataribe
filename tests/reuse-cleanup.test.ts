/**
 * 音声強調の一時ファイル、容量、無効化、会議削除を検証する。
 * 対応する要求: REQ-ENHANCE-001、REQ-ENHANCE-002、共通基盤
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EnhancementFile } from '../src/shared/types';
import { MeetingStore } from '../src/main/meetings';
import {
  writeMeetingMeta,
  type MeetingMeta,
} from '../src/main/meeting-meta';
import {
  EnhancementDiskSpaceError,
  assertEnhancementDiskSpace,
  cleanupMeetingTemp,
  cleanupOrphanedTempDirs,
  deleteAllSavedAudio,
  invalidateEnhancement,
  reconcileEnhancement,
  scanSavedAudioUsage,
  shouldKeepRecoveryData,
} from '../src/main/reuse-cleanup';
import {
  createEnhancementFile,
  readEnhancementFile,
  writeEnhancementFile,
} from '../src/main/reuse-metadata';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-reuse-cleanup-'));
  roots.push(root);
  const saveRoot = join(root, 'Kataribe');
  const tempRoot = join(root, 'tmp');
  const meetingId = '00000000-0000-4000-8000-0000000000dd';
  const meetingDir = join(saveRoot, '2026', '2026-11-03_1200_強調テスト');
  await mkdir(join(meetingDir), { recursive: true });
  await mkdir(join(tempRoot, meetingId), { recursive: true });
  return { root, saveRoot, tempRoot, meetingId, meetingDir };
}

function metaFixture(meetingId: string, status: MeetingMeta['status']): MeetingMeta {
  return {
    schema_version: 1,
    id: meetingId,
    status,
    title: '強調テスト',
    started_at: '2026-11-03T00:00:00.000Z',
    duration: 60,
    source: { input: 'both' },
    sample_rate: 48_000,
    channels: 1,
    bits_per_sample: 16,
    chunks: [],
    expected_samples: 0,
    actual_samples: 0,
    app_version: '0.1.0',
    audio_path: 'audio.mp3',
  };
}

function enhancementFixture(): EnhancementFile {
  const source = {
    path: 'audio.mp3',
    sha256: 'a'.repeat(64),
    sample_rate: 44_100,
    channels: 1,
  };
  const file = createEnhancementFile(source);
  file.saved_audio.nemotronlabs = {
    state: 'succeeded',
    model_sha256: 'b'.repeat(64),
    input: source,
    output: {
      path: 'audio.enhanced.nemotronlabs.mp3',
      sha256: 'c'.repeat(64),
    },
    settings: { chunk_seconds: 5, hop_seconds: 2.5, crossfade_seconds: 0.5 },
    started_at: null,
    finished_at: null,
    elapsed_seconds: null,
    error: null,
  };
  file.transcription.source_input_sha256 = 'd'.repeat(64);
  file.transcription.raw = {
    ...file.transcription.raw,
    state: 'succeeded',
    path: 'transcript.raw.md',
    input_sha256: 'd'.repeat(64),
    output_sha256: 'e'.repeat(64),
    chars: 10,
  };
  file.transcription.models.nemotronlabs = {
    ...file.transcription.raw,
    path: 'transcript.nemotronlabs.md',
    output_sha256: 'f'.repeat(64),
  };
  file.transcription.primary = {
    source: 'nemotronlabs',
    path: 'transcript.md',
  };
  return file;
}

async function writeMeetingDerivatives(
  meetingDir: string,
  meetingId: string,
  status: MeetingMeta['status'],
) {
  await writeMeetingMeta(join(meetingDir, 'meta.json'), metaFixture(meetingId, status));
  await writeFile(join(meetingDir, 'audio.mp3'), 'audio');
  await writeFile(
    join(meetingDir, 'audio.enhanced.nemotronlabs.mp3'),
    'enhanced audio',
  );
  await writeFile(join(meetingDir, 'transcript.md'), '# transcript');
  await writeFile(join(meetingDir, 'transcript.previous.md'), '# previous');
  await writeFile(join(meetingDir, 'transcript.raw.md'), '# raw');
  await writeFile(
    join(meetingDir, 'transcript.nemotronlabs.md'),
    '# enhanced',
  );
  await writeEnhancementFile(meetingDir, enhancementFixture());
}

describe('cleanupMeetingTemp', () => {
  it('removes a completed meeting tmp directory', async () => {
    const { tempRoot, meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'summarized');
    await writeFile(join(tempRoot, meetingId, 'audio.16k.wav'), '16k');
    await writeFile(join(tempRoot, meetingId, 'audio.16k.enhanced.wav'), 'enh');
    await writeFile(join(tempRoot, meetingId, 'audio.decoded.wav'), 'dec');
    await mkdir(join(tempRoot, meetingId, 'chunks'));
    await writeFile(join(tempRoot, meetingId, 'chunks', '0.wav'), 'chunk');

    await cleanupMeetingTemp(tempRoot, meetingId, meetingDir);
    await expect(stat(join(tempRoot, meetingId))).rejects.toThrow();
  });

  it('keeps chunks and the 16 kHz WAV after an error', async () => {
    const { tempRoot, meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'error');
    await writeFile(join(tempRoot, meetingId, 'audio.16k.wav'), '16k');
    await writeFile(join(tempRoot, meetingId, 'audio.16k.enhanced.wav'), 'enh');
    await writeFile(join(tempRoot, meetingId, 'audio.decoded.wav'), 'dec');
    await mkdir(join(tempRoot, meetingId, 'chunks'));
    await writeFile(join(tempRoot, meetingId, 'chunks', '0.wav'), 'chunk');

    await cleanupMeetingTemp(tempRoot, meetingId, meetingDir);
    expect(await readFile(join(tempRoot, meetingId, 'audio.16k.wav'), 'utf8')).toBe(
      '16k',
    );
    expect(
      await readFile(join(tempRoot, meetingId, 'chunks', '0.wav'), 'utf8'),
    ).toBe('chunk');
    await expect(
      stat(join(tempRoot, meetingId, 'audio.16k.enhanced.wav')),
    ).rejects.toThrow();
    await expect(
      stat(join(tempRoot, meetingId, 'audio.decoded.wav')),
    ).rejects.toThrow();
  });

  it('keeps recovery data while one side of a comparison is incomplete', async () => {
    const { tempRoot, meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'transcribed');
    const file = (await readEnhancementFile(meetingDir)).state === 'ok'
      ? (await readEnhancementFile(meetingDir))
      : null;
    if (file?.state !== 'ok') {
      throw new Error('enhancement fixture is missing');
    }
    const enhancedEntry = file.file.transcription.models.nemotronlabs;
    if (!enhancedEntry) {
      throw new Error('enhanced transcription fixture is missing');
    }
    file.file.transcription.models.nemotronlabs = {
      ...enhancedEntry,
      state: 'pending',
    };
    await writeEnhancementFile(meetingDir, file.file);
    await writeFile(join(tempRoot, meetingId, 'audio.16k.wav'), '16k');

    const meta = metaFixture(meetingId, 'transcribed');
    expect(shouldKeepRecoveryData(meta, file.file)).toBe(true);
    await cleanupMeetingTemp(tempRoot, meetingId, meetingDir);
    expect(await readFile(join(tempRoot, meetingId, 'audio.16k.wav'), 'utf8')).toBe(
      '16k',
    );
  });

  it('keeps recovery data when transcription is partial', async () => {
    const { tempRoot, meetingId, meetingDir } = await createWorkspace();
    const meta = metaFixture(meetingId, 'transcribed');
    meta.transcription = { state: 'partial' };
    await writeMeetingMeta(join(meetingDir, 'meta.json'), meta);
    await writeFile(join(tempRoot, meetingId, 'audio.16k.wav'), '16k');
    await cleanupMeetingTemp(tempRoot, meetingId, meetingDir);
    expect(
      await readFile(join(tempRoot, meetingId, 'audio.16k.wav'), 'utf8'),
    ).toBe('16k');
  });
});

describe('cleanupOrphanedTempDirs', () => {
  it('keeps recoverable meetings and removes orphaned or completed ones', async () => {
    const { saveRoot, tempRoot, meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'error');
    await mkdir(join(tempRoot, meetingId), { recursive: true });
    await writeFile(join(tempRoot, meetingId, 'audio.16k.wav'), '16k');

    const completedId = '00000000-0000-4000-8000-0000000000de';
    const completedDir = join(saveRoot, '2026', '2026-11-03_1300_完了');
    await mkdir(completedDir, { recursive: true });
    await writeMeetingMeta(
      join(completedDir, 'meta.json'),
      metaFixture(completedId, 'summarized'),
    );
    await mkdir(join(tempRoot, completedId), { recursive: true });
    await writeFile(join(tempRoot, completedId, 'audio.16k.wav'), 'done');

    const orphanId = '00000000-0000-4000-8000-0000000000df';
    await mkdir(join(tempRoot, orphanId), { recursive: true });
    await mkdir(join(tempRoot, 'children'), { recursive: true });
    await writeFile(join(tempRoot, 'children', 'keep.txt'), 'keep');

    const store = new MeetingStore(saveRoot);
    const removed = await cleanupOrphanedTempDirs(tempRoot, store);
    expect(removed.sort()).toEqual([completedId, orphanId].sort());
    expect(await stat(join(tempRoot, meetingId))).toBeTruthy();
    await expect(stat(join(tempRoot, completedId))).rejects.toThrow();
    await expect(stat(join(tempRoot, orphanId))).rejects.toThrow();
    expect(await readFile(join(tempRoot, 'children', 'keep.txt'), 'utf8')).toBe(
      'keep',
    );
  });
});

describe('assertEnhancementDiskSpace', () => {
  it('accepts enough space and rejects too little with the required sizes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kataribe-disk-'));
    roots.push(root);
    await expect(
      assertEnhancementDiskSpace(100, root, {
        freeBytes: async () => 1024 * 1024 * 1024,
      }),
    ).resolves.toMatchObject({ requiredBytes: 300 + 64 * 1024 * 1024 });

    let error: unknown = null;
    try {
      await assertEnhancementDiskSpace(100, root, {
        freeBytes: async () => 1,
      });
    } catch (reason) {
      error = reason;
    }
    expect(error).toBeInstanceOf(EnhancementDiskSpaceError);
    expect((error as EnhancementDiskSpaceError).requiredBytes).toBe(
      300 + 64 * 1024 * 1024,
    );
    expect((error as EnhancementDiskSpaceError).availableBytes).toBe(1);
  });
});

describe('invalidateEnhancement', () => {
  it('deletes only saved audio for the saved-audio scope', async () => {
    const { meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'summarized');
    await invalidateEnhancement(meetingDir, 'saved-audio', 'test');
    await expect(
      stat(join(meetingDir, 'audio.enhanced.nemotronlabs.mp3')),
    ).rejects.toThrow();
    expect(await readFile(join(meetingDir, 'transcript.raw.md'), 'utf8')).toBe(
      '# raw',
    );
    expect(await readFile(join(meetingDir, 'transcript.previous.md'), 'utf8')).toBe(
      '# previous',
    );
    const read = await readEnhancementFile(meetingDir);
    expect(read.state === 'ok' ? read.file.saved_audio : null).toEqual({});
    expect(read.state === 'ok' ? read.file.transcription.raw.state : null).toBe(
      'succeeded',
    );
  });

  it('deletes comparison transcripts while keeping saved audio and transcript.md', async () => {
    const { meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'summarized');
    await invalidateEnhancement(meetingDir, 'comparison', 'test');
    await expect(
      stat(join(meetingDir, 'transcript.raw.md')),
    ).rejects.toThrow();
    await expect(
      stat(join(meetingDir, 'transcript.nemotronlabs.md')),
    ).rejects.toThrow();
    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toBe(
      '# transcript',
    );
    expect(
      await readFile(join(meetingDir, 'audio.enhanced.nemotronlabs.mp3'), 'utf8'),
    ).toBe('enhanced audio');
    const read = await readEnhancementFile(meetingDir);
    expect(read.state === 'ok' ? read.file.transcription.raw.state : null).toBe(
      'pending',
    );
    expect(read.state === 'ok' ? read.file.saved_audio.nemotronlabs?.state : null)
      .toBe('succeeded');
  });

  it('deletes the previous transcript for the all scope', async () => {
    const { meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'summarized');
    await invalidateEnhancement(meetingDir, 'all', 'test');
    await expect(
      stat(join(meetingDir, 'transcript.previous.md')),
    ).rejects.toThrow();
    await expect(
      stat(join(meetingDir, 'audio.enhanced.nemotronlabs.mp3')),
    ).rejects.toThrow();
    expect(await readFile(join(meetingDir, 'transcript.md'), 'utf8')).toBe(
      '# transcript',
    );
  });
});

describe('reconcileEnhancement', () => {
  const modelSha = 'b'.repeat(64);

  it('removes all derivatives when audio.mp3 changed', async () => {
    const { meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'summarized');
    expect(
      await reconcileEnhancement(meetingDir, {
        audioSha256: 'z'.repeat(64),
      }),
    ).toBe('all');
    await expect(
      stat(join(meetingDir, 'audio.enhanced.nemotronlabs.mp3')),
    ).rejects.toThrow();
    await expect(
      stat(join(meetingDir, 'transcript.raw.md')),
    ).rejects.toThrow();
  });

  it('removes all derivatives when the model weights changed', async () => {
    const { meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'summarized');
    expect(
      await reconcileEnhancement(meetingDir, {
        audioSha256: 'a'.repeat(64),
        modelSha256: { nemotronlabs: 'z'.repeat(64) },
      }),
    ).toBe('all');
  });

  it('removes only comparison files when the comparison input changed', async () => {
    const { meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'summarized');
    expect(
      await reconcileEnhancement(meetingDir, {
        audioSha256: 'a'.repeat(64),
        modelSha256: { nemotronlabs: modelSha },
        comparisonInputSha256: 'z'.repeat(64),
      }),
    ).toBe('comparison');
    expect(
      await readFile(join(meetingDir, 'audio.enhanced.nemotronlabs.mp3'), 'utf8'),
    ).toBe('enhanced audio');
    await expect(
      stat(join(meetingDir, 'transcript.raw.md')),
    ).rejects.toThrow();
  });

  it('removes comparison files when enhancement is disabled or OpenAI is selected', async () => {
    const { meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'summarized');
    expect(
      await reconcileEnhancement(meetingDir, {
        audioSha256: 'a'.repeat(64),
        modelSha256: { nemotronlabs: modelSha },
        comparisonEnabled: false,
      }),
    ).toBe('comparison');
    await writeMeetingDerivatives(meetingDir, meetingId, 'summarized');
    expect(
      await reconcileEnhancement(meetingDir, {
        audioSha256: 'a'.repeat(64),
        modelSha256: { nemotronlabs: modelSha },
        transcriptionEngine: 'openai',
      }),
    ).toBe('comparison');
  });

  it('keeps the files when nothing changed', async () => {
    const { meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'summarized');
    expect(
      await reconcileEnhancement(meetingDir, {
        audioSha256: 'a'.repeat(64),
        modelSha256: { nemotronlabs: modelSha },
        comparisonInputSha256: 'd'.repeat(64),
      }),
    ).toBeNull();
    expect(
      await readFile(join(meetingDir, 'transcript.raw.md'), 'utf8'),
    ).toBe('# raw');
  });
});

describe('saved audio usage and meeting deletion', () => {
  it('sums the sizes of enhanced audio and deletes them all', async () => {
    const { saveRoot, tempRoot, meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'summarized');
    const store = new MeetingStore(saveRoot, tempRoot);
    expect(await scanSavedAudioUsage(store)).toEqual({
      bytes: Buffer.byteLength('enhanced audio'),
      meetings: 1,
    });
    expect(await deleteAllSavedAudio(store)).toEqual({
      bytes: Buffer.byteLength('enhanced audio'),
      meetings: 1,
    });
    await expect(
      stat(join(meetingDir, 'audio.enhanced.nemotronlabs.mp3')),
    ).rejects.toThrow();
    expect(await scanSavedAudioUsage(store)).toEqual({ bytes: 0, meetings: 0 });
  });

  it('removes the meeting folder and its tmp directory', async () => {
    const { saveRoot, tempRoot, meetingId, meetingDir } = await createWorkspace();
    await writeMeetingDerivatives(meetingDir, meetingId, 'summarized');
    await mkdir(join(tempRoot, meetingId), { recursive: true });
    const store = new MeetingStore(saveRoot, tempRoot);
    await store.delete(meetingId);
    await expect(stat(meetingDir)).rejects.toThrow();
    await expect(stat(join(tempRoot, meetingId))).rejects.toThrow();
  });
});
