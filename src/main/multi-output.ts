import type {
  AudioOutputDevice,
  MultiOutputStatus,
} from '../shared/types';
import type { BinaryLocator } from './media';
import { runProcess, ProcessStartError } from './process';

export const MULTI_OUTPUT_NAME = 'Kataribe Multi-Output';

type HelperList = {
  currentOutput?: AudioOutputDevice | null;
  devices?: AudioOutputDevice[];
};

function toDevice(value: unknown): AudioOutputDevice | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'number' ||
    typeof record.name !== 'string' ||
    typeof record.uid !== 'string' ||
    typeof record.channels !== 'number'
  ) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    uid: record.uid,
    channels: record.channels,
    isAggregate: record.isAggregate === true,
  };
}

function parseList(output: string): HelperList {
  const data = JSON.parse(output) as {
    currentOutput?: unknown;
    devices?: unknown;
  };
  return {
    currentOutput: toDevice(data.currentOutput),
    devices: Array.isArray(data.devices)
      ? data.devices.map(toDevice).filter((device): device is AudioOutputDevice => Boolean(device))
      : [],
  };
}

export type MultiOutputControllerOptions = {
  locator: BinaryLocator;
  runner?: typeof runProcess;
  platform?: NodeJS.Platform;
};

export class MultiOutputController {
  private readonly locator: BinaryLocator;
  private readonly runner: typeof runProcess;
  private readonly platform: NodeJS.Platform;

  constructor(options: MultiOutputControllerOptions) {
    this.locator = options.locator;
    this.runner = options.runner ?? runProcess;
    this.platform = options.platform ?? process.platform;
  }

  async status(): Promise<MultiOutputStatus> {
    if (this.platform !== 'darwin') {
      return {
        supported: false,
        helperAvailable: false,
        currentOutput: null,
        outputDevices: [],
        multiOutput: null,
        error: 'Multi-Output Device creation is supported only on macOS',
      };
    }
    let helper: string;
    try {
      helper = await this.locator.multiOutputPath();
    } catch (error) {
      return {
        supported: true,
        helperAvailable: false,
        currentOutput: null,
        outputDevices: [],
        multiOutput: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    try {
      const result = await this.runHelper(helper, ['list']);
      const list = parseList(result);
      return {
        supported: true,
        helperAvailable: true,
        currentOutput: list.currentOutput ?? null,
        outputDevices: list.devices ?? [],
        multiOutput:
          list.devices?.find((device) => device.name === MULTI_OUTPUT_NAME) ?? null,
        error: null,
      };
    } catch (error) {
      return {
        supported: true,
        helperAvailable: true,
        currentOutput: null,
        outputDevices: [],
        multiOutput: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async create(outputUid: string): Promise<MultiOutputStatus> {
    if (this.platform !== 'darwin') {
      throw new Error('Multi-Output Device creation is supported only on macOS');
    }
    const current = await this.status();
    if (!current.helperAvailable) {
      throw new Error(current.error ?? 'Multi-Output helper is not available');
    }
    const output = current.outputDevices.find((device) => device.uid === outputUid);
    if (!output) {
      throw new Error('選択した出力デバイスが見つかりません。');
    }
    if (output.name.toLowerCase().includes('blackhole')) {
      throw new Error('BlackHole 2ch を通常の出力デバイスとして選択できません。');
    }
    if (output.name === MULTI_OUTPUT_NAME) {
      throw new Error('Kataribe Multi-Output 自身を出力デバイスにできません。');
    }
    if (output.isAggregate) {
      throw new Error('既存の Aggregate Device を出力デバイスにできません。通常の出力デバイスを選択してください。');
    }
    const blackHole = current.outputDevices.find(
      (device) =>
        device.name.toLowerCase().includes('blackhole') &&
        device.channels > 0,
    );
    if (!blackHole) {
      throw new Error('BlackHole 2ch が見つかりません。先に BlackHole 2ch をインストールしてください。');
    }
    const helper = await this.locator.multiOutputPath();
    await this.runHelper(helper, ['create', output.uid, blackHole.uid]);
    return this.status();
  }

  async remove(): Promise<MultiOutputStatus> {
    if (this.platform !== 'darwin') {
      throw new Error('Multi-Output Device creation is supported only on macOS');
    }
    const helper = await this.locator.multiOutputPath();
    await this.runHelper(helper, ['remove']);
    return this.status();
  }

  private async runHelper(helper: string, args: string[]): Promise<string> {
    let result;
    try {
      result = await this.runner({
        command: helper,
        args,
        timeoutMs: 30_000,
      });
    } catch (error) {
      if (error instanceof ProcessStartError) {
        throw new Error(`Multi-Output helper failed: ${error.message}`);
      }
      throw error;
    }
    if (result.timedOut) {
      throw new Error('Multi-Output Device の作成がタイムアウトしました。');
    }
    if (result.code !== 0) {
      const detail = result.stderr.trim().split('\n').slice(-2).join(' ');
      throw new Error(
        `Multi-Output Device の操作に失敗しました。${detail ? ` ${detail}` : ''}`.trim(),
      );
    }
    return result.stdout.trim();
  }
}
