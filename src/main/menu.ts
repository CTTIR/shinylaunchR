/**
 * Native Electron application menu. Actions that are pure main-process logic
 * (launch/stop) are handled here directly; actions that drive renderer UI
 * (open a dialog/panel, switch theme view) are dispatched to the renderer via
 * the evtMenu channel so behaviour is identical on macOS (global menu) and
 * Win/Linux (in-window menu mirror).
 */
import {
  app,
  Menu,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import { IPC, type MenuCommand } from '@shared/types';
import type { AppContext } from './context';

export function buildMenu(ctx: AppContext, getWindow: () => BrowserWindow | null): Menu {
  const isMac = process.platform === 'darwin';
  const isDev = !app.isPackaged;

  const dispatch = (cmd: MenuCommand) => {
    const win = getWindow();
    win?.webContents.send(IPC.evtMenu, cmd);
  };

  const selected = () => ctx.getSelected();

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { label: 'About shinylaunchR', click: () => dispatch('open-about') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => dispatch('open-settings') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'File',
    submenu: [
      { label: 'Add App…', accelerator: 'CmdOrCtrl+N', click: () => dispatch('add-app') },
      { type: 'separator' },
      { label: 'Import Registry…', click: () => void ctx.importRegistry() },
      { label: 'Export Registry…', click: () => void ctx.exportRegistry() },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  });

  template.push({
    label: 'Edit',
    submenu: [
      {
        label: 'Edit App…',
        enabled: true,
        accelerator: 'CmdOrCtrl+E',
        click: () => dispatch('edit-selected'),
      },
      { label: 'Reinstall / Update App', click: () => dispatch('reinstall-selected') },
      { label: 'Remove App…', click: () => dispatch('remove-selected') },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  });

  template.push({
    label: 'Run',
    submenu: [
      {
        label: 'Launch selected',
        accelerator: 'CmdOrCtrl+L',
        click: () => {
          const id = selected();
          if (id) void ctx.launch(id);
        },
      },
      {
        label: 'Stop selected',
        click: () => {
          const id = selected();
          if (id) ctx.stop(id);
        },
      },
      { label: 'Stop all running', click: () => ctx.stopAll() },
    ],
  });

  const viewSubmenu: MenuItemConstructorOptions[] = [
    { label: 'Dark theme', click: () => dispatch('theme-dark') },
    { label: 'Light theme', click: () => dispatch('theme-light') },
    { label: 'System theme', click: () => dispatch('theme-system') },
    { type: 'separator' },
    {
      label: 'Toggle Log Console',
      accelerator: 'CmdOrCtrl+`',
      click: () => dispatch('toggle-log'),
    },
    {
      label: 'Reload dashboard',
      accelerator: 'CmdOrCtrl+R',
      click: () => getWindow()?.webContents.reload(),
    },
  ];
  if (isDev) {
    viewSubmenu.push({
      label: 'Toggle DevTools',
      accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
      click: () => getWindow()?.webContents.toggleDevTools(),
    });
  }
  template.push({ label: 'View', submenu: viewSubmenu });

  template.push({
    label: 'R Runtime',
    submenu: [
      { label: 'Show R status…', click: () => dispatch('open-r-panel') },
      { label: 'Bootstrap / Re-bootstrap managed R', click: () => void ctx.rBootstrap() },
      { label: 'Point to existing R installation…', click: () => void ctx.rPointTo() },
      { label: 'Open R library folder', click: () => void ctx.rOpenLibrary() },
    ],
  });

  template.push({
    label: 'Settings',
    submenu: [
      { label: 'General…', click: () => dispatch('open-settings') },
      { label: 'Sources…', click: () => dispatch('open-settings') },
      { type: 'separator' },
      { label: 'Open data folder', click: () => void ctx.openUserData() },
      { label: 'Clear icon cache', click: () => ctx.clearIconCache() },
    ],
  });

  template.push({
    label: 'Credentials',
    submenu: [{ label: 'Manage GitHub Token…', click: () => dispatch('open-credentials') }],
  });

  template.push({
    label: 'Help',
    submenu: [
      { label: 'Quick Start', click: () => dispatch('open-help') },
      {
        label: 'Documentation',
        click: () => void shell.openExternal('https://github.com/cttir/shinylaunchR#readme'),
      },
      {
        label: 'Report an Issue',
        click: () => void shell.openExternal('https://github.com/cttir/shinylaunchR/issues'),
      },
      { label: 'Keyboard Shortcuts', click: () => dispatch('open-shortcuts') },
      { type: 'separator' },
      { label: 'About', click: () => dispatch('open-about') },
    ],
  });

  return Menu.buildFromTemplate(template);
}

export function installMenu(ctx: AppContext, getWindow: () => BrowserWindow | null): void {
  Menu.setApplicationMenu(buildMenu(ctx, getWindow));
}
