/**
 * Proton Drive WebDAV Bridge - Logging
 *
 * Winston-based logging with console and optional rotating file transports.
 */

import { join } from 'path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { paths } from './paths.js';

// ============================================================================
// Configuration
// ============================================================================

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
  winston.format.printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)
);

// ============================================================================
// Transports
// ============================================================================

const isTestEnv =
  process.env.NODE_ENV === 'test' || process.argv.some((arg) => arg.includes('test'));

const consoleTransport = new winston.transports.Console({
  format: consoleFormat,
  level: 'info',
});

const transports: winston.transport[] = [consoleTransport];

if (!isTestEnv) {
  const fileTransport = new DailyRotateFile({
    dirname: paths.log,
    filename: 'proton-drive-webdav-bridge-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format: logFormat,
    level: 'debug',
  });

  const errorFileTransport = new DailyRotateFile({
    dirname: paths.log,
    filename: 'proton-drive-webdav-bridge-error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',
    format: logFormat,
    level: 'error',
  });

  transports.push(fileTransport, errorFileTransport);
}

// ============================================================================
// Logger Instance
// ============================================================================

export const logger = winston.createLogger({
  level: 'debug',
  transports,
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
  return join(paths.log, `proton-drive-webdav-bridge-${date}.log`);
}

export default logger;
