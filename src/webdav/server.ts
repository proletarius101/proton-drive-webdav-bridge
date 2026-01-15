/**
 * Proton Drive Bridge - WebDAV Server
 *
 * WebDAV server implementation using webdav-server library with Proton Drive backend.
 * Provides RFC 4918 compliant WebDAV access to Proton Drive files.
 */

import { v2 as webdav } from 'webdav-server';
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'https';
import { readFileSync } from 'fs';
import { PassThrough, Readable, Writable } from 'stream';
import { createHash } from 'crypto';
import { logger } from '../logger.js';
import { getConfig } from '../config.js';
import { driveClient, type DriveNode } from '../drive.js';

// ============================================================================
// Types
// ============================================================================

interface WebDAVServerOptions {
  host?: string;
  port?: number;
  requireAuth?: boolean;
  username?: string;
  passwordHash?: string;
  https?: boolean;
  certPath?: string;
  keyPath?: string;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// ============================================================================
// Proton Drive File System
// ============================================================================

/**
 * Custom WebDAV FileSystem that bridges to Proton Drive
 */
class ProtonDriveFileSystem extends webdav.FileSystem {
  private nodeCache: Map<string, CacheEntry<DriveNode>> = new Map();
  private listCache: Map<string, CacheEntry<DriveNode[]>> = new Map();
  private cacheTTL = 60000; // 60 seconds
  private _lockMgr: webdav.LocalLockManager;
  private _propMgr: webdav.LocalPropertyManager;

  constructor() {
    // Create a simple serializer that disables serialization
    const simpleSerializer: webdav.FileSystemSerializer = {
      uid: () => 'proton-drive-fs',
      serialize: (_fs, callback) => callback(undefined, {}),
      unserialize: (_data, callback) =>
        callback(
          new Error('Cannot unserialize ProtonDriveFileSystem'),
          undefined as unknown as webdav.FileSystem
        ),
    };
    super(simpleSerializer);
    this._lockMgr = new webdav.LocalLockManager();
    this._propMgr = new webdav.LocalPropertyManager();
    // Mark as non-serializable
    this.doNotSerialize();
  }

  // Required abstract methods
  _lockManager(
    _path: webdav.Path,
    _ctx: webdav.LockManagerInfo,
    callback: webdav.ReturnCallback<webdav.ILockManager>
  ): void {
    callback(undefined, this._lockMgr);
  }

  _propertyManager(
    _path: webdav.Path,
    _ctx: webdav.PropertyManagerInfo,
    callback: webdav.ReturnCallback<webdav.IPropertyManager>
  ): void {
    callback(undefined, this._propMgr);
  }

