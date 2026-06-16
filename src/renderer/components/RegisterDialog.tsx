/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import {
  appFamily,
  isSafeRelPath,
  isValidGist,
  isValidHttpsUrl,
  isValidName,
  isValidPkg,
  isValidRepo,
  type AppEntry,
  type AppEntryInput,
  type AppFamily,
  type AppSource,
} from '@shared/types';
import { api } from '../lib/api';
import { useFocusTrap } from '../lib/useFocusTrap';

export interface RegisterDialogProps {
  editing?: AppEntry;
  /** Pre-set family when opened from a section "+" tile (ignored while editing). */
  initialFamily?: AppFamily;
  onClose: () => void;
  onSubmit: (input: AppEntryInput) => void;
}

type PkgKind = 'cran' | 'github';
type OriginType = 'zip-upload' | 'local' | 'zip-url' | 'gist' | 'github';

const FAMILY_LABEL: Record<AppFamily, string> = {
  package: 'R package',
  shinyfile: 'Shiny app',
  url: 'Hosted URL',
};

function deriveOriginType(source: AppEntry['source']): OriginType {
  if (source.kind !== 'source') return 'zip-upload';
  const o = source.origin;
  if (o.from === 'zip') return o.filePath ? 'zip-upload' : 'zip-url';
  if (o.from === 'local') return 'local';
  if (o.from === 'gist') return 'gist';
  return 'github';
}

