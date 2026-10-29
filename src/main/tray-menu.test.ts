import { describe, expect, it } from 'vitest';
import type { InputSource, RecordingAppState } from '../shared/types';
import {
  buildTrayMenuTemplate,
  formatElapsed,
  statusLabel,
  type TrayMenuHandlers,
} from './tray-menu';

function createState(overrides: Partial<RecordingAppState> = {}): RecordingAppState {
  return {
    status: 'idle',
    inputSource: 'both',
    session: null,
    startedAt: null,
    elapsedSeconds: 0,
    level: null,
    captureStats: null,
    chunkCount: 0,
    lastResult: null,
    lastMeetingDir: null,
    notice: null,
    clipping: null,
    clippingConfig: {
      peakThreshold: 0.985,
      intervalsToWarn: 3,
      recoveryIntervals: 5,
    },
    error: null,
    ...overrides,
  };
}

function createHandlers() {
  const calls: string[] = [];
  const sources: InputSource[] = [];
  const handlers: TrayMenuHandlers = {
    start: () => calls.push('start'),
    stop: () => calls.push('stop'),
    selectInputSource: (source) => {
      calls.push('source');
      sources.push(source);
    },
    openWindow: () => calls.push('open-window'),
    quit: () => calls.push('quit'),
  };
  return { handlers, calls, sources };
}

function item(template: ReturnType<typeof buildTrayMenuTemplate>, label: string) {
  const found = template.find((entry) => entry.label === label);
  if (!found) {
    throw new Error(`menu item not found: ${label}`);
  }
  return found;
}

describe('formatElapsed', () => {
  it('formats minutes and hours', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(65.9)).toBe('01:05');
    expect(formatElapsed(3661)).toBe('1:01:01');
    expect(formatElapsed(Number.NaN)).toBe('00:00');
  });
});

describe('statusLabel', () => {
  it('labels every recording state', () => {
    expect(statusLabel('idle')).toBe('待機中');
    expect(statusLabel('starting')).toBe('準備中');
    expect(statusLabel('recording')).toBe('録音中');
    expect(statusLabel('stopping')).toBe('停止中');
    expect(statusLabel('encoding')).toBe('変換待ち');
    expect(statusLabel('error')).toBe('エラー');
  });
});

describe('buildTrayMenuTemplate', () => {
  it('shows the idle state and enables start only', () => {
    const { handlers } = createHandlers();
    const template = buildTrayMenuTemplate(createState(), handlers);

    expect(item(template, '状態: 待機中').enabled).toBe(false);
    expect(item(template, '経過時間: 00:00').enabled).toBe(false);
    expect(item(template, '録音を開始').enabled).toBe(true);
    expect(item(template, '録音を停止').enabled).toBe(false);

    const sourceMenu = item(template, '入力ソース: マイク + システム音声')
      .submenu as ReturnType<typeof buildTrayMenuTemplate>;
    expect(sourceMenu.map((entry) => [entry.label, entry.checked])).toEqual([
      ['マイク', false],
      ['システム音声', false],
      ['マイク + システム音声', true],
    ]);
  });

  it('shows the recording state and enables stop only', () => {
    const { handlers } = createHandlers();
    const template = buildTrayMenuTemplate(
      createState({
        status: 'recording',
        inputSource: 'microphone',
        elapsedSeconds: 65,
      }),
      handlers,
    );

    expect(item(template, '状態: 録音中').enabled).toBe(false);
    expect(item(template, '経過時間: 01:05').enabled).toBe(false);
    expect(item(template, '録音を開始').enabled).toBe(false);
    expect(item(template, '録音を停止').enabled).toBe(true);

    const sourceMenu = item(template, '入力ソース: マイク')
      .submenu as ReturnType<typeof buildTrayMenuTemplate>;
    expect(sourceMenu.find((entry) => entry.label === 'マイク')?.checked).toBe(true);
  });

  it('disables both actions while changing state', () => {
    const { handlers } = createHandlers();
    const starting = buildTrayMenuTemplate(createState({ status: 'starting' }), handlers);
    expect(item(starting, '録音を開始').enabled).toBe(false);
    expect(item(starting, '録音を停止').enabled).toBe(false);

    const stopping = buildTrayMenuTemplate(createState({ status: 'stopping' }), handlers);
    expect(item(stopping, '録音を開始').enabled).toBe(false);
    expect(item(stopping, '録音を停止').enabled).toBe(false);
  });

  it('wires the menu handlers', () => {
    const { handlers, calls, sources } = createHandlers();
    const template = buildTrayMenuTemplate(createState(), handlers);

    item(template, '録音を開始').click?.({} as never, {} as never, {} as never);
    item(template, 'メインウィンドウを開く').click?.({} as never, {} as never, {} as never);
    item(template, 'Kataribe を終了').click?.({} as never, {} as never, {} as never);

    const sourceMenu = item(template, '入力ソース: マイク + システム音声')
      .submenu as ReturnType<typeof buildTrayMenuTemplate>;
    sourceMenu.find((entry) => entry.label === 'システム音声')?.click?.(
      {} as never,
      {} as never,
      {} as never,
    );

    expect(calls).toEqual(['start', 'open-window', 'quit', 'source']);
    expect(sources).toEqual(['system']);
  });
});
