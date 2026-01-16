/**
 * Proton Drive Nephele Adapter
 *
 * Custom Nephele adapter for accessing Proton Drive via WebDAV.
 * Implements the Adapter interface to bridge Nephele with Proton Drive SDK.
 */

import type { Request } from 'express';
import type { Adapter as AdapterInterface, AuthResponse, Method, User } from 'nephele';
import {
  BadGatewayError,
  MethodNotImplementedError,
  MethodNotSupportedError,
  ResourceNotFoundError,
} from 'nephele';
import { logger } from '../logger.js';
import ProtonDriveResource from './ProtonDriveResource.js';
import { driveClient as globalDriveClient, type DriveClientManager } from '../drive.js';

// ============================================================================
// Adapter Configuration
// ============================================================================

export interface ProtonDriveAdapterConfig {
  /** TTL for cache entries in milliseconds (default: 60000) */
  cacheTTL?: number;
  /** Optional drive client to use (injected for testing or custom clients) */
  driveClient?: DriveClientManager;
}

// ============================================================================
// Proton Drive Nephele Adapter
// ============================================================================

/**
 * Nephele adapter for Proton Drive
 */
export default class ProtonDriveAdapter implements AdapterInterface {
  cacheTTL: number;
  /** The Drive client instance used by resources. Defaults to the module singleton. */
  driveClient: DriveClientManager;

  constructor({ cacheTTL = 60000, driveClient }: ProtonDriveAdapterConfig = {}) {
    this.cacheTTL = cacheTTL;
    this.driveClient = driveClient ?? globalDriveClient;
    logger.debug('ProtonDriveAdapter initialized');
  }

  urlToRelativePath(url: URL, baseUrl: URL): string | null {
    if (
      !decodeURIComponent(url.pathname)
        .replace(/\/?$/, () => '/')
        .startsWith(decodeURIComponent(baseUrl.pathname))
    ) {
      return null;
    }

    return (
      '/' +
      decodeURIComponent(url.pathname)
        .substring(decodeURIComponent(baseUrl.pathname).length)
        .replace(/^\/?/, '')
        .replace(/\/?$/, '')
    );
  }

  async getComplianceClasses(
    _url: URL,
    _request: Request,
    _response: AuthResponse
  ): Promise<string[]> {
    // Return class 2 for lock support (RFC 4918)
    return ['2'];
  }

  async getAllowedMethods(
    _url: URL,
    _request: Request,
    _response: AuthResponse
  ): Promise<string[]> {
    // No additional methods beyond standard WebDAV
    return [];
  }

  async getOptionsResponseCacheControl(
    _url: URL,
    _request: Request,
    _response: AuthResponse
  ): Promise<string> {
    // Cache for 1 minute
    return 'max-age=60';
  }

  async isAuthorized(_url: URL, _method: string, _baseUrl: URL, _user: User): Promise<boolean> {
    // For now, allow all authenticated users
    // TODO: Implement more fine-grained access control
    return true;
  }

  async getResource(url: URL, baseUrl: URL): Promise<ProtonDriveResource> {
    const path = this.urlToRelativePath(url, baseUrl);

    if (path === null) {
      throw new BadGatewayError('The given path is not managed by this server.');
    }

    const resource = new ProtonDriveResource({
      adapter: this,
      baseUrl,
      path,
    });

    if (!(await resource.exists())) {
      throw new ResourceNotFoundError('Resource not found.');
    }

    return resource;
  }

  async newResource(url: URL, baseUrl: URL): Promise<ProtonDriveResource> {
    const path = this.urlToRelativePath(url, baseUrl);

    if (path === null) {
      throw new BadGatewayError('The given path is not managed by this server.');
    }

    return new ProtonDriveResource({
      adapter: this,
      baseUrl,
      path,
      collection: false,
    });
  }

  async newCollection(url: URL, baseUrl: URL): Promise<ProtonDriveResource> {
    const path = this.urlToRelativePath(url, baseUrl);

    if (path === null) {
      throw new BadGatewayError('The given path is not managed by this server.');
    }

    return new ProtonDriveResource({
      adapter: this,
      baseUrl,
      path,
      collection: true,
    });
  }

  getMethod(_method: string): typeof Method {
    // No additional methods to handle
    if (_method === 'POST' || _method === 'PATCH') {
      throw new MethodNotSupportedError('Method not supported.');
    }
    throw new MethodNotImplementedError('Method not implemented.');
  }
}

export { ProtonDriveAdapter };
