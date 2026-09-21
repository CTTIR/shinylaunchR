/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
import type { BrowserWindow, IpcMainInvokeEvent, Session } from 'electron';
import { shell } from 'electron';
export function sameOrigin(target: string, expected: string): boolean {
  try {
    const a = new URL(target),
      b = new URL(expected);
    return (
      !a.username &&
      !a.password &&
      a.protocol === b.protocol &&
      a.origin === b.origin
    );
  } catch {
    return false;
  }
}
export function httpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}
export function restrictSession(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.on('will-download', (event) => event.preventDefault());
}
export function restrictWindow(
  win: BrowserWindow,
  allowed: (url: string) => boolean,
): void {
  const guard = (event: { preventDefault(): void }, url: string) => {
    if (!allowed(url)) event.preventDefault();
  };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);
  win.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame && !allowed(event.url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  // Link opening needs a user action in the page; arbitrary window.open never leaves the sandbox.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
export function trustedSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  win: BrowserWindow | null,
  expected: string,
  development = false,
): boolean {
  if (
    !win ||
    win.isDestroyed() ||
    event.sender !== win.webContents ||
    !event.senderFrame ||
    event.senderFrame !== win.webContents.mainFrame
  )
    return false;
  const url = event.senderFrame.url;
  return development ? sameOrigin(url, expected) : url === expected;
}
export async function openHttps(url: string): Promise<void> {
  if (!httpsUrl(url))
    throw new Error('Only HTTPS links without credentials are allowed.');
  await shell.openExternal(url);
}
