import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDirectory } from '@docufill/core';

const MAX_LOG_SIZE = 2 * 1024 * 1024;

let logsBaseDir: string | null = null;

/**
 * Per AGENTS.md, debug builds write logs into ./debug-logs while release
 * builds use the per-user data directory.
 */
export function initLogger(options: { isPackaged: boolean; logsDir: string }): void {
  logsBaseDir = options.isPackaged ? options.logsDir : path.resolve('debug-logs');
  void ensureDirectory(logsBaseDir).catch(() => {});
}

async function rotateIfNeeded(file: string): Promise<void> {
  try {
    const stat = await fs.stat(file);
    if (stat.size > MAX_LOG_SIZE) {
      await fs.rename(file, `${file}.previous.log`);
    }
  } catch {
    // Missing file is fine; first write creates it.
  }
}

async function appendLine(file: string, line: string): Promise<void> {
  if (!logsBaseDir) {
    return;
  }
  const target = path.join(logsBaseDir, file);
  await rotateIfNeeded(target).catch(() => {});
  await fs.appendFile(target, `${new Date().toISOString()} ${line}\n`, 'utf8').catch(() => {});
}

/**
 * debug.log is a summary of application warnings and errors.
 */
export function logAppEvent(level: 'info' | 'warn' | 'error', message: string): void {
  void appendLine('debug.log', `[${level}] ${message}`);
}

/**
 * debug-{feature}.log holds full per-domain output.
 */
export function logDebug(feature: string, message: string): void {
  void appendLine(`debug-${feature}.log`, message);
}

export function currentLogsBaseDir(): string | null {
  return logsBaseDir;
}
