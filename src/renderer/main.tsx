/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AppEntry,
  AppEntryInput,
  AppFamily,
  AppSettings,
  AppStatus,
  LogEvent,
  MenuCommand,
  ThemePreference,
} from '@shared/types';
import { api } from './lib/api';
import { applyTheme } from './components/ThemeToggle';
import { TopBar } from './components/TopBar';
import { AppGrid } from './components/AppGrid';
import { RegisterDialog } from './components/RegisterDialog';
import { LogConsole } from './components/LogConsole';
import { RManagerPanel } from './components/RManagerPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { CredentialsPanel } from './components/CredentialsPanel';
import { HelpPanel, type HelpSection } from './components/HelpPanel';
import { StatusFooter } from './components/StatusFooter';
import './styles/theme.css';

type Panel = 'r' | 'settings' | 'credentials' | 'help' | null;
type ContextMenuState = { x: number; y: number; app: AppEntry } | null;

const MAX_LOGS = 2000;

function App() {
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [statuses, setStatuses] = useState<Map<string, AppStatus>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [dialog, setDialog] = useState<{ open: boolean; editing?: AppEntry; family?: AppFamily }>({
    open: false,
  });
  const [panel, setPanel] = useState<Panel>(null);
  const [helpSection, setHelpSection] = useState<HelpSection>('help');
  const [logOpen, setLogOpen] = useState(false);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null);

  const refreshApps = useCallback(async () => {
    setApps(await api.listApps());
  }, []);

  const refreshStatuses = useCallback(async () => {
    const list = await api.getStatuses();
    setStatuses(new Map(list.map((s) => [s.id, s])));
  }, []);

  // initial load + subscriptions
  useEffect(() => {
    void (async () => {
      const settings = await api.getSettings();
      setTheme(settings.theme);
      applyTheme(settings.theme);
      await refreshApps();
      await refreshStatuses();
    })();

    const offLog = api.onLog((e) => {
      setLogs((prev) => {
        const next = [...prev, e];
        return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
      });
    });
    const offStatus = api.onStatus((list) => {
      setStatuses(new Map(list.map((s) => [s.id, s])));
      void refreshApps();
    });
    const offMenu = api.onMenu((cmd) => handleMenu(cmd));
    return () => {
      offLog();
      offStatus();
      offMenu();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // follow OS theme when in system mode
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => theme === 'system' && applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  // global Esc closes overlays; dismiss context menu on any click
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCtxMenu(null);
        setPanel(null);
      }
    };
    const onClick = () => setCtxMenu(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, []);

  const select = (id: string) => {
    setSelectedId(id);
    api.selectApp(id);
  };

  const changeTheme = (t: ThemePreference) => {
    setTheme(t);
    applyTheme(t);
    void api.setSettings({ theme: t });
  };

  const launch = async (id: string) => {
    const res = await api.launch(id);
    if (!res.ok) {
      setLogOpen(true);
    }
  };

  const submitDialog = async (input: AppEntryInput) => {
    if (dialog.editing) {
      await api.updateApp(dialog.editing.id, input);
    } else {
      // Trust gate: a Shiny-file app runs R code from those files on launch, and
      // a hosted URL loads remote content — confirm before adding either.
      if (input.source.kind === 'source' || input.source.kind === 'url') {
        const warning =
          input.source.kind === 'source'
            ? `Add "${input.name}"?\n\nIts files will be staged on this computer and its R ` +
              `code will run when you launch it. Only add Shiny apps you trust.`
            : `Add "${input.name}"?\n\nThis opens a remote web page in an isolated window. ` +
              `Only add URLs you trust.`;
        if (!window.confirm(warning)) return; // keep the dialog open
      }
      setLogOpen(true);
      await api.addApp(input);
    }
    setDialog({ open: false });
    await refreshApps();
  };

  const reinstall = async (id: string) => {
    setLogOpen(true);
    await api.install(id);
  };

  const remove = async (app: AppEntry) => {
    const alsoUninstall = window.confirm(
      `Remove "${app.name}"?\n\nClick OK to also note the R package (${app.pkg}) for uninstall, or Cancel to abort.`,
    );
    if (!alsoUninstall && !window.confirm(`Remove "${app.name}" but keep the R package?`)) return;
    await api.removeApp(app.id, alsoUninstall);
    if (selectedId === app.id) setSelectedId(null);
    await refreshApps();
  };

  const onContextMenu = (e: React.MouseEvent, app: AppEntry) => {
    e.preventDefault();
    select(app.id);
    setCtxMenu({ x: e.clientX, y: e.clientY, app });
  };

  function handleMenu(cmd: MenuCommand) {
    const sel = () => apps.find((a) => a.id === selectedId);
    switch (cmd) {
      case 'add-app':
        setDialog({ open: true });
        break;
      case 'edit-selected': {
        const a = sel();
        if (a) setDialog({ open: true, editing: a });
        break;
      }
      case 'reinstall-selected':
        if (selectedId) void reinstall(selectedId);
        break;
      case 'remove-selected': {
        const a = sel();
        if (a) void remove(a);
        break;
      }
      case 'launch-selected':
        if (selectedId) void launch(selectedId);
        break;
      case 'stop-selected':
        if (selectedId) void api.stop(selectedId);
        break;
      case 'stop-all':
        void api.stopAll();
        break;
      case 'toggle-log':
        setLogOpen((v) => !v);
        break;
      case 'open-r-panel':
        setPanel('r');
        break;
      case 'open-settings':
        setPanel('settings');
        break;
      case 'open-credentials':
        setPanel('credentials');
        break;
      case 'open-help':
        setHelpSection('help');
        setPanel('help');
        break;
      case 'open-shortcuts':
        setHelpSection('shortcuts');
        setPanel('help');
        break;
      case 'open-about':
        setHelpSection('about');
        setPanel('help');
        break;
      case 'theme-dark':
        changeTheme('dark');
        break;
      case 'theme-light':
        changeTheme('light');
        break;
      case 'theme-system':
        changeTheme('system');
        break;
    }
  }

  return (
    <div className="app-shell">
      <TopBar
        theme={theme}
        onThemeChange={changeTheme}
        onAddApp={() => setDialog({ open: true })}
        onToggleLog={() => setLogOpen((v) => !v)}
        onOpenR={() => setPanel('r')}
        onOpenSettings={() => setPanel('settings')}
        onOpenCredentials={() => setPanel('credentials')}
        onOpenHelp={() => {
          setHelpSection('help');
          setPanel('help');
        }}
      />

      <div className="content">
        <AppGrid
          apps={apps}
          statuses={statuses}
          selectedId={selectedId}
          onSelect={select}
          onLaunch={launch}
          onAdd={(family) => setDialog({ open: true, family })}
          onContextMenu={onContextMenu}
        />
      </div>

      <StatusFooter
        onOpenAbout={() => {
          setHelpSection('about');
          setPanel('help');
        }}
      />

      {logOpen && (
        <LogConsole
          logs={logs}
          apps={apps}
          onClose={() => setLogOpen(false)}
          onClear={() => setLogs([])}
        />
      )}

      {dialog.open && (
        <RegisterDialog
          editing={dialog.editing}
          initialFamily={dialog.family}
          onClose={() => setDialog({ open: false })}
          onSubmit={submitDialog}
        />
      )}

      {panel === 'r' && <RManagerPanel onClose={() => setPanel(null)} />}
      {panel === 'settings' && (
        <SettingsPanel
          onClose={() => setPanel(null)}
          onSettingsChanged={(s: AppSettings) => {
            setTheme(s.theme);
            applyTheme(s.theme);
          }}
        />
      )}
      {panel === 'credentials' && <CredentialsPanel onClose={() => setPanel(null)} />}
      {panel === 'help' && <HelpPanel section={helpSection} onClose={() => setPanel(null)} />}

      {ctxMenu && (
        <div className="context-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <button onClick={() => launch(ctxMenu.app.id)}>Launch</button>
          <button onClick={() => api.stop(ctxMenu.app.id)}>Stop</button>
          <button onClick={() => setDialog({ open: true, editing: ctxMenu.app })}>Edit…</button>
          <button onClick={() => reinstall(ctxMenu.app.id)}>Reinstall / Update</button>
          <button className="danger" onClick={() => remove(ctxMenu.app)}>
            Remove…
          </button>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
