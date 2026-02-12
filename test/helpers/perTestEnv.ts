import { vol, fs } from 'memfs';
import logger from '../../src/logger';
import envPaths from 'env-paths';
import { vi } from 'vitest';

export async function mockFileSystem(): Promise<void> {
  vol.reset();

  try {
    // Redirect common import specifiers to the in-memory fs. Some code imports
    // 'fs' / 'fs/promises' while others import 'node:fs' / 'node:fs/promises'.
    vi.doMock('fs');
    vi.doMock('node:fs');
    // memfs exposes a .promises API compatible with fs/promises
    vi.doMock('fs/promises');
    vi.doMock('node:fs/promises');
  } catch {
    // If mocking fails, continue without installing the in-memory fs mock.
    logger.error('Failed to set up in-memory fs mock');
  }

  // Ensure the per-test directories exist inside the in-memory fs so that
  // modules that call mkdirSync/read/write succeed.
  try {
    const paths = envPaths('proton-drive-webdav-bridge');
    fs.mkdirSync(paths.config, { recursive: true });
    fs.mkdirSync(paths.data, { recursive: true });
    fs.mkdirSync(paths.log, { recursive: true });
  } catch {
    logger.error('Failed to create in-memory test directories');
  }
}
