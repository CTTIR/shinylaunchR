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
import { randomUUID } from 'node:crypto';
import { assertInside, assertAppId } from './safe-path';
import { runStageTask } from './staging-worker';
import { isValidPkg, type AppEntry, type SourceOrigin } from '@shared/types';
import { logger } from './logger';

/** Base R packages that ship with R — never install-resolved from a scan. */
const BASE_PKGS = new Set([
  'base',
  'compiler',
  'datasets',
  'graphics',
  'grDevices',
  'grid',
  'methods',
  'parallel',
  'splines',
  'stats',
  'stats4',
  'tcltk',
  'tools',
  'translations',
  'utils',
]);

export function appsRootDir(userDataDir: string): string {
  return path.join(userDataDir, 'apps');
}

export function stagedDirFor(userDataDir: string, id: string): string {
  assertAppId(id);
  return assertInside(
    appsRootDir(userDataDir),
    path.join(appsRootDir(userDataDir), id),
  );
}

// ---------------------------------------------------------------------------
// App-entry discovery
// ---------------------------------------------------------------------------

function dirHasShinyApp(dir: string): boolean {
  try {
    if (
      fs.existsSync(path.join(dir, 'app.R')) ||
      fs.existsSync(path.join(dir, 'app.r'))
    ) {
      return true;
    }
    const hasUi =
      fs.existsSync(path.join(dir, 'ui.R')) ||
      fs.existsSync(path.join(dir, 'ui.r'));
    const hasSrv =
      fs.existsSync(path.join(dir, 'server.R')) ||
      fs.existsSync(path.join(dir, 'server.r'));
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
export function findShinyAppDir(
  baseDir: string,
  appDir?: string,
): string | undefined {
  const start = appDir
    ? assertInside(baseDir, path.join(baseDir, appDir))
    : baseDir;
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

const DEP_FIELDS = new Set(['Imports', 'Depends', 'LinkingTo']);

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
    const name = raw
      .trim()
      .replace(/\s*\(.*$/, '')
      .trim(); // strip "(>= 1.0)"
    if (name && name !== 'R' && !BASE_PKGS.has(name) && isValidPkg(name))
      into.add(name);
  }
}

function parseRenvLock(text: string, into: Set<string>): void {
  try {
    const lock = JSON.parse(text) as {
      Packages?: Record<string, { Package?: string }>;
    };
    for (const v of Object.values(lock.Packages ?? {})) {
      const name = v?.Package;
      if (name && !BASE_PKGS.has(name) && isValidPkg(name)) into.add(name);
    }
  } catch (err) {
    throw new Error(`Invalid renv.lock: ${String(err)}`, { cause: err });
  }
}

function walkFiles(
  dir: string,
  depth: number,
  visit: (file: string) => void,
): void {
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
 * Separate declared hard requirements from advisory `library()` /
 * `require()` / `requireNamespace()` / `pkg::` references in R/Rmd source, plus
 * DESCRIPTION dependency fields and renv.lock packages. `shiny` is always
 * included in required dependencies. Base R packages are excluded.
 */
export function scanDependencyModel(appDir: string): {
  required: string[];
  advisory: string[];
} {
  const found = new Set<string>(['shiny']);
  const advisory = new Set<string>();
  const libRe = /\b(?:library|require)\s*\(\s*["']?([A-Za-z][A-Za-z0-9.]*)/g;
  const reqNsRe = /requireNamespace\s*\(\s*["']([A-Za-z][A-Za-z0-9.]*)/g;
  const nsRe = /([A-Za-z][A-Za-z0-9.]*)\s*::/g;

  walkFiles(appDir, 0, (file) => {
    const base = path.basename(file);
    try {
      if (/\.(R|r|Rmd|rmd)$/.test(base)) {
        const text = fs.readFileSync(file, 'utf8');
        addMatches(text, libRe, advisory);
        addMatches(text, reqNsRe, advisory);
        addMatches(text, nsRe, advisory);
      } else if (base === 'DESCRIPTION') {
        parseDescriptionDeps(fs.readFileSync(file, 'utf8'), found);
      } else if (base === 'renv.lock') {
        parseRenvLock(fs.readFileSync(file, 'utf8'), found);
      }
    } catch (err) {
      if (base === 'DESCRIPTION' || base === 'renv.lock') throw err;
    }
  });
  return {
    required: [...found].sort(),
    advisory: [...advisory].filter((p) => !found.has(p)).sort(),
  };
}

// ---------------------------------------------------------------------------
// Remote fetch (https-only, redirect-following)
// ---------------------------------------------------------------------------

/** Abort a remote fetch that stalls (no socket activity) for this long. */
const REQUEST_TIMEOUT_MS = 30_000;

export function httpsGet(
  url: string,
  token: string | null,
  signal?: AbortSignal,
  maxBytes = 64 * 1024 * 1024,
  deadline = Date.now() + 60000,
  redirects = 0,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Download cancelled'));
    if (redirects > 5 || Date.now() >= deadline)
      return reject(new Error('Download deadline or redirect limit exceeded'));
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error('Invalid download URL'));
    }
    if (u.protocol !== 'https:' || u.username || u.password)
      return reject(new Error('Only clean HTTPS URLs are allowed'));
    const headers: Record<string, string> = { 'User-Agent': 'shinylaunchR' };
    if (token && /(^|\.)github(usercontent)?\.com$/.test(u.hostname))
      headers.Authorization = `token ${token}`;
    const req = https.get(
      u,
      { headers, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          cleanup();
          try {
            const next = new URL(res.headers.location, u).href;
            resolve(
              httpsGet(next, token, signal, maxBytes, deadline, redirects + 1),
            );
          } catch (err) {
            reject(new Error('Invalid download redirect URL', { cause: err }));
          }
          return;
        }
        if (status !== 200) {
          res.resume();
          cleanup();
          reject(new Error(`HTTP ${status} fetching ${u.hostname}`));
          return;
        }
        let received = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            res.destroy(new Error('Download byte budget exceeded'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          cleanup();
          resolve(Buffer.concat(chunks));
        });
        res.on('error', (err) => {
          cleanup();
          reject(err);
        });
      },
    );
    const abort = (): void => {
      req.destroy(new Error('Download cancelled'));
    };
    const timer = setTimeout(
      () => req.destroy(new Error('Download deadline exceeded')),
      Math.max(1, deadline - Date.now()),
    );
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    signal?.addEventListener('abort', abort, { once: true });
    req.on('timeout', () => req.destroy(new Error('Download timed out')));
    req.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

/** Only declared dependencies block installation; scans are advisory. */
export function scanDependencies(appDir: string): string[] {
  return scanDependencyModel(appDir).required;
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

function rmrf(root: string, dir: string): void {
  fs.rmSync(assertInside(root, dir), { recursive: true, force: true });
}

async function materialise(
  origin: SourceOrigin,
  destDir: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<string> {
  switch (origin.from) {
    case 'zip': {
      if (origin.filePath)
        await runStageTask({ zipFile: origin.filePath, dest: destDir }, signal);
      else if (origin.url)
        await runStageTask(
          { zip: await httpsGet(origin.url, token, signal), dest: destDir },
          signal,
        );
      else throw new Error('ZIP source is missing');
      return effectiveRoot(destDir);
    }
    case 'local': {
      await runStageTask({ source: origin.path, dest: destDir }, signal);
      return destDir;
    }
    case 'github': {
      const [repoPart, ref] = origin.repo.split('@');
      const url = `https://api.github.com/repos/${repoPart}/zipball/${ref ? encodeURIComponent(ref) : ''}`;
      await runStageTask(
        { zip: await httpsGet(url, token, signal), dest: destDir },
        signal,
      );
      const root = effectiveRoot(destDir);
      return origin.subdir
        ? assertInside(root, path.join(root, origin.subdir))
        : root;
    }
    case 'gist': {
      const deadline = Date.now() + 60000;
      const meta = JSON.parse(
        (
          await httpsGet(
            `https://api.github.com/gists/${origin.id}`,
            token,
            signal,
            8 * 1024 * 1024,
            deadline,
          )
        ).toString('utf8'),
      ) as {
        files?: Record<
          string,
          {
            filename?: string;
            content?: string;
            raw_url?: string;
            truncated?: boolean;
          }
        >;
      };
      let total = 0;
      const files = Object.values(meta.files ?? {});
      if (files.length > 1000) throw new Error('Gist entry budget exceeded');
      for (const f of files) {
        if (
          !f.filename ||
          /[\\/]/.test(f.filename) ||
          f.filename === '.' ||
          f.filename === '..'
        )
          throw new Error('Invalid gist filename');
        if (signal?.aborted || Date.now() > deadline)
          throw new Error('Gist cancelled or timed out');
        const content =
          f.truncated && f.raw_url
            ? await httpsGet(
                f.raw_url,
                token,
                signal,
                64 * 1024 * 1024 - total,
                deadline,
              )
            : Buffer.from(f.content ?? '');
        total += content.length;
        if (total > 64 * 1024 * 1024)
          throw new Error('Gist byte budget exceeded');
        fs.writeFileSync(
          assertInside(destDir, path.join(destDir, f.filename)),
          content,
          { flag: 'wx' },
        );
      }
      return destDir;
    }
  }
}

export interface StageDeps {
  userDataDir: string;
  token?: string | null;
  signal?: AbortSignal;
}
export interface StageResult {
  ok: boolean;
  appDir?: string;
  message?: string;
}
export interface PreparedSource extends StageResult {
  commit(): string;
  rollback(): void;
  finalize(): void;
}

/** Keep the previous revision until the caller has installed candidate dependencies. */
export async function prepareSource(
  entry: AppEntry,
  deps: StageDeps,
): Promise<PreparedSource> {
  let candidate: string | undefined;
  const root = appsRootDir(deps.userDataDir);
  let state: 'prepared' | 'committed' | 'finalized' | 'rolled-back' =
    'prepared';
  let staged: string | undefined;
  let backup: string | undefined;
  const rollback = (): void => {
    if (state === 'finalized' || state === 'rolled-back') return;
    if (state === 'committed' && staged && candidate) {
      // Move the rejected candidate aside before restoring the previous tree.
      assertInside(root, staged);
      assertInside(root, candidate);
      fs.renameSync(staged, candidate);
      try {
        if (backup) fs.renameSync(assertInside(root, backup), staged);
      } catch (err) {
        fs.renameSync(candidate, staged);
        throw err;
      }
      state = 'prepared';
    }
    if (candidate) rmrf(root, candidate);
    state = 'rolled-back';
  };
  try {
    if (entry.source.kind !== 'source') throw new Error('Not a source app');
    staged = stagedDirFor(deps.userDataDir, entry.id);
    candidate = assertInside(
      root,
      path.join(root, `${entry.id}.candidate-${randomUUID()}`),
    );
    fs.mkdirSync(candidate, { recursive: true });
    const materialised = await materialise(
      entry.source.origin,
      candidate,
      deps.token ?? null,
      deps.signal,
    );
    const appDir = findShinyAppDir(materialised, entry.source.appDir);
    if (!appDir)
      throw new Error(
        'No Shiny app found (need app.R, or ui.R + server.R). Check the app sub-directory.',
      );
    const relative = path.relative(candidate, appDir);
    return {
      ok: true,
      appDir,
      rollback,
      finalize: () => {
        if (state === 'finalized') return;
        if (state !== 'committed')
          throw new Error('Commit staging before finalizing');
        state = 'finalized';
        // Registry state is already durable; cleanup failure cannot undo publication.
        if (backup) {
          try {
            rmrf(root, backup);
          } catch (err) {
            logger.warn(
              'source',
              `Previous revision cleanup failed: ${String(err)}`,
            );
          }
        }
      },
      commit: () => {
        if (state !== 'prepared')
          throw new Error('Staging transaction already completed');
        if (deps.signal?.aborted) throw new Error('Staging cancelled');
        assertInside(root, staged!);
        assertInside(root, candidate!);
        backup = fs.existsSync(staged!)
          ? assertInside(root, `${staged}.previous-${randomUUID()}`)
          : undefined;
        if (backup) fs.renameSync(staged!, backup);
        try {
          fs.renameSync(candidate!, staged!);
        } catch (err) {
          if (backup) fs.renameSync(backup, staged!);
          backup = undefined;
          throw err;
        }
        state = 'committed';
        return relative
          ? assertInside(staged!, path.join(staged!, relative))
          : staged!;
      },
    };
  } catch (err) {
    rollback();
    return {
      ok: false,
      message: `Staging failed: ${String(err)}`,
      rollback,
      finalize: () => {
        throw new Error('Cannot finalize failed staging');
      },
      commit: () => {
        throw new Error('Cannot commit failed staging');
      },
    };
  }
}

export async function stageSource(
  entry: AppEntry,
  deps: StageDeps,
): Promise<StageResult> {
  const prepared = await prepareSource(entry, deps);
  if (!prepared.ok) return prepared;
  try {
    const appDir = prepared.commit();
    prepared.finalize();
    return { ok: true, appDir };
  } catch (err) {
    prepared.rollback();
    return { ok: false, message: String(err) };
  }
}

export function removeStaged(userDataDir: string, id: string): void {
  rmrf(appsRootDir(userDataDir), stagedDirFor(userDataDir, id));
}
