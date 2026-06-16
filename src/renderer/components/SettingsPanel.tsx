import { useEffect, useState } from 'react';
import type { AppSettings } from '@shared/types';
import { api } from '../lib/api';

export function SettingsPanel({
  onClose,
  onSettingsChanged,
}: {
  onClose: () => void;
  onSettingsChanged: (s: AppSettings) => void;
}) {
  const [s, setS] = useState<AppSettings | null>(null);

  useEffect(() => {
    void api.getSettings().then(setS);
  }, []);

  const patch = async (p: Partial<AppSettings>) => {
    const next = await api.setSettings(p);
    setS(next);
    onSettingsChanged(next);
  };

  if (!s) return null;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Settings</h2>
        <button className="btn ghost" aria-label="Close panel" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="panel-body">
        <div className="section-title">General</div>
        <div className="field">
          <label>Theme</label>
          <select value={s.theme} onChange={(e) => patch({ theme: e.target.value as AppSettings['theme'] })}>
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Window width</label>
            <input
              type="number"
              value={s.defaultWindowWidth}
              onChange={(e) => patch({ defaultWindowWidth: Number(e.target.value) })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Window height</label>
            <input
              type="number"
              value={s.defaultWindowHeight}
              onChange={(e) => patch({ defaultWindowHeight: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="field">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={s.startupLaunchLast}
              onChange={(e) => patch({ startupLaunchLast: e.target.checked })}
            />
            Re-launch last app on startup
          </label>
        </div>

        <hr className="sep" />
        <div className="section-title">Ports</div>
        <div className="field">
          <label>Port behaviour</label>
          <select
            value={s.portBehavior}
            onChange={(e) => patch({ portBehavior: e.target.value as AppSettings['portBehavior'] })}
          >
            <option value="auto">Auto (OS-assigned)</option>
            <option value="range">Within a range</option>
          </select>
        </div>
        {s.portBehavior === 'range' && (
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Range start</label>
              <input
                type="number"
                value={s.portRangeStart}
                onChange={(e) => patch({ portRangeStart: Number(e.target.value) })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Range end</label>
              <input
                type="number"
                value={s.portRangeEnd}
                onChange={(e) => patch({ portRangeEnd: Number(e.target.value) })}
              />
            </div>
          </div>
        )}

        <hr className="sep" />
        <div className="section-title">Sources</div>
        <div className="field">
          <label>CRAN mirror</label>
          <input
            type="text"
            value={s.cranMirror}
            onChange={(e) => patch({ cranMirror: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={s.preferPak}
              onChange={(e) => patch({ preferPak: e.target.checked })}
            />
            Prefer <code style={{ marginLeft: 4 }}>pak</code> for GitHub installs (else remotes)
          </label>
        </div>

        <hr className="sep" />
        <div className="section-title">Storage</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => void api.openUserData()}>
            Open data folder
          </button>
          <button className="btn" onClick={() => void api.clearIconCache()}>
            Clear icon cache
          </button>
        </div>
      </div>
    </div>
  );
}
