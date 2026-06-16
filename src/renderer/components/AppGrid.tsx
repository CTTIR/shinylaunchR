/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AppEntry, AppStatus } from '@shared/types';
import { AppTile } from './AppTile';

export interface AppGridProps {
  apps: AppEntry[];
  statuses: Map<string, AppStatus>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLaunch: (id: string) => void;
  onAdd: () => void;
  onContextMenu: (e: React.MouseEvent, app: AppEntry) => void;
}

export function AppGrid(props: AppGridProps) {
  if (props.apps.length === 0) {
    return (
      <div className="empty-state">
        <h2>No apps yet</h2>
        <p>Register a CRAN package or GitHub repo that exposes a Shiny launcher.</p>
        <button className="btn primary" onClick={props.onAdd}>
          + Add your first Shiny app
        </button>
      </div>
    );
  }

  return (
    <div className="grid">
      {props.apps.map((app) => (
        <AppTile
          key={app.id}
          app={app}
          status={props.statuses.get(app.id)}
          selected={props.selectedId === app.id}
          onSelect={props.onSelect}
          onLaunch={props.onLaunch}
          onContextMenu={props.onContextMenu}
        />
      ))}
      <div
        className="tile add-tile"
        role="button"
        tabIndex={0}
        aria-label="Add app"
        onClick={props.onAdd}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onAdd();
          }
        }}
      >
        <span className="plus" aria-hidden="true">
          +
        </span>
        <div className="tile-name">Add app</div>
      </div>
    </div>
  );
}
