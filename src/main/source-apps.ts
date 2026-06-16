/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Staging for the SHINY FILE / `source` family: take an app's files (an uploaded
 * .zip, a local folder, a remote zip URL, a gist, or a GitHub *source* repo),
 * materialise them under `userData/apps/<id>/`, and locate the Shiny entry
 * (`app.R`, or `ui.R`+`server.R`). Apps are always copied/extracted — never run
 * in place — so launches are reproducible and inputs are traversal-checked.
 *
 * Security: zip extraction is zip-slip-safe (see unzip.ts); remote fetches are
 * https-only; the GitHub PAT is sent only as a request header, never logged.
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { isValidPkg, type AppEntry, type SourceOrigin } from '@shared/types';
import { logger } from './logger';
import { extractZipBuffer, extractZipFile } from './unzip';

/** Base R packages that ship with R — never install-resolved from a scan. */
const BASE_PKGS = new Set([
  'base', 'compiler', 'datasets', 'graphics', 'grDevices', 'grid', 'methods',
  'parallel', 'splines', 'stats', 'stats4', 'tcltk', 'tools', 'translations',
  'utils',
]);

export function appsRootDir(userDataDir: string): string {
  return path.join(userDataDir, 'apps');
}

export function stagedDirFor(userDataDir: string, id: string): string {
  return path.join(appsRootDir(userDataDir), id);
}

// ---------------------------------------------------------------------------
// App-entry discovery
// ---------------------------------------------------------------------------

function dirHasShinyApp(dir: string): boolean {
  try {
    if (fs.existsSync(path.join(dir, 'app.R')) || fs.existsSync(path.join(dir, 'app.r'))) {
      return true;
    }
    const hasUi = fs.existsSync(path.join(dir, 'ui.R')) || fs.existsSync(path.join(dir, 'ui.r'));
    const hasSrv =
      fs.existsSync(path.join(dir, 'server.R')) || fs.existsSync(path.join(dir, 'server.r'));
    return hasUi && hasSrv;
  } catch {
    return false;
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'renv', '.Rproj.user']);

/**
 * Find the directory that actually contains the Shiny app under `baseDir`. If
 * `appDir` is given (already validated as a safe relative path) it is honored
 * first; otherwise we look at the base and then descend (bounded breadth-first,
 * depth ≤ 3) — this transparently handles the single wrapper directory that
 * zips and GitHub zipballs introduce. Returns undefined if none is found.
 */
