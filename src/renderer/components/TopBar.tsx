import type { ThemePreference } from '@shared/types';
import { ThemeToggle } from './ThemeToggle';

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
        <button className="btn ghost" onClick={props.onOpenR} title="R runtime status">
          R
        </button>
        <button className="btn ghost" onClick={props.onToggleLog} title="Toggle log console">
          Logs
        </button>
        <button className="btn ghost" onClick={props.onOpenCredentials} title="GitHub credentials">
          Token
        </button>
        <button className="btn ghost" onClick={props.onOpenSettings} title="Settings">
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
  // Brand mark: blue hexagon + white play triangle (matches resources/icon.*).
  return (
    <svg className="logo" viewBox="0 0 512 512" aria-hidden="true">
      <defs>
        <linearGradient id="slr-logo-g" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#9FC6E8" />
          <stop offset="0.55" stopColor="#75AADB" />
          <stop offset="1" stopColor="#2B6CB0" />
        </linearGradient>
      </defs>
      <polygon
        points="256,50 434.4,153 434.4,359 256,462 77.6,359 77.6,153"
        fill="url(#slr-logo-g)"
        stroke="url(#slr-logo-g)"
        strokeWidth="28"
        strokeLinejoin="round"
      />
      <polygon
        points="206,168 206,344 360,256"
        fill="#fff"
        stroke="#fff"
        strokeWidth="20"
        strokeLinejoin="round"
      />
    </svg>
  );
}
