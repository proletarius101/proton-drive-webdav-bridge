/**
 * Proton Drive Properties for Nephele
 *
 * Properties implementation for Proton Drive resources (emulated - not actually stored).
 */

import type { Properties as PropertiesInterface, User } from 'nephele';
import type { Resource } from 'nephele';

export default class ProtonDriveProperties implements PropertiesInterface {
  resource: Resource;
  private props: { [name: string]: string | object | object[] } = {};

  constructor({ resource }: { resource: Resource }) {
    this.resource = resource;
  }

  async get(name: string) {
    // Return empty string for undefined properties to avoid xmlbuilder errors
    // with clients requesting non-standard props (e.g., Apache executable).
    const value = this.props[name];
    return value === undefined ? '' : value;
  }

  async getByUser(name: string, _user: User) {
    const value = this.props[name];
    return value === undefined ? '' : value;
  }

  async set(name: string, value: string | object | object[] | undefined) {
    if (value !== undefined) {
      this.props[name] = value;
    }
  }

  async setByUser(name: string, value: string | object | object[] | undefined, _user: User) {
    if (value !== undefined) {
      this.props[name] = value;
    }
  }

  async remove(name: string) {
    delete this.props[name];
  }

  async removeByUser(name: string, _user: User) {
    delete this.props[name];
  }

  async runInstructions(instructions: ['set' | 'remove', string, unknown][]) {
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

  async runInstructionsByUser(instructions: ['set' | 'remove', string, unknown][], user: User) {
    const errors: [string, Error][] = [];
    for (const [action, name, value] of instructions) {
      try {
        if (action === 'set') {
          await this.setByUser(name, value as string | object | object[], user);
        } else {
          await this.removeByUser(name, user);
        }
      } catch (error) {
        errors.push([name, error as Error]);
      }
    }
    return errors.length > 0 ? errors : undefined;
  }

  async getAll() {
    return this.props;
  }

  async getAllByUser(_user: User) {
    return this.props;
  }

  async list() {
    return Object.keys(this.props);
  }

  async listByUser(_user: User) {
    return Object.keys(this.props);
  }

  async listLive() {
    // No live properties stored here
    return [];
  }

  async listLiveByUser(_user: User) {
    // No live properties stored here
    return [];
  }

  async listDead() {
    return Object.keys(this.props);
  }

  async listDeadByUser(_user: User) {
    return Object.keys(this.props);
  }
}
