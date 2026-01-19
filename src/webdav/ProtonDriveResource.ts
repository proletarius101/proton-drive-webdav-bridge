/**
 * Proton Drive Resource for Nephele
 *
 * Implements the Resource interface for Proton Drive files and folders.
 */

import { Readable } from 'stream';
import { createHash } from 'crypto';
import type { Resource as ResourceInterface, User, Lock, Properties } from 'nephele';
import {
  ResourceExistsError,
  ResourceTreeNotCompleteError,
  MethodNotSupportedError,
  ForbiddenError,
  ResourceNotFoundError,
} from 'nephele';
import { MethodNotAllowedError, LockedError } from '../errors/index.js';

import { type DriveNode } from '../drive.js';
import { logger } from '../logger.js';
import type ProtonDriveAdapter from './ProtonDriveAdapter.js';
import ProtonDriveLock from './ProtonDriveLock.js';
import ProtonDriveProperties from './ProtonDriveProperties.js';
import MetadataManager from './MetadataManager.js';
import { LockManager } from './LockManager.js';
import { getClaimedAdditionalMetadata } from './sdkHelpers.js';

// ============================================================================
// Resource Implementation
// ============================================================================

export default class ProtonDriveResource implements ResourceInterface {
  adapter: ProtonDriveAdapter;
  baseUrl: URL;
  path: string;
  collection: boolean | undefined;
  private _node: DriveNode | null | undefined;
  private lockManager: LockManager;

  // Metadata cache / hydration
  private _metaReady: Promise<void> | null = null;
  private _cachedProps: { [k: string]: unknown } | null = null;

  constructor({
    adapter,
    baseUrl,
    path,
    collection,
    node,
  }: {
    adapter: ProtonDriveAdapter;
    baseUrl: URL;
    path: string;
    collection?: boolean;
    node?: DriveNode | null;
  }) {
    this.adapter = adapter;
    this.baseUrl = baseUrl;
    this.path = path.replace(/\/?$/, '');
    this.collection = collection;
    // If a DriveNode is provided, cache it to avoid re-resolving the path later
    this._node = node ?? undefined;
    this.lockManager = LockManager.getInstance();
  }

