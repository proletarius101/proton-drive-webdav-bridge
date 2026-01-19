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
// Cache Types
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
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
  /** Cache for folder listings to reduce API calls during path resolution */
  private folderCache: Map<string, CacheEntry<import('../drive.js').DriveNode[]>>;
  /** Cache mapping full paths to resolved nodes to skip entire traversals */
  private pathCache: Map<string, CacheEntry<import('../drive.js').DriveNode>>;
  /** In-flight folder fetch promises to deduplicate concurrent fetches */
  private inflightFolderFetches: Map<string, Promise<import('../drive.js').DriveNode[]>>;

  constructor({ cacheTTL = 60000, driveClient }: ProtonDriveAdapterConfig = {}) {
    this.cacheTTL = cacheTTL;
    this.driveClient = driveClient ?? globalDriveClient;
    this.folderCache = new Map();
    this.pathCache = new Map();
    this.inflightFolderFetches = new Map();
    logger.debug(`ProtonDriveAdapter initialized (cacheTTL=${this.cacheTTL}ms)`);
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

  /**
   * Get cached node by path (fast path to skip traversal)
   */
  getCachedNode(path: string): import('../drive.js').DriveNode | null {
    const cached = this.pathCache.get(path);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.cacheTTL) {
      logger.debug(`Path cache hit for ${path}`);
      return cached.data;
    }

    return null;
  }

  /**
   * Cache a resolved node by its full path
   */
  cacheNode(path: string, node: import('../drive.js').DriveNode): void {
    this.pathCache.set(path, {
      data: node,
      timestamp: Date.now(),
    });
  }

  /**
   * Get folder listing with caching (deduplicates in-flight fetches)
   */
  async getCachedFolderListing(folderUid: string): Promise<import('../drive.js').DriveNode[]> {
    const cached = this.folderCache.get(folderUid);
    const now = Date.now();

    // Fast path: cached and fresh
    if (cached && now - cached.timestamp < this.cacheTTL) {
      logger.debug(`Folder cache hit for ${folderUid}`);
      return cached.data;
    }

    // If a fetch for this folder is already in-flight, await it
    const inFlight = this.inflightFolderFetches.get(folderUid);
    if (inFlight) {
      logger.debug(`Awaiting in-flight fetch for folder ${folderUid}`);
      return inFlight;
    }

    // If caching is disabled (ttl <= 0), fetch directly without storing results
    if (this.cacheTTL <= 0) {
      logger.debug(`Caching disabled or TTL<=0 for ${folderUid}, fetching direct`);
      return this.driveClient.listFolder(folderUid);
    }

    logger.debug(`Folder cache miss for ${folderUid}, fetching from API`);
    const fetchPromise = (async () => {
      try {
        const nodes = await this.driveClient.listFolder(folderUid);
        this.folderCache.set(folderUid, {
          data: nodes,
          timestamp: Date.now(),
        });
        return nodes;
      } catch (error) {
        logger.warn(`Failed to fetch folder ${folderUid}: ${error}`);
        throw error;
      } finally {
        this.inflightFolderFetches.delete(folderUid);
      }
    })();

    this.inflightFolderFetches.set(folderUid, fetchPromise);
    return fetchPromise;
  }

  /**
   * Invalidate cache for a specific folder and all paths containing it
   */
  invalidateFolderCache(folderUid: string): void {
    this.folderCache.delete(folderUid);

    // Also invalidate any path cache entries that might reference this folder
    // (we don't track which paths contain which folders, so we clear all paths)
    // This is conservative but safe
    if (this.pathCache.size > 0) {
      this.pathCache.clear();
      logger.debug(`Invalidated path cache due to folder change ${folderUid}`);
    }

    logger.debug(`Invalidated folder cache for ${folderUid}`);
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.folderCache.clear();
    this.pathCache.clear();
    logger.debug('Cleared all caches');
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
