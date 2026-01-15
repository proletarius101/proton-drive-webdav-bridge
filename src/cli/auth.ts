/**
 * Proton Drive Bridge - Auth CLI Command
 *
 * Handles authentication with Proton account.
 */

import { Command } from 'commander';
import { input, password as passwordPrompt, confirm } from '@inquirer/prompts';
import { ProtonAuth, type ApiError } from '../auth.js';
import { storeCredentials, deleteStoredCredentials, hasStoredCredentials } from '../keychain.js';
import { logger } from '../logger.js';

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

        // Get password
        const password = await passwordPrompt({
          message: 'Password:',
          mask: '*',
        });

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
          throw new Error('Authentication failed');
        }

        // Store credentials
        const credentials = auth.getReusableCredentials();
        await storeCredentials({
          ...credentials,
          username,
        });

        console.log(`\n✓ Successfully logged in as ${username}`);
        console.log('Credentials stored securely.');
        logger.info(`User ${username} authenticated successfully`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n✗ Login failed: ${message}`);
        logger.error(`Login failed: ${message}`);
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
        console.log('✓ Logged out successfully. Credentials removed.');
        logger.info('User logged out');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`✗ Logout failed: ${message}`);
        logger.error(`Logout failed: ${message}`);
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
            console.log('⚠ Credentials stored but session may be expired. Try logging in again.');
            console.log(error);
          }
        } else {
          console.log('✗ Not logged in. Use "proton-drive-bridge auth login" to authenticate.');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error checking status: ${message}`);
        process.exit(1);
      }
    });
}

export default registerAuthCommand;
