/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
import fs from 'node:fs';
import path from 'node:path';
import { isValidPkg, type AppEntry } from '@shared/types';
import type { RRuntimeManager } from './r-runtime';
import { ICON_SCRIPT } from './r-scripts';
import { assertInside } from './safe-path';
const ALLOWED_EXT = new Set(['.png', '.svg', '.jpg', '.jpeg', '.gif', '.ico']);
const NAME = /^(user-)?[a-f0-9-]{36}\.(png|svg|jpg|jpeg|gif|ico)$/;
export class IconManager {
  constructor(readonly cacheDir: string) {}
  copyUserIcon(srcPath: string, id: string, user = true): string | undefined {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new Error('Invalid icon identifier.');
    const ext = path.extname(srcPath).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) throw new Error('Unsupported image format.');
    if (
      !fs.statSync(srcPath).isFile() ||
      fs.statSync(srcPath).size > 5 * 1024 * 1024
    )
      throw new Error('Icon must be a file smaller than 5 MiB.');
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const target = assertInside(
      this.cacheDir,
      path.join(this.cacheDir, `${user ? 'user-' : ''}${id}${ext}`),
    );
    if (path.resolve(srcPath) !== target) fs.copyFileSync(srcPath, target);
    return target;
  }
  url(file: string | undefined): string | undefined {
    if (!file) return undefined;
    try {
      const target = assertInside(this.cacheDir, file);
      if (!NAME.test(path.basename(target)) || !fs.existsSync(target))
        return undefined;
      return `slr-icon://cache/${encodeURIComponent(path.basename(target))}`;
    } catch {
      return undefined;
    }
  }
  resolveUrl(value: string): string {
    const u = new URL(value);
    const name = decodeURIComponent(u.pathname.slice(1));
    if (
      u.protocol !== 'slr-icon:' ||
      u.hostname !== 'cache' ||
      u.search ||
      u.hash ||
      !NAME.test(name)
    )
      throw new Error('Invalid icon URL.');
    return assertInside(this.cacheDir, path.join(this.cacheDir, name));
  }
  async resolvePackageIcon(
    entry: AppEntry,
    runtime: RRuntimeManager,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!entry.pkg || !isValidPkg(entry.pkg)) return undefined;
    const resolved = await runtime.ready(signal);
    if (!resolved) return undefined;
    const child = runtime.processes.startScript(resolved.rPath, ICON_SCRIPT, {
      owner: entry.id,
      env: runtime.childEnv({ SLR_PACKAGE: entry.pkg }),
      signal,
      timeoutMs: 10000,
    });
    const result = await child.done;
    const file = result.stdout.trim();
    if (result.code !== 0 || result.error || !file || !fs.existsSync(file))
      return undefined;
    return this.copyUserIcon(file, entry.id, false);
  }
  resolveSourceIcon(appDir: string, id: string): string | undefined {
    for (const rel of [
      'www/logo.png',
      'www/logo.svg',
      'man/figures/logo.png',
      'man/figures/logo.svg',
    ]) {
      const file = assertInside(appDir, path.join(appDir, rel));
      if (fs.existsSync(file)) return this.copyUserIcon(file, id, false);
    }
    return undefined;
  }
  clearCache(): number {
    let n = 0;
    fs.mkdirSync(this.cacheDir, { recursive: true });
    for (const name of fs.readdirSync(this.cacheDir))
      if (NAME.test(name) && !name.startsWith('user-')) {
        fs.rmSync(assertInside(this.cacheDir, path.join(this.cacheDir, name)), {
          force: true,
        });
        n++;
      }
    return n;
  }
}
