/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import type { CredentialStatus, TokenTestResult } from '@shared/types';
import { useFocusTrap } from '../lib/useFocusTrap';
import { api } from '../lib/api';

export function CredentialsPanel({ onClose }: { onClose: () => void }) {
  const trap = useFocusTrap<HTMLDivElement>();
  const [error, setError] = useState('');
  const [statusFailed, setStatusFailed] = useState(false);
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [token, setToken] = useState('');
  const [test, setTest] = useState<TokenTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  const refresh = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      setStatus(await api.credStatus());
      setStatusFailed(false);
      setError('');
    } catch (e) {
      setStatus(null);
      setStatusFailed(true);
      setError(String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const save = async () => {
    if (!token.trim()) return;
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      setStatus(await api.credSet(token.trim()));
      setStatusFailed(false);
      setToken('');
      setTest(null);
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const remove = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      setStatus(await api.credRemove());
      setStatusFailed(false);
      setTest(null);
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const runTest = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      setTest(await api.credTest());
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
      aria-label="GitHub Credentials"
      tabIndex={-1}
      ref={trap}
    >
      <div className="panel-header">
        <h2>GitHub Credentials</h2>
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
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          A Personal Access Token lets shinylaunchR install from{' '}
          <strong>private</strong> repos and avoid API rate limits. Encrypted
          storage is used only when the OS provides a secure backend. Otherwise
          the token lasts for this session only.
        </p>

        <div className="kv">
          <div className="k">Stored token</div>
          <div className="v">
            {status
              ? status.present
                ? `•••• •••• ${status.last4}`
                : 'none'
              : statusFailed
                ? 'unknown — unable to read stored token'
                : 'Checking…'}
          </div>
          <div className="k">Backend</div>
          <div className="v">{status?.backend ?? '—'}</div>
        </div>

        {status && status.backend !== 'safeStorage' && (
          <p style={{ color: 'var(--status-red)', fontSize: 12 }}>
            Persistent secure storage is unavailable. A saved token is kept in
            memory for this session and must be entered again after restarting.
          </p>
        )}

        {!status && (
          <button className="btn" disabled={busy} onClick={refresh}>
            Retry status
          </button>
        )}
        {statusFailed && (
          <p className="hint">
            Stored credentials could not be read. Unlock your system credential
            store and retry, or remove the saved token to start again.
          </p>
        )}
        <hr className="sep" />
        <div className="field">
          <label htmlFor="github-token">
            {statusFailed
              ? 'Add or replace token'
              : status?.present
                ? 'Replace token'
                : 'Add token'}
          </label>
          <input
            id="github-token"
            autoComplete="off"
            type="password"
            placeholder="ghp_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn primary"
            disabled={busy || !token.trim()}
            onClick={save}
          >
            Save
          </button>
          <button
            className="btn"
            disabled={busy || !status?.present}
            onClick={runTest}
          >
            Test token
          </button>
          <button
            className="btn danger"
            disabled={busy || (!status?.present && !statusFailed)}
            onClick={remove}
          >
            Remove
          </button>
        </div>

        {test && (
          <p style={{ marginTop: 14, fontSize: 13 }}>
            {test.ok ? (
              <span style={{ color: 'var(--status-green)' }}>
                ✓ Authenticated as <strong>{test.login}</strong>
                {test.scopes?.length
                  ? ` (scopes: ${test.scopes.join(', ')})`
                  : ''}
              </span>
            ) : (
              <span style={{ color: 'var(--status-red)' }}>
                ✕ {test.message}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
