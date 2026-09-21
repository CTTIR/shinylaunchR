/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from '@shared/types';
import { api } from '../lib/api';
import { useFocusTrap } from '../lib/useFocusTrap';

export function SettingsPanel({
  onClose,
  onSettingsChanged,
}: {
  onClose: () => void;
  onSettingsChanged: (s: AppSettings) => void;
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const trap = useFocusTrap<HTMLDivElement>();
  const load = async () => {
    try {
      setSettings(await api.getSettings());
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const patch = async (value: Partial<AppSettings>, key?: string) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await api.setSettings(value);
      setSettings(next);
      onSettingsChanged(next);
      if (key)
        setDraft((d) => {
          const copy = { ...d };
          delete copy[key];
          return copy;
        });
    } catch (e) {
      setError(
        `${String(e)} Correct the value and press Enter or leave the field to retry.`,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const field = (
    key:
      | 'defaultWindowWidth'
      | 'defaultWindowHeight'
      | 'portRangeStart'
      | 'portRangeEnd'
      | 'cranMirror',
    label: string,
  ) => {
    const numeric = key !== 'cranMirror';
    const commit = () => {
      if (!(key in draft)) return;
      const value = draft[key]!.trim();
      if (!value || (numeric && !Number.isInteger(Number(value)))) {
        setError(
          `${label} requires ${numeric ? 'a whole number' : 'an HTTPS URL'}.`,
        );
        return;
      }
      void patch({ [key]: numeric ? Number(value) : value }, key);
    };
    return (
      <div className="field">
        <label htmlFor={key}>{label}</label>
        <input
          id={key}
          type={numeric ? 'number' : 'text'}
          value={draft[key] ?? String(settings![key])}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
      </div>
    );
  };
  const storage = async (
    fn: () => Promise<{ ok: boolean; message?: string }>,
  ) => {
    try {
      const result = await fn();
      if (!result.ok) throw new Error(result.message || 'Action failed');
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div
      className="panel"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      tabIndex={-1}
      ref={trap}
    >
      <div className="panel-header">
        <h2>Settings</h2>
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
            {error}
          </p>
        )}
        {!settings ? (
          <button className="btn" onClick={load}>
            Retry loading settings
          </button>
        ) : (
          <>
            <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
              <div className="field">
                <label htmlFor="theme">Theme</label>
                <select
                  id="theme"
                  value={settings.theme}
                  onChange={(e) =>
                    void patch({
                      theme: e.target.value as AppSettings['theme'],
                    })
                  }
                >
                  <option value="system">System</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
              {field('defaultWindowWidth', 'Window width')}
              {field('defaultWindowHeight', 'Window height')}
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.startupLaunchLast}
                  onChange={(e) =>
                    void patch({ startupLaunchLast: e.target.checked })
                  }
                />
                Re-launch last app on startup
              </label>
              <div className="field">
                <label htmlFor="port-behaviour">Port behaviour</label>
                <select
                  id="port-behaviour"
                  value={settings.portBehavior}
                  onChange={(e) =>
                    void patch({
                      portBehavior: e.target
                        .value as AppSettings['portBehavior'],
                    })
                  }
                >
                  <option value="auto">Auto (OS-assigned)</option>
                  <option value="range">Within a range</option>
                </select>
              </div>
              {settings.portBehavior === 'range' && (
                <>
                  {field('portRangeStart', 'Range start')}
                  {field('portRangeEnd', 'Range end')}
                </>
              )}
              {field('cranMirror', 'CRAN mirror')}
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.preferPak}
                  onChange={(e) => void patch({ preferPak: e.target.checked })}
                />
                Prefer pak for GitHub installs (else remotes)
              </label>
            </fieldset>
            <p className="hint">
              Text and number changes save on Enter or when you leave the field.
            </p>
            <div className="row">
              <button className="btn" onClick={() => storage(api.openUserData)}>
                Open data folder
              </button>
              <button
                className="btn"
                onClick={() => storage(api.clearIconCache)}
              >
                Clear automatic icon cache
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
