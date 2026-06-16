import { describe, expect, it, vi } from 'vitest';
import {
  buildLaunchScript,
  buildRunAppScript,
  defaultKillTree,
  ShinySupervisor,
} from '../src/main/shiny-supervisor';
import { PidLedger } from '../src/main/pid-ledger';

describe('buildLaunchScript', () => {
  it('builds a headless, fixed-port, fully-qualified launch expression', () => {
    const s = buildLaunchScript('molpathR', 'mp_run_app', 8123);
    expect(s).toContain('shiny.port = 8123');
    expect(s).toContain('shiny.launch.browser = FALSE');
    expect(s).toContain('library(molpathR)');
    expect(s).toContain('molpathR::mp_run_app()');
  });

  it('rejects an invalid package or function (no injection surface)', () => {
    expect(() => buildLaunchScript('bad name', 'fun', 8000)).toThrow();
    expect(() => buildLaunchScript('pkg', 'fun()', 8000)).toThrow();
    expect(() => buildLaunchScript('pkg', 'system("x")', 8000)).toThrow();
  });
});

describe('buildRunAppScript', () => {
  it('runs a staged directory headless on a fixed port (forward slashes)', () => {
    const s = buildRunAppScript('C:\\Users\\me\\AppData\\apps\\abc', 8200);
    expect(s).toContain('shiny.port = 8200');
    expect(s).toContain('shiny.launch.browser = FALSE');
    expect(s).toContain('shiny::runApp("C:/Users/me/AppData/apps/abc")');
  });

  it('rejects a path that could break out of the R string literal', () => {
    expect(() => buildRunAppScript('dir"); system("x', 8000)).toThrow();
    expect(() => buildRunAppScript('', 8000)).toThrow();
  });
});

describe('defaultKillTree', () => {
  it('uses taskkill /T on Windows', () => {
    const spawnFn = vi.fn();
    const killFn = vi.fn();
    defaultKillTree(4321, 'win32', { spawnFn: spawnFn as never, killFn });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnFn.mock.calls[0]!;
    expect(cmd).toBe('taskkill');
    expect(args).toEqual(['/pid', '4321', '/T', '/F']);
    expect(killFn).not.toHaveBeenCalled();
  });

  it('signals the process group on POSIX', () => {
    const spawnFn = vi.fn();
    const killFn = vi.fn();
    defaultKillTree(4321, 'linux', { spawnFn: spawnFn as never, killFn });
    expect(spawnFn).not.toHaveBeenCalled();
    expect(killFn).toHaveBeenCalledWith(-4321, 'SIGTERM');
  });

  it('falls back to the bare pid if the group signal throws', () => {
    const killFn = vi.fn((pid: number) => {
      if (pid < 0) throw new Error('no such group');
    });
    defaultKillTree(4321, 'darwin', { killFn });
    expect(killFn).toHaveBeenCalledWith(-4321, 'SIGTERM');
    expect(killFn).toHaveBeenCalledWith(4321, 'SIGTERM');
  });
});

describe('ShinySupervisor.reapOrphans', () => {
  function memLedger(initial: number[]): PidLedger {
    let content = JSON.stringify(initial);
    return new PidLedger('/x', {
      existsSync: () => true,
      readFileSync: () => content,
      writeFileSync: (_p, d) => {
        content = d;
      },
    });
  }

  it('kills ledger PIDs that are still our R processes, then clears the ledger', () => {
    const ledger = memLedger([111, 222]);
    const killTree = vi.fn();
    const sup = new ShinySupervisor({ ledger, killTree, isOrphan: () => true });
    expect(sup.reapOrphans()).toBe(2);
    expect(killTree).toHaveBeenCalledWith(111);
    expect(killTree).toHaveBeenCalledWith(222);
    expect(ledger.list()).toEqual([]);
  });

  it('skips PIDs that are no longer our process (guards against PID reuse)', () => {
    const ledger = memLedger([111, 999]);
    const killTree = vi.fn();
    // 999 was recycled by some unrelated program — must not be killed.
    const sup = new ShinySupervisor({ ledger, killTree, isOrphan: (pid) => pid === 111 });
    expect(sup.reapOrphans()).toBe(1);
    expect(killTree).toHaveBeenCalledWith(111);
    expect(killTree).not.toHaveBeenCalledWith(999);
    expect(ledger.list()).toEqual([]);
  });

  it('is a no-op with no ledger configured', () => {
    expect(new ShinySupervisor().reapOrphans()).toBe(0);
  });
});
