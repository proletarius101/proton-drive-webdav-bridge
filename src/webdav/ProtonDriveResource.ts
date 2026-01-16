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
import { driveClient, type DriveNode } from '../drive.js';
import { logger } from '../logger.js';
import type ProtonDriveAdapter from './ProtonDriveAdapter.js';
import ProtonDriveLock from './ProtonDriveLock.js';
import ProtonDriveProperties from './ProtonDriveProperties.js';
import { LockManager } from './LockManager.js';

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

  constructor({
    adapter,
    baseUrl,
    path,
    collection,
  }: {
    adapter: ProtonDriveAdapter;
    baseUrl: URL;
    path: string;
    collection?: boolean;
  }) {
    this.adapter = adapter;
    this.baseUrl = baseUrl;
    this.path = path.replace(/\/?$/, '');
    this.collection = collection;
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
        uid: driveClient.getRootFolderUid(),
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
    let currentUid = driveClient.getRootFolderUid();
    let currentNode: DriveNode | null = null;

    for (const part of parts) {
      const nodes = await driveClient.listFolder(currentUid);
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
    } else {
      // Check if resource is locked by someone else
      const locks = this.lockManager.getLocksForPath(this.path);
      const userLocks = locks.filter((l) => l.username === user.username);

      if (locks.length > userLocks.length) {
        throw new ForbiddenError('Resource is locked by another user');
      }
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

    try {
      const lockInfo = this.lockManager.createLock(
        this.path,
        user,
        timeout,
        scope,
        depth,
        provisional,
        owner
      );

      return new ProtonDriveLock({
        resource: this,
        token: lockInfo.token,
        date: lockInfo.createdAt,
        timeout: lockInfo.timeout,
        scope: lockInfo.scope,
        depth: lockInfo.depth,
        provisional: lockInfo.provisional,
        owner: lockInfo.owner,
      });
    } catch (error) {
      logger.error(`Failed to create lock: ${error}`);
      throw new ForbiddenError('Resource is already locked');
    }
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

  async getStream(_range?: { start: number; end: number }): Promise<Readable> {
    const node = await this.resolveNode();

    if (!node || node.type !== 'file') {
      return Readable.from([]);
    }

    const data = await driveClient.downloadFile(node.uid);

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
          'One or more intermediate collections must be created before this resource.'
        );
      }

      if (await this.isCollection()) {
        throw new MethodNotSupportedError('This resource is an existing collection.');
      }

      // Upload file
      await driveClient.uploadFile(
        parentNode.uid,
        name,
        Readable.toWeb(input) as ReadableStream,
        {}
      );

      // Invalidate cache
      this._node = undefined;
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
          'One or more intermediate collections must be created before this resource.'
        );
      }

      if (this.collection) {
        await driveClient.createFolder(parentNode.uid, name);
      } else {
        // Create empty file
        const emptyStream = Readable.from([Buffer.from([])]);
        await driveClient.uploadFile(
          parentNode.uid,
          name,
          Readable.toWeb(emptyStream) as ReadableStream,
          { size: 0 }
        );
      }

      this._node = undefined;
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
      throw new Error('Resource not found.');
    }

    logger.debug(`Deleting node uid=${node.uid} name=${node.name} path=${this.path}`);
    await driveClient.deleteNode(node.uid);
    logger.debug(`Deleted node uid=${node.uid} path=${this.path}`);

    // Remove any locks on this resource
    this.lockManager.deleteLocksForPath(this.path);

    this._node = null;
  }

  async copy(destination: URL, baseUrl: URL, user: User, lockToken?: string): Promise<void> {
    // Check lock before copying
    this.checkLock(user, lockToken);

    const node = await this.resolveNode();
    if (!node) {
      throw new Error('Resource not found.');
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
        'One or more intermediate collections must be created before this resource.'
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
      const fileData = await driveClient.downloadFile(node.uid);
      await driveClient.uploadFile(
        destParentNode.uid,
        destName,
        fileData instanceof ReadableStream
          ? fileData
          : (Readable.toWeb(Readable.from([fileData])) as ReadableStream),
        { size: node.size }
      );
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
    const createdFolderUid = await driveClient.createFolder(destParentUid, destName);

    // Copy all children
    const children = await driveClient.listFolder(sourceNode.uid);
    for (const child of children) {
      if (child.type === 'folder') {
        await this.copyDirectory(child, createdFolderUid, child.name, user);
      } else {
        const fileData = await driveClient.downloadFile(child.uid);
        await driveClient.uploadFile(
          createdFolderUid,
          child.name,
          fileData instanceof ReadableStream
            ? fileData
            : (Readable.toWeb(Readable.from([fileData])) as ReadableStream),
          { size: child.size }
        );
      }
    }
  }

  async move(destination: URL, baseUrl: URL, user: User, lockToken?: string): Promise<void> {
    // Check lock before moving
    this.checkLock(user, lockToken);

    if (await this.isCollection()) {
      throw new Error('Move called on a collection resource.');
    }

    const node = await this.resolveNode();
    if (!node) {
      throw new Error('Resource not found.');
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
        'One or more intermediate collections must be created before this resource.'
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
      await driveClient.moveNode(node.uid, destParentNode.uid);
    }

    // Rename if needed
    if (node.name !== destName) {
      await driveClient.renameNode(node.uid, destName);
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
      throw new Error('Resource not found.');
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

    const children = await driveClient.listFolder(node.uid);
    return children.map((child) => {
      const childPath =
        this.path === '' || this.path === '/' ? `/${child.name}` : `${this.path}/${child.name}`;

      return new ProtonDriveResource({
        adapter: this.adapter,
        baseUrl: this.baseUrl,
        path: childPath,
        collection: child.type === 'folder',
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

    const children = await driveClient.listFolder(node.uid);
    return children.length === 0;
  }

  /**
   * Validate that all parent directories exist
   */
  async resourceTreeExists(path: string = this.path): Promise<boolean> {
    if (path === '' || path === '/') {
      return true; // Root always exists
    }

    // Check that all parent directories exist
    const parts = path.split('/').filter((p) => p.length > 0);
    let currentUid = driveClient.getRootFolderUid();

    try {
      // Validate all parents except the last part (the resource itself)
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const nodes = await driveClient.listFolder(currentUid);
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
