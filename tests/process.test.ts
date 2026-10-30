import { describe, expect, it } from 'vitest';
import { ProcessStartError, runProcess } from '../src/main/process';

describe('runProcess', () => {
  it('captures stdout and stderr lines without a shell', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await runProcess({
      command: process.execPath,
      args: [
        '-e',
        'process.stdout.write("a\\nb\\n"); process.stderr.write("e1\\ne2\\n")',
      ],
      onStdoutLine: (line) => stdout.push(line),
      onStderrLine: (line) => stderr.push(line),
    });
    expect(result).toMatchObject({ code: 0, timedOut: false, aborted: false });
    expect(stdout).toEqual(['a', 'b']);
    expect(stderr).toEqual(['e1', 'e2']);
  });

  it('returns a non-zero exit code', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'process.exit(3)'],
    });
    expect(result.code).toBe(3);
  });

  it('kills a timed out process', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      timeoutMs: 100,
      killGraceMs: 100,
    });
    expect(result.timedOut).toBe(true);
    expect(result.code === null || result.signal !== null).toBe(true);
  });

  it('kills an aborted process', async () => {
    const controller = new AbortController();
    const promise = runProcess({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      signal: controller.signal,
      killGraceMs: 100,
    });
    setTimeout(() => controller.abort(), 50);
    const result = await promise;
    expect(result.aborted).toBe(true);
  });

  it('rejects when the executable does not exist', async () => {
    await expect(
      runProcess({ command: '/definitely/missing/kataribe', args: [] }),
    ).rejects.toBeInstanceOf(ProcessStartError);
  });

  it('does not start when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runProcess({
      command: '/definitely/missing/kataribe',
      args: [],
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
  });
});
