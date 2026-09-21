/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
import {
  isValidPkg,
  isValidRepo,
  type AppEntry,
  type AppSettings,
  type InstallResult,
} from '@shared/types';
import type { RRuntimeManager } from './r-runtime';
import { INSTALL_SCRIPT } from './r-scripts';
import { logger } from './logger';
export function safeRepos(url: string): string {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    /["\\\n\r]/.test(url)
  )
    throw new Error('CRAN mirror must be a clean HTTPS URL.');
  return parsed.href;
}
export interface InstallDeps {
  runtime: RRuntimeManager;
  settings: AppSettings;
  token?: string | null;
  signal?: AbortSignal;
  advisory?: string[];
}
export async function installPackage(
  entry: AppEntry,
  deps: InstallDeps,
): Promise<InstallResult> {
  return install(entry, [], deps);
}
export async function installSourceDeps(
  entry: AppEntry,
  pkgs: string[],
  deps: InstallDeps,
): Promise<InstallResult> {
  return install(entry, [...new Set(['shiny', ...pkgs])], deps);
}
async function install(
  entry: AppEntry,
  packages: string[],
  deps: InstallDeps,
): Promise<InstallResult> {
  try {
    const resolved = await deps.runtime.ready(deps.signal);
    if (!resolved)
      throw new Error('R is not available — select R ≥ 4.2 in R Runtime.');
    if (
      entry.source.kind !== 'source' &&
      (!entry.pkg || !isValidPkg(entry.pkg))
    )
      throw new Error('Invalid package.');
    if (entry.source.kind === 'github' && !isValidRepo(entry.source.repo))
      throw new Error('Invalid repository.');
    if (packages.some((p) => !isValidPkg(p)))
      throw new Error('Invalid dependency name.');
    const child = deps.runtime.processes.startScript(
      resolved.rPath,
      INSTALL_SCRIPT,
      {
        owner: entry.id,
        signal: deps.signal,
        timeoutMs: 30 * 60_000,
        env: deps.runtime.childEnv({
          ...(deps.token ? { GITHUB_PAT: deps.token } : {}),
          SLR_LIBRARY: deps.runtime.ensureLibrary(),
          SLR_KIND: entry.source.kind,
          SLR_PACKAGE: entry.pkg ?? '',
          SLR_REPO: entry.source.kind === 'github' ? entry.source.repo : '',
          SLR_PACKAGES: packages.join(','),
          SLR_ADVISORY: (deps.advisory ?? []).filter(isValidPkg).join(','),
          SLR_REPOS: safeRepos(deps.settings.cranMirror),
          SLR_PAK: String(deps.settings.preferPak),
        }),
        onLine: (line, stream) =>
          logger.log(
            stream === 'stderr' ? 'warn' : 'info',
            'installer',
            line,
            entry.id,
          ),
      },
    );
    const result = await child.done;
    if (
      result.error ||
      result.code !== 0 ||
      !result.stdout.split(/\r?\n/).includes('INSTALL_OK')
    ) {
      throw new Error(
        result.error ||
          result.stderr.trim() ||
          'Installation failed without a success record.',
      );
    }
    return { ok: true, id: entry.id };
  } catch (e) {
    const message = logger.redact(e instanceof Error ? e.message : String(e));
    logger.error('installer', message, entry.id);
    return { ok: false, id: entry.id, message };
  }
}
