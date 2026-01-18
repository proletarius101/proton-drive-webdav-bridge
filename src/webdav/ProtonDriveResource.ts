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

    // Traverse path
    const parts = this.path.split('/').filter((p) => p.length > 0);
    let currentUid = this.adapter.driveClient.getRootFolderUid();
    let currentNode: DriveNode | null = null;

    for (const part of parts) {
      const nodes = await this.adapter.driveClient.listFolder(currentUid);
      currentNode = nodes.find((n) => n.name === part) || null;

      if (!currentNode) {
        this._node = null;
        return null;
      }

      currentUid = currentNode.uid;
    }

    this._node = currentNode;
    return currentNode;
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
      if (l.depth === 'infinity' && this.path.startsWith(l.path.replace(/\/$/, '') + '/')) return true;
      return false;
    });

    const userLocks = applicableLocks.filter((l) => l.username === user.username);

    logger.debug(`Lock check for path=${this.path} applicable=${applicableLocks.length} userOwned=${userLocks.length} user=${user.username}`);

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
    const node = await this.resolveNode();

    if (!node || node.type !== 'file') {
      return Readable.from([]);
    }

    const data = await this.adapter.driveClient.downloadFile(node.uid);

    if (data instanceof ReadableStream) {
      return Readable.fromWeb(data as ReadableStream);
    }

    return Readable.from([data]);
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

    // Copy all children
    const children = await this.adapter.driveClient.listFolder(sourceNode.uid);
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
    }

    // Rename if needed
    if (node.name !== destName) {
      await this.adapter.driveClient.renameNode(node.uid, destName);
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

    const children = await this.adapter.driveClient.listFolder(node.uid);
    return children.map((child) => {
      const childPath =
        this.path === '' || this.path === '/' ? `/${child.name}` : `${this.path}/${child.name}`;

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

    const children = await this.adapter.driveClient.listFolder(node.uid);
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
        const nodes = await this.adapter.driveClient.listFolder(currentUid);
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
