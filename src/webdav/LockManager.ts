/**
 * WebDAV Lock Manager using Bun SQLite
 *
 * Manages WebDAV locks with SQLite persistence for reliability across server restarts.
 * Handles lock creation, validation, expiration, and cleanup.
 */

import { Database } from 'bun:sqlite';
import { join } from 'path';
import { getDataDir } from '../paths.js';
import { logger } from '../logger.js';
import type { User } from 'nephele';

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
  private db: Database;
  private static instance: LockManager | null = null;

  private constructor() {
    const dbPath = join(getDataDir(), 'locks.db');
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
    this.db.run(`
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

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_locks_path ON locks(path)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_locks_expires_at ON locks(expires_at)
    `);
  }

  private cleanupExpiredLocks(): void {
    const now = Date.now();
    const result = this.db.run('DELETE FROM locks WHERE expires_at < ?', [now]);
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

    this.db.run(
      `INSERT INTO locks (token, path, username, created_at, expires_at, timeout, scope, depth, provisional, owner)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        token,
        path,
        user.username,
        now,
        expiresAt,
        timeout,
        scope,
        depth,
        provisional ? 1 : 0,
        JSON.stringify(owner),
      ]
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
      .query<LockRow, [string]>('SELECT * FROM locks WHERE token = ?')
      .get(normalized);

    if (!row) {
      return null;
    }

    return this.rowToLockInfo(row);
  }

  getLocksForPath(path: string): LockInfo[] {
    this.cleanupExpiredLocks();

    const rows = this.db.query<LockRow, [string]>('SELECT * FROM locks WHERE path = ?').all(path);

    return rows.map((row) => this.rowToLockInfo(row));
  }

  getLocksForUser(username: string): LockInfo[] {
    this.cleanupExpiredLocks();

    const rows = this.db
      .query<LockRow, [string]>('SELECT * FROM locks WHERE username = ?')
      .all(username);

    return rows.map((row) => this.rowToLockInfo(row));
  }

  getAllLocks(): LockInfo[] {
    this.cleanupExpiredLocks();

    const rows = this.db.query<LockRow, []>('SELECT * FROM locks').all();

    return rows.map((row) => this.rowToLockInfo(row));
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

    const result = this.db.run('UPDATE locks SET expires_at = ?, timeout = ? WHERE token = ?', [
      expiresAt,
      timeout,
      normalized,
    ]);

    return result.changes > 0;
  }

  deleteLock(token: string): boolean {
    const normalized = this.normalizeToken(token);
    if (!normalized) return false;
    const result = this.db.run('DELETE FROM locks WHERE token = ?', [normalized]);
    return result.changes > 0;
  }

  deleteLocksForPath(path: string): number {
    const result = this.db.run('DELETE FROM locks WHERE path = ?', [path]);
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

    const result = this.db
      .query<{ count: number }, [string] | [string, string]>(query)
      .get(...(params as [string] | [string, string]));

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
        .query<LockRow, [string]>('SELECT * FROM locks WHERE path LIKE ?')
        .all(`${path}/%`);
      locks.push(...childLocks.map((row) => this.rowToLockInfo(row)));
    }

    // Check for parent locks with depth infinity
    const pathParts = path.split('/').filter((p) => p);
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const parentPath = '/' + pathParts.slice(0, i).join('/');
      const parentLocks = this.db
        .query<LockRow, [string, string]>('SELECT * FROM locks WHERE path = ? AND depth = ?')
        .all(parentPath, 'infinity');
      locks.push(...parentLocks.map((row) => this.rowToLockInfo(row)));
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
