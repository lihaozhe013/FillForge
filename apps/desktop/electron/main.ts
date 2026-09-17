import { app } from 'electron';
import { registerIpcHandlers } from './ipc/handlers';
import { initLogger, logAppEvent } from './logger';
import { createAppServices } from './services';
import { createMainWindow, quitWhenAllWindowsClosedOnNonMac } from './window';

app.setName('FillForge');

app.whenReady().then(() => {
  try {
    const services = createAppServices();
    initLogger({
      isPackaged: app.isPackaged,
      logsDir: services.paths.logsDir
    });
    logAppEvent('info', `Data directory: ${services.paths.dataDir}`);
    registerIpcHandlers(services);
    createMainWindow();
  } catch (error) {
    logAppEvent(
      'error',
      `Startup failed: ${error instanceof Error ? error.message : String(error)}`
    );
    console.error(error);
    app.quit();
  }
});

quitWhenAllWindowsClosedOnNonMac();

process.on('uncaughtException', (error) => {
  logAppEvent('error', `Uncaught exception: ${error.message}`);
  logAppEvent('error', `Stack: ${error.stack ?? 'unavailable'}`);
});
process.on('unhandledRejection', (reason) => {
  logAppEvent(
    'error',
    `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`
  );
});
