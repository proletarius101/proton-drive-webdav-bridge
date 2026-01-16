/**
 * Proton Drive Lock for Nephele
 *
 * Lock implementation using SQLite-backed LockManager for persistence.
 */

import type { Lock as LockInterface } from 'nephele';
import type { Resource } from 'nephele';
import { LockManager } from './LockManager.js';

export default class ProtonDriveLock implements LockInterface {
  resource: Resource;
  token: string;
  date: Date;
  timeout: number;
  scope: 'exclusive' | 'shared';
  depth: '0' | 'infinity';
  provisional: boolean;
  owner: unknown;
  private lockManager: LockManager;

  constructor({
    resource,
    token,
    date,
    timeout,
    scope,
    depth,
    provisional,
    owner,
  }: {
    resource: Resource;
    token: string;
    date: Date;
    timeout: number;
    scope: 'exclusive' | 'shared';
    depth: '0' | 'infinity';
    provisional: boolean;
    owner: unknown;
  }) {
    this.resource = resource;
    this.token = token;
    this.date = date;
    this.timeout = timeout;
    this.scope = scope;
    this.depth = depth;
    this.provisional = provisional;
    this.owner = owner;
    this.lockManager = LockManager.getInstance();
  }

  async save(): Promise<void> {
    // Lock is already saved in LockManager during creation
    // This is called after modifications to persist changes
    const success = this.lockManager.refreshLock(this.token, this.timeout);
    if (!success) {
      throw new Error('Failed to save lock - lock may have expired');
    }
  }

  async delete(): Promise<void> {
    const success = this.lockManager.deleteLock(this.token);
    if (!success) {
      throw new Error('Failed to delete lock - lock may not exist');
    }
  }
}
