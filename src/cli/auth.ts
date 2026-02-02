/**
 * Proton Drive WebDAV Bridge - Auth CLI Command
 *
 * Handles authentication with Proton account.
 */

import { Command } from 'commander';
import { input, password as passwordPrompt, confirm } from '@inquirer/prompts';
import { ProtonAuth, type ApiError } from '../auth.js';
import { storeCredentials, deleteStoredCredentials, hasStoredCredentials } from '../keychain.js';
import { logger } from '../logger.js';
import { toAppError } from '../utils/error.js';
import { validateEmail, validatePasswordStrength } from '../validation/auth.js';
import { InvalidCredentialsError } from '../errors/index.js';
import { getConfig, updateConfig } from '../config.js';

export function registerAuthCommand(program: Command): void {
  const authCmd = program.command('auth').description('Manage Proton account authentication');

  // Login subcommand
  authCmd
    .command('login')
    .description('Login to your Proton account')
    .option('-u, --username <username>', 'Proton username or email')
    .action(async (options) => {
      try {
        // Check if already authenticated
        if (await hasStoredCredentials()) {
          const overwrite = await confirm({
            message: 'You are already logged in. Do you want to login with a different account?',
            default: false,
          });
          if (!overwrite) {
            console.log('Login cancelled.');
            return;
          }
        }

        // Get username
        const username =
          options.username ||
          (await input({
            message: 'Proton username or email:',
            validate: (value) => value.length > 0 || 'Username is required',
          }));

        // Validate username format (basic)
        const usernameValidation = validateEmail(username);
        if (!usernameValidation.ok) {
          throw usernameValidation.error;
        }

        // Get password
        const password = await passwordPrompt({
          message: 'Password:',
          mask: '*',
        });

        // Validate password (non-empty)
        const pwdValidation = validatePasswordStrength(password, 1);
        if (!pwdValidation.ok) {
          throw pwdValidation.error;
        }

        console.log('Authenticating...');

        const auth = new ProtonAuth();
        let session;

        try {
          session = await auth.login(username, password);
        } catch (error) {
          const apiError = error as ApiError;

          // Handle 2FA
          if (apiError.requires2FA) {
            const twoFactorCode = await input({
              message: 'Enter 2FA code:',
              validate: (value) => /^\d{6}$/.test(value) || 'Please enter a 6-digit code',
            });

            try {
              session = await auth.submit2FA(twoFactorCode);
            } catch (error2) {
              const apiError2 = error2 as ApiError;

              // Handle mailbox password after 2FA
              if (apiError2.requiresMailboxPassword) {
                const mailboxPassword = await passwordPrompt({
                  message: 'Mailbox password (two-password mode):',
                  mask: '*',
                });
                session = await auth.submitMailboxPassword(mailboxPassword);
              } else {
                throw error2;
              }
            }
          } else if (apiError.requiresMailboxPassword) {
            // Handle mailbox password
            const mailboxPassword = await passwordPrompt({
              message: 'Mailbox password (two-password mode):',
              mask: '*',
            });
            session = await auth.submitMailboxPassword(mailboxPassword);
          } else {
            throw error;
          }
        }

        if (!session) {
          throw new InvalidCredentialsError('Authentication failed');
        }

        // Store credentials
        const credentials = auth.getReusableCredentials();
        await storeCredentials({
          ...credentials,
          username,
        });

        // Store username in config (non-sensitive metadata)
        // This allows status commands to show username without accessing keyring
        updateConfig({ username });

        console.log(`\n✓ Successfully logged in as ${username}`);
        console.log('Credentials stored securely.');
        logger.info(`User ${username} authenticated successfully`);
      } catch (error) {
        const appError = toAppError(error);
        console.error(`\n✗ Login failed: ${appError.getPublicMessage()}`);
        logger.error(`Login failed: [${appError.code}] ${appError.message}`);
        process.exit(1);
      }
    });

  // Logout subcommand
  authCmd
    .command('logout')
    .description('Logout and remove stored credentials')
    .action(async () => {
      try {
        if (!(await hasStoredCredentials())) {
          console.log('You are not logged in.');
          return;
        }

        const confirmed = await confirm({
          message: 'Are you sure you want to logout?',
          default: false,
        });

        if (!confirmed) {
          console.log('Logout cancelled.');
          return;
        }

        await deleteStoredCredentials();
        
        // Clear username from config
        updateConfig({ username: undefined });
        
        console.log('✓ Logged out successfully. Credentials removed.');
        logger.info('User logged out');
      } catch (error) {
        const appError = toAppError(error);
        console.error(`✗ Logout failed: ${appError.getPublicMessage()}`);
        logger.error(`Logout failed: [${appError.code}] ${appError.message}`);
        process.exit(1);
      }
    });

  // Status subcommand
  authCmd
    .command('status')
    .description('Check authentication status')
    .action(async () => {
      try {
        if (await hasStoredCredentials()) {
          // Try to restore session to verify it's still valid
          const { restoreSessionFromStorage } = await import('../auth.js');
          try {
            const { username } = await restoreSessionFromStorage();
            console.log(`✓ Logged in as: ${username}`);
          } catch (error) {
            const appError = toAppError(error);
            console.log('⚠ Credentials stored but session may be expired. Try logging in again.');
            console.log(appError.getPublicMessage());
          }
        } else {
          console.log(
            '✗ Not logged in. Use "proton-drive-webdav-bridge auth login" to authenticate.'
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error checking status: ${message}`);
        process.exit(1);
      }
    });
}

export default registerAuthCommand;
