import { useEffect, useState } from 'react';
import type { CredentialStatus, TokenTestResult } from '@shared/types';
import { api } from '../lib/api';

export function CredentialsPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [token, setToken] = useState('');
  const [test, setTest] = useState<TokenTestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => setStatus(await api.credStatus());
  useEffect(() => {
    void refresh();
  }, []);

  const save = async () => {
    if (!token.trim()) return;
    setBusy(true);
    try {
      setStatus(await api.credSet(token.trim()));
      setToken('');
      setTest(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      setStatus(await api.credRemove());
      setTest(null);
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    try {
      setTest(await api.credTest());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>GitHub Credentials</h2>
        <button className="btn ghost" aria-label="Close panel" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="panel-body">
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          A Personal Access Token lets shinylaunchR install from <strong>private</strong> repos and
          avoid API rate limits. It is stored in your OS secure store
          {status ? ` (${status.backend})` : ''} — never in plaintext, never logged.
        </p>

        <div className="kv">
          <div className="k">Stored token</div>
          <div className="v">
            {status?.present ? `•••• •••• ${status.last4}` : 'none'}
          </div>
          <div className="k">Backend</div>
          <div className="v">{status?.backend ?? '—'}</div>
        </div>

        {status?.backend === 'unavailable' && (
          <p style={{ color: 'var(--status-red)', fontSize: 12 }}>
            Secure store (keytar) is unavailable — tokens will be kept for this session only.
          </p>
        )}

        <hr className="sep" />
        <div className="field">
          <label>{status?.present ? 'Replace token' : 'Add token'}</label>
          <input
            type="password"
            placeholder="ghp_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" disabled={busy || !token.trim()} onClick={save}>
            Save
          </button>
          <button className="btn" disabled={busy || !status?.present} onClick={runTest}>
            Test token
          </button>
          <button className="btn danger" disabled={busy || !status?.present} onClick={remove}>
            Remove
          </button>
        </div>

        {test && (
          <p style={{ marginTop: 14, fontSize: 13 }}>
            {test.ok ? (
              <span style={{ color: 'var(--status-green)' }}>
                ✓ Authenticated as <strong>{test.login}</strong>
                {test.scopes?.length ? ` (scopes: ${test.scopes.join(', ')})` : ''}
              </span>
            ) : (
              <span style={{ color: 'var(--status-red)' }}>✕ {test.message}</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
