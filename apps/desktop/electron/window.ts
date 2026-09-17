import path from 'node:path';
import { app, BrowserWindow, shell } from 'electron';

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 620,
    title: 'FillForge',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.on('ready-to-show', () => window.show());

  // The dev server URL is injected by electron-vite during `dev`.
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return window;
}

export function activateOrCreateWindow(): void {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
}

export function quitWhenAllWindowsClosedOnNonMac(): void {
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
  app.on('activate', activateOrCreateWindow);
}
