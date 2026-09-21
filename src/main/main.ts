/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, protocol, net, dialog } from 'electron';
import { logger } from './logger';
import { packagedUiChecks, packagedCredentialCheck } from './packaged-qa';
import { AppContext } from './context';
import { registerIpc } from './ipc';
import { installMenu } from './menu';
import { resourcePath } from './resources';
import { restrictSession, restrictWindow, sameOrigin } from './window-policy';

const smokeRoot = process.argv.includes('--smoke-test')
  ? process.env.SLR_SMOKE_ROOT
  : undefined;
if (process.argv.includes('--smoke-test') && !smokeRoot)
  throw new Error('SLR_SMOKE_ROOT is required for smoke tests.');
if (smokeRoot) {
  if (!path.isAbsolute(smokeRoot) || !fs.statSync(smokeRoot).isDirectory())
    throw new Error(
      'Smoke root must be an existing absolute temporary directory.',
    );
  app.setPath('userData', path.join(smokeRoot, 'user-data'));
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'slr-icon',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let mainWindow: BrowserWindow | null = null;
let context: AppContext | null = null;
let shutdownComplete = false,
  shuttingDown = false;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#1a1a1d',
    title: 'shinylaunchR',
    icon: resourcePath('icon.png'),
    show: !smokeRoot,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  restrictSession(win.webContents.session);
  const dev = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  const file = pathToFileURL(
    path.join(__dirname, '../renderer/index.html'),
  ).href;
  restrictWindow(win, (url) => (dev ? sameOrigin(url, dev) : url === file));
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}
async function loadDashboard(win: BrowserWindow): Promise<void> {
  const dev = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  if (dev) await win.loadURL(dev);
  else await win.loadFile(path.join(__dirname, '../renderer/index.html'));
}
async function smoke(win: BrowserWindow, ctx: AppContext): Promise<void> {
  const checks: Record<string, unknown> = {};
  try {
    checks.dashboard = await win.webContents.executeJavaScript(
      '({bridge:typeof window.shinylaunchR?.listApps === "function",node:typeof window.require,root:!!document.querySelector("#root")})',
    );
    const result = checks.dashboard as {
      bridge: boolean;
      node: string;
      root: boolean;
    };
    if (!result.bridge || result.node !== 'undefined' || !result.root)
      throw new Error('Dashboard/preload isolation smoke failed.');
    checks.ipc = await win.webContents.executeJavaScript(
      'window.shinylaunchR.listApps()',
    );
    checks.ui = await packagedUiChecks(win, smokeRoot!);
    checks.credentials = await packagedCredentialCheck(smokeRoot!);
    const iconDir = path.join(smokeRoot!, 'user-data', 'icons');
    fs.mkdirSync(iconDir, { recursive: true });
    fs.writeFileSync(
      path.join(iconDir, '00000000-0000-4000-8000-000000000000.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    checks.icon = await win.webContents.executeJavaScript(
      'new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(true);image.onerror=()=>resolve(false);image.src="slr-icon://cache/00000000-0000-4000-8000-000000000000.png";setTimeout(()=>resolve(false),3000)})',
    );
    if (!checks.icon) throw new Error('Scoped icon protocol/CSP failed.');
    checks.notification = await win.webContents.executeJavaScript(
      'Notification.requestPermission()',
    );
    if (checks.notification !== 'denied')
      throw new Error('Permission request was not denied.');
    const remote = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'smoke-isolated',
      },
    });
    restrictSession(remote.webContents.session);
    restrictWindow(remote, () => false);
    await remote.loadURL(
      'data:text/html,<html><body>isolated smoke</body></html>',
    );
    checks.remote = await remote.webContents.executeJavaScript(
      '({bridge:typeof window.shinylaunchR,node:typeof window.require})',
    );
    const isolated = checks.remote as { bridge: string; node: string };
    if (isolated.bridge !== 'undefined' || isolated.node !== 'undefined')
      throw new Error('Remote isolation failed.');
    checks.permissions =
      remote.webContents.session.getStoragePath() === null ||
      !remote.webContents.session.isPersistent();
    if (!checks.permissions)
      throw new Error('Remote session unexpectedly persists.');
    checks.senderRejected = !ctx.isTrustedSender({
      sender: remote.webContents,
      senderFrame: remote.webContents.mainFrame,
    });
    if (!checks.senderRejected) throw new Error('Foreign IPC sender accepted.');
    checks.remoteNotification = await remote.webContents.executeJavaScript('Notification.requestPermission()');
    if (checks.remoteNotification !== 'denied') throw new Error('Remote permission was granted.');
    checks.popupBlocked = await remote.webContents.executeJavaScript('window.open("https://example.invalid/") === null');
    if (!checks.popupBlocked) throw new Error('Remote popup was allowed.');
    const originalUrl = remote.webContents.getURL();
    checks.navigationBlocked = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 3000);
      const observed = (event: { defaultPrevented: boolean }) => {
        clearTimeout(timer);
        resolve(event.defaultPrevented);
      };
      remote.webContents.once('will-navigate', observed);
      remote.webContents.once('will-frame-navigate', observed);
      void remote.webContents.executeJavaScript('location.href="https://example.invalid/"').catch(() => {});
    });
    if (!checks.navigationBlocked || remote.webContents.getURL() !== originalUrl) throw new Error('Remote navigation was not blocked.');
    remote.close();
    const foreign = new BrowserWindow({ show: false, webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'smoke-foreign',
    }});
    restrictSession(foreign.webContents.session);
    restrictWindow(foreign, () => false);
    await foreign.loadURL('data:text/html,<html><body>foreign sender</body></html>');
    checks.foreignIpcRejected = await foreign.webContents.executeJavaScript('window.shinylaunchR.listApps().then(()=>false,error=>error.message.includes("Untrusted IPC sender"))');
    foreign.close();
    if (!checks.foreignIpcRejected) throw new Error('Foreign renderer IPC was accepted.');
    await ctx.shutdown();
    fs.writeFileSync(
      path.join(smokeRoot!, 'smoke-result.json'),
      JSON.stringify(
        {
          ok: true,
          version: app.getVersion(),
          platform: process.platform,
          checks,
        },
        null,
        2,
      ),
    );
    shutdownComplete = true;
    app.quit();
  } catch (e) {
    fs.writeFileSync(
      path.join(smokeRoot!, 'smoke-result.json'),
      JSON.stringify({ ok: false, error: String(e), checks }, null, 2),
    );
    await ctx.shutdown().catch(() => {});
    app.exit(1);
  }
}
async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  logger.init(path.join(userData, 'logs'));
  context = new AppContext(userData, { smoke: !!smokeRoot });
  await context.reapOrphanProcesses();
  const ctx = context;
  protocol.handle('slr-icon', (request) => {
    try {
      return net.fetch(pathToFileURL(ctx.icons.resolveUrl(request.url)).href);
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  mainWindow = createMainWindow();
  context.setMainWindow(mainWindow);
  registerIpc(context);
  const rebuild = () => installMenu(ctx, () => mainWindow);
  ctx.setMenuRebuilder(rebuild);
  rebuild();
  await loadDashboard(mainWindow);
  if (smokeRoot) {
    await smoke(mainWindow, ctx);
    return;
  }
  await ctx.launchLast();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  void app
    .whenReady()
    .then(bootstrap)
    .catch((e) => {
      logger.error('main', String(e));
      dialog.showErrorBox('Startup failed', String(e));
      app.quit();
    });
  app.on('activate', () => {
    if (!mainWindow && context) {
      mainWindow = createMainWindow();
      context.setMainWindow(mainWindow);
      void loadDashboard(mainWindow).catch((e) =>
        logger.error('main', String(e)),
      );
    }
  });
}
app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  void (async () => {
    try {
      await context?.shutdown();
      logger.close();
      shutdownComplete = true;
      app.quit();
    } catch (e) {
      shuttingDown = false;
      logger.error('main', String(e));
      dialog.showErrorBox('Unable to confirm shutdown', String(e));
    }
  })();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
