import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type RunProcessOptions = {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  spawn?: typeof nodeSpawn;
  killGraceMs?: number;
};

export type RunProcessResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
};

export class ProcessStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessStartError';
  }
}

export type ChildProcessRegistryLike = {
  register: (pid: number, command: string) => void;
  unregister: (pid: number) => void;
};

let childProcessRegistry: ChildProcessRegistryLike | null = null;

export function configureChildProcessRegistry(
  registry: ChildProcessRegistryLike | null,
): void {
  childProcessRegistry = registry;
}

const MAX_CAPTURE = 64 * 1024;

function capture(current: string, text: string): string {
  const next = current + text;
  return next.length > MAX_CAPTURE ? next.slice(-MAX_CAPTURE) : next;
}

export async function runProcess(options: RunProcessOptions): Promise<RunProcessResult> {
  const spawn = options.spawn ?? nodeSpawn;
  const killGraceMs = options.killGraceMs ?? 3000;

  return new Promise<RunProcessResult>((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: true,
      });
      return;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }) as unknown as ChildProcessWithoutNullStreams;
    } catch (error) {
      reject(
        new ProcessStartError(
          `failed to start process: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | null = null;
    const pid = child.pid;
    if (pid) {
      childProcessRegistry?.register(pid, options.command);
    }

    const flushLines = (
      buffer: string,
      callback: ((line: string) => void) | undefined,
    ): string => {
      let rest = buffer;
      let newline = rest.indexOf('\n');
      while (newline !== -1) {
        const line = rest.slice(0, newline).replace(/\r$/u, '');
        rest = rest.slice(newline + 1);
        callback?.(line);
        newline = rest.indexOf('\n');
      }
      return rest;
    };

    const terminate = (reason: 'timeout' | 'abort') => {
      if (settled) {
        return;
      }
      if (reason === 'timeout') {
        timedOut = true;
      } else {
        aborted = true;
      }
      try {
        child.kill('SIGTERM');
      } catch {
        // The process may have already exited.
      }
      if (killTimer === null) {
        killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // The process may have already exited.
          }
        }, killGraceMs);
        killTimer.unref?.();
      }
    };

    const timeoutTimer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => terminate('timeout'), options.timeoutMs)
        : null;
    timeoutTimer?.unref?.();

    const onAbort = () => terminate('abort');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdout = capture(stdout, chunk);
      stdoutBuffer += chunk;
      stdoutBuffer = flushLines(stdoutBuffer, options.onStdoutLine);
    });

    child.stderr.on('data', (chunk: string) => {
      stderr = capture(stderr, chunk);
      stderrBuffer += chunk;
      stderrBuffer = flushLines(stderrBuffer, options.onStderrLine);
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
      options.signal?.removeEventListener('abort', onAbort);
      if (pid) {
        childProcessRegistry?.unregister(pid);
      }
      reject(new ProcessStartError(`process failed: ${error.message}`));
    });

    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
      options.signal?.removeEventListener('abort', onAbort);
      if (stdoutBuffer.length > 0) {
        options.onStdoutLine?.(stdoutBuffer.replace(/\r$/u, ''));
      }
      if (stderrBuffer.length > 0) {
        options.onStderrLine?.(stderrBuffer.replace(/\r$/u, ''));
      }
      if (pid) {
        childProcessRegistry?.unregister(pid);
      }
      resolve({ code, signal, stdout, stderr, timedOut, aborted });
    });
  });
}
