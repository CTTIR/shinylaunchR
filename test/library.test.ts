import { describe, expect, it } from 'vitest';
import {
  cleanForReinstall,
  isCorruptInstall,
  removeInstalledPackage,
  staleLocks,
  type LibFs,
} from '../src/main/library';

/**
 * In-memory fake of the slice of `fs` the library helpers use. Directories are
 * modelled as a set of path prefixes; `rmSync` deletes a path and everything
 * under it, and can be made to throw for chosen paths (a simulated lock).
 */
function fakeFs(
  paths: string[],
  locked: string[] = [],
): LibFs & { paths: Set<string> } {
  const set = new Set(paths.map((p) => p.replace(/\\/g, '/')));
  const norm = (p: string) => p.replace(/\\/g, '/');
  return {
    paths: set,
    existsSync: (p) => set.has(norm(p)),
    readdirSync: (p) => {
      const base = norm(p).replace(/\/$/, '');
      const names = new Set<string>();
      for (const entry of set) {
        if (entry.startsWith(base + '/')) {
          const rest = entry.slice(base.length + 1);
          names.add(rest.split('/')[0]!);
        }
      }
      return [...names];
    },
    rmSync: (p) => {
      const target = norm(p);
      if (locked.some((l) => norm(l) === target))
        throw new Error('EBUSY: resource busy or locked');
      for (const entry of [...set]) {
        if (entry === target || entry.startsWith(target + '/'))
          set.delete(entry);
      }
    },
  };
}

const LIB = '/managed-library';

describe('isCorruptInstall', () => {
  it('flags a package dir with no DESCRIPTION', () => {
    const fs = fakeFs([
      '/managed-library/zhncommandR',
      '/managed-library/zhncommandR/shiny',
    ]);
    expect(isCorruptInstall(LIB, 'zhncommandR', fs)).toBe(true);
  });

  it('treats a dir with DESCRIPTION as healthy', () => {
    const fs = fakeFs([
      '/managed-library/zhncommandR',
      '/managed-library/zhncommandR/DESCRIPTION',
    ]);
    expect(isCorruptInstall(LIB, 'zhncommandR', fs)).toBe(false);
  });

  it('is false for an absent package and for invalid names', () => {
    const fs = fakeFs([]);
    expect(isCorruptInstall(LIB, 'zhncommandR', fs)).toBe(false);
    expect(
      isCorruptInstall(LIB, 'bad;name', fakeFs(['/managed-library/bad;name'])),
    ).toBe(false);
  });
});

describe('staleLocks', () => {
  it('lists only 00LOCK* entries', () => {
    const fs = fakeFs([
      '/managed-library/00LOCK-zhncommandR',
      '/managed-library/00LOCK',
      '/managed-library/shiny',
      '/managed-library/dplyr',
    ]);
    expect(staleLocks(LIB, fs).sort()).toEqual([
      '00LOCK',
      '00LOCK-zhncommandR',
    ]);
  });
});

describe('cleanForReinstall', () => {
  it('removes stale locks and a corrupt copy, keeping healthy installs', () => {
    const fs = fakeFs([
      '/managed-library/00LOCK-zhncommandR',
      '/managed-library/zhncommandR',
      '/managed-library/zhncommandR/shiny', // corrupt: no DESCRIPTION
      '/managed-library/shiny',
      '/managed-library/shiny/DESCRIPTION', // healthy dependency, must survive
    ]);
    const r = cleanForReinstall(LIB, 'zhncommandR', fs);
    expect(r.removed.sort()).toEqual(['00LOCK-zhncommandR', 'zhncommandR']);
    expect(r.failed).toEqual([]);
    expect(fs.paths.has('/managed-library/zhncommandR')).toBe(false);
    expect(fs.paths.has('/managed-library/shiny/DESCRIPTION')).toBe(true);
  });

  it('does NOT remove a healthy existing install', () => {
    const fs = fakeFs([
      '/managed-library/zhncommandR',
      '/managed-library/zhncommandR/DESCRIPTION',
    ]);
    const r = cleanForReinstall(LIB, 'zhncommandR', fs);
    expect(r.removed).toEqual([]);
    expect(fs.paths.has('/managed-library/zhncommandR/DESCRIPTION')).toBe(true);
  });

  it('reports a locked dir as failed instead of throwing', () => {
    const fs = fakeFs(
      ['/managed-library/zhncommandR', '/managed-library/zhncommandR/shiny'],
      ['/managed-library/zhncommandR'],
    );
    const r = cleanForReinstall(LIB, 'zhncommandR', fs);
    expect(r.failed).toEqual(['zhncommandR']);
    expect(fs.paths.has('/managed-library/zhncommandR')).toBe(true);
  });
});

describe('removeInstalledPackage', () => {
  it('removes the package dir and its 00LOCK, leaving deps', () => {
    const fs = fakeFs([
      '/managed-library/zhncommandR',
      '/managed-library/zhncommandR/DESCRIPTION',
      '/managed-library/00LOCK-zhncommandR',
      '/managed-library/dplyr',
      '/managed-library/dplyr/DESCRIPTION',
    ]);
    const r = removeInstalledPackage(LIB, 'zhncommandR', fs);
    expect(r.removed.sort()).toEqual(['00LOCK-zhncommandR', 'zhncommandR']);
    expect(fs.paths.has('/managed-library/zhncommandR')).toBe(false);
    expect(fs.paths.has('/managed-library/dplyr/DESCRIPTION')).toBe(true);
  });

  it('ignores invalid package names (no traversal)', () => {
    const fs = fakeFs(['/managed-library/evil']);
    expect(removeInstalledPackage(LIB, '../evil', fs).removed).toEqual([]);
  });
});
