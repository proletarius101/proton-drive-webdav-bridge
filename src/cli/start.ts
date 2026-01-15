/**
 * Proton Drive Bridge - Start CLI Command
 *
 * Starts the WebDAV server.
 */

import { Command } from 'commander';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { logger, setDebugMode } from '../logger.js';
import { loadConfig } from '../config.js';
import { hasStoredCredentials } from '../keychain.js';
import { getPidFilePath } from '../paths.js';
import { WebDAVServer } from '../webdav/index.js';

// ============================================================================
// Daemon Management
// ============================================================================

function writePidFile(pid: number): void {
  const pidFile = getPidFilePath();
  writeFileSync(pidFile, pid.toString(), { mode: 0o644 });
}

function removePidFile(): void {
  const pidFile = getPidFilePath();
  if (existsSync(pidFile)) {
    unlinkSync(pidFile);
  }
}

function readPidFile(): number | null {
  const pidFile = getPidFilePath();
  if (!existsSync(pidFile)) {
    return null;
  }
  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the WebDAV server')
    .option('-p, --port <port>', 'Port to listen on', (val) => parseInt(val, 10))
    .option('-H, --host <host>', 'Host to bind to')
    .option('--no-auth', 'Disable authentication (not recommended)')
    .option('-d, --daemon', 'Run as background daemon')
    .option('--no-daemon', 'Run in foreground')
    .action(async (options) => {
      try {
        // Check if already logged in
        if (!(await hasStoredCredentials())) {
          console.error('✗ Not logged in. Run "proton-drive-bridge auth login" first.');
          process.exit(1);
        }

        // Check if already running
        const existingPid = readPidFile();
        if (existingPid && isProcessRunning(existingPid)) {
          console.error(`✗ Server already running (PID: ${existingPid})`);
          console.error('Use "proton-drive-bridge stop" to stop it first.');
          process.exit(1);
        }

        // Clean up stale PID file
        if (existingPid) {
          removePidFile();
        }

        // Run as daemon if requested
        if (options.daemon) {
          await spawnDaemon(options);
          return;
        }

        // Load config
        const config = loadConfig();
        
        if (config.debug) {
          setDebugMode(true);
        }

        // Create server with options
        const serverOptions: Record<string, unknown> = {};
        if (options.port) serverOptions.port = options.port;
        if (options.host) serverOptions.host = options.host;
        if (options.auth === false) serverOptions.requireAuth = false;

        const server = new WebDAVServer(serverOptions);

        // Setup signal handlers
        const shutdown = async () => {
          console.log('\nShutting down...');
          await server.stop();
          removePidFile();
          process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        // Write PID file
        writePidFile(process.pid);

        // Start server
        console.log('Starting WebDAV server...');
        await server.start();

        console.log(`\n✓ WebDAV server running at ${server.getUrl()}`);
        console.log('\nYou can now mount this WebDAV share:');
        console.log(`  macOS: Finder → Go → Connect to Server → ${server.getUrl()}`);
        console.log(`  Linux: davfs2, GNOME Files, or other WebDAV clients`);
        console.log(`  Windows: Map network drive using WebDAV path`);
        console.log('\nPress Ctrl+C to stop the server.');

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`✗ Failed to start server: ${message}`);
        logger.error(`Server start failed: ${message}`);
        removePidFile();
        process.exit(1);
      }
    });
}

/**
 * Spawn server as background daemon
 */
async function spawnDaemon(options: Record<string, unknown>): Promise<void> {
  const args = ['start', '--no-daemon'];

  if (options.port) args.push('--port', String(options.port));
  if (options.host) args.push('--host', String(options.host));
  if (options.auth === false) args.push('--no-auth');

  // Get the path to this script
  const scriptPath = process.argv[1];
  const runtime = process.argv[0]; // bun or node

  const child = Bun.spawn([runtime, scriptPath, ...args], {
    detached: true,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env },
  });

  child.unref();

  console.log(`Starting daemon (PID: ${child.pid})...`);

  // Wait a bit to check if it started successfully
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const pidFromFile = readPidFile();
  if (pidFromFile && isProcessRunning(pidFromFile)) {
    console.log(`✓ Server started in background (PID: ${pidFromFile})`);
    console.log('Use "proton-drive-bridge status" to check server status.');
    console.log('Use "proton-drive-bridge stop" to stop the server.');
  } else {
    console.error('✗ Failed to start daemon. Check logs for details.');
    process.exit(1);
  }
}

export default registerStartCommand;
