import { describe, expect, it, vi } from 'vitest';
import { buildLaunchScript, defaultKillTree } from '../src/main/shiny-supervisor';

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
