import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

describe('config', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-config-'));
    process.env.XDG_CONFIG_HOME = baseDir;
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('creates default config when missing', async () => {
    const { loadConfig, getConfigFilePath } = await import(
      `../src/config.ts?cache=${Date.now()}`
    );

    const config = loadConfig();
    const configPath = getConfigFilePath();

    expect(config.webdav.host).toBe('127.0.0.1');
    expect(config.webdav.port).toBe(8080);
    expect(config.webdav.requireAuth).toBe(true);
    expect(config.cache.enabled).toBe(true);
    expect(existsSync(configPath)).toBe(true);

    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as typeof config;
    expect(raw.webdav.host).toBe(config.webdav.host);
  });

  it('updates and persists config', async () => {
    const { loadConfig, updateConfig, getConfigFilePath, getConfig } = await import(
      `../src/config.ts?cache=${Date.now()}`
    );

    loadConfig();
    const updated = updateConfig({ webdav: { port: 9090, requireAuth: false } });

    expect(updated.webdav.port).toBe(9090);
    expect(updated.webdav.requireAuth).toBe(false);
    expect(getConfig().webdav.port).toBe(9090);

    const raw = JSON.parse(readFileSync(getConfigFilePath(), 'utf-8')) as typeof updated;
    expect(raw.webdav.port).toBe(9090);
    expect(raw.webdav.requireAuth).toBe(false);
  });
});
