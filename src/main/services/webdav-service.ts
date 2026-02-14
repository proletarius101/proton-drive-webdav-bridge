/**
 * Proton Drive WebDAV Bridge - WebDAV Service
 *
 * Service layer for managing WebDAV server lifecycle in the main process.
 * Wraps CLI functionality for use by IPC handlers.
 */

import { WebDAVServer } from '../../webdav/index.js';
import { logger } from '../../logger.js';
import { loadConfig } from '../../config.js';
import { hasStoredCredentials } from '../../keychain.js';

export interface WebDAVServiceOptions {
  port?: number;
  host?: string;
  requireAuth?: boolean;
}

export interface ServerStatus {
  running: boolean;
  url?: string;
  error?: string;
}

/**
 * Singleton service for managing the WebDAV server
 */
class WebDAVServiceManager {
  private server: WebDAVServer | null = null;
  private isRunning = false;

  /**
   * Start the WebDAV server
   */
  async start(options: WebDAVServiceOptions = {}): Promise<ServerStatus> {
    try {
      // Check if already running
      if (this.isRunning && this.server) {
        return {
          running: true,
          url: this.server.getUrl(),
        };
      }

      // Check authentication unless disabled
      if (options.requireAuth !== false) {
        const hasAuth = await hasStoredCredentials();
        if (!hasAuth) {
          return {
            running: false,
            error: 'Not logged in. Please authenticate first.',
          };
        }
      }

      // Load config
      const config = loadConfig();

      // Create server with merged options
      const serverOptions: Record<string, unknown> = {
        ...config,
        ...options,
      };

      this.server = new WebDAVServer(serverOptions);

      // Start server
      await this.server.start();
      this.isRunning = true;

      logger.info('WebDAV server started:', this.server.getUrl());

      return {
        running: true,
        url: this.server.getUrl(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to start WebDAV server:', error);
      return {
        running: false,
        error: message,
      };
    }
  }

  /**
   * Stop the WebDAV server
   */
  async stop(): Promise<ServerStatus> {
    try {
      if (!this.server || !this.isRunning) {
        return {
          running: false,
        };
      }

      await this.server.stop();
      this.server = null;
      this.isRunning = false;

      logger.info('WebDAV server stopped');

      return {
        running: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to stop WebDAV server:', error);
      return {
        running: this.isRunning,
        error: message,
      };
    }
  }

  /**
   * Get current server status
   */
  getStatus(): ServerStatus {
    if (this.isRunning && this.server) {
      return {
        running: true,
        url: this.server.getUrl(),
      };
    }

    return {
      running: false,
    };
  }
}

// Export singleton instance
export const webdavService = new WebDAVServiceManager();
