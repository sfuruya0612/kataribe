import type { MenuItemConstructorOptions } from 'electron';
import type {
  InputSource,
  RecordingAppState,
  RecordingAppStatus,
} from '../shared/types';

export type TrayMenuHandlers = {
  start: () => void;
  stop: () => void;
  selectInputSource: (source: InputSource) => void;
  openWindow: () => void;
  quit: () => void;
};

const INPUT_SOURCE_LABELS: Record<InputSource, string> = {
  microphone: 'マイク',
  system: 'システム音声',
  both: 'マイク + システム音声',
};

export function formatElapsed(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(remainder).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function statusLabel(status: RecordingAppStatus): string {
  switch (status) {
    case 'starting':
      return '準備中';
    case 'recording':
      return '録音中';
    case 'stopping':
      return '停止中';
    case 'encoding':
      return '変換待ち';
    case 'error':
      return 'エラー';
    default:
      return '待機中';
  }
}

function canStart(status: RecordingAppStatus): boolean {
  return status === 'idle' || status === 'encoding' || status === 'error';
}

export function buildTrayMenuTemplate(
  state: RecordingAppState,
  handlers: TrayMenuHandlers,
): MenuItemConstructorOptions[] {
  return [
    {
      label: `状態: ${statusLabel(state.status)}`,
      enabled: false,
    },
    {
      label: `経過時間: ${formatElapsed(state.elapsedSeconds)}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '録音を開始',
      enabled: canStart(state.status),
      click: handlers.start,
    },
    {
      label: '録音を停止',
      enabled: state.status === 'recording',
      click: handlers.stop,
    },
    { type: 'separator' },
    {
      label: `入力ソース: ${INPUT_SOURCE_LABELS[state.inputSource]}`,
      submenu: (['microphone', 'system', 'both'] as InputSource[]).map((source) => ({
        label: INPUT_SOURCE_LABELS[source],
        type: 'radio',
        checked: state.inputSource === source,
        click: () => handlers.selectInputSource(source),
      })),
    },
    { type: 'separator' },
    {
      label: 'メインウィンドウを開く',
      click: handlers.openWindow,
    },
    { type: 'separator' },
    {
      label: 'Kataribe を終了',
      click: handlers.quit,
    },
  ];
}
