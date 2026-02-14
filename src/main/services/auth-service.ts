/**
 * Proton Drive WebDAV Bridge - Authentication Service
 *
 * Service layer for managing authentication in the main process.
 */

import { ProtonAuth } from '../../auth.js';
import { storeCredentials, deleteStoredCredentials, hasStoredCredentials } from '../../keychain.js';
import { logger } from '../../logger.js';

export interface LoginCredentials {
  username?: string;
  email?: string;
  password?: string;
}

export interface TwoFactorAuth {
  code: string;
}

export interface MailboxPasswordAuth {
  password: string;
}

export interface AuthResult {
  success: boolean;
  requires2FA?: boolean;
  requiresMailboxPassword?: boolean;
  error?: string;
  sessionData?: unknown;
}

export interface AuthStatus {
  isAuthenticated: boolean;
  username?: string;
}

/**
 * Singleton service for managing authentication
 */
class AuthServiceManager {
  private auth: ProtonAuth | null = null;

  /**
   * Login with username and password
   * Follows the same flow as CLI auth command
   */
  async login(credentials: LoginCredentials): Promise<AuthResult> {
    try {
      // Accept either username or email
      const username = credentials.username || credentials.email;
      const password = credentials.password;

      if (!username || !password) {
        return {
          success: false,
          error: 'Username/email and password are required',
        };
      }

      this.auth = new ProtonAuth();
      let session;

      try {
        // Initial login attempt
        session = await this.auth.login(username, password);
      } catch (error: unknown) {
        const apiError = error as {
          requires2FA?: boolean;
          requiresMailboxPassword?: boolean;
          message?: string;
        };

        // Handle 2FA requirement
        if (apiError.requires2FA) {
          logger.debug('2FA required for login');
          return {
            success: false,
            requires2FA: true,
          };
        }

        // Handle mailbox password requirement
        if (apiError.requiresMailboxPassword) {
          logger.debug('Mailbox password required for login');
          return {
            success: false,
            requiresMailboxPassword: true,
          };
        }

        throw error;
      }

      // Store credentials using the reusable credentials from auth instance
      const reusableCredentials = this.auth.getReusableCredentials();
      const storedCreds = {
        ...reusableCredentials,
        username,
      };

      await storeCredentials(storedCreds);

      logger.info('Login successful for:', username);

      return {
        success: true,
        sessionData: session,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Login failed:', error);

      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Submit 2FA code
   */
  async submit2FA(twoFactor: TwoFactorAuth): Promise<AuthResult> {
    try {
      if (!this.auth) {
        throw new Error('No active authentication session');
      }

      const session = await this.auth.submit2FA(twoFactor.code);

      logger.info('2FA successful');

      return {
        success: true,
        sessionData: session,
      };
    } catch (error: unknown) {
      const apiError = error as {
        requiresMailboxPassword?: boolean;
        message?: string;
      };

      logger.error('2FA failed:', error);

      if (apiError.requiresMailboxPassword) {
        return {
          success: false,
          requiresMailboxPassword: true,
        };
      }

      const message = apiError.message || String(error);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Submit mailbox password
   */
  async submitMailboxPassword(mailbox: MailboxPasswordAuth): Promise<AuthResult> {
    try {
      if (!this.auth) {
        throw new Error('No active authentication session');
      }

      const session = await this.auth.submitMailboxPassword(mailbox.password);

      logger.info('Mailbox password authentication successful');

      return {
        success: true,
        sessionData: session,
      };
    } catch (error: unknown) {
      const apiError = error as { message?: string };
      const message = apiError.message || String(error);

      logger.error('Mailbox password authentication failed:', error);

      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Logout and clear stored credentials
   */
  async logout(): Promise<{ success: boolean; error?: string }> {
    try {
      await deleteStoredCredentials();
      this.auth = null;

      logger.info('Logout successful');

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Logout failed:', error);

      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Get current authentication status
   */
  async getStatus(): Promise<AuthStatus> {
    const isAuthenticated = await hasStoredCredentials();

    return {
      isAuthenticated,
    };
  }
}

// Export singleton instance
export const authService = new AuthServiceManager();
