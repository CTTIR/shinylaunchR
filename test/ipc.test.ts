import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { AppContext } from '../src/main/context';
import { IPC } from '../src/shared/types';
const handlers = vi.hoisted(() => ({
  invoke: new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
  >(),
  event: new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => void
  >(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      fn: typeof handlers.invoke extends Map<string, infer F> ? F : never,
    ) => handlers.invoke.set(channel, fn),
    on: (
      channel: string,
      fn: typeof handlers.event extends Map<string, infer F> ? F : never,
    ) => handlers.event.set(channel, fn),
  },
  shell: {},
}));
import { registerIpc } from '../src/main/ipc';
import { trustedSender } from '../src/main/window-policy';
const mainFrame = { url: 'file:///app/renderer/index.html' };
const contents = { mainFrame };
const win = {
  webContents: contents,
  isDestroyed: () => false,
} as unknown as BrowserWindow;
const event = {
  sender: contents,
  senderFrame: mainFrame,
} as unknown as IpcMainInvokeEvent;
let ctx: AppContext;
let list: ReturnType<typeof vi.fn>,
  select: ReturnType<typeof vi.fn>,
  launch: ReturnType<typeof vi.fn>,
  add: ReturnType<typeof vi.fn>;
beforeEach(() => {
  handlers.invoke.clear();
  handlers.event.clear();
  list = vi.fn().mockReturnValue([]);
  select = vi.fn();
  launch = vi.fn().mockResolvedValue({ ok: true });
  add = vi.fn();
  ctx = {
    isTrustedSender: (e: IpcMainInvokeEvent) =>
      trustedSender(e, win, mainFrame.url),
    listApps: list,
    setSelected: select,
    launch,
    addApp: add,
  } as unknown as AppContext;
  registerIpc(ctx);
});
describe('IPC authorization and validation', () => {
  it('rejects a foreign WebContents and an identically located subframe before executing handlers', async () => {
    for (const forged of [
      { ...event, sender: {} },
      { ...event, senderFrame: { url: mainFrame.url } },
      { ...event, senderFrame: null },
    ]) {
      await expect(
        handlers.invoke.get(IPC.listApps)!(forged as IpcMainInvokeEvent),
      ).rejects.toThrow('Untrusted IPC sender');
      handlers.event.get(IPC.selectApp)!(
        forged as IpcMainInvokeEvent,
        'target',
      );
    }
    expect(list).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    await expect(handlers.invoke.get(IPC.listApps)!(event)).resolves.toEqual(
      [],
    );
    handlers.event.get(IPC.selectApp)!(event, 'selected');
    expect(select).toHaveBeenCalledWith('selected');
  });
  it('validates IDs and app input before privileged calls', async () => {
    await expect(
      handlers.invoke.get(IPC.launch)!(event, { id: 'bad' }),
    ).rejects.toThrow('id must be a string');
    expect(launch).not.toHaveBeenCalled();
    await expect(
      handlers.invoke.get(IPC.addApp)!(event, {
        name: 'Untrusted',
        source: { kind: 'url', url: 'file:///etc/passwd' },
      }),
    ).rejects.toThrow();
    expect(add).not.toHaveBeenCalled();
    await expect(
      handlers.invoke.get(IPC.launch)!(event, 'good'),
    ).resolves.toEqual({ ok: true });
    expect(launch).toHaveBeenCalledWith('good');
  });
  it('propagates useful operation errors and remains usable for retry', async () => {
    launch.mockRejectedValueOnce(
      new Error('R is missing; choose Rscript in Runtime.'),
    );
    await expect(handlers.invoke.get(IPC.launch)!(event, 'a')).rejects.toThrow(
      'choose Rscript',
    );
    await expect(handlers.invoke.get(IPC.launch)!(event, 'a')).resolves.toEqual(
      { ok: true },
    );
  });
});
