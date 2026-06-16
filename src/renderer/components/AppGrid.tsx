/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

import { appFamily, type AppEntry, type AppFamily, type AppStatus } from '@shared/types';
import { AppTile } from './AppTile';

export interface AppGridProps {
  apps: AppEntry[];
  statuses: Map<string, AppStatus>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLaunch: (id: string) => void;
  /** Open the Add dialog pre-set to a given family (from a section's "+" tile). */
  onAdd: (family: AppFamily) => void;
  onContextMenu: (e: React.MouseEvent, app: AppEntry) => void;
}

interface SectionDef {
  family: AppFamily;
  heading: string;
  addLabel: string;
}

// Fixed order: Packages → Shiny apps → Hosted. Every section always renders
// (even when empty) so all three add paths stay discoverable.
const SECTIONS: SectionDef[] = [
  { family: 'package', heading: 'Packages', addLabel: 'Add package' },
  { family: 'shinyfile', heading: 'Shiny apps', addLabel: 'Add Shiny app' },
  { family: 'url', heading: 'Hosted', addLabel: 'Add URL' },
];

function AddTile({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div
      className="tile add-tile"
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onAdd}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAdd();
        }
      }}
    >
      <span className="plus" aria-hidden="true">
        +
      </span>
      <div className="tile-name">{label}</div>
    </div>
  );
}

export function AppGrid(props: AppGridProps) {
  return (
    <div className="grid-sections">
      {SECTIONS.map((section) => {
        const apps = props.apps.filter((a) => appFamily(a.source) === section.family);
        return (
          <section className="grid-group" key={section.family}>
            <div className="grid-group-head">
              <h2 className="grid-group-title">{section.heading}</h2>
              <span className="grid-group-count">{apps.length}</span>
            </div>
            <div className="grid">
              {apps.map((app) => (
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
              <AddTile label={section.addLabel} onAdd={() => props.onAdd(section.family)} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
