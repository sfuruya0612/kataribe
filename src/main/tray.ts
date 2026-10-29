import { Menu, Tray, nativeImage } from 'electron';
import type { RecordingAppState } from '../shared/types';
import {
  buildTrayMenuTemplate,
  formatElapsed,
  statusLabel,
  type TrayMenuHandlers,
} from './tray-menu';

export type TrayControllerOptions = {
  iconPath: string;
  handlers: TrayMenuHandlers;
  onToggle: () => void;
};

export class TrayController {
  private readonly tray: Tray;
  private readonly handlers: TrayMenuHandlers;
  private menu: Menu | null = null;

  constructor(options: TrayControllerOptions) {
    const image = nativeImage.createFromPath(options.iconPath);
    if (image.isEmpty()) {
      throw new Error(`tray icon is empty: ${options.iconPath}`);
    }
    image.setTemplateImage(true);
    this.handlers = options.handlers;
    this.tray = new Tray(image);
    this.tray.on('click', options.onToggle);
    this.tray.on('right-click', () => {
      if (this.menu) {
        this.tray.popUpContextMenu(this.menu);
      }
    });
  }

  update(state: RecordingAppState): void {
    this.menu = Menu.buildFromTemplate(buildTrayMenuTemplate(state, this.handlers));
    this.tray.setToolTip(`Kataribe: ${statusLabel(state.status)}`);
    if (process.platform === 'darwin') {
      const showElapsed = state.status === 'recording' || state.status === 'stopping';
      this.tray.setTitle(showElapsed ? formatElapsed(state.elapsedSeconds) : '');
    }
  }

  destroy(): void {
    this.tray.destroy();
  }
}
