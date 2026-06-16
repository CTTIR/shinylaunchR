import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/types';
import { api } from '../lib/api';

export type HelpSection = 'help' | 'shortcuts' | 'about';

const SHORTCUTS: [string, string][] = [
  ['Ctrl/Cmd + N', 'Add app'],
  ['Ctrl/Cmd + E', 'Edit selected app'],
  ['Ctrl/Cmd + L', 'Launch selected app'],
  ['Ctrl/Cmd + `', 'Toggle log console'],
  ['Ctrl/Cmd + R', 'Reload dashboard'],
  ['Enter', 'Activate / launch focused tile'],
  ['Esc', 'Close dialog or panel'],
];

export function HelpPanel({
  section,
  onClose,
}: {
  section: HelpSection;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<HelpSection>(section);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => setTab(section), [section]);
  useEffect(() => {
    void api.appInfo().then(setInfo);
  }, []);

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Help</h2>
        <button className="btn ghost" aria-label="Close panel" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="panel-body">
        <div className="row" style={{ gap: 8, marginBottom: 16 }}>
          <button className={`btn ${tab === 'help' ? 'primary' : 'ghost'}`} onClick={() => setTab('help')}>
            Quick Start
          </button>
          <button
            className={`btn ${tab === 'shortcuts' ? 'primary' : 'ghost'}`}
            onClick={() => setTab('shortcuts')}
          >
            Shortcuts
          </button>
          <button
            className={`btn ${tab === 'about' ? 'primary' : 'ghost'}`}
            onClick={() => setTab('about')}
          >
            About
          </button>
        </div>

        {tab === 'help' && (
          <div>
            <p>
              <strong>shinylaunchR</strong> is a launchpad for R/Shiny apps. Each tile is a
              registered app; click <code>+</code> to add one and double-click a ready tile to open
              it in its own native window.
            </p>
            <ol style={{ paddingLeft: 18, lineHeight: 1.7 }}>
              <li>Click <strong>+ Add app</strong>.</li>
              <li>Pick a source: a CRAN package or a GitHub <code>org/repo</code>.</li>
              <li>
                Enter the <strong>launcher function</strong> — the function the package exposes to
                start its Shiny app, e.g. <code>mp_run_app</code>. It is called as{' '}
                <code>pkg::fun()</code>.
              </li>
              <li>shinylaunchR installs the package into its managed library and shows progress.</li>
              <li>When the tile turns green, double-click to launch.</li>
            </ol>
            <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              R runs headless in the background; the app window simply loads the local Shiny URL.
            </p>
          </div>
        )}

        {tab === 'shortcuts' && (
          <table className="shortcuts">
            <tbody>
              {SHORTCUTS.map(([k, v]) => (
                <tr key={k}>
                  <td className="key">{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'about' && info && (
          <div>
            <div className="kv">
              <div className="k">Version</div>
              <div className="v">{info.version}</div>
              <div className="k">Author</div>
              <div className="v">{info.author}</div>
              <div className="k">ORCID</div>
              <div className="v">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    void api.openExternal(`https://orcid.org/${info.orcid}`);
                  }}
                >
                  {info.orcid}
                </a>
              </div>
              <div className="k">License</div>
              <div className="v">MIT</div>
              <div className="k">Electron</div>
              <div className="v">{info.electron}</div>
              <div className="k">Node</div>
              <div className="v">{info.node}</div>
              <div className="k">Chromium</div>
              <div className="v">{info.chrome}</div>
              <div className="k">Data folder</div>
              <div className="v">{info.userDataPath}</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" onClick={() => void api.openExternal(info.repo)}>
                Repository
              </button>
              <button
                className="btn"
                onClick={() => void api.openExternal(`${info.repo}/issues`)}
              >
                Report an issue
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
