import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface AppPaths {
  home: string;
  configDir: string;
  configFile: string;
  dataDir: string;
  templatesDir: string;
  runsDir: string;
  exportsDir: string;
  cacheDir: string;
  logsDir: string;
}

export const APP_NAME = 'docufill';

/**
 * Resolve canonical application paths under a given home directory.
 * The same logical layout is used on Linux, macOS, and Windows; we never
 * translate these into OS-specific application data directories.
 */
export function resolveAppPaths(home: string): AppPaths {
  const configDir = path.join(home, '.config', APP_NAME);
  const dataDir = path.join(home, '.local', APP_NAME);
  return {
    home,
    configDir,
    configFile: path.join(configDir, 'config.yaml'),
    dataDir,
    templatesDir: path.join(dataDir, 'templates'),
    runsDir: path.join(dataDir, 'runs'),
    exportsDir: path.join(dataDir, 'exports'),
    cacheDir: path.join(dataDir, 'cache'),
    logsDir: path.join(dataDir, 'logs')
  };
}

export function getHomeDirectory(): string {
  return process.env.DOCUFILL_HOME ?? os.homedir();
}

export function getAppPaths(): AppPaths {
  return resolveAppPaths(getHomeDirectory());
}

/**
 * Create the canonical directory layout on first launch. Safe to call every
 * start; it never deletes anything.
 */
export async function ensureAppDirectories(paths: AppPaths): Promise<void> {
  await Promise.all(
    [
      paths.configDir,
      paths.dataDir,
      paths.templatesDir,
      paths.runsDir,
      paths.exportsDir,
      paths.cacheDir,
      paths.logsDir
    ].map((dir) => fs.mkdir(dir, { recursive: true }))
  );
}
