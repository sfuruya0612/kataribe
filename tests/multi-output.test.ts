import { describe, expect, it, vi } from 'vitest';
import type { BinaryLocator } from '../src/main/media';
import { MultiOutputController } from '../src/main/multi-output';
import type { RunProcessResult } from '../src/main/process';

function result(stdout: string, overrides: Partial<RunProcessResult> = {}): RunProcessResult {
  return {
    code: 0,
    signal: null,
    stdout,
    stderr: '',
    timedOut: false,
    aborted: false,
    ...overrides,
  };
}

const listJson = JSON.stringify({
  currentOutput: {
    id: 97,
    name: 'MacBook Pro のスピーカー',
    uid: 'BuiltInSpeakerDevice',
    channels: 2,
  },
  devices: [
    {
      id: 97,
      name: 'MacBook Pro のスピーカー',
      uid: 'BuiltInSpeakerDevice',
      channels: 2,
    },
    {
      id: 79,
      name: 'BlackHole 2ch',
      uid: 'BlackHole2ch_UID',
      channels: 2,
    },
    {
      id: 120,
      name: 'Kataribe Multi-Output',
      uid: 'KataribeAggregate',
      channels: 2,
    },
  ],
});

const helperLocator = {
  multiOutputPath: async () => '/fake/kataribe-multi-output',
} as unknown as BinaryLocator;

describe('MultiOutputController', () => {
  it('lists output devices and detects an existing Multi-Output', async () => {
    const runner = vi.fn(async () => result(listJson));
    const controller = new MultiOutputController({
      locator: helperLocator,
      runner: runner as never,
      platform: 'darwin',
    });
    const status = await controller.status();
    expect(status.helperAvailable).toBe(true);
    expect(status.currentOutput?.name).toContain('MacBook Pro');
    expect(status.outputDevices).toHaveLength(3);
    expect(status.multiOutput).toMatchObject({
      uid: 'KataribeAggregate',
      name: 'Kataribe Multi-Output',
    });
  });

  it('creates a Multi-Output using the selected output and BlackHole', async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce(result(listJson))
      .mockResolvedValueOnce(
        result(
          JSON.stringify({
            id: 130,
            name: 'Kataribe Multi-Output',
            uid: 'NewAggregate',
            channels: 2,
          }),
        ),
      )
      .mockResolvedValueOnce(
        result(
          JSON.stringify({
            currentOutput: {
              id: 130,
              name: 'Kataribe Multi-Output',
              uid: 'NewAggregate',
              channels: 2,
            },
            devices: [
              {
                id: 130,
                name: 'Kataribe Multi-Output',
                uid: 'NewAggregate',
                channels: 2,
              },
            ],
          }),
        ),
      );
    const controller = new MultiOutputController({
      locator: helperLocator,
      runner: runner as never,
      platform: 'darwin',
    });
    const status = await controller.create('BuiltInSpeakerDevice');
    expect(runner.mock.calls[1][0].args).toEqual([
      'create',
      'BuiltInSpeakerDevice',
      'BlackHole2ch_UID',
    ]);
    expect(status.currentOutput?.uid).toBe('NewAggregate');
  });

  it('rejects BlackHole as the main output device', async () => {
    const runner = vi.fn(async () => result(listJson));
    const controller = new MultiOutputController({
      locator: helperLocator,
      runner: runner as never,
      platform: 'darwin',
    });
    await expect(controller.create('BlackHole2ch_UID')).rejects.toThrow(
      'BlackHole 2ch',
    );
  });

  it('removes the Multi-Output helper device', async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce(result(JSON.stringify({ removed: 1 })))
      .mockResolvedValueOnce(result(listJson));
    const controller = new MultiOutputController({
      locator: helperLocator,
      runner: runner as never,
      platform: 'darwin',
    });
    await controller.remove();
    expect(runner.mock.calls[0][0].args).toEqual(['remove']);
  });

  it('reports an unavailable helper', async () => {
    const controller = new MultiOutputController({
      locator: {
        multiOutputPath: async () => {
          throw new Error('helper not found');
        },
      } as unknown as BinaryLocator,
      runner: vi.fn() as never,
      platform: 'darwin',
    });
    const status = await controller.status();
    expect(status.helperAvailable).toBe(false);
    expect(status.error).toContain('helper not found');
  });
});
