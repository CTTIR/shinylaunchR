/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import {
  appFamily,
  type AppEntry,
  type AppRunState,
  type AppStatus,
} from '@shared/types';
import { HexIcon } from './HexIcon';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

const STATE_TITLE: Record<AppRunState, string> = {
  'not-installed': 'Not installed',
  queued: 'Queued…',
  installing: 'Installing…',
  launching: 'Launching…',
  stopping: 'Stopping…',
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

export function AppTile({
  app,
  status,
  selected,
  onSelect,
  onLaunch,
  onContextMenu,
}: AppTileProps) {
  const [failedIcon, setFailedIcon] = useState(false);
  useEffect(() => setFailedIcon(false), [app.iconPath]);
  const state = status?.state ?? (app.installed ? 'ready' : 'not-installed');
  const busy = ['queued', 'installing', 'launching', 'stopping'].includes(
    state,
  );
  const title = `${app.name} — ${STATE_TITLE[state]}${status?.message ? `: ${status.message}` : ''}`;
  // A user/real logo always wins; otherwise a hex whose COLOR signals the family
  // (colored = package, grey = Shiny file / hosted URL) and whose glyph hints the
  // kind (globe for a hosted URL, monogram otherwise).
  const family = appFamily(app.source);
  const tone = family === 'package' ? 'package' : 'grey';
  const variant = family === 'url' ? 'globe' : 'monogram';

  return (
    <div
      className={`tile${selected ? ' selected' : ''}`}
      tabIndex={0}
      role="button"
      title={title}
      onFocus={() => onSelect(app.id)}
      aria-pressed={selected}
      onClick={() => onSelect(app.id)}
      onDoubleClick={() => {
        if (!busy) onLaunch(app.id);
      }}
      onContextMenu={(e) => onContextMenu(e, app)}
      onKeyDown={(e) => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          onContextMenu(
            {
              preventDefault() {},
              clientX: rect.left,
              clientY: rect.bottom,
            } as React.MouseEvent,
            app,
          );
        }
        if (e.key === ' ') {
          e.preventDefault();
          onSelect(app.id);
        }
        if (e.key === 'Enter' && !busy) {
          e.preventDefault();
          onLaunch(app.id);
        }
      }}
      aria-label={`${app.name}, ${STATE_TITLE[state]}`}
    >
      <span
        className={`status-dot ${state}`}
        role="img"
        aria-label={STATE_TITLE[state]}
      />
      {app.iconPath?.startsWith('slr-icon://cache/') && !failedIcon ? (
        <img
          className="tile-icon"
          src={app.iconPath}
          alt=""
          onError={() => setFailedIcon(true)}
        />
      ) : (
        <HexIcon tone={tone} variant={variant} label={initials(app.name)} />
      )}
      <div className="tile-name">{app.name}</div>
    </div>
  );
}
