import { mkdtemp } from 'fs/promises';
import { rmSync } from 'fs';
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
  // paths at import time will use our test directory. Import `mock` lazily
  // so we don't reference test-runner globals during module evaluation.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { mock } = await import('bun:test');
    mock.module('env-paths', () => ({
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
        mock.restore();
      } catch {
        /* ignore */
      }
      try {
        mock.clearAllMocks();
      } catch {
        /* ignore */
      }
    },
  };
}