export function findShinyAppDir(baseDir: string, appDir?: string): string | undefined {
  const start = appDir ? path.join(baseDir, appDir) : baseDir;
  if (dirHasShinyApp(start)) return start;

  const queue: { dir: string; depth: number }[] = [{ dir: start, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (dirHasShinyApp(dir)) return dir;
    if (depth >= 3) continue;
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const c of children) {
      if (c.isDirectory() && !SKIP_DIRS.has(c.name)) {
        queue.push({ dir: path.join(dir, c.name), depth: depth + 1 });
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Dependency scanning
// ---------------------------------------------------------------------------

function addMatches(text: string, re: RegExp, into: Set<string>): void {
  for (const m of text.matchAll(re)) {
    const name = m[1];
    if (name && !BASE_PKGS.has(name) && isValidPkg(name)) into.add(name);
  }
}

const DEP_FIELDS = new Set(['Imports', 'Depends', 'LinkingTo', 'Suggests']);

function parseDescriptionDeps(text: string, into: Set<string>): void {
  // DESCRIPTION fields start at column 0 ("Field: value") and wrap onto indented
  // continuation lines. Accumulate the dependency fields, then split on commas.
  let current: string | null = null;
  const bodies: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^([A-Za-z][\w.]*):(.*)$/);
    if (header) {
      current = header[1]!;
      if (DEP_FIELDS.has(current)) bodies.push(header[2] ?? '');
    } else if (/^\s+\S/.test(line) && current && DEP_FIELDS.has(current)) {
      bodies.push(' ' + line.trim());
    }
  }
  for (const raw of bodies.join(' ').split(',')) {
    const name = raw.trim().replace(/\s*\(.*$/, '').trim(); // strip "(>= 1.0)"
    if (name && name !== 'R' && !BASE_PKGS.has(name) && isValidPkg(name)) into.add(name);
  }
}

function parseRenvLock(text: string, into: Set<string>): void {
  try {
    const lock = JSON.parse(text) as { Packages?: Record<string, { Package?: string }> };
    for (const v of Object.values(lock.Packages ?? {})) {
      const name = v?.Package;
      if (name && !BASE_PKGS.has(name) && isValidPkg(name)) into.add(name);
    }
  } catch {
    // not valid JSON — ignore
  }
}

function walkFiles(dir: string, depth: number, visit: (file: string) => void): void {
  if (depth > 6) return;
  let children: fs.Dirent[];
  try {
    children = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const c of children) {
    const full = path.join(dir, c.name);
    if (c.isDirectory()) {
      if (!SKIP_DIRS.has(c.name)) walkFiles(full, depth + 1, visit);
    } else if (c.isFile()) {
      visit(full);
    }
  }
}

/**
 * Scan a staged app directory for the R packages it needs: `library()` /
 * `require()` / `requireNamespace()` / `pkg::` references in R/Rmd source, plus
 * DESCRIPTION dependency fields and renv.lock packages. `shiny` is always
 * included. Base R packages are excluded. Returns a sorted, de-duplicated list.
 */
export function scanDependencies(appDir: string): string[] {
  const found = new Set<string>(['shiny']);
  const libRe = /\b(?:library|require)\s*\(\s*["']?([A-Za-z][A-Za-z0-9.]*)/g;
  const reqNsRe = /requireNamespace\s*\(\s*["']([A-Za-z][A-Za-z0-9.]*)/g;
  const nsRe = /([A-Za-z][A-Za-z0-9.]*)\s*::/g;

  walkFiles(appDir, 0, (file) => {
    const base = path.basename(file);
    try {
      if (/\.(R|r|Rmd|rmd)$/.test(base)) {
        const text = fs.readFileSync(file, 'utf8');
        addMatches(text, libRe, found);
        addMatches(text, reqNsRe, found);
        addMatches(text, nsRe, found);
      } else if (base === 'DESCRIPTION') {
        parseDescriptionDeps(fs.readFileSync(file, 'utf8'), found);
      } else if (base === 'renv.lock') {
        parseRenvLock(fs.readFileSync(file, 'utf8'), found);
      }
    } catch {
      // unreadable file — skip
    }
  });
  return [...found].sort();
}

// ---------------------------------------------------------------------------
// Remote fetch (https-only, redirect-following)
// ---------------------------------------------------------------------------

function httpsGet(url: string, token: string | null, redirects = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error(`invalid URL: ${url}`));
    }
    if (u.protocol !== 'https:') return reject(new Error(`only https is allowed: ${url}`));
    const headers: Record<string, string> = { 'User-Agent': 'shinylaunchR' };
    // Only attach the PAT to GitHub hosts.
    if (token && /(^|\.)github(usercontent)?\.com$/.test(u.hostname)) {
      headers.Authorization = `token ${token}`;
    }
    https
      .get(u, { headers }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, u).href;
          resolve(httpsGet(next, token, redirects + 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${status} fetching ${u.hostname}${u.pathname}`));
        }
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/** A single top-level wrapper dir (as zips/zipballs produce) collapses to itself. */
function effectiveRoot(dir: string): string {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (entries.length === 1 && entries[0]!.isDirectory()) {
      return path.join(dir, entries[0]!.name);
    }
  } catch {
    // ignore
  }
  return dir;
}

function rmrf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function materialise(
  origin: SourceOrigin,
  destDir: string,
  token: string | null,
): Promise<string> {
  fs.mkdirSync(destDir, { recursive: true });
  switch (origin.from) {
    case 'zip': {
      if (origin.filePath) {
        extractZipFile(origin.filePath, destDir);
      } else if (origin.url) {
        extractZipBuffer(await httpsGet(origin.url, token), destDir);
      }
      return effectiveRoot(destDir);
    }
    case 'local': {
      const src = origin.path;
      if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
        throw new Error(`local folder not found: ${src}`);
      }
      fs.cpSync(src, destDir, { recursive: true });
      return destDir;
    }
    case 'github': {
      const [repoPart, ref] = origin.repo.split('@');
      const url = `https://api.github.com/repos/${repoPart}/zipball/${ref ?? ''}`;
      extractZipBuffer(await httpsGet(url, token), destDir);
      return effectiveRoot(destDir);
    }
    case 'gist': {
      const meta = JSON.parse(
        (await httpsGet(`https://api.github.com/gists/${origin.id}`, token)).toString('utf8'),
      ) as { files?: Record<string, { filename?: string; content?: string; raw_url?: string; truncated?: boolean }> };
      for (const f of Object.values(meta.files ?? {})) {
        if (!f.filename) continue;
        // gist filenames are flat; reject any path separator defensively.
        if (/[\\/]/.test(f.filename)) continue;
        const content =
          f.truncated && f.raw_url ? (await httpsGet(f.raw_url, token)).toString('utf8') : f.content ?? '';
        fs.writeFileSync(path.join(destDir, f.filename), content);
      }
      return destDir;
    }
  }
}

export interface StageDeps {
  userDataDir: string;
  token?: string | null;
}

export interface StageResult {
  ok: boolean;
  appDir?: string;
  message?: string;
}

/**
 * Stage a `source` app for `entry`: clear any previous staging, materialise the
 * files, then locate the Shiny entry directory. Returns the resolved app dir on
 * success, or a clear message (never throws into the caller).
 */
export async function stageSource(entry: AppEntry, deps: StageDeps): Promise<StageResult> {
  if (entry.source.kind !== 'source') {
    return { ok: false, message: 'not a source app' };
  }
  const staged = stagedDirFor(deps.userDataDir, entry.id);
  rmrf(staged);
  try {
    const root = await materialise(entry.source.origin, staged, deps.token ?? null);
    const appDir = findShinyAppDir(root, entry.source.appDir);
    if (!appDir) {
      rmrf(staged);
      return {
        ok: false,
        message:
          'No Shiny app found (need app.R, or ui.R + server.R). ' +
          'Check the archive/folder, or set the app sub-directory.',
      };
    }
    logger.info('source', `Staged "${entry.name}" → ${appDir}`, entry.id);
    return { ok: true, appDir };
  } catch (err) {
    rmrf(staged);
    const message = `Staging failed: ${err instanceof Error ? err.message : String(err)}`;
    logger.error('source', message, entry.id);
    return { ok: false, message };
  }
}

/** Remove a staged source app's directory (used on app removal). */
export function removeStaged(userDataDir: string, id: string): void {
  rmrf(stagedDirFor(userDataDir, id));
}
