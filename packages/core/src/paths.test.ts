import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getAppPaths, isPathInside, resolveAppPaths } from './paths.ts';

const originalHome = process.env.FILLFORGE_HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.FILLFORGE_HOME;
  } else {
    process.env.FILLFORGE_HOME = originalHome;
  }
});

describe('resolveAppPaths', () => {
  it('uses the same logical layout on every platform', () => {
    const paths = resolveAppPaths(path.resolve('/tmp/fillforge-home'));
    expect(paths.configDir).toBe(path.join(paths.home, '.config', 'fillforge'));
    expect(paths.configFile).toBe(path.join(paths.configDir, 'config.yaml'));
    expect(paths.dataDir).toBe(path.join(paths.home, '.local', 'fillforge'));
    expect(paths.templatesDir).toBe(path.join(paths.dataDir, 'templates'));
    expect(paths.runsDir).toBe(path.join(paths.dataDir, 'runs'));
    expect(paths.exportsDir).toBe(path.join(paths.dataDir, 'exports'));
    expect(paths.cacheDir).toBe(path.join(paths.dataDir, 'cache'));
    expect(paths.logsDir).toBe(path.join(paths.dataDir, 'logs'));
  });

  it('does not depend on OS-specific application data directories', () => {
    const paths = resolveAppPaths(os.tmpdir());
    const all = [
      paths.configDir,
      paths.dataDir,
      paths.templatesDir,
      paths.runsDir,
      paths.exportsDir,
      paths.cacheDir,
      paths.logsDir
    ];
    for (const candidate of all) {
      expect(candidate).not.toMatch(/Application Support|AppData/i);
    }
  });
});

describe('getAppPaths', () => {
  it('honors the FILLFORGE_HOME override so tests never touch the real home', async () => {
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'fillforge-paths-'));
    process.env.FILLFORGE_HOME = fakeHome;
    const paths = getAppPaths();
    expect(paths.home).toBe(fakeHome);
    expect(paths.configDir.startsWith(fakeHome)).toBe(true);
  });
});

describe('isPathInside', () => {
  it('rejects traversal and sibling paths', () => {
    const root = path.resolve('/tmp/fillforge-data');
    expect(isPathInside(root, path.join(root, 'runs', 'result.docx'))).toBe(true);
    expect(isPathInside(root, path.join(root, '..', 'outside.txt'))).toBe(false);
    expect(isPathInside(root, `${root}-backup/result.docx`)).toBe(false);
  });
});
