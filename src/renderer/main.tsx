/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AppEntry,
  AppEntryInput,
  AppFamily,
  AppSettings,
  AppStatus,
  MenuCommand,
  ThemePreference,
} from '@shared/types';
import { api } from './lib/api';
import { applyTheme } from './components/ThemeToggle';
import { TopBar } from './components/TopBar';
import { AppGrid } from './components/AppGrid';
import { RegisterDialog } from './components/RegisterDialog';
import { LogConsole, type DisplayLog } from './components/LogConsole';
import { RManagerPanel } from './components/RManagerPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { CredentialsPanel } from './components/CredentialsPanel';
import { HelpPanel, type HelpSection } from './components/HelpPanel';
import { useFocusTrap } from './lib/useFocusTrap';
import './styles/theme.css';

type Panel = 'r' | 'settings' | 'credentials' | 'help' | null;
type ContextMenuState = { x: number; y: number; app: AppEntry } | null;

const MAX_LOGS = 2000;

export function App() {
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [statuses, setStatuses] = useState<Map<string, AppStatus>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [dialog, setDialog] = useState<{
    open: boolean;
    editing?: AppEntry;
    family?: AppFamily;
  }>({
    open: false,
  });
  const [panel, setPanel] = useState<Panel>(null);
  const [helpSection, setHelpSection] = useState<HelpSection>('help');
  const [logOpen, setLogOpen] = useState(false);
  const [logs, setLogs] = useState<DisplayLog[]>([]);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null);

  const [failure, setFailure] = useState<{
    message: string;
    retry?: () => void;
  } | null>(null);
  const [removing, setRemoving] = useState<AppEntry | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const menuHandler = useRef<(cmd: MenuCommand) => void>(() => {});
  const nextLogId = useRef(0);
  const report = (error: unknown, retry?: () => void) =>
    setFailure({
      message: error instanceof Error ? error.message : String(error),
      retry,
    });
  const operation = async (
    id: string,
    fn: () => Promise<{ ok: boolean; message?: string }>,
  ) => {
    if (pendingRef.current.has(id)) return;
    pendingRef.current.add(id);
    setPending(new Set(pendingRef.current));
    setFailure(null);
    setLogOpen(true);
    try {
      const result = await fn();
      if (!result.ok)
        throw new Error(
          result.message || 'Operation failed. See logs for details.',
        );
    } catch (error) {
      report(error, () => void operation(id, fn));
    } finally {
      pendingRef.current.delete(id);
      setPending(new Set(pendingRef.current));
    }
  };

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
      if (!(await api.rStatus()).found) setPanel('r');
    })().catch((error) => report(error, () => window.location.reload()));

    let queue: DisplayLog[] = [];
    let frame: number | undefined;
    const offLog = api.onLog((e) => {
      queue.push({ ...e, displayId: ++nextLogId.current });
      if (queue.length > MAX_LOGS) queue.splice(0, queue.length - MAX_LOGS);
      if (frame === undefined)
        frame = requestAnimationFrame(() => {
          const batch = queue;
          queue = [];
          frame = undefined;
          setLogs((previous) => [...previous, ...batch].slice(-MAX_LOGS));
        });
    });
    const offStatus = api.onStatus((list) => {
      setStatuses(new Map(list.map((s) => [s.id, s])));
      void refreshApps().catch((error) => report(error));
    });
    const offMenu = api.onMenu((cmd) => menuHandler.current(cmd));
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
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
        if (ctxMenu) setCtxMenu(null);
        else if (removing) setRemoving(null);
        else setPanel(null);
      }
    };
    const onClick = () => setCtxMenu(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [ctxMenu, removing]);

  const select = (id: string) => {
    setSelectedId(id);
    api.selectApp(id);
  };

  const changeTheme = (t: ThemePreference) => {
    setTheme(t);
    applyTheme(t);
    void api.setSettings({ theme: t }).catch((error) => report(error));
  };

  const launch = (id: string) => operation(id, () => api.launch(id));
  const stop = (id: string) =>
    void api
      .stop(id)
      .then((r) => {
        if (!r.ok) throw new Error(r.message || 'Could not stop app');
      })
      .catch((error) => report(error));

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
      const added = await api.addApp(input);
      setApps((previous) => [
        ...previous.filter((app) => app.id !== added.id),
        added,
      ]);
      setDialog({ open: false });
      if (input.source.kind !== 'url') void reinstall(added.id);
      return;
    }
    await refreshApps();
    setDialog({ open: false });
  };

  const reinstall = (id: string) => operation(id, () => api.install(id));
  const remove = (app: AppEntry) => setRemoving(app);
  const confirmRemove = async (app: AppEntry, uninstall: boolean) => {
    await operation(app.id, async () => {
      const result = await api.removeApp(app.id, uninstall);
      if (result.ok) {
        setRemoving(null);
        if (selectedId === app.id) {
          setSelectedId(null);
          api.selectApp(null);
        }
        await refreshApps();
      }
      return result;
    });
  };

  const onContextMenu = (e: React.MouseEvent, app: AppEntry) => {
    e.preventDefault();
    select(app.id);
    setCtxMenu({ x: e.clientX, y: e.clientY, app });
  };

  function handleMenu(cmd: MenuCommand) {
    if (dialog.open || removing) return;
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

  menuHandler.current = handleMenu;
  return (
    <div className="app-shell">
      {failure && (
        <div role="alert" className="operation-error">
          {failure.message}{' '}
          {failure.retry && (
            <button className="btn" onClick={failure.retry}>
              Retry
            </button>
          )}
          <button className="btn ghost" onClick={() => setFailure(null)}>
            Dismiss
          </button>
        </div>
      )}
      {pending.size > 0 && (
        <div role="status" className="operation-status">
          Work in progress.{' '}
          {Array.from(pending)
            .filter((id) => id !== 'all')
            .map((id) => (
              <button className="btn" key={id} onClick={() => stop(id)}>
                Cancel {apps.find((a) => a.id === id)?.name ?? 'operation'}
              </button>
            ))}
        </div>
      )}

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
      {panel === 'credentials' && (
        <CredentialsPanel onClose={() => setPanel(null)} />
      )}
      {panel === 'help' && (
        <HelpPanel section={helpSection} onClose={() => setPanel(null)} />
      )}

      {removing && (
        <RemoveDialog
          app={removing}
          busy={pending.has(removing.id)}
          onClose={() => setRemoving(null)}
          onRemove={(uninstall) => void confirmRemove(removing, uninstall)}
        />
      )}
      {ctxMenu && (
        <ContextMenu
          menu={ctxMenu}
          busy={
            pending.has(ctxMenu.app.id) ||
            ['queued', 'installing', 'launching', 'stopping'].includes(
              statuses.get(ctxMenu.app.id)?.state ?? '',
            )
          }
          onLaunch={() => void launch(ctxMenu.app.id)}
          onStop={() => stop(ctxMenu.app.id)}
          onEdit={() => setDialog({ open: true, editing: ctxMenu.app })}
          onInstall={() => void reinstall(ctxMenu.app.id)}
          onRemove={() => remove(ctxMenu.app)}
        />
      )}
    </div>
  );
}

