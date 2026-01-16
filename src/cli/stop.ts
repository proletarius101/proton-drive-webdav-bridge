/**
 * Proton Drive WebDAV Bridge - Stop CLI Command
 *
 * Stops the running WebDAV server daemon.
 */

import { Command } from 'commander';
import { logger } from '../logger.js';
import { readPidFile, removePidFile, isProcessRunning } from './daemon-utils.js';

export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop the WebDAV server')
    .option('-f, --force', 'Force kill the server')
    .action(async (options) => {
      try {
        const pid = readPidFile();

        if (!pid) {
          console.log('Server is not running (no PID file found).');
          return;
        }

        if (!isProcessRunning(pid)) {
          console.log('Server is not running (stale PID file). Cleaning up...');
          removePidFile();
          return;
        }

        console.log(`Stopping server (PID: ${pid})...`);

        // Send SIGTERM first
        const signal = options.force ? 'SIGKILL' : 'SIGTERM';
        process.kill(pid, signal);

        // Wait for process to exit
        const maxWait = options.force ? 1000 : 5000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          if (!isProcessRunning(pid)) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Check if still running
        if (isProcessRunning(pid)) {
          if (!options.force) {
            console.log('Server did not stop gracefully. Use --force to kill it.');
            process.exit(1);
          } else {
            console.error('Failed to kill server.');
            process.exit(1);
          }
        }

        removePidFile();
        console.log('✓ Server stopped successfully.');
        logger.info(`Server stopped (PID: ${pid})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`✗ Failed to stop server: ${message}`);
        logger.error(`Server stop failed: ${message}`);
        process.exit(1);
      }
    });
}

export default registerStopCommand;
