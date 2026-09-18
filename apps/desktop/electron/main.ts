import { app } from 'electron';
import { initLogger, logAppEvent } from './logger';
import { registerIpcHandlers } from './ipc/handlers';
import { applyLanguage } from './i18n';
import { installApplicationMenu } from './menu';
import { createAppServices } from './services';
import { createMainWindow, quitWhenAllWindowsClosedOnNonMac } from './window';

app.setName('FillForge');

// Escape hatch for environments where Chromium's GPU process is unstable
// (observed with some NVIDIA/vaapi setups): FILLFORGE_DISABLE_GPU=1 pnpm dev
if (process.env.FILLFORGE_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}

app.whenReady().then(async () => {
  try {
    const services = await createAppServices();
    initLogger({
      isPackaged: app.isPackaged,
      logsDir: services.paths.logsDir
    });
    logAppEvent('info', `Data directory: ${services.paths.dataDir}`);
    registerIpcHandlers(services);
    applyLanguage(services.config.language);
    installApplicationMenu();
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
