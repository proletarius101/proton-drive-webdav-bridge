/**
 * Proton Drive WebDAV Bridge - IPC Handlers
 *
 * Registers all IPC handlers for communication between main and renderer.
 * Uses contextBridge-exposed API surface.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { webdavService, type WebDAVServiceOptions } from './services/webdav-service.js';
import {
  authService,
  type LoginCredentials,
  type TwoFactorAuth,
  type MailboxPasswordAuth,
} from './services/auth-service.js';
import { configService, type ConfigUpdate } from './services/config-service.js';
import { logger } from '../logger.js';

/**
 * Register all IPC handlers
 */
export function registerIPCHandlers(): void {
  logger.debug('Registering IPC handlers');

  // ============================================================================
  // WebDAV Server Handlers
  // ============================================================================

  ipcMain.handle(
    'webdav:start',
    async (_event: IpcMainInvokeEvent, options?: WebDAVServiceOptions) => {
      logger.debug('IPC: webdav:start', options);
      return await webdavService.start(options || {});
    }
  );

  ipcMain.handle('webdav:stop', async (_event: IpcMainInvokeEvent) => {
    logger.debug('IPC: webdav:stop');
    return await webdavService.stop();
  });

  ipcMain.handle('webdav:status', async (_event: IpcMainInvokeEvent) => {
    logger.debug('IPC: webdav:status');
    return webdavService.getStatus();
  });

  // ============================================================================
  // Authentication Handlers
  // ============================================================================

  ipcMain.handle(
    'auth:login',
    async (_event: IpcMainInvokeEvent, credentials: LoginCredentials) => {
      logger.debug('IPC: auth:login', { username: credentials.username || credentials.email });
      return await authService.login(credentials);
    }
  );

  ipcMain.handle('auth:submit2FA', async (_event: IpcMainInvokeEvent, twoFactor: TwoFactorAuth) => {
    logger.debug('IPC: auth:submit2FA');
    return await authService.submit2FA(twoFactor);
  });

  ipcMain.handle(
    'auth:submitMailboxPassword',
    async (_event: IpcMainInvokeEvent, mailbox: MailboxPasswordAuth) => {
      logger.debug('IPC: auth:submitMailboxPassword');
      return await authService.submitMailboxPassword(mailbox);
    }
  );

  ipcMain.handle('auth:logout', async (_event: IpcMainInvokeEvent) => {
    logger.debug('IPC: auth:logout');
    return await authService.logout();
  });

  ipcMain.handle('auth:getStatus', async (_event: IpcMainInvokeEvent) => {
    logger.debug('IPC: auth:getStatus');
    return await authService.getStatus();
  });

  // ============================================================================
  // Configuration Handlers
  // ============================================================================

  ipcMain.handle('config:get', async (_event: IpcMainInvokeEvent) => {
    logger.debug('IPC: config:get');
    return configService.getConfig();
  });

  ipcMain.handle('config:update', async (_event: IpcMainInvokeEvent, updates: ConfigUpdate) => {
    logger.debug('IPC: config:update', updates);
    return await configService.updateConfig(updates);
  });

  // ============================================================================
  // Log Events (one-way from renderer)
  // ============================================================================

  ipcMain.on(
    'log:message',
    (_event: IpcMainInvokeEvent, level: string, message: string, ...args: unknown[]) => {
      // Forward renderer logs to main logger
      switch (level) {
        case 'error':
          logger.error('[Renderer]', message, ...args);
          break;
        case 'warn':
          logger.warn('[Renderer]', message, ...args);
          break;
        case 'info':
          logger.info('[Renderer]', message, ...args);
          break;
        case 'debug':
          logger.debug('[Renderer]', message, ...args);
          break;
        default:
          logger.info('[Renderer]', message, ...args);
      }
    }
  );

  logger.info('IPC handlers registered');
}
