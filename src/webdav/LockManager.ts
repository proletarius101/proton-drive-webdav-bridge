/**
 * WebDAV Lock Manager using better-sqlite3
 *
 * Manages WebDAV locks with SQLite persistence for reliability across server restarts.
 * Handles lock creation, validation, expiration, and cleanup.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import type { User } from 'nephele';
import { dirname, join } from 'path';
import { logger } from '../logger.js';
import { getDataDir } from '../paths.js';

// ============================================================================
// Types
// ============================================================================

export interface LockInfo {
  token: string;
  path: string;
  username: string;
  createdAt: Date;
  expiresAt: Date;
  timeout: number;
  scope: 'exclusive' | 'shared';
  depth: '0' | 'infinity';
  provisional: boolean;
  owner: string;
}

interface LockRow {
  token: string;
  path: string;
  username: string;
  created_at: number;
  expires_at: number;
  timeout: number;
  scope: 'exclusive' | 'shared';
  depth: '0' | 'infinity';
  provisional: number;
  owner: string;
}

// ============================================================================
// Lock Manager
// ============================================================================

export class LockManager {
  private db: InstanceType<typeof Database>;
  private static instance: LockManager | null = null;

  private constructor() {
    // Allow overriding the locks DB path via environment variable so tests
    // (or CI) can isolate the DB per-run. If not provided, fall back to the
    // platform-specific data directory.
    const envPath = process.env.LOCKS_DB_PATH;
    const dbPath = envPath ? envPath : join(getDataDir(), 'locks.db');

    // Creates the parent directory if it doesn't exist
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
    } catch (error) {
      // Directory might already exist, which is fine
      logger.debug(`Directory creation for ${dbPath}: ${error}`);
    }

    this.db = new Database(dbPath);

    this.initializeDatabase();
    this.cleanupExpiredLocks();
    logger.info(`Lock database initialized at ${dbPath}`);
  }

  static getInstance(): LockManager {
    if (!LockManager.instance) {
      LockManager.instance = new LockManager();
    }
    return LockManager.instance;
  }

  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS locks (
        token TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        username TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        timeout INTEGER NOT NULL,
        scope TEXT NOT NULL,
        depth TEXT NOT NULL,
        provisional INTEGER NOT NULL,
        owner TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_locks_path ON locks(path)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_locks_expires_at ON locks(expires_at)
    `);
  }

  private cleanupExpiredLocks(): void {
    const now = Date.now();
    const result = this.db.prepare('DELETE FROM locks WHERE expires_at < ?').run(now);
    if (result.changes > 0) {
      logger.info(`Cleaned up ${result.changes} expired locks`);
    }
  }

  generateToken(): string {
    return `opaquelocktoken:${crypto.randomUUID()}`;
  }

  createLock(
    path: string,
    user: User,
    timeout: number,
    scope: 'exclusive' | 'shared',
    depth: '0' | 'infinity',
    provisional: boolean,
    owner: unknown
  ): LockInfo {
    // Check for conflicting locks
    const conflicts = this.getConflictingLocks(path, depth);
    if (conflicts.length > 0) {
      throw new Error('Resource is already locked');
    }

    const token = this.generateToken();
    const now = Date.now();
    const expiresAt = now + timeout * 1000;

    this.db
      .prepare(
        `INSERT INTO locks (token, path, username, created_at, expires_at, timeout, scope, depth, provisional, owner)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        token,
        path,
        user.username,
        now,
        expiresAt,
        timeout,
        scope,
        depth,
        provisional ? 1 : 0,
        JSON.stringify(owner)
      );

    return {
      token,
      path,
      username: user.username,
      createdAt: new Date(now),
      expiresAt: new Date(expiresAt),
      timeout,
      scope,
      depth,
      provisional,
      owner: JSON.stringify(owner),
    };
  }

  private normalizeToken(token: string | null | undefined): string | null {
    if (!token) return null;
    // Remove surrounding angle brackets and whitespace if present
    return token.trim().replace(/^<|>$/g, '');
  }

  getLock(token: string): LockInfo | null {
    this.cleanupExpiredLocks();

    const normalized = this.normalizeToken(token);
    if (!normalized) return null;

    const row = this.db
      .prepare<[string], LockRow>('SELECT * FROM locks WHERE token = ?')
      .get(normalized);

    if (!row) {
      return null;
    }

    return this.rowToLockInfo(row);
  }

  getLocksForPath(path: string): LockInfo[] {
    this.cleanupExpiredLocks();

    const rows = this.db
      .prepare<[string], LockRow>('SELECT * FROM locks WHERE path = ?')
      .all(path) as LockRow[];

    return rows.map((row: LockRow) => this.rowToLockInfo(row));
  }

  getLocksForUser(username: string): LockInfo[] {
    this.cleanupExpiredLocks();

    const rows = this.db
      .prepare<[string], LockRow>('SELECT * FROM locks WHERE username = ?')
      .all(username) as LockRow[];

    return rows.map((row: LockRow) => this.rowToLockInfo(row));
  }

  getAllLocks(): LockInfo[] {
    this.cleanupExpiredLocks();

    const rows = this.db.prepare<[], LockRow>('SELECT * FROM locks').all() as LockRow[];

    return rows.map((row: LockRow) => this.rowToLockInfo(row));
  }

  refreshLock(token: string, timeout: number): boolean {
    this.cleanupExpiredLocks();

    const normalized = this.normalizeToken(token);
    if (!normalized) return false;

    const lock = this.getLock(normalized);
    if (!lock) {
      return false;
    }

    const now = Date.now();
    const expiresAt = now + timeout * 1000;

    const result = this.db
      .prepare('UPDATE locks SET expires_at = ?, timeout = ? WHERE token = ?')
      .run(expiresAt, timeout, normalized);

    return result.changes > 0;
  }

  deleteLock(token: string): boolean {
    const normalized = this.normalizeToken(token);
    if (!normalized) return false;
    const result = this.db.prepare('DELETE FROM locks WHERE token = ?').run(normalized);
    return result.changes > 0;
  }

  deleteLocksForPath(path: string): number {
    const result = this.db.prepare('DELETE FROM locks WHERE path = ?').run(path);
    return result.changes;
  }

  isLocked(path: string, ignoreToken?: string): boolean {
    this.cleanupExpiredLocks();

    let query = 'SELECT COUNT(*) as count FROM locks WHERE path = ?';
    const params: unknown[] = [path];

    if (ignoreToken) {
      query += ' AND token != ?';
      params.push(ignoreToken);
    }

    const stmt = this.db.prepare(query);
    let result: { count: number } | undefined;
    if (ignoreToken) {
      result = stmt.get(path, ignoreToken) as { count: number } | undefined;
    } else {
      result = stmt.get(path) as { count: number } | undefined;
    }

    return (result?.count ?? 0) > 0;
  }

  validateLockToken(path: string, token: string | null): boolean {
    if (!token) {
      // If no token provided, check if resource is locked
      return !this.isLocked(path);
    }

    const normalized = this.normalizeToken(token);
    if (!normalized) return false;

    // Verify the token exists and matches the path
    const lock = this.getLock(normalized);
    if (!lock) {
      return false;
    }

    // Check if the token is for this exact path or a parent path with depth infinity
    if (lock.path === path) {
      return true;
    }

    // Check if this is a child path of a depth:infinity lock
    if (lock.depth === 'infinity' && path.startsWith(lock.path + '/')) {
      return true;
    }

    return false;
  }

  private getConflictingLocks(path: string, depth: '0' | 'infinity'): LockInfo[] {
    this.cleanupExpiredLocks();

    const locks: LockInfo[] = [];

    // Check for locks on the exact path
    const exactLocks = this.getLocksForPath(path);
    locks.push(...exactLocks);

    // If depth is infinity, check for locks on child paths
    if (depth === 'infinity') {
      const childLocks = this.db
        .prepare<[string], LockRow>('SELECT * FROM locks WHERE path LIKE ?')
        .all(`${path}/%`);
      locks.push(...(childLocks as LockRow[]).map((row: LockRow) => this.rowToLockInfo(row)));
    }

    // Check for parent locks with depth infinity
    const pathParts = path.split('/').filter((p) => p);
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const parentPath = '/' + pathParts.slice(0, i).join('/');
      const parentLocks = this.db
        .prepare<[string, string], LockRow>('SELECT * FROM locks WHERE path = ? AND depth = ?')
        .all(parentPath, 'infinity');
      locks.push(...(parentLocks as LockRow[]).map((row: LockRow) => this.rowToLockInfo(row)));
    }

    return locks;
  }

  private rowToLockInfo(row: LockRow): LockInfo {
    return {
      token: row.token,
      path: row.path,
      username: row.username,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      timeout: row.timeout,
      scope: row.scope,
      depth: row.depth,
      provisional: row.provisional === 1,
      owner: row.owner,
    };
  }

  close(): void {
    this.db.close();
    LockManager.instance = null;
  }
}

export default LockManager;
