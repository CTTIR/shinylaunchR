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
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <polygon points="16,3 28,10 28,22 16,29 4,22 4,10" fill="var(--accent)" />
      <polygon points="16,9 23,13 23,19 16,23 9,19 9,13" fill="var(--bg)" />
    </svg>
  );
}
