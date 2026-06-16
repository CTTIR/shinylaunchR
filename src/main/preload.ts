/**
 * Preload script: the ONLY bridge between the sandboxed renderer and the main
 * process. Exposes a minimal, typed API over contextBridge. No Node or ipc
 * primitives leak into the renderer's global scope.
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type AppEntryInput,
  type AppSettings,
  type LogEvent,
  type AppStatus,
  type MenuCommand,
  type ShinyLaunchAPI,
} from '@shared/types';

const api: ShinyLaunchAPI = {
  listApps: () => ipcRenderer.invoke(IPC.listApps),
  addApp: (input: AppEntryInput) => ipcRenderer.invoke(IPC.addApp, input),
  updateApp: (id, input) => ipcRenderer.invoke(IPC.updateApp, id, input),
  removeApp: (id, alsoUninstall) => ipcRenderer.invoke(IPC.removeApp, id, alsoUninstall),
  exportRegistry: () => ipcRenderer.invoke(IPC.exportRegistry),
  importRegistry: () => ipcRenderer.invoke(IPC.importRegistry),

  getStatuses: () => ipcRenderer.invoke(IPC.getStatuses),

  install: (id) => ipcRenderer.invoke(IPC.install, id),
  launch: (id) => ipcRenderer.invoke(IPC.launch, id),
  stop: (id) => ipcRenderer.invoke(IPC.stop, id),
  stopAll: () => ipcRenderer.invoke(IPC.stopAll),

  pickIcon: () => ipcRenderer.invoke(IPC.pickIcon),

  rStatus: () => ipcRenderer.invoke(IPC.rStatus),
  rBootstrap: () => ipcRenderer.invoke(IPC.rBootstrap),
  rPointTo: () => ipcRenderer.invoke(IPC.rPointTo),
  rOpenLibrary: () => ipcRenderer.invoke(IPC.rOpenLibrary),

  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.setSettings, patch),
  openUserData: () => ipcRenderer.invoke(IPC.openUserData),
  clearIconCache: () => ipcRenderer.invoke(IPC.clearIconCache),

  credStatus: () => ipcRenderer.invoke(IPC.credStatus),
  credSet: (token) => ipcRenderer.invoke(IPC.credSet, token),
  credRemove: () => ipcRenderer.invoke(IPC.credRemove),
  credTest: () => ipcRenderer.invoke(IPC.credTest),

  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  selectApp: (id) => ipcRenderer.send(IPC.selectApp, id),

  onLog: (handler: (e: LogEvent) => void) => {
    const listener = (_evt: unknown, payload: LogEvent) => handler(payload);
    ipcRenderer.on(IPC.evtLog, listener);
    return () => ipcRenderer.removeListener(IPC.evtLog, listener);
  },
  onStatus: (handler: (s: AppStatus[]) => void) => {
    const listener = (_evt: unknown, payload: AppStatus[]) => handler(payload);
    ipcRenderer.on(IPC.evtStatus, listener);
    return () => ipcRenderer.removeListener(IPC.evtStatus, listener);
  },
  onMenu: (handler: (cmd: MenuCommand) => void) => {
    const listener = (_evt: unknown, payload: MenuCommand) => handler(payload);
    ipcRenderer.on(IPC.evtMenu, listener);
    return () => ipcRenderer.removeListener(IPC.evtMenu, listener);
  },
};

contextBridge.exposeInMainWorld('shinylaunchR', api);