  // Cache helpers
  private getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.cacheTTL) {
      return entry.data;
    }
    cache.delete(key);
    return null;
  }

  private setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
    cache.set(key, { data, timestamp: Date.now() });
  }

  private invalidateCache(path: string): void {
    this.nodeCache.delete(path);
    this.listCache.delete(path);
    this.listCache.clear();

    // Invalidate parent
    const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
    this.listCache.delete(parentPath);
  }

  // Path helpers
  private normalizePath(path: webdav.Path): string {
    const pathStr = path.toString();
    return pathStr.startsWith('/') ? pathStr : '/' + pathStr;
  }

  private getParentPath(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash <= 0 ? '/' : path.substring(0, lastSlash);
  }

  private getBaseName(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    return path.substring(lastSlash + 1);
  }

  // Resolve path to DriveNode
  private async resolveNode(path: string): Promise<DriveNode | null> {
    if (path === '/' || path === '') {
      return {
        uid: driveClient.getRootFolderUid(),
        name: '',
        type: 'folder',
        size: 0,
        mimeType: 'inode/directory',
        createdTime: new Date(),
        modifiedTime: new Date(),
        parentUid: null,
      };
    }

    const cached = this.getCached(this.nodeCache, path);
    if (cached) return cached;

    const parts = path.split('/').filter((p) => p.length > 0);
    let currentUid = driveClient.getRootFolderUid();
    let currentNode: DriveNode | null = null;

    for (const part of parts) {
      const nodes = await this.listNodesInFolder(currentUid);
      currentNode = nodes.find((n) => n.name === part) || null;

      if (!currentNode) {
        return null;
      }

      currentUid = currentNode.uid;
    }

    if (currentNode) {
      this.setCache(this.nodeCache, path, currentNode);
    }

    return currentNode;
  }

  // List nodes in folder
  private async listNodesInFolder(folderUid: string): Promise<DriveNode[]> {
    const cacheKey = `list:${folderUid}`;
    const cached = this.getCached(this.listCache, cacheKey);
    if (cached) return cached;

    const nodes = await driveClient.listFolder(folderUid);
    this.setCache(this.listCache, cacheKey, nodes);
    return nodes;
  }

  // ==========================================================================
  // FileSystem Implementation
  // ==========================================================================

  _fastExistCheck(
    _ctx: webdav.RequestContext,
    path: webdav.Path,
    callback: (exists: boolean) => void
  ): void {
    const pathStr = this.normalizePath(path);

    this.resolveNode(pathStr)
      .then((node) => callback(node !== null))
      .catch(() => callback(false));
  }

  _create(path: webdav.Path, ctx: webdav.CreateInfo, callback: webdav.SimpleCallback): void {
    const pathStr = this.normalizePath(path);
    const parentPath = this.getParentPath(pathStr);
    const name = this.getBaseName(pathStr);

    this.resolveNode(parentPath)
      .then(async (parent) => {
        if (!parent || parent.type !== 'folder') {
          return callback(webdav.Errors.ResourceNotFound);
        }

        if (ctx.type.isDirectory) {
          await driveClient.createFolder(parent.uid, name);
        } else {
          // Create empty file
          await driveClient.uploadFile(parent.uid, name, new Uint8Array(0), { size: 0 });
        }

        this.invalidateCache(pathStr);
        callback();
      })
      .catch((error) => {
        logger.error(`Create failed: ${error}`);
        callback(webdav.Errors.InvalidOperation);
      });
  }

  _delete(path: webdav.Path, _ctx: webdav.DeleteInfo, callback: webdav.SimpleCallback): void {
    const pathStr = this.normalizePath(path);

    this.resolveNode(pathStr)
      .then(async (node) => {
        if (!node) {
          return callback(webdav.Errors.ResourceNotFound);
        }

        await driveClient.deleteNode(node.uid);
        this.invalidateCache(pathStr);
        callback();
      })
      .catch((error) => {
        logger.error(`Delete failed: ${error}`);
        callback(webdav.Errors.InvalidOperation);
      });
  }

  _openWriteStream(
    path: webdav.Path,
    _ctx: webdav.OpenWriteStreamInfo,
    callback: webdav.ReturnCallback<Writable>
  ): void {
    const pathStr = this.normalizePath(path);
    const parentPath = this.getParentPath(pathStr);
    const name = this.getBaseName(pathStr);

    const passThrough = new PassThrough();
    const readableStream = Readable.toWeb(passThrough) as ReadableStream;
    const estimatedSize =
      typeof _ctx.estimatedSize === 'number' && _ctx.estimatedSize >= 0
        ? _ctx.estimatedSize
        : undefined;

    let uploadError: Error | null = null;

    const uploadPromise = this.resolveNode(parentPath)
      .then(async (parent) => {
        if (!parent || parent.type !== 'folder') {
          throw new Error('Parent folder not found');
        }

        await driveClient.uploadFile(parent.uid, name, readableStream, {
          size: estimatedSize,
        });

        this.invalidateCache(pathStr);
      })
      .catch((error) => {
        uploadError = error as Error;
        passThrough.destroy(uploadError);
        logger.error(`Upload failed: ${error}`);
        throw uploadError;
      });

    const writable = new Writable({
      write(chunk: Buffer | Uint8Array, _encoding, cb) {
        passThrough.write(chunk, cb);
      },

      final: (cb) => {
        passThrough.end();
        uploadPromise.then(() => cb()).catch((error) => cb(error as Error));
      },

      destroy: (error, cb) => {
        const err = error ?? undefined;
        passThrough.destroy(err as Error | undefined);
        cb(err as Error | undefined);
      },
    });

    callback(undefined, writable);
  }

  _openReadStream(
    path: webdav.Path,
    _ctx: webdav.OpenReadStreamInfo,
    callback: webdav.ReturnCallback<Readable>
  ): void {
    const pathStr = this.normalizePath(path);

    this.resolveNode(pathStr)
      .then(async (node) => {
        if (!node || node.type !== 'file') {
          return callback(webdav.Errors.ResourceNotFound, undefined);
        }

        const data = await driveClient.downloadFile(node.uid);
        if (data instanceof ReadableStream) {
          const readable = Readable.fromWeb(data as ReadableStream);
          callback(undefined, readable);
          return;
        }

        const readable = Readable.from([data]);
        callback(undefined, readable);
      })
      .catch((error) => {
        logger.error(`Download failed: ${error}`);
        callback(webdav.Errors.InvalidOperation, undefined);
      });
  }

  _move(
    pathFrom: webdav.Path,
    pathTo: webdav.Path,
    _ctx: webdav.MoveInfo,
    callback: webdav.ReturnCallback<boolean>
  ): void {
    const fromStr = this.normalizePath(pathFrom);
    const toStr = this.normalizePath(pathTo);
    const toParentPath = this.getParentPath(toStr);
    const toName = this.getBaseName(toStr);

    Promise.all([this.resolveNode(fromStr), this.resolveNode(toParentPath)])
      .then(async ([fromNode, toParent]) => {
        if (!fromNode) {
          return callback(webdav.Errors.ResourceNotFound, false);
        }
        if (!toParent || toParent.type !== 'folder') {
          return callback(webdav.Errors.ResourceNotFound, false);
        }

        // Check if it's a rename (same parent) or move (different parent)
        const fromParentPath = this.getParentPath(fromStr);
        if (fromParentPath === toParentPath) {
          // Rename
          await driveClient.renameNode(fromNode.uid, toName);
        } else {
          // Move to different folder
          await driveClient.moveNode(fromNode.uid, toParent.uid);
          // Also rename if the name changed
          if (fromNode.name !== toName) {
            await driveClient.renameNode(fromNode.uid, toName);
          }
        }

        this.invalidateCache(fromStr);
        this.invalidateCache(toStr);
        callback(undefined, true);
      })
      .catch((error) => {
        logger.error(`Move failed: ${error}`);
        callback(webdav.Errors.InvalidOperation, false);
      });
  }

  _copy(
    _pathFrom: webdav.Path,
    _pathTo: webdav.Path,
    _ctx: webdav.CopyInfo,
    callback: webdav.ReturnCallback<boolean>
  ): void {
    // Proton Drive doesn't support copy, so we need to download and re-upload
    // For now, return not implemented
    callback(webdav.Errors.InvalidOperation, false);
  }

  _rename(
    pathFrom: webdav.Path,
    newName: string,
    _ctx: webdav.RenameInfo,
    callback: webdav.ReturnCallback<boolean>
  ): void {
    const fromStr = this.normalizePath(pathFrom);

    this.resolveNode(fromStr)
      .then(async (node) => {
        if (!node) {
          return callback(webdav.Errors.ResourceNotFound, false);
        }

        await driveClient.renameNode(node.uid, newName);
        this.invalidateCache(fromStr);
        callback(undefined, true);
      })
      .catch((error) => {
        logger.error(`Rename failed: ${error}`);
        callback(webdav.Errors.InvalidOperation, false);
      });
  }

  _size(path: webdav.Path, _ctx: webdav.SizeInfo, callback: webdav.ReturnCallback<number>): void {
    const pathStr = this.normalizePath(path);

    this.resolveNode(pathStr)
      .then((node) => {
        if (!node) {
          return callback(webdav.Errors.ResourceNotFound, 0);
        }
        callback(undefined, node.size);
      })
      .catch((error) => {
        logger.error(`Size check failed: ${error}`);
        callback(webdav.Errors.InvalidOperation, 0);
      });
  }

  _type(
    path: webdav.Path,
    _ctx: webdav.TypeInfo,
    callback: webdav.ReturnCallback<webdav.ResourceType>
  ): void {
    const pathStr = this.normalizePath(path);

    this.resolveNode(pathStr)
      .then((node) => {
        if (!node) {
          return callback(webdav.Errors.ResourceNotFound, webdav.ResourceType.NoResource);
        }
        const type =
          node.type === 'folder' ? webdav.ResourceType.Directory : webdav.ResourceType.File;
        callback(undefined, type);
      })
      .catch((error) => {
        logger.error(`Type check failed: ${error}`);
        callback(webdav.Errors.InvalidOperation, webdav.ResourceType.NoResource);
      });
  }

  _mimeType(
    path: webdav.Path,
    _ctx: webdav.MimeTypeInfo,
    callback: webdav.ReturnCallback<string>
  ): void {
    const pathStr = this.normalizePath(path);

    this.resolveNode(pathStr)
      .then((node) => {
        if (!node) {
          return callback(webdav.Errors.ResourceNotFound, '');
        }
        callback(undefined, node.mimeType || 'application/octet-stream');
      })
      .catch((error) => {
        logger.error(`MimeType check failed: ${error}`);
        callback(webdav.Errors.InvalidOperation, '');
      });
  }

  _lastModifiedDate(
    path: webdav.Path,
    _ctx: webdav.LastModifiedDateInfo,
    callback: webdav.ReturnCallback<number>
  ): void {
    const pathStr = this.normalizePath(path);

    this.resolveNode(pathStr)
      .then((node) => {
        if (!node) {
          return callback(webdav.Errors.ResourceNotFound, 0);
        }
        callback(undefined, node.modifiedTime.getTime());
      })
      .catch((error) => {
        logger.error(`Last modified check failed: ${error}`);
        callback(webdav.Errors.InvalidOperation, 0);
      });
  }

  _creationDate(
    path: webdav.Path,
    _ctx: webdav.CreationDateInfo,
    callback: webdav.ReturnCallback<number>
  ): void {
    const pathStr = this.normalizePath(path);

    this.resolveNode(pathStr)
      .then((node) => {
        if (!node) {
          return callback(webdav.Errors.ResourceNotFound, 0);
        }
        callback(undefined, node.createdTime.getTime());
      })
      .catch((error) => {
        logger.error(`Creation date check failed: ${error}`);
        callback(webdav.Errors.InvalidOperation, 0);
      });
  }

  _readDir(
    path: webdav.Path,
    _ctx: webdav.ReadDirInfo,
    callback: webdav.ReturnCallback<string[] | webdav.Path[]>
  ): void {
    const pathStr = this.normalizePath(path);

    this.resolveNode(pathStr)
      .then(async (node) => {
        if (!node || node.type !== 'folder') {
          return callback(webdav.Errors.ResourceNotFound, []);
        }

        const children = await this.listNodesInFolder(node.uid);
        const names = children.map((c) => c.name);
        callback(undefined, names);
      })
      .catch((error) => {
        logger.error(`ReadDir failed: ${error}`);
        callback(webdav.Errors.InvalidOperation, []);
      });
  }
}