  /**
   * Resolve path to DriveNode
   */
  private async resolveNode(): Promise<DriveNode | null> {
    if (this._node !== undefined) {
      return this._node;
    }

    // Root folder
    if (this.path === '' || this.path === '/') {
      this._node = {
        uid: this.adapter.driveClient.getRootFolderUid(),
        name: '',
        type: 'folder',
        size: 0,
        mimeType: 'inode/directory',
        createdTime: new Date(),
        modifiedTime: new Date(),
        parentUid: null,
      };
      return this._node;
    }

    // Check path cache first (fast path)
    const cachedNode = this.adapter.getCachedNode(this.path);
    if (cachedNode) {
      this._node = cachedNode;
      return cachedNode;
    }

    // Use SDK's efficient resolvePath that uses iterators (stops early, doesn't fetch all items)
    // instead of listFolder which fetches all children and searches
    try {
      const t0 = Date.now();
      const resolved = await this.adapter.driveClient.resolvePath(this.path);
      const resolvePathDuration = Date.now() - t0;
      logger.debug(
        `resolvePath("${this.path}") took ${resolvePathDuration}ms, resolved: ${resolved ? resolved.uid : 'null'}`
      );

      if (!resolved) {
        this._node = null;
        return null;
      }

      // Fetch full node details using the SDK's getNode for complete metadata
      const t1 = Date.now();
      const nodeResult = await this.adapter.driveClient.getNode(resolved.uid);
      const getNodeDuration = Date.now() - t1;
      logger.debug(`getNode("${resolved.uid}") took ${getNodeDuration}ms`);

      if (!nodeResult) {
        this._node = null;
        return null;
      }

      // getNode returns NodeEntity | DegradedNode - both have the properties we need
      const node = nodeResult;
      const isFolder = node.type === 'folder';

      // Extract size from activeRevision if available
      function extractClaimedSize(activeRevision: unknown): number | undefined {
        if (!activeRevision) return undefined;
        const rev = activeRevision as { claimedSize?: number; storageSize?: number };
        return rev.claimedSize ?? rev.storageSize;
      }

      // Extract modification time from activeRevision if available
      function extractClaimedModificationTime(activeRevision: unknown): Date | undefined {
        if (!activeRevision) return undefined;
        const rev = activeRevision as { claimedModificationTime?: Date };
        return rev.claimedModificationTime;
      }

      const createdTime =
        node.creationTime ??
        extractClaimedModificationTime(node.activeRevision as unknown) ??
        node.modificationTime ??
        new Date(0);

      const modifiedTime = isFolder
        ? (node.folder?.claimedModificationTime ?? node.modificationTime ?? createdTime)
        : (extractClaimedModificationTime(node.activeRevision as unknown) ??
          node.modificationTime ??
          createdTime);

      const size = isFolder ? 0 : (extractClaimedSize(node.activeRevision as unknown) ?? 0);

      // Handle name which may be a Result<string, Error> in degraded nodes
      let name: string;
      if (typeof node.name === 'string') {
        name = node.name;
      } else if (node.name && typeof node.name === 'object' && 'ok' in node.name) {
        const nameResult = node.name as { ok?: boolean; value?: string };
        name = nameResult.ok && nameResult.value ? nameResult.value : 'Undecryptable';
      } else {
        name = 'Undecryptable';
      }

      const driveNode: DriveNode = {
        uid: node.uid,
        name,
        type: isFolder ? 'folder' : 'file',
        size,
        mimeType: node.mediaType || 'application/octet-stream',
        createdTime: createdTime as Date,
        modifiedTime: modifiedTime as Date,
        parentUid: resolved.uid, // Use the resolved parent UID
      };

      // Cache the resolved node by path for future lookups
      this.adapter.cacheNode(this.path, driveNode);

      this._node = driveNode;
      return driveNode;
    } catch (e) {
      // Fallback to listFolder-based resolution using cached folder listings
      logger.debug('resolvePath failed, falling back to cached listing resolution', {
        error: e,
        path: this.path,
      });
      const parts = this.path.split('/').filter((p) => p.length > 0);
      let currentUid = this.adapter.driveClient.getRootFolderUid();
      let foundNode: import('../drive.js').DriveNode | undefined = undefined;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const nodes = await this.adapter.getCachedFolderListing(currentUid);
        const nodeItem = nodes.find((n) => n.name === part);
        if (!nodeItem) {
          this._node = null;
          return null;
        }
        foundNode = nodeItem;
        currentUid = nodeItem.uid;
      }

      if (!foundNode) {
        this._node = null;
        return null;
      }

      const isFolder = foundNode.type === 'folder';
      const driveNode: DriveNode = {
        uid: foundNode.uid,
        name: foundNode.name,
        type: isFolder ? 'folder' : 'file',
        size: isFolder ? 0 : (foundNode.size ?? 0),
        mimeType: foundNode.mimeType || 'application/octet-stream',
        createdTime: foundNode.createdTime ?? new Date(0),
        modifiedTime: foundNode.modifiedTime ?? foundNode.createdTime ?? new Date(0),
        parentUid: foundNode.parentUid ?? null,
      };

      // Cache and return
      this.adapter.cacheNode(this.path, driveNode);
      this._node = driveNode;
      return driveNode;
    }
  }

  /**
   * Get parent path
   */
  private getParentPath(): string {
    const lastSlash = this.path.lastIndexOf('/');
    return lastSlash <= 0 ? '/' : this.path.substring(0, lastSlash);
  }

  /**
   * Get basename
   */
  private getBaseName(): string {
    const lastSlash = this.path.lastIndexOf('/');
    return this.path.substring(lastSlash + 1);
  }

  /**
   * Generate ETag for a node
   */
  private generateETag(node: DriveNode): string {
    const content = `${node.uid}-${node.modifiedTime.getTime()}-${node.size}`;
    return createHash('md5').update(content).digest('hex');
  }

  /**
   * Check if resource is locked by another user
   */
  private checkLock(user: User, lockToken?: string): void {
    if (lockToken) {
      // Validate the provided lock token
      if (!this.lockManager.validateLockToken(this.path, lockToken)) {
        throw new ForbiddenError('Invalid lock token provided');
      }
      return;
    }

    // No token provided: determine if any locks apply to this path (including parent locks with depth=infinity)
    const allLocks = this.lockManager.getAllLocks();
    const applicableLocks = allLocks.filter((l) => {
      if (l.path === this.path) return true;
      if (l.depth === 'infinity' && this.path.startsWith(l.path.replace(/\/$/, '') + '/'))
        return true;
      return false;
    });

    const userLocks = applicableLocks.filter((l) => l.username === user.username);

    logger.debug(
      `Lock check for path=${this.path} applicable=${applicableLocks.length} userOwned=${userLocks.length} user=${user.username}`
    );

    if (applicableLocks.length > userLocks.length) {
      logger.warn(`Operation blocked on locked resource path=${this.path}`);
      throw new LockedError(this.path);
    }
  }

  async getLocks(): Promise<Lock[]> {
    const lockInfos = this.lockManager.getLocksForPath(this.path);
    return lockInfos.map(
      (info) =>
        new ProtonDriveLock({
          resource: this,
          token: info.token,
          date: info.createdAt,
          timeout: info.timeout,
          scope: info.scope,
          depth: info.depth,
          provisional: info.provisional,
          owner: info.owner,
        })
    );
  }

  async getLocksByUser(user: User): Promise<Lock[]> {
    const userLocks = this.lockManager.getLocksForUser(user.username);
    const pathLocks = userLocks.filter((l) => l.path === this.path);

    return pathLocks.map(
      (info) =>
        new ProtonDriveLock({
          resource: this,
          token: info.token,
          date: info.createdAt,
          timeout: info.timeout,
          scope: info.scope,
          depth: info.depth,
          provisional: info.provisional,
          owner: info.owner,
        })
    );
  }

  async createLockForUser(user: User): Promise<Lock> {
    // Default timeout: 1 hour
    const timeout = 3600;
    const scope = 'exclusive';
    const depth = '0';
    const provisional = false;
    const owner = { username: user.username };

    // Don't persist immediately here; let the Lock.save() call create the lock
    const token = this.lockManager.generateToken();

    return new ProtonDriveLock({
      resource: this,
      token,
      date: new Date(),
      timeout,
      scope,
      depth,
      provisional,
      owner,
    });
  }

  async getProperties(): Promise<Properties> {
    const props = new ProtonDriveProperties({ resource: this });

    const node = await this.resolveNode();
    const lastModified = node ? node.modifiedTime : new Date();
    const created = node ? node.createdTime : new Date();

    await props.set('getlastmodified', lastModified.toUTCString());
    await props.set('creationdate', created.toISOString());

    // Provide standard live properties expected by clients
    // displayname: use '/' for root, actual name otherwise
    const displayName = !node || this.path === '' || this.path === '/' ? '/' : node.name;
    await props.set('displayname', displayName);

    // resourcetype / getcontentlength
    if (node) {
      if (node.type === 'folder') {
        // <D:resourcetype><D:collection/></D:resourcetype>
        await props.set('resourcetype', { collection: {} });
        // For collections, content length is typically omitted
      } else if (node.type === 'file') {
        await props.set('getcontentlength', String(node.size));
      }
    }

    return props;
  }

  // Metadata persistence helpers (backed by MetadataManager)
  private async ensureMetadataLoaded(): Promise<void> {
    if (this._metaReady) return this._metaReady;
    this._metaReady = (async () => {
      const node = await this.resolveNode();
      if (!node) {
        this._cachedProps = null;
        return;
      }

      const mm = MetadataManager.getInstance();

      // If we already have stored metadata, use it
      const stored = mm.get(node.uid);
      if (stored && stored.props) {
        this._cachedProps = stored.props as { [k: string]: unknown };
        return;
      }

      // Try hydrating from SDK node extended attributes
      try {
        const sdkNode = await this.adapter.driveClient.getNode(node.uid);
        if (sdkNode) {
          const claimedObj = getClaimedAdditionalMetadata(
            sdkNode as unknown as Parameters<typeof getClaimedAdditionalMetadata>[0]
          );

          if (claimedObj) {
            logger.debug(`Hydrating metadata for node ${node.uid}: ${JSON.stringify(claimedObj)}`);
            mm.save(node.uid, { props: claimedObj });
            this._cachedProps = claimedObj;
            return;
          }

          // Folders: not storing arbitrary key:value metadata for folders yet
        }
      } catch (e) {
        logger.debug(`Failed to hydrate metadata from SDK for node ${node.uid}: ${e}`);
      }

      // Nothing found
      this._cachedProps = null;
    })();

    return this._metaReady;
  }

  async getMetadata(): Promise<{ props?: { [k: string]: unknown } } | null> {
    await this.ensureMetadataLoaded();
    const node = await this.resolveNode();
    if (!node) return null;
    return this._cachedProps ? { props: this._cachedProps } : null;
  }

  async saveMetadata(meta: { props?: { [k: string]: unknown } }): Promise<void> {
    const node = await this.resolveNode();
    if (!node) throw new ResourceNotFoundError('Resource not found');
    const mm = MetadataManager.getInstance();
    mm.save(node.uid, meta);

    // Update cache
    this._cachedProps = meta.props ? meta.props : null;
    this._metaReady = Promise.resolve();
  }

  async getStream(_range?: { start: number; end: number }): Promise<Readable> {
    const t0 = Date.now();
    logger.debug(`getStream called for path: ${this.path}`);

    const node = await this.resolveNode();
    const resolveNodeDuration = Date.now() - t0;
    logger.debug(`getStream: resolveNode took ${resolveNodeDuration}ms for ${this.path}`);

    if (!node || node.type !== 'file') {
      logger.debug(`getStream: Not a file or node not found for ${this.path}`);
      return Readable.from([]);
    }

    // Use the SDK's downloader directly with our own Node.js PassThrough stream
    // to avoid Web ReadableStream locking issues
    logger.debug(`getStream: Getting downloader for uid=${node.uid}, path=${this.path}`);
    const t1 = Date.now();
    const downloader = await this.adapter.driveClient.getFileDownloader(node.uid);
    const downloaderDuration = Date.now() - t1;
    logger.debug(`getStream: Got downloader in ${downloaderDuration}ms`);

    // Create a PassThrough stream that the SDK can write to
    const { PassThrough } = await import('stream');
    const passthrough = new PassThrough();

    // Start the download in the background
    // Don't await this - let it run independently while we return the stream
    const t2 = Date.now();
    downloader
      .downloadToStream(
        new WritableStream({
          write(chunk) {
            passthrough.write(chunk);
          },
          close() {
            passthrough.end();
          },
          abort(reason) {
            passthrough.destroy(reason instanceof Error ? reason : new Error(String(reason)));
          },
        })
      )
      .completion()
      .then(() => {
        const duration = Date.now() - t2;
        logger.debug(`getStream: Download completed for ${this.path} in ${duration}ms`);
      })
      .catch((error: unknown) => {
        logger.error(
          `getStream: Error downloading for ${this.path}: ${error instanceof Error ? error.message : String(error)}`
        );
        passthrough.destroy(error instanceof Error ? error : new Error(String(error)));
      });

    logger.debug(`getStream: Returning PassThrough stream for ${this.path}`);
    return passthrough;
  }

  async setStream(input: Readable, user: User, lockToken?: string): Promise<void> {
    try {
      // Check lock before modifying
      this.checkLock(user, lockToken);

      const parentPath = this.getParentPath();
      const name = this.getBaseName();

      // Find parent
      const parentResource = new ProtonDriveResource({
        adapter: this.adapter,
        baseUrl: this.baseUrl,
        path: parentPath,
      });

      const parentNode = await parentResource.resolveNode();

      if (!parentNode || parentNode.type !== 'folder') {
        throw new ResourceTreeNotCompleteError(
          'One or more intermediate collections must be created before this resource (missing parent directory or incomplete tree).'
        );
      }

      if (await this.isCollection()) {
        throw new MethodNotSupportedError('This resource is an existing collection.');
      }

      // Upload file
      await this.adapter.driveClient.uploadFile(
        parentNode.uid,
        name,
        Readable.toWeb(input) as ReadableStream,
        {}
      );

      // Invalidate parent folder cache
      this.adapter.invalidateFolderCache(parentNode.uid);

      // Invalidate node + metadata cache
      this._node = undefined;
      this._metaReady = null;
      this._cachedProps = null;
    } catch (error) {
      logger.error(
        `setStream failed for path ${this.path}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  async create(_user: User): Promise<void> {
    try {
      if (await this.exists()) {
        throw new ResourceExistsError('A resource already exists here.');
      }

      const parentPath = this.getParentPath();
      const name = this.getBaseName();

      const parentResource = new ProtonDriveResource({
        adapter: this.adapter,
        baseUrl: this.baseUrl,
        path: parentPath,
      });

      const parentNode = await parentResource.resolveNode();

      if (!parentNode || parentNode.type !== 'folder') {
        throw new ResourceTreeNotCompleteError(
          'One or more intermediate collections must be created before this resource (missing parent directory or incomplete tree).'
        );
      }

      if (this.collection) {
        await this.adapter.driveClient.createFolder(parentNode.uid, name);
      } else {
        // Create empty file using a small empty ReadableStream (avoid Buffer allocation)
        const emptyStream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        });

        await this.adapter.driveClient.uploadFile(parentNode.uid, name, emptyStream, { size: 0 });
      }

      // Invalidate parent folder cache
      this.adapter.invalidateFolderCache(parentNode.uid);

      this._node = undefined;
      this._metaReady = null;
      this._cachedProps = null;
    } catch (error) {
      logger.error(
        `create failed for path ${this.path}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  async delete(user: User, lockToken?: string): Promise<void> {
    // Check lock before deleting
    this.checkLock(user, lockToken);

    const node = await this.resolveNode();

    if (!node) {
      throw new ResourceNotFoundError('Resource not found.');
    }

    logger.debug(`Deleting node uid=${node.uid} name=${node.name} path=${this.path}`);
    await this.adapter.driveClient.deleteNode(node.uid);
    logger.debug(`Deleted node uid=${node.uid} path=${this.path}`);

    // Invalidate parent folder cache if node has a parent
    if (node.parentUid) {
      this.adapter.invalidateFolderCache(node.parentUid);
    }

    // Remove any locks on this resource
    this.lockManager.deleteLocksForPath(this.path);

    // Remove persisted metadata for this node
    try {
      MetadataManager.getInstance().delete(node.uid);
    } catch (e) {
      // Don't fail delete on metadata cleanup error
      logger.error(`Failed to delete metadata for node ${node.uid}: ${e}`);
    }

    // Clear caches
    this._node = null;
    this._metaReady = null;
    this._cachedProps = null;
  }

  async copy(destination: URL, baseUrl: URL, user: User, lockToken?: string): Promise<void> {
    // Check lock before copying
    this.checkLock(user, lockToken);

    const node = await this.resolveNode();
    if (!node) {
      throw new ResourceNotFoundError('Resource not found.');
    }

    const destPath = this.adapter.urlToRelativePath(destination, baseUrl);
    if (!destPath) {
      throw new ForbiddenError('The destination URL is not under the namespace of this server.');
    }

    // Prevent copying to self or into self (for collections)
    if (
      this.path === destPath ||
      ((await this.isCollection()) && destPath.startsWith(this.path + '/'))
    ) {
      throw new ForbiddenError(
        'The destination cannot be the same as or contained within the source.'
      );
    }

    // Validate destination parent exists
    if (!(await this.resourceTreeExists(destPath))) {
      throw new ResourceTreeNotCompleteError(
        'One or more intermediate collections must be created before this resource (missing parent directory or incomplete tree).'
      );
    }

    // Get destination parent and name
    let destParentPath = '/';
    const lastSlash = destPath.lastIndexOf('/');
    if (lastSlash > 0) {
      destParentPath = destPath.substring(0, lastSlash);
    }
    const destName = destPath.substring(lastSlash + 1);

    const destParentResource = new ProtonDriveResource({
      adapter: this.adapter,
      baseUrl: baseUrl,
      path: destParentPath,
    });

    const destParentNode = await destParentResource.resolveNode();
    if (!destParentNode || destParentNode.type !== 'folder') {
      throw new ResourceTreeNotCompleteError('Destination parent folder not found.');
    }

    // Handle destination overwrite
    try {
      const destResource = await this.adapter.getResource(destination, baseUrl);
      if (await destResource.isCollection()) {
        if (!(await destResource.isEmpty())) {
          throw new ForbiddenError('Directory not empty.');
        }
        await destResource.delete(user);
      } else {
        await destResource.delete(user);
      }
    } catch (e) {
      if (!(e instanceof ResourceNotFoundError)) {
        throw e;
      }
    }

    // Perform the copy operation
    if (node.type === 'folder') {
      // Recursively copy directory
      await this.copyDirectory(node, destParentNode.uid, destName, user);
    } else {
      // Copy file
      const fileData = await this.adapter.driveClient.downloadFile(node.uid);

      // Prefer passing streams through directly to avoid buffering whole file into memory.
      // If the backend returns a ReadableStream, pass it straight to uploadFile; otherwise pass the raw bytes.
      let uploadData: Uint8Array | ReadableStream;
      if (fileData instanceof ReadableStream) {
        uploadData = fileData;
      } else {
        uploadData = fileData as Uint8Array;
      }

      await this.adapter.driveClient.uploadFile(destParentNode.uid, destName, uploadData, {
        size: node.size,
      });
    }

    logger.debug(`Copied ${this.path} to ${destPath}`);
  }

  private async copyDirectory(
    sourceNode: DriveNode,
    destParentUid: string,
    destName: string,
    user: User
  ): Promise<void> {
    // Create destination directory
    const createdFolderUid = await this.adapter.driveClient.createFolder(destParentUid, destName);

    // Copy all children (using cached listing to reduce API calls)
    const children = await this.adapter.getCachedFolderListing(sourceNode.uid);
    for (const child of children) {
      if (child.type === 'folder') {
        await this.copyDirectory(child, createdFolderUid, child.name, user);
      } else {
        const fileData = await this.adapter.driveClient.downloadFile(child.uid);
        // Pass bytes or stream directly to uploadFile; the drive client accepts ReadableStream | Buffer | Uint8Array
        await this.adapter.driveClient.uploadFile(createdFolderUid, child.name, fileData, {
          size: child.size,
        });
      }
    }
  }

  async move(destination: URL, baseUrl: URL, user: User, lockToken?: string): Promise<void> {
    // Check lock before moving
    this.checkLock(user, lockToken);

    if (await this.isCollection()) {
      const err = new MethodNotAllowedError('MOVE', this.path);
      // Preserve original user-facing message expected by tests
      err.message = 'Move called on a collection resource.';
      throw err;
    }

    const node = await this.resolveNode();
    if (!node) {
      throw new ResourceNotFoundError('Resource not found.');
    }

    const destPath = this.adapter.urlToRelativePath(destination, baseUrl);
    if (!destPath) {
      throw new ForbiddenError('The destination URL is not under the namespace of this server.');
    }

    // Prevent moving to self or into self
    if (
      this.path === destPath ||
      ((await this.isCollection()) && destPath.startsWith(this.path + '/'))
    ) {
      throw new ForbiddenError(
        'The destination cannot be the same as or contained within the source.'
      );
    }

    // Validate destination tree exists
    if (!(await this.resourceTreeExists(destPath))) {
      throw new ResourceTreeNotCompleteError(
        'One or more intermediate collections must be created before this resource (missing parent directory or incomplete tree).'
      );
    }

    // Get destination parent and name
    let destParentPath = '/';
    const lastSlash = destPath.lastIndexOf('/');
    if (lastSlash > 0) {
      destParentPath = destPath.substring(0, lastSlash);
    }
    const destName = destPath.substring(lastSlash + 1);

    const destParentResource = new ProtonDriveResource({
      adapter: this.adapter,
      baseUrl: baseUrl,
      path: destParentPath,
    });

    const destParentNode = await destParentResource.resolveNode();
    if (!destParentNode || destParentNode.type !== 'folder') {
      throw new ResourceTreeNotCompleteError('Destination parent folder not found.');
    }

    // Handle destination overwrite
    try {
      const destResource = await this.adapter.getResource(destination, baseUrl);
      if ((await destResource.isCollection()) && !(await destResource.isEmpty())) {
        throw new ForbiddenError('The destination cannot be an existing non-empty directory.');
      }
    } catch (e) {
      if (!(e instanceof ResourceNotFoundError)) {
        throw e;
      }
    }

    // Clear locks before moving (security - prevent lock hijacking)
    this.lockManager.deleteLocksForPath(this.path);

    // Move to different folder if needed
    const currentParentPath = this.getParentPath();
    if (currentParentPath !== destParentPath) {
      await this.adapter.driveClient.moveNode(node.uid, destParentNode.uid);
      
      // Invalidate both source and destination parent folder caches
      if (node.parentUid) {
        this.adapter.invalidateFolderCache(node.parentUid);
      }
      this.adapter.invalidateFolderCache(destParentNode.uid);
    }

    // Rename if needed
    if (node.name !== destName) {
      await this.adapter.driveClient.renameNode(node.uid, destName);
      
      // Invalidate parent folder cache (same folder, different name)
      if (node.parentUid) {
        this.adapter.invalidateFolderCache(node.parentUid);
      }
    }

    logger.debug(`Moved ${this.path} to ${destPath}`);
    this._node = undefined;
  }

  async getLength(): Promise<number> {
    if (await this.isCollection()) {
      return 0;
    }

    const node = await this.resolveNode();
    return node ? node.size : 0;
  }

  async getEtag(): Promise<string> {
    const node = await this.resolveNode();

    if (!node) {
      return '';
    }

    return this.generateETag(node);
  }

  async getMediaType(): Promise<string> {
    if (await this.isCollection()) {
      return 'httpd/unix-directory';
    }

    const node = await this.resolveNode();
    return node ? node.mimeType || 'application/octet-stream' : 'application/octet-stream';
  }

  async getCanonicalName(): Promise<string> {
    if (this.path === '' || this.path === '/') {
      return '/';
    }
    const node = await this.resolveNode();
    if (!node) {
      throw new ResourceNotFoundError('Resource not found.');
    }
    return node.name;
  }

  async getCanonicalPath(): Promise<string> {
    if (await this.isCollection()) {
      // Ensure collections have trailing slash
      if (this.path === '') {
        return '/';
      }
      return this.path.replace(/\/?$/, () => '/');
    }
    // Non-collections should not have trailing slash
    return this.path.replace(/\/$/, '');
  }

  async getCanonicalUrl(): Promise<URL> {
    const canonicalPath = await this.getCanonicalPath();
    return new URL(
      canonicalPath
        .split('/')
        .filter((part) => part.length > 0)
        .map((part) => encodeURIComponent(part))
        .join('/'),
      this.baseUrl
    );
  }

  async isCollection(): Promise<boolean> {
    if (this.collection !== undefined) {
      return this.collection;
    }

    const node = await this.resolveNode();
    return node ? node.type === 'folder' : false;
  }

  async getInternalMembers(_user: User): Promise<ProtonDriveResource[]> {
    if (!(await this.isCollection())) {
      return [];
    }

    const node = await this.resolveNode();

    if (!node) {
      return [];
    }

    const children = await this.adapter.getCachedFolderListing(node.uid);
    return children.map((child) => {
      const childPath =
        this.path === '' || this.path === '/' ? `/${child.name}` : `${this.path}/${child.name}`;

      // Populate path cache for faster subsequent resolve calls
      try {
        this.adapter.cacheNode(childPath, child);
      } catch (e) {
        logger.debug(`Failed to cache node for ${childPath}: ${e}`);
      }

      return new ProtonDriveResource({
        adapter: this.adapter,
        baseUrl: this.baseUrl,
        path: childPath,
        collection: child.type === 'folder',
        node: child,
      });
    });
  }

  async exists(): Promise<boolean> {
    try {
      const node = await this.resolveNode();
      return node !== null;
    } catch (error) {
      logger.error(`Error checking existence: ${error}`);
      return false;
    }
  }

  async getCreationDate(): Promise<Date | null> {
    const node = await this.resolveNode();
    return node ? node.createdTime : null;
  }

  async getLastModified(): Promise<string> {
    const node = await this.resolveNode();
    const date = node ? node.modifiedTime : new Date();
    return date.toUTCString();
  }

  /**
   * Check if a collection is empty
   */
  async isEmpty(): Promise<boolean> {
    if (!(await this.isCollection())) {
      return false;
    }

    const node = await this.resolveNode();
    if (!node || node.type !== 'folder') {
      return true;
    }

    const children = await this.adapter.getCachedFolderListing(node.uid);
    return children.length === 0;
  }

  /**
   * Validate that all parent directories exist
   */
  async resourceTreeExists(path: string = this.path): Promise<boolean> {
    if (path === '' || path === '/') {
      return true; // Root always exists
    }

    // Normalize paths to compare
    const normalize = (p: string) =>
      '/' +
      p
        .split('/')
        .filter((x) => x.length > 0)
        .join('/');
    const normalizedPath = normalize(path);
    const normalizedThis = normalize(this.path || '');

    // Split parts once
    const parts = path.split('/').filter((p) => p.length > 0);

    try {
      // If the requested path is inside this resource's path, only verify this resource's path exists
      if (normalizedThis !== '/' && normalizedPath.startsWith(normalizedThis)) {
        const thisNode = await this.resolveNode();
        return !!(thisNode && thisNode.type === 'folder');
      }

      let currentUid = this.adapter.driveClient.getRootFolderUid();

      // Validate all parents except the last part (the resource itself)
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const nodes = await this.adapter.getCachedFolderListing(currentUid);
        const foundNode = nodes.find((n) => n.name === part);

        if (!foundNode || foundNode.type !== 'folder') {
          logger.debug(`Parent directory not found: ${part}`);
          return false;
        }
        currentUid = foundNode.uid;
      }

      return true;
    } catch (error) {
      logger.error(`Error checking resource tree: ${error}`);
      return false;
    }
  }
}
