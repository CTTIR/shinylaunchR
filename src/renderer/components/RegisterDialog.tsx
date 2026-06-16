import { useEffect, useMemo, useState } from 'react';
import {
  isValidName,
  isValidPkg,
  isValidRepo,
  type AppEntry,
  type AppEntryInput,
} from '@shared/types';
import { api } from '../lib/api';
import { useFocusTrap } from '../lib/useFocusTrap';

export interface RegisterDialogProps {
  editing?: AppEntry;
  onClose: () => void;
  onSubmit: (input: AppEntryInput) => void;
}

type SourceKind = 'cran' | 'github';

export function RegisterDialog({ editing, onClose, onSubmit }: RegisterDialogProps) {
  const [name, setName] = useState(editing?.name ?? '');
  const [kind, setKind] = useState<SourceKind>(editing?.source.kind ?? 'cran');
  const [repo, setRepo] = useState(
    editing?.source.kind === 'github' ? editing.source.repo : '',
  );
  const [pkg, setPkg] = useState(editing?.pkg ?? '');
  const [fun, setFun] = useState(editing?.fun ?? '');
  const [iconPath, setIconPath] = useState<string | undefined>(editing?.iconPath);
  const [portMode, setPortMode] = useState<'auto' | 'fixed'>(editing?.fixedPort ? 'fixed' : 'auto');
  const [port, setPort] = useState<string>(editing?.fixedPort ? String(editing.fixedPort) : '');
  const [frameless, setFrameless] = useState<boolean>(editing?.frameless ?? false);
  const [pkgTouched, setPkgTouched] = useState(Boolean(editing));
  const trapRef = useFocusTrap<HTMLDivElement>();

  // Auto-suggest package name from "org/repo" until the user edits it.
  useEffect(() => {
    if (kind === 'github' && !pkgTouched) {
      const m = repo.match(/^[^/]+\/([^@]+)/);
      if (m?.[1]) setPkg(m[1].replace(/[^A-Za-z0-9.]/g, ''));
    }
  }, [repo, kind, pkgTouched]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Display name is required.';
    if (!isValidPkg(pkg)) e.pkg = 'Letters, digits and dots only (R package name).';
    if (!isValidName(fun)) e.fun = 'Must match ^[A-Za-z.][A-Za-z0-9._]*$';
    if (kind === 'github' && !isValidRepo(repo)) e.repo = 'Use org/repo or org/repo@ref';
    if (portMode === 'fixed') {
      const p = Number(port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) e.port = 'Port must be 1–65535.';
    }
    return e;
  }, [name, pkg, fun, kind, repo, portMode, port]);

  const valid = Object.keys(errors).length === 0;

  const submit = () => {
    if (!valid) return;
    const input: AppEntryInput = {
      name: name.trim(),
      pkg,
      fun,
      source: kind === 'cran' ? { kind: 'cran' } : { kind: 'github', repo },
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
          // Enter submits from any input field (not from buttons/selects).
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
        <h2>{editing ? 'Edit app' : 'Add a Shiny app'}</h2>

        <div className="field">
          <label>Display name</label>
          <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          {errors.name && <div className="error">{errors.name}</div>}
        </div>

        <div className="field">
          <label>Source</label>
          <div className="radio-row">
            <label>
              <input
                type="radio"
                checked={kind === 'cran'}
                onChange={() => setKind('cran')}
              />
              CRAN
            </label>
            <label>
              <input
                type="radio"
                checked={kind === 'github'}
                onChange={() => setKind('github')}
              />
              GitHub
            </label>
          </div>
        </div>

        {kind === 'github' && (
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
          {kind === 'github' && (
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

        <div className="field">
          <label>Icon (optional)</label>
          <div className="row">
            <button className="btn" onClick={pickIcon} type="button">
              Choose file…
            </button>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {iconPath ? iconPath.split(/[\\/]/).pop() : 'auto-resolve from package'}
            </span>
            {iconPath && (
              <button className="btn ghost" type="button" onClick={() => setIconPath(undefined)}>
                clear
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <label>Port</label>
          <div className="radio-row">
            <label>
              <input
                type="radio"
                checked={portMode === 'auto'}
                onChange={() => setPortMode('auto')}
              />
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

        <div className="field">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={frameless}
              onChange={(e) => setFrameless(e.target.checked)}
            />
            Frameless launched window
          </label>
        </div>

        <div className="actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={submit}>
            {editing ? 'Save' : 'Add & install'}
          </button>
        </div>
      </div>
    </div>
  );
}