export function RegisterDialog({ editing, initialFamily, onClose, onSubmit }: RegisterDialogProps) {
  const editFamily = editing ? appFamily(editing.source) : undefined;
  const [family, setFamily] = useState<AppFamily>(editFamily ?? initialFamily ?? 'package');

  const [name, setName] = useState(editing?.name ?? '');

  // PACKAGE family
  const [pkgKind, setPkgKind] = useState<PkgKind>(
    editing?.source.kind === 'github' ? 'github' : 'cran',
  );
  const [repo, setRepo] = useState(editing?.source.kind === 'github' ? editing.source.repo : '');
  const [pkg, setPkg] = useState(editing?.pkg ?? '');
  const [fun, setFun] = useState(editing?.fun ?? '');
  const [pkgTouched, setPkgTouched] = useState(Boolean(editing?.pkg));

  // SHINY FILE family
  const initialOrigin = editing ? deriveOriginType(editing.source) : 'zip-upload';
  const [originType, setOriginType] = useState<OriginType>(initialOrigin);
  const srcOrigin = editing?.source.kind === 'source' ? editing.source.origin : undefined;
  const [zipFilePath, setZipFilePath] = useState(
    srcOrigin?.from === 'zip' ? (srcOrigin.filePath ?? '') : '',
  );
  const [zipUrl, setZipUrl] = useState(srcOrigin?.from === 'zip' ? (srcOrigin.url ?? '') : '');
  const [localPath, setLocalPath] = useState(srcOrigin?.from === 'local' ? srcOrigin.path : '');
  const [gistId, setGistId] = useState(srcOrigin?.from === 'gist' ? srcOrigin.id : '');
  const [ghRepo, setGhRepo] = useState(srcOrigin?.from === 'github' ? srcOrigin.repo : '');
  const [appDir, setAppDir] = useState(
    editing?.source.kind === 'source' ? (editing.source.appDir ?? '') : '',
  );

  // HOSTED URL family
  const [url, setUrl] = useState(editing?.source.kind === 'url' ? editing.source.url : '');

  // Common
  const [iconPath, setIconPath] = useState<string | undefined>(editing?.iconPath);
  const [portMode, setPortMode] = useState<'auto' | 'fixed'>(editing?.fixedPort ? 'fixed' : 'auto');
  const [port, setPort] = useState<string>(editing?.fixedPort ? String(editing.fixedPort) : '');
  const [frameless, setFrameless] = useState<boolean>(editing?.frameless ?? false);
  const trapRef = useFocusTrap<HTMLDivElement>();

  // Auto-suggest package name from "org/repo" until the user edits it.
  useEffect(() => {
    if (family === 'package' && pkgKind === 'github' && !pkgTouched) {
      const m = repo.match(/^[^/]+\/([^@]+)/);
      if (m?.[1]) setPkg(m[1].replace(/[^A-Za-z0-9.]/g, ''));
    }
  }, [repo, family, pkgKind, pkgTouched]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Display name is required.';
    if (family === 'package') {
      if (!isValidPkg(pkg)) e.pkg = 'Letters, digits and dots only (R package name).';
      if (!isValidName(fun)) e.fun = 'Must match ^[A-Za-z.][A-Za-z0-9._]*$';
      if (pkgKind === 'github' && !isValidRepo(repo)) e.repo = 'Use org/repo or org/repo@ref';
    } else if (family === 'url') {
      if (!isValidHttpsUrl(url)) e.url = 'Enter a full https:// URL.';
    } else {
      // shinyfile
      if (originType === 'zip-upload' && !zipFilePath) e.origin = 'Choose a .zip file.';
      if (originType === 'local' && !localPath) e.origin = 'Choose a folder.';
      if (originType === 'zip-url' && !isValidHttpsUrl(zipUrl)) e.origin = 'Enter an https zip URL.';
      if (originType === 'gist' && !isValidGist(gistId)) e.origin = 'Enter a gist id.';
      if (originType === 'github' && !isValidRepo(ghRepo)) e.origin = 'Use org/repo or org/repo@ref';
      if (appDir && !isSafeRelPath(appDir)) e.appDir = 'A relative path inside the app (no "..").';
    }
    if (portMode === 'fixed') {
      const p = Number(port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) e.port = 'Port must be 1–65535.';
    }
    return e;
  }, [
    name, family, pkg, fun, pkgKind, repo, url, originType, zipFilePath, localPath, zipUrl, gistId,
    ghRepo, appDir, portMode, port,
  ]);

  const valid = Object.keys(errors).length === 0;

  const buildSource = (): AppSource => {
    if (family === 'package') {
      return pkgKind === 'cran' ? { kind: 'cran' } : { kind: 'github', repo };
    }
    if (family === 'url') {
      return { kind: 'url', url };
    }
    const dir = appDir.trim() || undefined;
    switch (originType) {
      case 'zip-upload':
        return { kind: 'source', origin: { from: 'zip', filePath: zipFilePath }, appDir: dir };
      case 'zip-url':
        return { kind: 'source', origin: { from: 'zip', url: zipUrl }, appDir: dir };
      case 'local':
        return { kind: 'source', origin: { from: 'local', path: localPath }, appDir: dir };
      case 'gist':
        return { kind: 'source', origin: { from: 'gist', id: gistId }, appDir: dir };
      case 'github':
        return { kind: 'source', origin: { from: 'github', repo: ghRepo }, appDir: dir };
    }
  };

  const submit = () => {
    if (!valid) return;
    const input: AppEntryInput = {
      name: name.trim(),
      pkg: family === 'package' ? pkg : undefined,
      fun: family === 'package' ? fun : undefined,
      source: buildSource(),
      iconPath,
      fixedPort: portMode === 'fixed' ? Number(port) : undefined,
      frameless,
    };
    onSubmit(input);
  };

  const pickIcon = async () => {
    const picked = await api.pickIcon();
    if (picked) setIconPath(picked);
  };
  const pickZip = async () => {
    const picked = await api.pickZipFile();
    if (picked) setZipFilePath(picked);
  };
  const pickFolder = async () => {
    const picked = await api.pickFolder();
    if (picked) setLocalPath(picked);
  };

  const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Edit app' : 'Add a Shiny app'}
        ref={trapRef}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (
            e.key === 'Enter' &&
            (e.target as HTMLElement).tagName === 'INPUT' &&
            (e.target as HTMLInputElement).type !== 'radio' &&
            (e.target as HTMLInputElement).type !== 'checkbox'
          ) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <h2>{editing ? 'Edit app' : `Add a ${FAMILY_LABEL[family]}`}</h2>

        {!editing && (
          <div className="field">
            <label>Type</label>
            <div className="radio-row">
              {(['package', 'shinyfile', 'url'] as AppFamily[]).map((f) => (
                <label key={f}>
                  <input type="radio" checked={family === f} onChange={() => setFamily(f)} />
                  {FAMILY_LABEL[f]}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label>Display name</label>
          <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          {errors.name && <div className="error">{errors.name}</div>}
        </div>

        {family === 'package' && (
          <>
            <div className="field">
              <label>Source</label>
              <div className="radio-row">
                <label>
                  <input type="radio" checked={pkgKind === 'cran'} onChange={() => setPkgKind('cran')} />
                  CRAN
                </label>
                <label>
                  <input
                    type="radio"
                    checked={pkgKind === 'github'}
                    onChange={() => setPkgKind('github')}
                  />
                  GitHub
                </label>
              </div>
            </div>

            {pkgKind === 'github' && (
              <div className="field">
                <label>GitHub repo</label>
                <input
                  type="text"
                  placeholder="org/repo or org/repo@ref"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                />
                {errors.repo && <div className="error">{errors.repo}</div>}
                <div className="hint">Private repos use your stored GitHub token automatically.</div>
              </div>
            )}

            <div className="field">
              <label>Package name</label>
              <input
                type="text"
                value={pkg}
                onChange={(e) => {
                  setPkg(e.target.value);
                  setPkgTouched(true);
                }}
              />
              {errors.pkg && <div className="error">{errors.pkg}</div>}
              {pkgKind === 'github' && (
                <div className="hint">Repo name and package name can differ — override if needed.</div>
              )}
            </div>

            <div className="field">
              <label>Launcher function</label>
              <input
                type="text"
                placeholder="e.g. mp_run_app"
                value={fun}
                onChange={(e) => setFun(e.target.value)}
              />
              {errors.fun && <div className="error">{errors.fun}</div>}
              <div className="hint">
                Called as <code>{(pkg || 'pkg') + '::' + (fun || 'fun')}()</code> — never a shell.
              </div>
            </div>
          </>
        )}

        {family === 'shinyfile' && (
          <>
            <div className="field">
              <label>Source</label>
              <select value={originType} onChange={(e) => setOriginType(e.target.value as OriginType)}>
                <option value="zip-upload">Upload .zip</option>
                <option value="local">Local folder</option>
                <option value="zip-url">Zip URL</option>
                <option value="gist">Gist</option>
                <option value="github">GitHub source repo</option>
              </select>
            </div>

            {originType === 'zip-upload' && (
              <div className="field">
                <label>App .zip</label>
                <div className="row">
                  <button className="btn" type="button" onClick={pickZip}>
                    Choose .zip…
                  </button>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                    {zipFilePath ? baseName(zipFilePath) : 'no file chosen'}
                  </span>
                </div>
                {errors.origin && <div className="error">{errors.origin}</div>}
              </div>
            )}
            {originType === 'local' && (
              <div className="field">
                <label>App folder</label>
                <div className="row">
                  <button className="btn" type="button" onClick={pickFolder}>
                    Choose folder…
                  </button>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                    {localPath ? baseName(localPath) : 'no folder chosen'}
                  </span>
                </div>
                {errors.origin && <div className="error">{errors.origin}</div>}
                <div className="hint">The folder is copied into the app — never run in place.</div>
              </div>
            )}
            {originType === 'zip-url' && (
              <div className="field">
                <label>Zip URL</label>
                <input
                  type="text"
                  placeholder="https://…/app.zip"
                  value={zipUrl}
                  onChange={(e) => setZipUrl(e.target.value)}
                />
                {errors.origin && <div className="error">{errors.origin}</div>}
              </div>
            )}
            {originType === 'gist' && (
              <div className="field">
                <label>Gist id</label>
                <input
                  type="text"
                  placeholder="e.g. 3b8c1f2e…"
                  value={gistId}
                  onChange={(e) => setGistId(e.target.value)}
                />
                {errors.origin && <div className="error">{errors.origin}</div>}
              </div>
            )}
            {originType === 'github' && (
              <div className="field">
                <label>GitHub source repo</label>
                <input
                  type="text"
                  placeholder="org/repo or org/repo@ref"
                  value={ghRepo}
                  onChange={(e) => setGhRepo(e.target.value)}
                />
                {errors.origin && <div className="error">{errors.origin}</div>}
                <div className="hint">A repo of Shiny *files* (app.R / ui.R+server.R), not a package.</div>
              </div>
            )}

            <div className="field">
              <label>App sub-directory (optional)</label>
              <input
                type="text"
                placeholder="e.g. inst/shiny"
                value={appDir}
                onChange={(e) => setAppDir(e.target.value)}
              />
              {errors.appDir && <div className="error">{errors.appDir}</div>}
              <div className="hint">Where app.R / ui.R+server.R live, if not at the top level.</div>
            </div>
          </>
        )}

        {family === 'url' && (
          <div className="field">
            <label>App URL</label>
            <input
              type="text"
              placeholder="https://example.shinyapps.io/myapp/"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            {errors.url && <div className="error">{errors.url}</div>}
            <div className="hint">Opens in an isolated, https-only window. Nothing is installed.</div>
          </div>
        )}

        <div className="field">
          <label>Icon (optional)</label>
          <div className="row">
            <button className="btn" onClick={pickIcon} type="button">
              Choose file…
            </button>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {iconPath
                ? baseName(iconPath)
                : family === 'package'
                  ? 'auto-resolve from package'
                  : 'a grey hex is used by default'}
            </span>
            {iconPath && (
              <button className="btn ghost" type="button" onClick={() => setIconPath(undefined)}>
                clear
              </button>
            )}
          </div>
        </div>

        {family !== 'url' && (
          <div className="field">
            <label>Port</label>
            <div className="radio-row">
              <label>
                <input type="radio" checked={portMode === 'auto'} onChange={() => setPortMode('auto')} />
                Auto
              </label>
              <label>
                <input
                  type="radio"
                  checked={portMode === 'fixed'}
                  onChange={() => setPortMode('fixed')}
                />
                Fixed
              </label>
              {portMode === 'fixed' && (
                <input
                  type="number"
                  style={{ width: 120 }}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              )}
            </div>
            {errors.port && <div className="error">{errors.port}</div>}
          </div>
        )}

        <div className="field">
          <label className="checkbox-row">
            <input type="checkbox" checked={frameless} onChange={(e) => setFrameless(e.target.checked)} />
            Frameless launched window
          </label>
        </div>

        <div className="actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={submit}>
            {editing ? 'Save' : family === 'url' ? 'Add' : 'Add & install'}
          </button>
        </div>
      </div>
    </div>
  );
}
