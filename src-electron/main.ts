/**
 * Electron Main Process Entry Point
 * 
 * This is the main process for the Electron application.
 * It manages window lifecycle, IPC handlers, and backend services.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

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
      sandbox: false, // Required for some native modules
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
  // @ts-ignore - Electron Forge Vite globals
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    // Development mode - load from Vite dev server
    // @ts-ignore
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    // Production mode - load from built files
    // @ts-ignore
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

/**
 * App lifecycle handlers
 */
app.whenReady().then(() => {
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
ipcMain.handle('auth:login', async (event, credentials) => {
  try {
    // TODO: Connect to actual auth service
    // const result = await authManager.login(credentials);
    // return result;
    console.log('IPC: auth:login called', { email: credentials.email });
    return {
      success: false,
      error: 'Auth service not yet implemented',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: message,
    };
  }
});

ipcMain.handle('auth:submit2FA', async (event, twoFactor) => {
  try {
    // TODO: Connect to actual auth service
    console.log('IPC: auth:submit2FA called');
    return {
      success: false,
      error: 'Auth service not yet implemented',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: message,
    };
  }
});

ipcMain.handle('auth:submitMailboxPassword', async (event, mailbox) => {
  try {
    // TODO: Connect to actual auth service
    console.log('IPC: auth:submitMailboxPassword called');
    return {
      success: false,
      error: 'Auth service not yet implemented',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: message,
    };
  }
});

ipcMain.handle('auth:logout', async () => {
  try {
    // TODO: Connect to actual auth service
    console.log('IPC: auth:logout called');
    return {
      success: true,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: message,
    };
  }
});

ipcMain.handle('auth:check', async () => {
  try {
    // TODO: Connect to actual auth service
    console.log('IPC: auth:check called');
    return {
      isAuthenticated: false,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      isAuthenticated: false,
      error: message,
    };
  }
});

/**
 * WebDAV Service IPC handlers
 */
ipcMain.handle('webdav:start', async (event, options) => {
  try {
    // TODO: Connect to actual WebDAV service
    console.log('IPC: webdav:start called', options);
    return {
      running: true,
      url: 'http://localhost:8008',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      running: false,
      error: message,
    };
  }
});

ipcMain.handle('webdav:stop', async () => {
  try {
    // TODO: Connect to actual WebDAV service
    console.log('IPC: webdav:stop called');
    return {
      running: false,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      running: true,
      error: message,
    };
  }
});

ipcMain.handle('webdav:status', async () => {
  try {
    // TODO: Connect to actual WebDAV service
    console.log('IPC: webdav:status called');
    return {
      running: false,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      running: false,
      error: message,
    };
  }
});

/**
 * Configuration IPC handlers
 */
ipcMain.handle('config:get', async () => {
  try {
    // TODO: Connect to actual config service
    console.log('IPC: config:get called');
    return {
      port: 8008,
      host: 'localhost',
      requireAuth: true,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      error: message,
    };
  }
});

ipcMain.handle('config:update', async (event, updates) => {
  try {
    // TODO: Connect to actual config service
    console.log('IPC: config:update called', updates);
    return {
      success: true,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: message,
    };
  }
});
