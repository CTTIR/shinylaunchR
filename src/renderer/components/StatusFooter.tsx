/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/types';
import { api } from '../lib/api';

/**
 * A persistent footer / status bar shown in the start window. It surfaces the
 * legal essentials — version, legal notices, reference docs, and license —
 * directly in the dashboard (mirroring the top menu's Help → About) and carries
 * the copyright watermark so attribution is always visible, not buried in a
 * panel.
 */
export function StatusFooter({ onOpenAbout }: { onOpenAbout: () => void }) {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void api.appInfo().then(setInfo);
  }, []);

  const repo = info?.repo ?? 'https://github.com/cttir/shinylaunchR';
  const open = (url: string) => () => void api.openExternal(url);

  return (
    <footer className="statusbar" role="contentinfo">
      <div className="watermark" title="Apache-2.0 licensed open-source software">
        <span className="mark">©</span> 2026 {info?.author ?? 'Raban Heller'}
        <span className="dot">·</span>
        <span className="wm-name">shinylaunchR</span>
      </div>

      <div className="spacer" />

      <nav className="legal-links" aria-label="Version, legal, reference and license">
        <button className="link" onClick={onOpenAbout} title="Version, build and about info">
          Version {info ? `v${info.version}` : ''}
        </button>
        <span className="sep" aria-hidden="true">|</span>
        <button
          className="link"
          onClick={open(`${repo}/blob/main/NOTICE`)}
          title="Legal notices, attribution & trademark disclaimer"
        >
          Legal
        </button>
        <span className="sep" aria-hidden="true">|</span>
        <button
          className="link"
          onClick={open(`${repo}#readme`)}
          title="Documentation & reference"
        >
          Reference
        </button>
        <span className="sep" aria-hidden="true">|</span>
        <button
          className="link"
          onClick={open(`${repo}/blob/main/LICENSE`)}
          title="Apache License 2.0"
        >
          License (Apache-2.0)
        </button>
      </nav>
    </footer>
  );
}
