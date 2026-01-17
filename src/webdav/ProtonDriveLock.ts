/**
 * Proton Drive Lock for Nephele
 *
 * Lock implementation using SQLite-backed LockManager for persistence.
 */

import type { Lock as LockInterface } from 'nephele';
import type { Resource, User } from 'nephele';
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
    // If lock does not exist yet (some WebDAV flows create lock object then expect save() to persist),
    // create it now using LockManager and update our token to the newly persisted one.
    const existing = this.lockManager.getLock(this.token);
    if (!existing) {
      try {
        const ownerUsername =
          typeof this.owner === 'string'
            ? this.owner
            : (this.owner as { username?: string })?.username;
        const userObj = { username: ownerUsername ?? 'unknown' } as unknown as User;
        const path = (this.resource as unknown as { path?: string }).path ?? '/';
        const created = this.lockManager.createLock(
          path,
          userObj,
          this.timeout,
          this.scope,
          this.depth,
          this.provisional,
          this.owner
        );
        // update token to the one persisted
        this.token = created.token;
      } catch {
        // If creation failed due to conflict or other issue, rethrow as save failure
        throw new Error('Failed to save lock - lock may have expired');
      }
    }

    let success = this.lockManager.refreshLock(this.token, this.timeout);
    if (!success) {
      // Retry once briefly in case of a race between creation and refresh
      await new Promise((resolve) => setTimeout(resolve, 10));
      success = this.lockManager.refreshLock(this.token, this.timeout);
    }

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
