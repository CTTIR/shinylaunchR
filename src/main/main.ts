/**
 * Electron main entry: app lifecycle, the dashboard window, and wiring of the
 * service context, IPC handlers and native menu. Guarantees all child R
 * processes are killed before quit.
 */
import path from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { logger } from './logger';
import { AppContext } from './context';
import { registerIpc } from './ipc';
import { installMenu } from './menu';
import { resourcePath } from './resources';

let mainWindow: BrowserWindow | null = null;
let context: AppContext | null = null;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#1a1a1d',
    title: 'shinylaunchR',
    icon: resourcePath('icon.png'),
    show: false,
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

  win.once('ready-to-show', () => win.show());
  hardenNavigation(win, () => process.env.ELECTRON_RENDERER_URL);

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

/**
 * Lock a window down: block in-page navigation to anything but its own origin,
 * and route any window.open / external link to the system browser (https only).
 * Prevents a compromised renderer or stray link from navigating the app shell.
 */
function hardenNavigation(win: BrowserWindow, devUrl: () => string | undefined): void {
  const isInternal = (url: string): boolean => {
    const dev = devUrl();
    if (dev && url.startsWith(dev)) return true;
    return url.startsWith('file://');
  };

  win.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault();
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function bootstrap(): void {
  const userData = app.getPath('userData');
  logger.init(path.join(userData, 'logs'));
  logger.info('main', `shinylaunchR ${app.getVersion()} starting (userData: ${userData}).`);

  context = new AppContext(userData);
  mainWindow = createMainWindow();
  context.setMainWindow(mainWindow);

  registerIpc(context);
  installMenu(context, () => mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Single-instance lock — focus the existing window instead of opening a second.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    bootstrap();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        context?.setMainWindow(mainWindow);
        mainWindow.on('closed', () => {
          mainWindow = null;
        });
      }
    });
  });
}

app.on('before-quit', () => {
  logger.info('main', 'Shutting down; stopping all Shiny processes.');
  context?.supervisor.stopAll();
  logger.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    context?.supervisor.stopAll();
    app.quit();
  }
});
