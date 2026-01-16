#!/usr/bin/env node

/**
 * Proton Drive WebDAV Bridge - CLI Entry Point
 *
 * Command-line interface for the Proton Drive WebDAV bridge.
 */

import { program } from 'commander';
import { registerAuthCommand } from './cli/auth.js';
import { registerStartCommand } from './cli/start.js';
import { registerStopCommand } from './cli/stop.js';
import { registerStatusCommand } from './cli/status.js';
import { registerConfigCommand } from './cli/config.js';
import { loadConfig } from './config.js';
import { setDebugMode } from './logger.js';

// Load configuration
loadConfig();

// Program setup
program
  .name('proton-drive-webdav-bridge')
  .description('WebDAV bridge for Proton Drive - access your files via WebDAV protocol')
  .version('0.1.0')
  .option('--debug', 'Enable debug logging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.debug) {
      setDebugMode(true);
    }
  });

// Register commands
registerAuthCommand(program);
registerStartCommand(program);
registerStopCommand(program);
registerStatusCommand(program);
registerConfigCommand(program);

// Parse and run
program.parse();
