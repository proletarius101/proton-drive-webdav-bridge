/**
 * Proton Drive WebDAV Bridge - Daemon Utilities
 *
 * Shared utilities for managing the WebDAV server daemon process.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { getPidFilePath } from '../paths.js';
import { logger } from '../logger.js';

/**
 * Write process ID to PID file
 */
export function writePidFile(pid: number): void {
  const pidFile = getPidFilePath();
  writeFileSync(pidFile, pid.toString(), { mode: 0o644 });
}

/**
 * Remove PID file
 */
export function removePidFile(): void {
  const pidFile = getPidFilePath();
  if (existsSync(pidFile)) {
    unlinkSync(pidFile);
  }
}

/**
 * Read process ID from PID file
 */
export function readPidFile(): number | null {
  const pidFile = getPidFilePath();
  if (!existsSync(pidFile)) {
    return null;
  }
  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch (error) {
    logger.debug(`Failed to read PID file: ${error}`);
    return null;
  }
}

/**
 * Check if a process is running by sending signal 0
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
