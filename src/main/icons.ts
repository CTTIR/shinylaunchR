/**
 * Resolve, extract and cache a package's icon.
 *
 * Priority: (1) user-supplied file at registration, (2) a logo inside the
 * installed package (pkgdown/hex convention), (3) fall back to a generated
 * monogram tile rendered by the renderer (so this module just returns
 * undefined). Cached files live under `userData/icons/<id>.<ext>`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type SpawnOptions } from 'node:child_process';
import { isValidPkg, type AppEntry } from '@shared/types';
import { logger } from './logger';
import type { RRuntimeManager } from './r-runtime';

const ALLOWED_EXT = new Set(['.png', '.svg', '.jpg', '.jpeg', '.gif', '.ico']);

export class IconManager {
  constructor(
    private readonly cacheDir: string,
    private readonly spawner: (
      cmd: string,
      args: string[],
      options: SpawnOptions,
    ) => ReturnType<typeof spawn> = spawn,
  ) {}

  private ensureDir(): void {
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  /** Copy a user-chosen icon file into the cache; returns the cached path. */
  copyUserIcon(srcPath: string, id: string): string | undefined {
    try {
      const ext = path.extname(srcPath).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        logger.warn('icons', `Unsupported icon type: ${ext}`);
        return undefined;
      }
      this.ensureDir();
      const dest = path.join(this.cacheDir, `${id}${ext}`);
      fs.copyFileSync(srcPath, dest);
      return dest;
    } catch (err) {
      logger.error('icons', `Failed to copy icon: ${String(err)}`);
      return undefined;
    }
  }

  /**
   * Ask R for a logo inside the installed package, copy it into the cache.
   * Returns the cached path, or undefined if none found / R unavailable.
   */
  async resolvePackageIcon(entry: AppEntry, runtime: RRuntimeManager): Promise<string | undefined> {
    if (!isValidPkg(entry.pkg)) return undefined;
    const resolved = runtime.resolveRscript();
    if (!resolved) return undefined;

    const script = [
      `pkg <- "${entry.pkg}"`,
      `cands <- c(`,
      `  system.file("figures","logo.png",package=pkg),`,
      `  system.file("figures","logo.svg",package=pkg),`,
      `  system.file("man","figures","logo.png",package=pkg),`,
      `  system.file("man","figures","logo.svg",package=pkg),`,
      `  system.file("www","logo.png",package=pkg)`,
      `)`,
      `hit <- cands[nzchar(cands) & file.exists(cands)]`,
      `if (length(hit) > 0) cat(hit[1])`,
    ].join(' ');

    const found = await new Promise<string | undefined>((resolve) => {
      let out = '';
      try {
        const child = this.spawner(resolved.rPath, ['--vanilla', '-e', script], {
          env: runtime.childEnv(),
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        });
        child.stdout?.on('data', (d) => (out += d.toString()));
        child.on('error', () => resolve(undefined));
        child.on('close', () => resolve(out.trim() || undefined));
      } catch {
        resolve(undefined);
      }
    });

    if (!found || !fs.existsSync(found)) return undefined;
    return this.copyUserIcon(found, entry.id);
  }

  /** Remove every cached icon file. */
  clearCache(): number {
    try {
      if (!fs.existsSync(this.cacheDir)) return 0;
      const entries = fs.readdirSync(this.cacheDir);
      let n = 0;
      for (const f of entries) {
        try {
          fs.unlinkSync(path.join(this.cacheDir, f));
          n++;
        } catch {
          // ignore
        }
      }
      return n;
    } catch {
      return 0;
    }
  }
}
