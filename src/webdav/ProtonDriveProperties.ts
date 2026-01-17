/**
 * Proton Drive Properties for Nephele
 *
 * Properties implementation for Proton Drive resources (emulated - not actually stored).
 */

import type { Properties as PropertiesInterface, User } from 'nephele';
import type { Resource } from 'nephele';

import MetadataManager from './MetadataManager.js';

// Minimal local type for optional resource helpers used by properties
type ResourceWithMeta = {
  getMetadata?: () => Promise<{ props?: Record<string, unknown> } | null>;
  resolveNode?: () => Promise<{ uid: string } | null>;
};

export default class ProtonDriveProperties implements PropertiesInterface {
  resource: Resource;
  private props: { [name: string]: string | object | object[] } = {};
  private metaLoaded = false;

  constructor({ resource }: { resource: Resource }) {
    this.resource = resource;
  }

  private async ensureLoaded() {
    if (this.metaLoaded) return;
    try {
      const r = this.resource as unknown as ResourceWithMeta;
      const meta = (await r.getMetadata?.()) ?? null;
      if (meta && meta.props) {
        this.props = { ...(meta.props as Record<string, string | object | object[]>) };
      }
    } catch (error) {
      // If metadata not available, continue with empty props; log for debugging
      // (preserve behavior but avoid uncaught errors when methods are missing)
      console.debug(
        'ProtonDriveProperties.ensureLoaded: failed to load metadata',
        (error as Error).message
      );
    }
    this.metaLoaded = true;
  }

  async get(name: string) {
    await this.ensureLoaded();
    const value = this.props[name];
    return value === undefined ? '' : value;
  }

  async getByUser(name: string, _user: User) {
    await this.ensureLoaded();
    const value = this.props[name];
    return value === undefined ? '' : value;
  }

  private async isLiveProperty(name: string) {
    const live = await this.listLive();
    return live.includes(name);
  }

  async set(name: string, value: string | object | object[] | undefined) {
    await this.ensureLoaded();
    if (value !== undefined) {
      this.props[name] = value;
      // persist only dead properties
      if (!(await this.isLiveProperty(name))) {
        const r = this.resource as unknown as ResourceWithMeta;
        const node = (await r.resolveNode?.()) as { uid: string } | null;
        if (node) {
          const mm = MetadataManager.getInstance();
          const meta = (await mm.get(node.uid)) || {};
          meta.props = { ...(meta.props || {}), [name]: value };
          mm.save(node.uid, meta);
        }
      }
    }
  }

  async setByUser(name: string, value: string | object | object[] | undefined, _user: User) {
    await this.set(name, value);
  }

  async remove(name: string) {
    await this.ensureLoaded();
    if (name in this.props) {
      delete this.props[name];
      // persist
      const r = this.resource as unknown as ResourceWithMeta;
      const node = (await r.resolveNode?.()) as { uid: string } | null;
      if (node) {
        const mm = MetadataManager.getInstance();
        const meta = (await mm.get(node.uid)) || {};
        if (meta.props && name in meta.props) {
          delete meta.props[name];
          mm.save(node.uid, meta);
        }
      }
    }
  }

  async removeByUser(name: string, _user: User) {
    await this.remove(name);
  }

  async runInstructions(instructions: ['set' | 'remove', string, unknown][]) {
    await this.ensureLoaded();
    const errors: [string, Error][] = [];
    for (const [action, name, value] of instructions) {
      try {
        if (action === 'set') {
          await this.set(name, value as string | object | object[]);
        } else {
          await this.remove(name);
        }
      } catch (error) {
        errors.push([name, error as Error]);
      }
    }
    return errors.length > 0 ? errors : undefined;
  }

  async runInstructionsByUser(instructions: ['set' | 'remove', string, unknown][], _user: User) {
    return await this.runInstructions(instructions);
  }

  async getAll() {
    await this.ensureLoaded();
    return this.props;
  }

  async getAllByUser(_user: User) {
    return await this.getAll();
  }

  async list() {
    await this.ensureLoaded();
    return Object.keys(this.props);
  }

  async listByUser(_user: User) {
    return await this.list();
  }

  async listLive() {
    // Live properties are managed by resource itself
    return [
      'creationdate',
      'getcontentlength',
      'getcontenttype',
      'getetag',
      'getlastmodified',
      'resourcetype',
      'supportedlock',
      'displayname',
    ];
  }

  async listLiveByUser(_user: User) {
    return await this.listLive();
  }

  async listDead() {
    await this.ensureLoaded();
    return Object.keys(this.props);
  }

  async listDeadByUser(_user: User) {
    return await this.listDead();
  }
}
