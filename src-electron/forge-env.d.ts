/**
 * Type declarations for Electron Forge Vite plugin globals
 * These are injected by @electron-forge/plugin-vite during build
 */

// Renderer window globals - provided by Electron Forge Vite plugin
// The naming pattern is: ${NAME}_VITE_DEV_SERVER_URL and ${NAME}_VITE_NAME
// where NAME is from the renderer config (e.g., 'main_window' becomes 'MAIN_WINDOW')
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// Preload script paths are resolved automatically by Electron Forge
// The preload files are available at: path.join(__dirname, '../preload/PRELOAD_FILENAME')