// ============================================================================
// WebDAV Server Wrapper
// ============================================================================

let serverInstance: WebDAVServer | null = null;

export function getWebDAVServer(): WebDAVServer | null {
  return serverInstance;
}

export class WebDAVServer {
  private server: webdav.WebDAVServer;
  private httpServer: HttpServer | HttpsServer | null = null;
  private options: Required<WebDAVServerOptions>;

  constructor(options: WebDAVServerOptions = {}) {
    const config = getConfig();

    this.options = {
      host: options.host ?? config.webdav.host,
      port: options.port ?? config.webdav.port,
      requireAuth: options.requireAuth ?? config.webdav.requireAuth,
      username: options.username ?? config.webdav.username ?? 'proton',
      passwordHash: options.passwordHash ?? config.webdav.passwordHash ?? '',
      https: options.https ?? config.webdav.https,
      certPath: options.certPath ?? config.webdav.certPath ?? '',
      keyPath: options.keyPath ?? config.webdav.keyPath ?? '',
    };

    // Create WebDAV server options
    const serverOptions: webdav.WebDAVServerOptions = {};
    let privilegeManager: webdav.SimplePathPrivilegeManager | null = null;

    // Add authentication if required
    if (this.options.requireAuth) {
      const userManager = new SimpleUserManager(this.options.username, this.options.passwordHash);
      serverOptions.httpAuthentication = new webdav.HTTPBasicAuthentication(userManager);
      privilegeManager = new webdav.SimplePathPrivilegeManager();
      privilegeManager.setRights(
        {
          username: this.options.username,
          uid: this.options.username,
          isAdministrator: true,
          isDefaultUser: false,
        },
        '/',
        ['all']
      );
      serverOptions.privilegeManager = privilegeManager;
    }

    this.server = new webdav.WebDAVServer(serverOptions);
    serverInstance = this;
  }