function RemoveDialog({
  app,
  busy,
  onClose,
  onRemove,
}: {
  app: AppEntry;
  busy: boolean;
  onClose: () => void;
  onRemove: (uninstall: boolean) => void;
}) {
  const trap = useFocusTrap<HTMLDivElement>();
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Remove app"
        ref={trap}
      >
        <h2>Remove “{app.name}”?</h2>
        <p>
          Remove this registration and stop its active work. Your original
          source files are kept.
        </p>
        {app.pkg && (
          <p>
            Uninstalling also removes {app.pkg} from the managed library. Other
            apps using that package may need it reinstalled.
          </p>
        )}
        <div className="actions">
          <button className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => onRemove(false)}
          >
            Remove registration
          </button>
          {app.pkg && (
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => onRemove(true)}
            >
              Remove and uninstall package
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
function ContextMenu({
  menu,
  busy,
  onLaunch,
  onStop,
  onEdit,
  onInstall,
  onRemove,
}: {
  menu: NonNullable<ContextMenuState>;
  busy: boolean;
  onLaunch: () => void;
  onStop: () => void;
  onEdit: () => void;
  onInstall: () => void;
  onRemove: () => void;
}) {
  const ref = useFocusTrap<HTMLDivElement>();
  return (
    <div
      className="context-menu"
      role="menu"
      aria-label={`Actions for ${menu.app.name}`}
      ref={ref}
      style={{
        left: Math.max(0, Math.min(menu.x, window.innerWidth - 230)),
        top: Math.max(0, Math.min(menu.y, window.innerHeight - 240)),
      }}
      onKeyDown={(e) => {
        const items = Array.from(
          e.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)',
          ),
        );
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          items[
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? items.length - 1
                : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) %
                  items.length
          ]?.focus();
        }
      }}
    >
      <button role="menuitem" disabled={busy} onClick={onLaunch}>
        Launch
      </button>
      <button role="menuitem" onClick={onStop}>
        Stop / cancel
      </button>
      <button role="menuitem" disabled={busy} onClick={onEdit}>
        Edit…
      </button>
      {menu.app.source.kind !== 'url' && (
        <button role="menuitem" disabled={busy} onClick={onInstall}>
          Reinstall / retry
        </button>
      )}
      <button role="menuitem" className="danger" onClick={onRemove}>
        Remove…
      </button>
    </div>
  );
}

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
