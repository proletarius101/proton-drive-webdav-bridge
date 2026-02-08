import { mkdtemp } from 'fs/promises';
import { rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// Import `mock` lazily inside the setup function to avoid evaluating test
// globals at module import time which can cause ReferenceError when the
// test runner hasn't set up the test globals yet.

export type PerTestEnv = {
  baseDir: string;
  cleanup: () => Promise<void>;
};

export async function setupPerTestEnv(): Promise<PerTestEnv> {
  const baseDir = await mkdtemp(join(tmpdir(), 'pdb-test-'));

  // Register a file-scoped module mock for env-paths so modules that read
  // paths at import time will use our test directory. Import `vi` lazily
  // so we don't reference test-runner globals during module evaluation.
  try {
    const { vi } = await import('vitest');
    vi.doMock('env-paths', () => ({
      default: () => ({
        config: join(baseDir, 'config'),
        data: join(baseDir, 'data'),
        log: join(baseDir, 'log'),
        temp: join(baseDir, 'temp'),
        cache: join(baseDir, 'cache'),
      }),
    }));
  } catch {
    // If dynamic import fails for some reason, continue without registering
    // the mock — individual tests may register their own env-paths mock.
  }

  return {
    baseDir,
    async cleanup() {
      try {
        rmSync(baseDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      try {
        const { vi } = await import('vitest');
        vi.restoreAllMocks();
      } catch {
        /* ignore */
      }
      try {
        const { vi } = await import('vitest');
        vi.clearAllMocks();
      } catch {
        /* ignore */
      }
    },
  };
}

// Helper to provide a reusable env-paths mock factory for tests. Use like:
// vi.mock('env-paths', envPathsMock(pathsBase));
export function envPathsMock(baseDir: string) {
  return () => ({
    default: () => ({
      config: join(baseDir, 'config'),
      data: join(baseDir, 'data'),
      log: join(baseDir, 'log'),
      temp: join(baseDir, 'temp'),
      cache: join(baseDir, 'cache'),
    }),
  });
}

// Dynamic mock factory: accepts a getter for the base path and an optional
// subdirectory to append (e.g. 'proton-drive-webdav-bridge'). The returned
// factory will create the directories on access to mimic original tests that
// relied on env-paths creating dirs when modules read them.
export function envPathsMockDynamic(getBase: () => string, subdir?: string) {
  return () => ({
    default: () => {
      const base = subdir ? join(getBase(), subdir) : getBase();
      const paths = {
        config: join(base, 'config'),
        data: join(base, 'data'),
        log: join(base, 'log'),
        temp: join(base, 'temp'),
        cache: join(base, 'cache'),
      };

      // Ensure directories exist when the mock is used
      try {
        Object.values(paths).forEach((p) => mkdirSync(p, { recursive: true }));
      } catch {
        /* ignore */
      }

      return paths;
    },
  });
}

// Helper to create a mock from an explicit map of paths. Useful for tests
// that create each env-path separately (config/data/log/temp/cache).
export function envPathsMockFromMap(paths: {
  config: string;
  data: string;
  log: string;
  temp: string;
  cache: string;
}) {
  return () => ({
    default: () => {
      // Ensure directories exist when the mock is used
      try {
        mkdirSync(paths.config, { recursive: true });
      } catch {}
      try {
        mkdirSync(paths.data, { recursive: true });
      } catch {}
      try {
        mkdirSync(paths.log, { recursive: true });
      } catch {}
      try {
        mkdirSync(paths.temp, { recursive: true });
      } catch {}
      try {
        mkdirSync(paths.cache, { recursive: true });
      } catch {}

      return paths;
    },
  });
}
