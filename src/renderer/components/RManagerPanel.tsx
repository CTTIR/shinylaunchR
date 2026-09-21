/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import type { RStatus } from '@shared/types';
import { useFocusTrap } from '../lib/useFocusTrap';
import { api } from '../lib/api';

export function RManagerPanel({ onClose }: { onClose: () => void }) {
  const trap = useFocusTrap<HTMLDivElement>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState<RStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  const refresh = async () => {
    try {
      setStatus(await api.rStatus());
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const run = async (fn: () => Promise<RStatus>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      setStatus(await fn());
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      className="panel"
      role="dialog"
      aria-modal="true"
      aria-label="R Runtime"
      tabIndex={-1}
      ref={trap}
    >
      <div className="panel-header">
        <h2>R Runtime</h2>
        <button
          className="btn ghost"
          aria-label="Close panel"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="panel-body">
        {error && (
          <p role="alert" className="error">
            {error} Please try again.
          </p>
        )}
        {!status ? (
          <p>Checking…</p>
        ) : (
          <>
            <div className="kv">
              <div className="k">Status</div>
              <div className="v">
                {status.found ? (
                  <span
                    className="badge"
                    style={{ color: 'var(--status-green)' }}
                  >
                    detected ({status.source})
                  </span>
                ) : (
                  <span
                    className="badge"
                    style={{ color: 'var(--status-red)' }}
                  >
                    not found
                  </span>
                )}
              </div>
              <div className="k">Version</div>
              <div className="v">{status.version ?? '—'}</div>
              <div className="k">Rscript path</div>
              <div className="v">{status.rPath ?? '—'}</div>
              <div className="k">Managed library</div>
              <div className="v">{status.libraryPath ?? '—'}</div>
            </div>
            {status.message && (
              <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                {status.message}
              </p>
            )}
          </>
        )}

        <hr className="sep" />
        <div className="section-title">Actions</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button
            className="btn"
            disabled={busy}
            onClick={() => run(() => api.rPointTo())}
          >
            Point to existing R…
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void api
                .rOpenLibrary()
                .then((r) => {
                  if (!r.ok) setError(r.message || 'Could not open library');
                })
                .catch((e) => setError(String(e)))
            }
          >
            Open library folder
          </button>
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
        <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 16 }}>
          Install R ≥ 4.2 from the R Project, then choose “Point to existing R…”
          and select Rscript. Hosted URLs work without R. Packages and Shiny
          files require a local R installation.
        </p>
      </div>
    </div>
  );
}
