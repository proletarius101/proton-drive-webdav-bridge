/**
 * Authentication Manager for Electron Main Process
 *
 * This module manages the global ProtonAuth instance and coordinates
 * the multi-step authentication flow (login -> 2FA -> mailbox password).
 * It handles session persistence via the keychain and provides methods
 * for the IPC handlers to use.
 */

import ProtonAuth, {
  authenticateAndStore,
  restoreSessionFromStorage,
  type Session,
  type ApiError,
} from '../src/auth.js';
import { logger } from '../src/logger.js';

interface AuthState {
  auth: ProtonAuth | null;
  session: Session | null;
  isAuthenticated: boolean;
}

/**
 * Global authentication state
 */
let authState: AuthState = {
  auth: null,
  session: null,
  isAuthenticated: false,
};

/**
 * Initialize authentication manager on startup
 * Attempts to restore a previous session from stored credentials
 */
export async function initializeAuthManager(): Promise<void> {
  try {
    const result = await restoreSessionFromStorage();
    authState.auth = new ProtonAuth();
    authState.session = result.session;
    authState.isAuthenticated = true;
    logger.info(`Authentication restored for user: ${result.username}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug(`No previous authentication found: ${message}`);
    authState = {
      auth: null,
      session: null,
      isAuthenticated: false,
    };
  }
}

/**
 * Handle login with email and password
 * Returns success status and indicates if 2FA or mailbox password is required
 */
export async function handleLogin(credentials: { email: string; password: string }): Promise<{
  success: boolean;
  requires2FA?: boolean;
  requiresMailboxPassword?: boolean;
  error?: string;
}> {
  try {
    // Start fresh authentication instance for this login attempt
    const auth = new ProtonAuth();
    authState.auth = auth;

    try {
      const session = await auth.login(credentials.email, credentials.password);
      authState.session = session;
      authState.isAuthenticated = true;

      // Attempt to store credentials for future sessions
      try {
        await authenticateAndStore(credentials.email, credentials.password);
      } catch (storageError) {
        logger.warn(`Failed to store credentials: ${storageError}`);
        // Continue anyway - user can still use the session until they close the app
      }

      return { success: true };
    } catch (error) {
      const apiError = error as ApiError;

      // Check if error is due to missing 2FA
      if (apiError.requires2FA) {
        logger.debug('2FA is required for this account');
        return { success: false, requires2FA: true };
      }

      // Check if error is due to missing mailbox password (password mode 2)
      if (apiError.requiresMailboxPassword) {
        logger.debug('Mailbox password is required');
        return { success: false, requiresMailboxPassword: true };
      }

      // Handle other errors
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Login failed: ${message}`);

      return {
        success: false,
        error: message.includes('Invalid')
          ? 'Invalid email or password'
          : 'Login failed. Please try again.',
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Unexpected error during login: ${message}`);
    return {
      success: false,
      error: 'An unexpected error occurred. Please try again.',
    };
  }
}

/**
 * Handle 2FA code submission
 * Must be called after a login attempt returned requires2FA: true
 */
export async function handleSubmit2FA(code: string): Promise<{
  success: boolean;
  requiresMailboxPassword?: boolean;
  error?: string;
}> {
  try {
    if (!authState.auth) {
      return {
        success: false,
        error: 'No pending authentication. Please start by entering your email and password.',
      };
    }

    try {
      const session = await authState.auth.submit2FA(code);
      authState.session = session;
      authState.isAuthenticated = true;

      return { success: true };
    } catch (error) {
      const apiError = error as ApiError;

      // Check if mailbox password is now required
      if (apiError.requiresMailboxPassword) {
        logger.debug('Mailbox password is required after 2FA');
        return { success: false, requiresMailboxPassword: true };
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.error(`2FA submission failed: ${message}`);

      return {
        success: false,
        error: message.includes('Invalid')
          ? 'Invalid 2FA code'
          : '2FA verification failed. Please try again.',
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Unexpected error during 2FA: ${message}`);
    return {
      success: false,
      error: 'An unexpected error occurred. Please try again.',
    };
  }
}

/**
 * Handle mailbox password submission
 * Must be called after authentication returned requiresMailboxPassword: true
 */
export async function handleSubmitMailboxPassword(password: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    if (!authState.auth) {
      return {
        success: false,
        error: 'No pending authentication. Please start by entering your email and password.',
      };
    }

    try {
      const session = await authState.auth.submitMailboxPassword(password);
      authState.session = session;
      authState.isAuthenticated = true;

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Mailbox password submission failed: ${message}`);

      return {
        success: false,
        error: message.includes('Invalid')
          ? 'Invalid mailbox password'
          : 'Mailbox password verification failed. Please try again.',
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Unexpected error during mailbox password submission: ${message}`);
    return {
      success: false,
      error: 'An unexpected error occurred. Please try again.',
    };
  }
}

/**
 * Handle logout
 * Clears the current session and removes stored credentials
 */
export async function handleLogout(): Promise<{ success: boolean }> {
  try {
    if (authState.auth && authState.session) {
      await authState.auth.logout();
    }

    // Clear stored credentials for next app start
    const { deleteStoredCredentials } = await import('../src/keychain.js');
    try {
      await deleteStoredCredentials();
    } catch (error) {
      logger.warn(`Failed to delete stored credentials: ${error}`);
    }

    // Clear in-memory state
    authState = {
      auth: null,
      session: null,
      isAuthenticated: false,
    };

    logger.info('User logged out successfully');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Logout failed: ${message}`);
    // Still clear state even if logout fails
    authState = {
      auth: null,
      session: null,
      isAuthenticated: false,
    };
    return { success: true };
  }
}

/**
 * Check if user is currently authenticated
 */
export function isAuthenticated(): boolean {
  return authState.isAuthenticated && authState.session !== null;
}

/**
 * Get current session (if authenticated)
 */
export function getSession(): Session | null {
  return authState.isAuthenticated ? authState.session : null;
}

export default {
  initializeAuthManager,
  handleLogin,
  handleSubmit2FA,
  handleSubmitMailboxPassword,
  handleLogout,
  isAuthenticated,
  getSession,
};
