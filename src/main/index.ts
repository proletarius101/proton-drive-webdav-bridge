/**
 * Proton Drive WebDAV Bridge - Electron Main Process
 *
 * Main entry point for Electron application. Manages window lifecycle,
 * IPC handlers, and backend services.
 */

import { app, BrowserWindow } from 'electron';
import path from 'path';
import { logger, setDebugMode } from '../logger.js';
import { loadConfig } from '../config.js';
import { registerIPCHandlers } from './ipc-handlers.js';

// Electron Forge Vite Plugin provides these globals
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// Keep a global reference to prevent garbage collection
let mainWindow: BrowserWindow | null = null;

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration();

/**
 * Create the main application window
 */
function createWindow(): void {
  const config = loadConfig();

  if (config.debug) {
    setDebugMode(true);
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Proton Drive WebDAV Bridge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load the renderer - Vite plugin handles dev server vs production
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    // Open DevTools in development
    if (config.debug) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  logger.info('Main window created');
}

/**
 * App lifecycle handlers
 */
app.on('ready', async () => {
  logger.info('Electron app ready');

  // Register all IPC handlers
  registerIPCHandlers();

  createWindow();
});

app.on('window-all-closed', () => {
  // On macOS, keep the app active until the user quits explicitly
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle app shutdown
app.on('before-quit', async () => {
  logger.info('App shutting down');
  // Cleanup will be handled by individual services
});

// Global error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});

export { mainWindow };
