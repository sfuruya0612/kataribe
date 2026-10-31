import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChildProcessRegistry } from '../src/main/child-registry';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRegistry() {
  const root = mkdtempSync(join(tmpdir(), 'kataribe-children-'));
  roots.push(root);
  return { root, registry: new ChildProcessRegistry(root) };
}

describe('ChildProcessRegistry', () => {
  it('writes and removes a PID marker', () => {
    const { root, registry } = createRegistry();
    registry.register(12345, '/tmp/fake-binary');
    expect(existsSync(join(root, '12345.json'))).toBe(true);
    registry.unregister(12345);
    expect(existsSync(join(root, '12345.json'))).toBe(false);
  });

  it('removes a marker for a process that is no longer running', async () => {
    const { root, registry } = createRegistry();
    registry.register(999999, '/tmp/fake-binary');
    await registry.cleanupOrphaned();
    expect(existsSync(join(root, '999999.json'))).toBe(false);
  });

  it('terminates a matching orphaned child process', async () => {
    const { root, registry } = createRegistry();
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      stdio: 'ignore',
    });
    await new Promise<void>((resolve) => child.once('spawn', resolve));
    expect(child.pid).toBeTypeOf('number');
    registry.register(child.pid as number, process.execPath);
    await registry.cleanupOrphaned();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(existsSync(join(root, `${child.pid}.json`))).toBe(false);
  }, 10000);
});
