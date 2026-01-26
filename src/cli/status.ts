/**
 * Proton Drive WebDAV Bridge - Status CLI Command
 *
 * Shows the status of the WebDAV server and authentication.
 */

import { Command } from 'commander';
import { getStoredCredentials } from '../keychain.js';
import { getLogFilePath, getCredentialsFilePath } from '../paths.js';
import { getConfig } from '../config.js';
import { logger } from '../logger.js';
import { readPidFile, isProcessRunning } from './daemon-utils.js';
import { existsSync } from 'fs';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show status of the WebDAV server')
    .option('-j, --json', 'Output status as JSON')
    .action(async (options) => {
      try {
        const config = getConfig();
        const status = {
          server: {
            running: false,
            pid: null as number | null,
            url: null as string | null,
          },
          auth: {
            loggedIn: false,
            username: null as string | null,
          },
          config: {
            webdav: {
              host: config.webdav.host,
              port: config.webdav.port,
              https: config.webdav.https,
              requireAuth: config.webdav.requireAuth,
            },
            remotePath: config.remotePath,
          },
          logFile: getLogFilePath(),
        };

        // Check server status
        const pid = readPidFile();
        if (pid && isProcessRunning(pid)) {
          status.server.running = true;
          status.server.pid = pid;

          const config = status.config;
          const protocol = config.webdav.https ? 'https' : 'http';
          status.server.url = `${protocol}://${config.webdav.host}:${config.webdav.port}`;
        }

        // Check auth status (without reading credentials - just check file exists)
        // This avoids keyring/DBus calls on every status check
        const credsFileExists = existsSync(getCredentialsFilePath());
        if (credsFileExists) {
          status.auth.loggedIn = true;
          // Only read credentials if not running as JSON (for display purposes)
          if (!options.json) {
            try {
              const creds = await getStoredCredentials();
              status.auth.username = creds?.username || null;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger.warn(`Failed to retrieve stored credentials: ${message}`);
            }
          } else {
            // For JSON output, we can skip username if it causes keyring calls
            status.auth.username = null;
          }
        }

        // Output
        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          console.log('Proton Drive WebDAV Bridge Status');
          console.log('==========================\n');

          // Server status
          console.log('WebDAV Server:');
          if (status.server.running) {
            console.log(`  Status: ✓ Running (PID: ${status.server.pid})`);
            console.log(`  URL: ${status.server.url}`);
          } else {
            console.log('  Status: ✗ Not running');
          }
          console.log();

          // Auth status
          console.log('Authentication:');
          if (status.auth.loggedIn) {
            console.log(`  Status: ✓ Logged in`);
            if (status.auth.username) {
              console.log(`  Username: ${status.auth.username}`);
            }
          } else {
            console.log('  Status: ✗ Not logged in');
          }
          console.log();

          // Config
          console.log('Configuration:');
          console.log(`  Host: ${status.config.webdav.host}`);
          console.log(`  Port: ${status.config.webdav.port}`);
          console.log(`  HTTPS: ${status.config.webdav.https ? 'Enabled' : 'Disabled'}`);
          console.log(`  Auth Required: ${status.config.webdav.requireAuth ? 'Yes' : 'No'}`);
          console.log(`  Remote Path: ${status.config.remotePath}`);
          console.log();

          console.log(`Log file: ${status.logFile}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error getting status: ${message}`);
        process.exit(1);
      }
    });
}

export default registerStatusCommand;
