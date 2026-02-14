/**
 * Electron Main Process Entry Point
 *
 * This is the main process for the Electron application.
 * It manages window lifecycle, IPC handlers, and backend services.
 */

import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateIPCRequest } from '../src/ipc/validation.js';
import { withTimeout, handleIPCError, logIPCHandler } from '../src/ipc/handler-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

/**
 * Set up Content Security Policy headers to prevent XSS attacks
 * This runs once when the app is ready and applies to all sessions
 */
function setupContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
        ],
      },
    });
  });
}

/**
 * Create the main application window
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // Both main and preload are built to .vite/build/
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 },
  });

  // Show window when ready
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Clean up on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Load the renderer
  // Electron Forge Vite provides these globals
  // @ts-expect-error - Electron Forge Vite globals
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    // Development mode - load from Vite dev server
    // @ts-expect-error - Electron Forge Vite globals
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    // Production mode - load from built files
    // @ts-expect-error - Electron Forge Vite globals
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

/**
 * App lifecycle handlers
 */
app.whenReady().then(() => {
  setupContentSecurityPolicy();
  createWindow();

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * Basic IPC handlers for testing
 */
ipcMain.handle('ping', () => 'pong');

/**
 * Window control handlers
 */
ipcMain.on('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow?.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window:close', () => {
  mainWindow?.close();
});

/**
 * Authentication IPC handlers
 *
 * These handlers bridge the Electron renderer process to the backend auth service.
 * In production, these should connect to the actual auth module.
 */
ipcMain.handle('auth:login', async (_event, credentials) => {
  logIPCHandler('auth:login', 'start');
  try {
    // Validate request
    const validation = validateIPCRequest('auth:login', credentials);
    if (!validation.success) {
      throw new Error(validation.error);
    }

    // Wrap in timeout (30s default)
    const result = await withTimeout(
      (async () => {
        // TODO: Connect to actual auth service
        // const result = await authManager.login(credentials);
        // return result;
        const cred = validation.data as Record<string, unknown>;
        console.log('IPC: auth:login called', { email: cred.email });
        return {
          success: false,
          error: 'Auth service not yet implemented',
        };
      })()
    );
    logIPCHandler('auth:login', 'complete');
    return result;
  } catch (error: unknown) {
    logIPCHandler('auth:login', 'error');
    return handleIPCError(error);
  }
});

ipcMain.handle('auth:submit2FA', async (_event, twoFactor) => {
  logIPCHandler('auth:submit2FA', 'start');
  try {
    // Validate request
    const validation = validateIPCRequest('auth:submit2FA', twoFactor);
    if (!validation.success) {
      throw new Error(validation.error);
    }

    // Wrap in timeout (30s default)
    const result = await withTimeout(
      (async () => {
        // TODO: Connect to actual auth service
        console.log('IPC: auth:submit2FA called');
        return {
          success: false,
          error: 'Auth service not yet implemented',
        };
      })()
    );
    logIPCHandler('auth:submit2FA', 'complete');
    return result;
  } catch (error: unknown) {
    logIPCHandler('auth:submit2FA', 'error');
    return handleIPCError(error);
  }
});

ipcMain.handle('auth:submitMailboxPassword', async (_event, mailbox) => {
  logIPCHandler('auth:submitMailboxPassword', 'start');
  try {
    // Validate request
    const validation = validateIPCRequest('auth:submitMailboxPassword', mailbox);
    if (!validation.success) {
      throw new Error(validation.error);
    }

    // Wrap in timeout (30s default)
    const result = await withTimeout(
      (async () => {
        // TODO: Connect to actual auth service
        console.log('IPC: auth:submitMailboxPassword called');
        return {
          success: false,
          error: 'Auth service not yet implemented',
        };
      })()
    );
    logIPCHandler('auth:submitMailboxPassword', 'complete');
    return result;
  } catch (error: unknown) {
    logIPCHandler('auth:submitMailboxPassword', 'error');
    return handleIPCError(error);
  }
});

ipcMain.handle('auth:logout', async () => {
  logIPCHandler('auth:logout', 'start');
  try {
    // Wrap in timeout (30s default)
    const result = await withTimeout(
      (async () => {
        // TODO: Connect to actual auth service
        console.log('IPC: auth:logout called');
        return {
          success: true,
        };
      })()
    );
    logIPCHandler('auth:logout', 'complete');
    return result;
  } catch (error: unknown) {
    logIPCHandler('auth:logout', 'error');
    return handleIPCError(error);
  }
});

ipcMain.handle('auth:check', async () => {
  logIPCHandler('auth:check', 'start');
  try {
    // Wrap in timeout (30s default)
    const result = await withTimeout(
      (async () => {
        // TODO: Connect to actual auth service
        console.log('IPC: auth:check called');
        return {
          isAuthenticated: false,
        };
      })()
    );
    logIPCHandler('auth:check', 'complete');
    return result;
  } catch (error: unknown) {
    logIPCHandler('auth:check', 'error');
    return handleIPCError(error);
  }
});

/**
 * WebDAV Service IPC handlers
 */
ipcMain.handle('webdav:start', async (_event, options) => {
  logIPCHandler('webdav:start', 'start');
  try {
    // Validate request
    const validation = validateIPCRequest('webdav:start', options);
    if (!validation.success) {
      throw new Error(validation.error);
    }

    // Wrap in timeout (30s default)
    const result = await withTimeout(
      (async () => {
        // TODO: Connect to actual WebDAV service
        console.log('IPC: webdav:start called', validation.data);
        return {
          running: true,
          url: 'http://localhost:8008',
        };
      })()
    );
    logIPCHandler('webdav:start', 'complete');
    return result;
  } catch (error: unknown) {
    logIPCHandler('webdav:start', 'error');
    return handleIPCError(error);
  }
});

ipcMain.handle('webdav:stop', async () => {
  logIPCHandler('webdav:stop', 'start');
  try {
    // Wrap in timeout (30s default)
    const result = await withTimeout(
      (async () => {
        // TODO: Connect to actual WebDAV service
        console.log('IPC: webdav:stop called');
        return {
          running: false,
        };
      })()
    );
    logIPCHandler('webdav:stop', 'complete');
    return result;
  } catch (error: unknown) {
    logIPCHandler('webdav:stop', 'error');
    return handleIPCError(error);
  }
});

ipcMain.handle('webdav:status', async () => {
  logIPCHandler('webdav:status', 'start');
  try {
    // Wrap in timeout (30s default)
    const result = await withTimeout(
      (async () => {
        // TODO: Connect to actual WebDAV service
        console.log('IPC: webdav:status called');
        return {
          running: false,
        };
      })()
    );
    logIPCHandler('webdav:status', 'complete');
    return result;
  } catch (error: unknown) {
    logIPCHandler('webdav:status', 'error');
    return handleIPCError(error);
  }
});

/**
 * Configuration IPC handlers
 */
ipcMain.handle('config:get', async () => {
  logIPCHandler('config:get', 'start');
  try {
    // Wrap in timeout (30s default)
    const result = await withTimeout(
      (async () => {
        // TODO: Connect to actual config service
        console.log('IPC: config:get called');
        return {
          port: 8008,
          host: 'localhost',
          requireAuth: true,
        };
      })()
    );
    logIPCHandler('config:get', 'complete');
    return result;
  } catch (error: unknown) {
    logIPCHandler('config:get', 'error');
    return handleIPCError(error);
  }
});

ipcMain.handle('config:update', async (_event, updates) => {
  logIPCHandler('config:update', 'start');
  try {
    // Validate request
    const validation = validateIPCRequest('config:update', updates);
    if (!validation.success) {
      throw new Error(validation.error);
    }

    // Wrap in timeout (30s default)
    const result = await withTimeout(
      (async () => {
        // TODO: Connect to actual config service
        console.log('IPC: config:update called', validation.data);
        return {
          success: true,
        };
      })()
    );
    logIPCHandler('config:update', 'complete');
    return result;
  } catch (error: unknown) {
    logIPCHandler('config:update', 'error');
    return handleIPCError(error);
  }
});
