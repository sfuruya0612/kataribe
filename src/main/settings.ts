import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
} from '../shared/settings';
import type { AppSettings } from '../shared/types';

export class SettingsStore {
  private readonly filePath: string;
  private current: AppSettings = { ...DEFAULT_APP_SETTINGS };
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<AppSettings> {
    try {
      const text = await readFile(this.filePath, 'utf8');
      this.current = normalizeAppSettings(JSON.parse(text) as Partial<AppSettings>);
    } catch {
      this.current = normalizeAppSettings(DEFAULT_APP_SETTINGS);
    }
    return this.current;
  }

  get(): AppSettings {
    return this.current;
  }

  save(patch: Partial<AppSettings>): Promise<AppSettings> {
    const result = this.operationQueue.then(async () => {
      const next = normalizeAppSettings({ ...this.current, ...patch });
      await this.write(next);
      this.current = next;
      return next;
    });
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async write(settings: AppSettings): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const tempPath = `${this.filePath}.tmp`;
    const handle = await open(tempPath, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(settings, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(tempPath, 0o600);
    await rename(tempPath, this.filePath);
  }
}
