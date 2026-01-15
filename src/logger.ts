/**
 * Proton Drive Bridge - Logging
 *
 * Winston-based logging with console and file transports.
 * Supports daily log rotation.
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { getLogDir } from './paths.js';

// ============================================================================
// Configuration
// ============================================================================

const LOG_DIR = getLogDir();

// Ensure log directory exists
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // Ignore if already exists
}

// ============================================================================
// Log Format
// ============================================================================

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    if (stack) {
      return `${timestamp} [${level.toUpperCase()}] ${message}\n${stack}`;
    }
    return `${timestamp} [${level.toUpperCase()}] ${message}`;
  })
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// ============================================================================
// Transports
// ============================================================================

const consoleTransport = new winston.transports.Console({
  format: consoleFormat,
  level: 'info',
});

const fileTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'proton-drive-bridge-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: logFormat,
  level: 'debug',
});

const errorFileTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'proton-drive-bridge-error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  format: logFormat,
  level: 'error',
});

// ============================================================================
// Logger Instance
// ============================================================================

export const logger = winston.createLogger({
  level: 'debug',
  transports: [consoleTransport, fileTransport, errorFileTransport],
});

// ============================================================================
// Log Level Control
// ============================================================================

let debugEnabled = false;

/**
 * Enable or disable debug logging to console
 */
export function setDebugMode(enabled: boolean): void {
  debugEnabled = enabled;
  consoleTransport.level = enabled ? 'debug' : 'info';
  logger.info(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Check if debug mode is enabled
 */
export function isDebugMode(): boolean {
  return debugEnabled;
}

/**
 * Get the log file path for the current day
 */
export function getLogFilePath(): string {
  const date = new Date().toISOString().split('T')[0];
  return join(LOG_DIR, `proton-drive-bridge-${date}.log`);
}

export default logger;
