/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/types';
import { useFocusTrap } from '../lib/useFocusTrap';
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
  const trap = useFocusTrap<HTMLDivElement>();
  const [error, setError] = useState('');
  const [tab, setTab] = useState<HelpSection>(section);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => setTab(section), [section]);
  useEffect(() => {
    void api
      .appInfo()
      .then(setInfo)
      .catch((e) => setError(String(e)));
  }, []);

  const open = (url: string) =>
    void api
      .openExternal(url)
      .then((r) => {
        if (!r.ok) setError(r.message || 'Could not open link');
      })
      .catch((e) => setError(String(e)));

  return (
    <div
      className="panel"
      role="dialog"
      aria-modal="true"
      aria-label="Help"
      tabIndex={-1}
      ref={trap}
    >
      <div className="panel-header">
        <h2>Help</h2>
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
        <div className="row" style={{ gap: 8, marginBottom: 16 }}>
          <button
            className={`btn ${tab === 'help' ? 'primary' : 'ghost'}`}
            onClick={() => setTab('help')}
          >
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
              <strong>shinylaunchR</strong> is a launchpad for R/Shiny apps.
              Each tile is a registered app; click <code>+</code> to add one and
              double-click a ready tile to open it in its own native window.
            </p>
            <ul style={{ paddingLeft: 18, lineHeight: 1.7 }}>
              <li>
                <strong>Packages:</strong> choose CRAN or GitHub, enter the
                package name and exported launcher function (for example{' '}
                <code>pkg::run_app()</code>). Installation uses the managed R
                library.
              </li>
              <li>
                <strong>Shiny apps:</strong> choose a local folder, ZIP, gist or
                GitHub repository containing <code>app.R</code> or{' '}
                <code>ui.R</code> and <code>server.R</code>. Files are copied
                locally. Add only code you trust.
              </li>
              <li>
                <strong>Hosted URLs:</strong> enter an HTTPS address. No local R
                or installation is needed. Sign-in sessions are temporary and
                end when the app closes.
              </li>
            </ul>
            <p>
              Click or focus a tile to select it; double-click or press Enter to
              launch. Space selects. Right-click or press Shift+F10 for actions.
              Stop / cancel ends an active launch or installation; retry failed
              work from the app actions.
            </p>
            <p>
              For packages and Shiny files, open the R panel to select an
              existing R ≥ 4.2 installation.
            </p>
            <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              R runs headless in the background; the app window simply loads the
              local Shiny URL.
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
                    open(`https://orcid.org/${info.orcid}`);
                  }}
                >
                  {info.orcid}
                </a>
              </div>
              <div className="k">License</div>
              <div className="v">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    open(`${info.repo}/blob/main/LICENSE`);
                  }}
                >
                  Apache License 2.0
                </a>
              </div>
              <div className="k">Electron</div>
              <div className="v">{info.electron}</div>
              <div className="k">Node</div>
              <div className="v">{info.node}</div>
              <div className="k">Chromium</div>
              <div className="v">{info.chrome}</div>
              <div className="k">Data folder</div>
              <div className="v">{info.userDataPath}</div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => open(info.repo)}>
                Repository
              </button>
              <button
                className="btn"
                onClick={() => open(`${info.repo}/issues`)}
              >
                Report an issue
              </button>
              <button
                className="btn ghost"
                onClick={() => open(`${info.repo}/blob/main/NOTICE`)}
              >
                Notice
              </button>
              <button
                className="btn ghost"
                onClick={() =>
                  open(`${info.repo}/blob/main/THIRD_PARTY_LICENSES.md`)
                }
              >
                Third-party licenses
              </button>
              <button
                className="btn ghost"
                onClick={() => open(`${info.repo}/blob/main/PRIVACY.md`)}
              >
                Privacy
              </button>
            </div>

            <hr className="sep" />
            <p
              style={{
                fontSize: 12,
                color: 'var(--text-dim)',
                lineHeight: 1.6,
              }}
            >
              shinylaunchR is an independent open-source project. It is not
              affiliated with, endorsed by, or sponsored by Posit Software, PBC
              (RStudio), the R Foundation, or the maintainers of Shiny. “R”,
              “RStudio”, “Posit”, and “Shiny” are trademarks of their respective
              owners. No telemetry is collected.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
