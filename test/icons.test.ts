import { describe, expect, it, vi } from 'vitest';
import type { SpawnOptions } from 'node:child_process';
import { IconManager } from '../src/main/icons';
import type { AppEntry } from '../src/shared/types';
import type { RRuntimeManager } from '../src/main/r-runtime';

/** Minimal child stub that resolves the close promise with empty stdout. */
function fakeChild() {
  const child: Record<string, unknown> = {
    stdout: { on: () => {} },
    on: (ev: string, cb: () => void) => {
      if (ev === 'close') cb();
      return child;
    },
  };
  return child;
}

const runtimeStub = {
  resolveRscript: () => ({ rPath: 'Rscript', source: 'system' as const }),
  childEnv: () => ({}),
} as unknown as RRuntimeManager;

describe('IconManager.resolvePackageIcon', () => {
  it('emits a parseable R program with one statement per line', async () => {
    let captured: string[] = [];
    const spawner = vi.fn((_cmd: string, args: string[], _opts: SpawnOptions) => {
      captured = args;
      return fakeChild() as never;
    });

    const icons = new IconManager('/tmp/shinylaunchr-icons', spawner);
    const entry = { id: 'a1', pkg: 'testpkg' } as AppEntry;

    await icons.resolvePackageIcon(entry, runtimeStub);

    const script = captured[captured.indexOf('-e') + 1];
    expect(script).toBeTypeOf('string');
    const lines = script!.split('\n').map((l) => l.trim());

    // Top-level statements must each stand on their own line; joining them with
    // a bare space produces invalid R ("unexpected symbol") and silently fails.
    expect(lines).toContain('pkg <- "testpkg"');
    expect(lines).toContain('hit <- cands[nzchar(cands) & file.exists(cands)]');
  });
});
