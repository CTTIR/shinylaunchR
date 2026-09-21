import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  ProcessManager,
  matchesIdentity,
  processIdentity,
  type ManagedProcess,
} from '../src/main/process-manager';
import { PidLedger } from '../src/main/pid-ledger';
import { logger } from '../src/main/logger';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const waitFor = (check: () => void) => vi.waitFor(check, { timeout: 20000 });

let root: string;
let managers: ProcessManager[];
let ownedDescendants: number[];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-process-test-'));
  managers = [];
  ownedDescendants = [];
});
afterEach(async () => {
  await Promise.allSettled(managers.map((manager) => manager.shutdown()));
  for (const pid of ownedDescendants) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* fixture already exited */
    }
  }
  vi.unstubAllEnvs();
  logger.clearSecrets();
  fs.rmSync(root, { recursive: true, force: true });
});
function manager(): ProcessManager {
  const item = new ProcessManager(root);
  managers.push(item);
  return item;
}
async function ready(child: ManagedProcess): Promise<void> {
  await waitFor(() => expect(child.child.pid).toBeGreaterThan(0));
}
function live(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
    }
    return true;
  } catch {
    return false;
  }
}

describe('owned process lifecycle', () => {
  it('settles asynchronous spawn errors and releases ownership', async () => {
    const owner = manager();
    const child = owner.start(path.join(root, 'missing-executable'), [], {
      owner: 'fixture',
      timeoutMs: process.platform === 'win32' ? 15000 : 1000,
    });
    const result = await child.done;
    expect(result.error).toMatch(/ENOENT|not found/i);
    expect(child.running()).toBe(false);
    expect(owner.size).toBe(0);
  });
  it('reassembles split protocol records, redacts before callbacks, and omits oversized lines', async () => {
    const token = 'github_pat_fixture_secret_123456';
    logger.addSecret(token);
    const lines: string[] = [];
    const code = `process.stdout.write('INSTALL_');setTimeout(()=>{process.stdout.write('OK\\n${token.slice(0, 12)}');setTimeout(()=>{process.stdout.write('${token.slice(12)}\\n'+'x'.repeat(70000)+'\\n');},15)},15)`;
    const child = manager().start(process.execPath, ['-e', code], {
      owner: 'fixture',
      onLine: (line) => lines.push(line),
    });
    const result = await child.done;
    expect(result.code).toBe(0);
    expect(lines).toEqual([
      'INSTALL_OK',
      '«redacted»',
      '[oversized output line omitted]',
    ]);
    expect(result.stdout).not.toContain(token);
    expect(result.stdout.length).toBeLessThan(1000);
  });
  it('does not propagate ambient credentials but permits an explicitly supplied installer token', async () => {
    vi.stubEnv('GITHUB_PAT', 'ambient-sensitive');
    vi.stubEnv('GH_TOKEN', 'ambient-other');
    const owner = manager();
    const probe = `console.log(JSON.stringify([process.env.GITHUB_PAT??null,process.env.GH_TOKEN??null]))`;
    expect(
      (
        await owner.start(process.execPath, ['-e', probe], { owner: 'app' })
          .done
      ).stdout.trim(),
    ).toBe('[null,null]');
    expect(
      (
        await owner.start(process.execPath, ['-e', probe], {
          owner: 'installer',
          env: { GITHUB_PAT: 'explicit-fixture' },
        }).done
      ).stdout.trim(),
    ).toBe('["explicit-fixture",null]');
  });
  it('cancels a live child, waits for close, and stops accepting work after shutdown', async () => {
    const owner = manager(),
      controller = new AbortController();
    const child = owner.start(
      process.execPath,
      ['-e', 'setInterval(()=>{},1000)'],
      { owner: 'fixture', signal: controller.signal },
    );
    await ready(child);
    controller.abort();
    const result = await child.done;
    expect(result.error).toContain('cancelled');
    expect(child.running()).toBe(false);
    await owner.shutdown();
    expect(owner.size).toBe(0);
    expect(() =>
      owner.start(process.execPath, [], { owner: 'fixture' }),
    ).toThrow(/cancelled/i);
  });
  it('enforces a process deadline and records the timeout cause', async () => {
    const child = manager().start(
      process.execPath,
      ['-e', 'setInterval(()=>{},1000)'],
      { owner: 'fixture', timeoutMs: 100 },
    );
    const result = await child.done;
    expect(result.error).toMatch(/timed out/);
    expect(child.running()).toBe(false);
  });
  it.skipIf(process.platform === 'win32')(
    'escalates for an owned child ignoring SIGTERM',
    async () => {
      let announced = false;
      const child = manager().start(
        process.execPath,
        [
          '-e',
          `process.on('SIGTERM',()=>{});console.log('READY');setInterval(()=>{},1000)`,
        ],
        {
          owner: 'fixture',
          onLine: (line) => {
            announced = line === 'READY';
          },
        },
      );
      await waitFor(() => expect(announced).toBe(true));
      const started = Date.now();
      await child.stop();
      expect(Date.now() - started).toBeLessThan(5000);
      expect(child.running()).toBe(false);
      expect(live(child.child.pid!)).toBe(false);
    },
    8000,
  );
  it('terminates a descendant in the owned process tree', async () => {
    let descendant: number | undefined;
    const code = `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)`;
    const child = manager().start(process.execPath, ['-e', code], {
      owner: 'fixture',
      onLine: (line) => {
        descendant = Number(line);
        if (descendant > 0) ownedDescendants.push(descendant);
      },
    });
    await waitFor(() => expect(descendant).toBeGreaterThan(0));
    await child.stop();
    await waitFor(() => expect(live(descendant!)).toBe(false));
  });
  it('drains descendants after the root exits with redirected stdio', async () => {
    let descendant: number | undefined;
    const code = `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);c.unref();setTimeout(()=>process.exit(0),100)`;
    const owner = manager();
    const child = owner.start(process.execPath, ['-e', code], {
      owner: 'fixture',
      onLine: (line) => {
        descendant = Number(line);
        if (descendant > 0) ownedDescendants.push(descendant);
      },
    });
    await waitFor(() => expect(descendant).toBeGreaterThan(0));
    await child.done;
    await waitFor(() => expect(live(descendant!)).toBe(false));
    expect(owner.size).toBe(0);
  });
  it('drains detached descendants retaining output pipes after root exit', async () => {
    let descendant: number | undefined;
    const code = `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',process.stdout,process.stderr]});console.log(c.pid);c.unref();setTimeout(()=>process.exit(0),100)`;
    const owner = manager();
    const child = owner.start(process.execPath, ['-e', code], {
      owner: 'fixture',
      onLine: (line) => {
        descendant = Number(line);
        if (descendant > 0) ownedDescendants.push(descendant);
      },
    });
    await waitFor(() => expect(descendant).toBeGreaterThan(0));
    await child.done;
    await waitFor(() => expect(live(descendant!)).toBe(false));
    expect(owner.size).toBe(0);
  });
  it.skipIf(process.platform !== 'win32')(
    'closes the job when the private owner lease disappears',
    async () => {
      let descendant: number | undefined;
      const child = manager().start(
        process.execPath,
        [
          '-e',
          `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)`,
        ],
        {
          owner: 'fixture',
          onLine: (line) => {
            descendant = Number(line);
            if (descendant > 0) ownedDescendants.push(descendant);
          },
        },
      );
      await waitFor(() => expect(descendant).toBeGreaterThan(0));
      // EOF is the same kernel pipe event caused by an abrupt desktop process exit.
      child.child.stdin!.destroy();
      await child.done;
      await waitFor(() => expect(live(descendant!)).toBe(false));
    },
  );
  it.skipIf(process.platform !== 'win32')(
    'kills the job when the supervisor itself is terminated',
    async () => {
      let descendant: number | undefined;
      const child = manager().start(
        process.execPath,
        [
          '-e',
          `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)`,
        ],
        {
          owner: 'fixture',
          onLine: (line) => {
            descendant = Number(line);
            if (descendant > 0) ownedDescendants.push(descendant);
          },
        },
      );
      await waitFor(() => expect(descendant).toBeGreaterThan(0));
      child.child.kill('SIGKILL');
      await child.done;
      await waitFor(() => expect(live(descendant!)).toBe(false));
    },
  );
  it('preserves shell-sensitive arguments, Unicode, environment and both output pipes', async () => {
    const values = [
      '',
      'space space',
      'quote"here',
      'tail\\',
      'a\\"b',
      'λ 日本語',
      "$(Write-Output wrong); & ' %PATH%",
    ];
    const child = manager().start(
      process.execPath,
      [
        '-e',
        `console.log(JSON.stringify(process.argv.slice(1)));console.error(process.env.OWNED_FIXTURE);`,
        '--',
        ...values,
      ],
      {
        owner: 'fixture',
        env: { ...process.env, OWNED_FIXTURE: 'inherited value' },
      },
    );
    const result = await child.done;
    expect(result.error).toBeUndefined();
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(values);
    expect(result.stderr.trim()).toBe('inherited value');
  });
  it.skipIf(process.platform === 'win32')(
    'allows graceful termination output to flush before stop resolves',
    async () => {
      let announced = false;
      const child = manager().start(
        process.execPath,
        [
          '-e',
          `process.on('SIGTERM',()=>{console.log('CLEANED');process.exit(0)});console.log('READY');setInterval(()=>{},1000)`,
        ],
        {
          owner: 'fixture',
          onLine: (line) => {
            if (line === 'READY') announced = true;
          },
        },
      );
      await waitFor(() => expect(announced).toBe(true));
      await child.stop();
      expect(await child.done).toMatchObject({
        code: 0,
        stdout: 'READY\nCLEANED\n',
      });
    },
  );
  it('cleans temporary scripts after a failed executable launch', async () => {
    const child = manager().startScript(
      path.join(root, 'absent'),
      'cat("fixture")',
      { owner: 'fixture' },
    );
    await child.done;
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.R'))).toEqual(
      [],
    );
  });
  it('does not reap a live unrelated fixture with a mismatched identity', async () => {
    const fixture = spawn(
      process.execPath,
      ['-e', 'setInterval(()=>{},1000)'],
      { stdio: 'ignore' },
    );
    await new Promise<void>((resolve, reject) => {
      fixture.once('spawn', resolve);
      fixture.once('error', reject);
    });
    try {
      const owner = manager(),
        file = path.join(root, 'pids.json');
      owner.enableLedger(file);
      new PidLedger(file).add({
        pid: fixture.pid!,
        started: 'incorrect',
        executable: process.execPath,
        marker: randomUUID(),
      });
      await owner.reap();
      expect(live(fixture.pid!)).toBe(true);
      expect(new PidLedger(file).list()).toEqual([]);
    } finally {
      const closed = new Promise<void>((resolve) => {
        fixture.once('close', () => resolve());
      });
      fixture.kill('SIGKILL');
      await closed;
    }
  });
  it(
    'matches the complete live identity and rejects a changed start time',
    async () => {
      const marker = randomUUID();
      const child = manager().start(
        process.execPath,
        ['-e', 'setInterval(()=>{},1000)'],
        { owner: 'fixture' },
        marker,
      );
      await ready(child);
      const record = processIdentity(child.child.pid!, marker);
      expect(record).toBeDefined();
      expect(matchesIdentity(record!)).toBe(true);
      expect(matchesIdentity({ ...record!, started: 'different' })).toBe(false);
      expect(processIdentity(child.child.pid!, randomUUID())).toBeUndefined();
      await child.stop();
      expect(matchesIdentity(record!)).toBe(false);
    },
  );
});
