/**
 * All ipcMain handlers, with strict input validation. The renderer can only
 * reach privileged operations through these channels; every argument crossing
 * the boundary is validated here before it touches a service.
 */
import { ipcMain } from 'electron';
import { IPC, type AppEntryInput } from '@shared/types';
import { validateInput } from './registry';
import { logger } from './logger';
import type { AppContext } from './context';

function asString(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new Error(`${field} must be a string`);
  return v;
}

function asBool(v: unknown): boolean {
  return v === true;
}

export function registerIpc(ctx: AppContext): void {
  const handle = <T>(channel: string, fn: (...args: any[]) => T | Promise<T>) => {
    ipcMain.handle(channel, async (_evt, ...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('ipc', `${channel} failed: ${message}`);
        // Re-throw so the renderer's await rejects with a useful message.
        throw new Error(message);
      }
    });
  };

  // registry
  handle(IPC.listApps, () => ctx.listApps());
  handle(IPC.addApp, (input: unknown) => ctx.addApp(validateInput(input as AppEntryInput)));
  handle(IPC.updateApp, (id: unknown, input: unknown) =>
    ctx.updateApp(asString(id, 'id'), validateInput(input as AppEntryInput)),
  );
  handle(IPC.removeApp, (id: unknown, alsoUninstall: unknown) =>
    ctx.removeApp(asString(id, 'id'), asBool(alsoUninstall)),
  );
  handle(IPC.exportRegistry, () => ctx.exportRegistry());
  handle(IPC.importRegistry, () => ctx.importRegistry());

  // status
  handle(IPC.getStatuses, () => ctx.statuses());

  // install / launch
  handle(IPC.install, (id: unknown) => ctx.install(asString(id, 'id')));
  handle(IPC.launch, (id: unknown) => ctx.launch(asString(id, 'id')));
  handle(IPC.stop, (id: unknown) => ctx.stop(asString(id, 'id')));
  handle(IPC.stopAll, () => ctx.stopAll());

  // icons
  handle(IPC.pickIcon, () => ctx.pickIcon());

  // R runtime
  handle(IPC.rStatus, () => ctx.rStatus());
  handle(IPC.rBootstrap, () => ctx.rBootstrap());
  handle(IPC.rPointTo, () => ctx.rPointTo());
  handle(IPC.rOpenLibrary, () => ctx.rOpenLibrary());

  // settings
  handle(IPC.getSettings, () => ctx.getSettings());
  handle(IPC.setSettings, (patch: unknown) => {
    if (!patch || typeof patch !== 'object') throw new Error('settings patch must be an object');
    return ctx.setSettings(patch as Record<string, never>);
  });
  handle(IPC.openUserData, () => ctx.openUserData());
  handle(IPC.clearIconCache, () => ctx.clearIconCache());

  // credentials
  handle(IPC.credStatus, () => ctx.credStatus());
  handle(IPC.credSet, (token: unknown) => ctx.credSet(asString(token, 'token')));
  handle(IPC.credRemove, () => ctx.credRemove());
  handle(IPC.credTest, () => ctx.credTest());

  // misc
  handle(IPC.appInfo, () => ctx.appInfo());
  handle(IPC.openExternal, (url: unknown) => ctx.openExternal(asString(url, 'url')));

  // selection is fire-and-forget (renderer -> main, no reply)
  ipcMain.on(IPC.selectApp, (_evt, id: unknown) => {
    ctx.setSelected(typeof id === 'string' ? id : null);
  });
}
