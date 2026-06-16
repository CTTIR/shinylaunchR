/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AppEntry, AppRunState, AppStatus } from '@shared/types';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Convert an absolute filesystem path to a file:// URL usable in <img>. */
function toFileUrl(p: string): string {
  let normalized = p.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  return encodeURI('file://' + normalized);
}

const STATE_TITLE: Record<AppRunState, string> = {
  'not-installed': 'Not installed',
  installing: 'Installing…',
  ready: 'Ready',
  running: 'Running',
  error: 'Error',
};

export interface AppTileProps {
  app: AppEntry;
  status: AppStatus | undefined;
  selected: boolean;
  onSelect: (id: string) => void;
  onLaunch: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, app: AppEntry) => void;
}

export function AppTile({ app, status, selected, onSelect, onLaunch, onContextMenu }: AppTileProps) {
  const state = status?.state ?? (app.installed ? 'ready' : 'not-installed');
  const title = `${app.name} — ${STATE_TITLE[state]}${status?.message ? `: ${status.message}` : ''}`;

  return (
    <div
      className={`tile${selected ? ' selected' : ''}`}
      tabIndex={0}
      role="button"
      title={title}
      onClick={() => onSelect(app.id)}
      onDoubleClick={() => onLaunch(app.id)}
      onContextMenu={(e) => onContextMenu(e, app)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onLaunch(app.id);
        }
      }}
      aria-label={`${app.name}, ${STATE_TITLE[state]}`}
    >
      <span className={`status-dot ${state}`} role="img" aria-label={STATE_TITLE[state]} />
      {app.iconPath ? (
        <img
          className="tile-icon"
          src={toFileUrl(app.iconPath)}
          alt=""
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
      ) : (
        <div className="monogram">{initials(app.name)}</div>
      )}
      <div className="tile-name">{app.name}</div>
    </div>
  );
}
