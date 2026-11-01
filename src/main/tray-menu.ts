import type { MenuItemConstructorOptions } from 'electron';
import type {
  InputSource,
  RecordingAppState,
  RecordingAppStatus,
} from '../shared/types';
import { t } from './i18n';

export type TrayMenuHandlers = {
  start: () => void;
  stop: () => void;
  selectInputSource: (source: InputSource) => void;
  openWindow: () => void;
  quit: () => void;
};

function inputSourceLabel(source: InputSource): string {
  switch (source) {
    case 'microphone':
      return t('マイク');
    case 'system':
      return t('システム音声');
    case 'both':
      return t('マイク + システム音声');
  }
}

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
      return t('準備中');
    case 'recording':
      return t('録音中');
    case 'stopping':
      return t('停止中');
    case 'encoding':
      return t('変換待ち');
    case 'error':
      return t('エラー');
    default:
      return t('待機中');
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
      label: t('状態: {status}', { status: statusLabel(state.status) }),
      enabled: false,
    },
    {
      label: t('経過時間: {elapsed}', {
        elapsed: formatElapsed(state.elapsedSeconds),
      }),
      enabled: false,
    },
    { type: 'separator' },
    {
      label: t('録音を開始'),
      enabled: canStart(state.status),
      click: handlers.start,
    },
    {
      label: t('録音を停止'),
      enabled: state.status === 'recording',
      click: handlers.stop,
    },
    { type: 'separator' },
    {
      label: t('入力ソース: {source}', {
        source: inputSourceLabel(state.inputSource),
      }),
      submenu: (['microphone', 'system', 'both'] as InputSource[]).map((source) => ({
        label: inputSourceLabel(source),
        type: 'radio',
        checked: state.inputSource === source,
        click: () => handlers.selectInputSource(source),
      })),
    },
    { type: 'separator' },
    {
      label: t('メインウィンドウを開く'),
      click: handlers.openWindow,
    },
    { type: 'separator' },
    {
      label: t('Kataribe を終了'),
      click: handlers.quit,
    },
  ];
}