  async start(): Promise<void> {
    // Initialize drive client first
    await driveClient.initialize();

    // Mount Proton Drive filesystem
    const fs = new ProtonDriveFileSystem();
    await new Promise<void>((resolve, reject) => {
      this.server.setFileSystem('/', fs, (success) => {
        if (success) {
          resolve();
        } else {
          reject(new Error('Failed to mount filesystem'));
        }
      });
    });

    // Create HTTP(S) server
    const requestHandler = (req: IncomingMessage, res: ServerResponse) => {
      this.server.executeRequest(req, res);
    };

    if (this.options.https && this.options.certPath && this.options.keyPath) {
      this.httpServer = createHttpsServer(
        {
          cert: readFileSync(this.options.certPath),
          key: readFileSync(this.options.keyPath),
        },
        requestHandler
      );
    } else {
      this.httpServer = createServer(requestHandler);
    }

    // Start listening
    await new Promise<void>((resolve) => {
      this.httpServer!.listen(this.options.port, this.options.host, () => {
        logger.info(`WebDAV server started on ${this.getUrl()}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => {
          logger.info('WebDAV server stopped');
          resolve();
        });
      });
      this.httpServer = null;
    }
    serverInstance = null;
  }

  getUrl(): string {
    const protocol = this.options.https ? 'https' : 'http';
    return `${protocol}://${this.options.host}:${this.options.port}`;
  }
}

// ============================================================================
// Simple User Manager for Basic Auth
// ============================================================================

class SimpleUserManager implements webdav.IUserManager {
  private username: string;
  private passwordHash: string;

  constructor(username: string, passwordHash: string) {
    this.username = username;
    this.passwordHash = passwordHash;
  }

  getDefaultUser(callback: (user: webdav.IUser) => void): void {
    callback({
      username: 'anonymous',
      uid: 'anonymous',
      isAdministrator: false,
      isDefaultUser: true,
    });
  }

  getUserByNamePassword(
    username: string,
    password: string,
    callback: (error: Error, user?: webdav.IUser) => void
  ): void {
    if (username !== this.username) {
      callback(new Error('Invalid username'));
      return;
    }

    // Hash the provided password and compare
    const hash = createHash('sha256').update(password).digest('hex');

    if (hash !== this.passwordHash) {
      callback(new Error('Invalid password'));
      return;
    }

    callback(undefined as unknown as Error, {
      username: this.username,
      uid: this.username,
      isAdministrator: true,
      isDefaultUser: false,
    });
  }
}

export default WebDAVServer;
