/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ThemePreference } from '@shared/types';
import { ThemeToggle } from './ThemeToggle';
import brandIcon from '../assets/logo-symbol.svg';

export interface TopBarProps {
  theme: ThemePreference;
  onThemeChange: (t: ThemePreference) => void;
  onAddApp: () => void;
  onToggleLog: () => void;
  onOpenR: () => void;
  onOpenSettings: () => void;
  onOpenCredentials: () => void;
  onOpenHelp: () => void;
}

/** A slim Hugo-Coder-style top bar with in-window menu affordances. */
export function TopBar(props: TopBarProps) {
  return (
    <div className="topbar">
      <div className="brand">
        <HexLogo />
        <span>shinylaunchR</span>
      </div>
      <div className="spacer" />
      <div className="menu-host row">
        <button
          className="btn ghost"
          onClick={props.onOpenR}
          title="R runtime status"
        >
          R
        </button>
        <button
          className="btn ghost"
          onClick={props.onToggleLog}
          title="Toggle log console"
        >
          Logs
        </button>
        <button
          className="btn ghost"
          onClick={props.onOpenCredentials}
          title="GitHub credentials"
        >
          Token
        </button>
        <button
          className="btn ghost"
          onClick={props.onOpenSettings}
          title="Settings"
        >
          Settings
        </button>
        <button className="btn ghost" onClick={props.onOpenHelp} title="Help">
          Help
        </button>
        <ThemeToggle value={props.theme} onChange={props.onThemeChange} />
        <button className="btn primary" onClick={props.onAddApp}>
          + Add app
        </button>
      </div>
    </div>
  );
}

function HexLogo() {
  return <img className="logo" src={brandIcon} alt="" aria-hidden="true" />;
}
