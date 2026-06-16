/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Filesystem hygiene for the managed R library. Reinstalls and uninstalls must
 * leave the library in a clean state: stale `00LOCK-*` directories (left by an
 * interrupted `R CMD INSTALL`) and corrupt/partial package folders (a directory
 * with no DESCRIPTION — wreckage from a half-completed pak move) otherwise block
 * every later install with "Failed to move installed package".
 *
 * Every operation is best-effort: a directory still locked by a live process
 * (an R session holding a compiled `.dll`) will not delete; that is reported in
 * `failed`, never thrown. The caller is expected to have already stopped the
 * instances it knows about before asking for cleanup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isValidPkg } from '@shared/types';

export interface LibFs {
  existsSync(p: string): boolean;
  readdirSync(p: string): string[];
  rmSync(p: string, opts: { recursive: boolean; force: boolean }): void;
}

export interface RemoveResult {
  /** Artifacts successfully deleted (basenames). */
  removed: string[];
  /** Artifacts that could not be deleted — almost always a live file lock. */
  failed: string[];
}

/** A package is corrupt if its directory exists but has no DESCRIPTION manifest. */
export function isCorruptInstall(lib: string, pkg: string, fsLike: LibFs = fs): boolean {
  if (!isValidPkg(pkg)) return false;
  const dir = path.join(lib, pkg);
  return fsLike.existsSync(dir) && !fsLike.existsSync(path.join(dir, 'DESCRIPTION'));
}

/** Names of stale R lock directories currently in `lib` (anything `00LOCK*`). */
export function staleLocks(lib: string, fsLike: LibFs = fs): string[] {
  try {
    return fsLike.readdirSync(lib).filter((n) => n.startsWith('00LOCK'));
  } catch {
    return [];
  }
}

function tryRemove(target: string, label: string, fsLike: LibFs, acc: RemoveResult): void {
  if (!fsLike.existsSync(target)) return;
  try {
    fsLike.rmSync(target, { recursive: true, force: true });
    acc.removed.push(label);
  } catch {
    acc.failed.push(label);
  }
}

/**
 * Pre-install hygiene: remove stale `00LOCK*` dirs and a *corrupt* copy of `pkg`
 * (a partial folder with no DESCRIPTION). A healthy existing install is left
 * untouched for pak/install.packages to replace in place — so a reinstall never
 * destroys a working copy just because the new build might later fail.
 */
export function cleanForReinstall(lib: string, pkg: string, fsLike: LibFs = fs): RemoveResult {
  const acc: RemoveResult = { removed: [], failed: [] };
  for (const lock of staleLocks(lib, fsLike)) {
    tryRemove(path.join(lib, lock), lock, fsLike, acc);
  }
  if (isCorruptInstall(lib, pkg, fsLike)) {
    tryRemove(path.join(lib, pkg), pkg, fsLike, acc);
  }
  return acc;
}

/**
 * Uninstall: fully remove `pkg` and its lock dir from the managed library.
 * Only the named package is removed — shared dependencies are deliberately left
 * in place so deleting one app cannot break another.
 */
export function removeInstalledPackage(lib: string, pkg: string, fsLike: LibFs = fs): RemoveResult {
  const acc: RemoveResult = { removed: [], failed: [] };
  if (!isValidPkg(pkg)) return acc;
  tryRemove(path.join(lib, pkg), pkg, fsLike, acc);
  tryRemove(path.join(lib, `00LOCK-${pkg}`), `00LOCK-${pkg}`, fsLike, acc);
  return acc;
}
