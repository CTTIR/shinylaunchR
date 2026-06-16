/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { RStatus } from '@shared/types';
import { api } from '../lib/api';

export function RManagerPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<RStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => setStatus(await api.rStatus());
  useEffect(() => {
    void refresh();
  }, []);

  const run = async (fn: () => Promise<RStatus>) => {
    setBusy(true);
    try {
      setStatus(await fn());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>R Runtime</h2>
        <button className="btn ghost" aria-label="Close panel" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="panel-body">
        {!status ? (
          <p>Checking…</p>
        ) : (
          <>
            <div className="kv">
              <div className="k">Status</div>
              <div className="v">
                {status.found ? (
                  <span className="badge" style={{ color: 'var(--status-green)' }}>
                    detected ({status.source})
                  </span>
                ) : (
                  <span className="badge" style={{ color: 'var(--status-red)' }}>
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
              <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{status.message}</p>
            )}
          </>
        )}

        <hr className="sep" />
        <div className="section-title">Actions</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn" disabled={busy} onClick={() => run(() => api.rBootstrap())}>
            Bootstrap managed R
          </button>
          <button className="btn" disabled={busy} onClick={() => run(() => api.rPointTo())}>
            Point to existing R…
          </button>
          <button className="btn" disabled={busy} onClick={() => void api.rOpenLibrary()}>
            Open library folder
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 16 }}>
          shinylaunchR targets R ≥ 4.2. Managed-R bootstrap downloads are configured in
          <code> r-sources.json</code>; if unavailable, point to an existing R installation.
        </p>
      </div>
    </div>
  );
}
