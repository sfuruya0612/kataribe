import { execFile } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type ChildRecord = {
  pid: number;
  command: string;
  started_at: string;
};

export class ChildProcessRegistry {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  register(pid: number, command: string): void {
    try {
      const record: ChildRecord = {
        pid,
        command,
        started_at: new Date().toISOString(),
      };
      const path = join(this.directory, `${pid}.json`);
      writeFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      chmodSync(path, 0o600);
    } catch {
      // The process can still run without a PID marker.
    }
  }

  unregister(pid: number): void {
    try {
      rmSync(join(this.directory, `${pid}.json`), { force: true });
    } catch {
      // The marker may already be absent.
    }
  }

  async cleanupOrphaned(): Promise<void> {
    let files: string[];
    try {
      files = readdirSync(this.directory).filter((file) => file.endsWith('.json'));
    } catch {
      return;
    }
    for (const file of files) {
      const path = join(this.directory, file);
      let record: ChildRecord;
      try {
        record = JSON.parse(readFileSync(path, 'utf8')) as ChildRecord;
      } catch {
        rmSync(path, { force: true });
        continue;
      }
      if (
        !Number.isInteger(record.pid) ||
        record.pid <= 0 ||
        typeof record.command !== 'string'
      ) {
        rmSync(path, { force: true });
        continue;
      }
      try {
        if (!isAlive(record.pid)) {
          rmSync(path, { force: true });
          continue;
        }
        const { stdout } = await execFileAsync('/bin/ps', [
          '-p',
          String(record.pid),
          '-o',
          'command=',
        ]);
        if (!stdout.includes(record.command)) {
          rmSync(path, { force: true });
          continue;
        }
        try {
          process.kill(record.pid, 'SIGTERM');
        } catch {
          // The process may have exited.
        }
        for (let attempt = 0; attempt < 10 && isAlive(record.pid); attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (isAlive(record.pid)) {
          try {
            process.kill(record.pid, 'SIGKILL');
          } catch {
            // The process may have exited.
          }
        }
        console.log(`terminated orphaned child process: ${record.pid}`);
      } catch {
        // ps may fail when the process has already exited.
      } finally {
        rmSync(path, { force: true });
      }
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
