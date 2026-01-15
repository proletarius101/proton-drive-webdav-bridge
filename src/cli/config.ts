/**
 * Proton Drive Bridge - Config CLI Command
 *
 * Manage configuration settings.
 */

import { Command } from 'commander';
import { input, confirm, password as passwordPrompt } from '@inquirer/prompts';
import { createHash } from 'crypto';
import { updateConfig, loadConfig, getConfigFilePath, validateWebDAVConfig } from '../config.js';
import { logger } from '../logger.js';

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage configuration settings');

  // Show current config
  configCmd
    .command('show')
    .description('Show current configuration')
    .option('-j, --json', 'Output as JSON')
    .action((options) => {
      const config = loadConfig();

      if (options.json) {
        // Hide sensitive fields
        const safeConfig = {
          ...config,
          webdav: {
            ...config.webdav,
            passwordHash: config.webdav.passwordHash ? '****' : undefined,
          },
        };
        console.log(JSON.stringify(safeConfig, null, 2));
      } else {
        console.log('Current Configuration');
        console.log('=====================\n');
        console.log('WebDAV Server:');
        console.log(`  Host: ${config.webdav.host}`);
        console.log(`  Port: ${config.webdav.port}`);
        console.log(`  HTTPS: ${config.webdav.https}`);
        console.log(`  Auth Required: ${config.webdav.requireAuth}`);
        console.log(`  Username: ${config.webdav.username || '(not set)'}`);
        console.log(`  Password: ${config.webdav.passwordHash ? '****' : '(not set)'}`);
        if (config.webdav.https) {
          console.log(`  Cert Path: ${config.webdav.certPath || '(not set)'}`);
          console.log(`  Key Path: ${config.webdav.keyPath || '(not set)'}`);
        }
        console.log();
        console.log('Drive Settings:');
        console.log(`  Remote Path: ${config.remotePath}`);
        console.log();
        console.log('Cache:');
        console.log(`  Enabled: ${config.cache.enabled}`);
        console.log(`  TTL: ${config.cache.ttlSeconds}s`);
        console.log(`  Max Size: ${config.cache.maxSizeMB}MB`);
        console.log();
        console.log('Other:');
        console.log(`  Debug: ${config.debug}`);
        console.log(`  Auto Start: ${config.autoStart}`);
        console.log();
        console.log(`Config file: ${getConfigFilePath()}`);
      }
    });

  // Set a config value
  configCmd
    .command('set')
    .description('Set a configuration value')
    .argument('<key>', 'Configuration key (e.g., webdav.port)')
    .argument('<value>', 'Value to set')
    .action((key, value) => {
      try {
        const config = loadConfig();
        const parts = key.split('.');

        // Parse value
        let parsedValue: unknown = value;
        if (value === 'true') parsedValue = true;
        else if (value === 'false') parsedValue = false;
        else if (/^\d+$/.test(value)) parsedValue = parseInt(value, 10);

        // Set nested value
        if (parts.length === 1) {
          (config as unknown as Record<string, unknown>)[parts[0]] = parsedValue;
        } else if (parts.length === 2) {
          const section = (config as unknown as Record<string, Record<string, unknown>>)[parts[0]];
          if (section && typeof section === 'object') {
            section[parts[1]] = parsedValue;
          } else {
            console.error(`Invalid config section: ${parts[0]}`);
            process.exit(1);
          }
        } else {
          console.error('Only one level of nesting is supported (e.g., webdav.port)');
          process.exit(1);
        }

        updateConfig(config);
        console.log(`✓ Set ${key} = ${value}`);
        logger.info(`Config updated: ${key} = ${value}`);

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`✗ Failed to set config: ${message}`);
        process.exit(1);
      }
    });

  // Interactive setup wizard
  configCmd
    .command('setup')
    .description('Interactive configuration setup')
    .action(async () => {
      try {
        console.log('Proton Drive Bridge Configuration\n');

        const config = loadConfig();

        // WebDAV settings
        console.log('WebDAV Server Settings:');

        config.webdav.port = parseInt(await input({
          message: 'Port:',
          default: String(config.webdav.port),
          validate: (val) => {
            const port = parseInt(val, 10);
            return (port >= 1 && port <= 65535) || 'Port must be between 1 and 65535';
          },
        }), 10);

        config.webdav.host = await input({
          message: 'Host to bind to:',
          default: config.webdav.host,
        });

        // Security warning for non-localhost
        if (config.webdav.host !== '127.0.0.1' && config.webdav.host !== 'localhost') {
          console.log('\n⚠ Warning: Binding to a non-localhost address exposes the server to the network.');
          console.log('  Make sure to enable HTTPS and authentication for security.\n');
        }

        config.webdav.requireAuth = await confirm({
          message: 'Require authentication?',
          default: config.webdav.requireAuth,
        });

        if (config.webdav.requireAuth) {
          config.webdav.username = await input({
            message: 'WebDAV username:',
            default: config.webdav.username || 'proton',
            validate: (val) => val.length > 0 || 'Username is required',
          });

          const password = await passwordPrompt({
            message: 'WebDAV password:',
            mask: '*',
          });

          // Hash password
          config.webdav.passwordHash = createHash('sha256').update(password).digest('hex');
        }

        config.webdav.https = await confirm({
          message: 'Enable HTTPS?',
          default: config.webdav.https,
        });

        if (config.webdav.https) {
          config.webdav.certPath = await input({
            message: 'Path to SSL certificate:',
            default: config.webdav.certPath || '',
          });

          config.webdav.keyPath = await input({
            message: 'Path to SSL private key:',
            default: config.webdav.keyPath || '',
          });
        }

        // Drive settings
        console.log('\nDrive Settings:');

        config.remotePath = await input({
          message: 'Remote path to expose (/ for root):',
          default: config.remotePath,
        });

        // Other settings
        config.debug = await confirm({
          message: 'Enable debug logging?',
          default: config.debug,
        });

        config.autoStart = await confirm({
          message: 'Auto-start on system boot?',
          default: config.autoStart,
        });

        // Validate and save
        const errors = validateWebDAVConfig(config.webdav);
        if (errors.length > 0) {
          console.log('\n⚠ Configuration warnings:');
          for (const err of errors) {
            console.log(`  - ${err}`);
          }
          
          const proceed = await confirm({
            message: 'Save configuration anyway?',
            default: false,
          });
          
          if (!proceed) {
            console.log('Configuration cancelled.');
            return;
          }
        }

        updateConfig(config);
        console.log('\n✓ Configuration saved successfully.');
        console.log(`Config file: ${getConfigFilePath()}`);

        logger.info('Configuration updated via setup wizard');

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n✗ Setup failed: ${message}`);
        process.exit(1);
      }
    });

  // Reset to defaults
  configCmd
    .command('reset')
    .description('Reset configuration to defaults')
    .action(async () => {
      const confirmed = await confirm({
        message: 'Reset all configuration to defaults?',
        default: false,
      });

      if (!confirmed) {
        console.log('Reset cancelled.');
        return;
      }

      try {
        const { existsSync, unlinkSync } = await import('fs');
        const configPath = getConfigFilePath();
        
        if (existsSync(configPath)) {
          unlinkSync(configPath);
        }
        
        loadConfig(); // This will create default config
        console.log('✓ Configuration reset to defaults.');
        logger.info('Configuration reset to defaults');

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`✗ Reset failed: ${message}`);
        process.exit(1);
      }
    });
}

export default registerConfigCommand;
