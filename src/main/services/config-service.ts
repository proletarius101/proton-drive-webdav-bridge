/**
 * Proton Drive WebDAV Bridge - Configuration Service
 *
 * Service layer for managing application configuration in the main process.
 */

import { loadConfig, updateConfig as updateConfigFile, type Config } from '../../config.js';
import { logger } from '../../logger.js';

export type ConfigUpdate = Partial<Config>;

/**
 * Singleton service for managing configuration
 */
class ConfigServiceManager {
  /**
   * Get current configuration
   */
  getConfig(): Config {
    return loadConfig();
  }

  /**
   * Update configuration
   */
  async updateConfig(updates: ConfigUpdate): Promise<{ success: boolean; error?: string }> {
    try {
      updateConfigFile(updates);

      logger.info('Configuration updated:', updates);

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to update configuration:', error);

      return {
        success: false,
        error: message,
      };
    }
  }
}

// Export singleton instance
export const configService = new ConfigServiceManager();
