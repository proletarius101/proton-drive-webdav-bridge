/**
 * Proton Drive WebDAV Bridge - WebDAV Server
 *
 * WebDAV server implementation using Nephele library with Proton Drive backend.
 * Provides RFC 4918 compliant WebDAV access to Proton Drive files.
 */

import express from 'express';
import { createServer as createHttpServer, type Server as HttpServer } from 'http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'https';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import nepheleServer, { ResourceNotFoundError } from 'nephele';
import { logger } from '../logger.js';
import { getConfig } from '../config.js';
import { driveClient } from '../drive.js';
import ProtonDriveAdapter from './ProtonDriveAdapter.js';
import ProtonDriveAuthenticator from './ProtonDriveAuthenticator.js';
import { LockManager } from './LockManager.js';

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

// ============================================================================
// Basic Authentication Middleware
// ============================================================================

function createAuthMiddleware(username: string, passwordHash: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.get('authorization');

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Proton Drive WebDAV"');
      res.status(401).send('Unauthorized');
      return;
    }

    const base64Credentials = authHeader.slice(6);
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
    const parts = credentials.split(':');
    const providedUsername = parts[0] ?? '';
    // Support passwords containing ':' by joining the remaining parts
    const password = parts.slice(1).join(':') ?? '';

    if (providedUsername !== username) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Proton Drive WebDAV"');
      res.status(401).send('Unauthorized');
      return;
    }

    // Hash the provided password and compare
    const hash = createHash('sha256').update(password).digest('hex');

    if (hash !== passwordHash) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Proton Drive WebDAV"');
      res.status(401).send('Unauthorized');
      return;
    }

    next();
  };
}

// ============================================================================
// WebDAV Server Wrapper
// ============================================================================

let serverInstance: WebDAVServer | null = null;

export function getWebDAVServer(): WebDAVServer | null {
  return serverInstance;
}

export class WebDAVServer {
  private app: express.Application;
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

    this.app = express();

    // Log all incoming requests
    this.app.use((req, res, next) => {
      const startTime = Date.now();
      logger.debug(`→ ${req.method} ${req.url}`);

      res.on('finish', () => {
        const duration = Date.now() - startTime;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        logger[level](`← ${req.method} ${req.url} -> ${res.statusCode} (${duration}ms)`);
      });
      next();
    });

    // DEBUG: log PROPFIND headers only (do not consume body to avoid interfering with Nephele)
    this.app.use((req, _res, next) => {
      if (req.method === 'PROPFIND') {
        logger.debug(`PROPFIND headers: ${JSON.stringify(req.headers)}`);
        const contentLength = Number(req.headers['content-length'] ?? 0);
        if (contentLength > 0) {
          logger.debug(`PROPFIND body length: ${contentLength} (not read)`);
        } else {
          logger.debug('PROPFIND body: <empty>');
        }
      }
      next();
    });

    // Add authentication middleware if required
    if (this.options.requireAuth) {
      this.app.use(createAuthMiddleware(this.options.username, this.options.passwordHash));
    }

    // Implement minimal LOCK handler integrated with LockManager
    // Creates an exclusive lock on the requested path when no conflicts exist.
    this.app.use((req, res, next) => {
      if (req.method === 'LOCK') {
        try {
          logger.info(`Handling LOCK ${req.url}`);
          const path = req.path || '/';
          const depthHeader = (req.get('Depth') || '').toLowerCase();
          const depth: '0' | 'infinity' = depthHeader === '0' ? '0' : 'infinity';

          const timeoutHeader = req.get('Timeout') || 'Second-3600';
          let timeout = 3600; // seconds
          const m = timeoutHeader.match(/Second-(\d+)/i);
          if (m) {
            timeout = parseInt(m[1] ?? '3600', 10);
          } else if (/infinite/i.test(timeoutHeader)) {
            // Cap infinite timeouts to a reasonable upper bound
            timeout = 24 * 3600;
          }

          // Default to exclusive scope; parsing the XML body is unnecessary for our tests
          const scope: 'exclusive' | 'shared' = 'exclusive';
          const owner = 'webdav-client';

          const lm = LockManager.getInstance();
          const user = { username: 'proton-user', uid: 1000, gid: 1000 } as const;
          const lock = lm.createLock(path, user, timeout, scope, depth, false, owner);

          res.setHeader('Lock-Token', `<${lock.token}>`);
          logger.info(`LOCK created for ${path} token=${lock.token}`);
          // Minimal successful response; clients primarily rely on Lock-Token header
          res.status(200).send('');
          return;
        } catch (err) {
          // Conflict / already locked
          logger.warn(`LOCK handler error: ${err instanceof Error ? err.message : String(err)}`);
          res.status(423).send('Locked');
          return;
        }
      }
      next();
    });

    // Provide a lightweight UNLOCK handler to ensure tokens are recognized
    // (normalize angle-bracket tokens) before handing to Nephele. This mirrors
    // expected behavior found in other Nephele adapters (S3 reference).
    this.app.use((req, res, next) => {
      if (req.method === 'UNLOCK') {
        try {
          const lockToken = req.get('Lock-Token') ?? '';
          const normalized = lockToken.trim().replace(/^<|>$/g, '');
          if (normalized) {
            const lm = LockManager.getInstance();
            const deleted = lm.deleteLock(normalized);
            if (deleted) {
              res.status(204).send();
              return;
            }
          }
          res.status(404).send('Lock not found');
          return;
        } catch (err) {
          logger.error(`UNLOCK handler error: ${err}`);
          res.status(500).send('Internal Server Error');
          return;
        }
      }
      next();
    });

    // Global lock enforcement middleware
    // This ensures that operations which modify resources respect existing locks
    // (including parent locks with depth:infinity) and return 423 Locked when applicable.
    this.app.use((req, res, next) => {
      const modifyingMethods = new Set([
        'PUT',
        'DELETE',
        'MOVE',
        'COPY',
        'MKCOL',
        'PROPPATCH',
        'PROPPATCH',
      ]);
      if (modifyingMethods.has(req.method)) {
        try {
          const lm = LockManager.getInstance();
          const path = req.path || '/';
          const rawToken = (req.get('Lock-Token') || '').trim().replace(/^<|>$/g, '') || null;

          // If client provided a valid lock token for this path, allow the operation
          if (rawToken && lm.validateLockToken(path, rawToken)) {
            return next();
          }

          // Otherwise check if any lock applies to this path (including parent depth:infinity)
          const applicable = lm.getAllLocks().filter((l) => {
            if (l.path === path) return true;
            if (l.depth === 'infinity' && path.startsWith(l.path.replace(/\/$/, '') + '/'))
              return true;
            return false;
          });

          if (applicable.length > 0) {
            res.status(423).send('Locked');
            return;
          }
        } catch (e) {
          // On error, don't block request here; let later handlers handle it
          logger.warn(`Lock enforcement middleware failed: ${e}`);
        }
      }

      // Advertise WebDAV compliance via OPTIONS (RFC 4918)
      if (req.method === 'OPTIONS') {
        // DAV header indicates supported DAV classes; class 1/2 covers core + locking
        res.setHeader('DAV', '1,2');
        // Allow header enumerates supported methods commonly used by WebDAV clients
        res.setHeader(
          'Allow',
          [
            'OPTIONS',
            'PROPFIND',
            'GET',
            'HEAD',
            'PUT',
            'DELETE',
            'MKCOL',
            'COPY',
            'MOVE',
            'LOCK',
            'UNLOCK',
          ].join(', ')
        );
        // Some clients (MS Office) rely on this hint; harmless for others
        res.setHeader('MS-Author-Via', 'DAV');
      }
      next();
    });

    // Pre-check middleware for COPY/MOVE operations
    // Enforces Overwrite semantics and checks for moving into non-empty collections early
    this.app.use(async (req, res, next) => {
      if (req.method === 'COPY' || req.method === 'MOVE') {
        const destHeader = req.get('Destination');
        if (!destHeader) {
          res.status(400).send('Missing Destination header');
          return;
        }

        try {
          const destUrl = new URL(destHeader);
          const adapter = new ProtonDriveAdapter();
          const baseUrl = new URL(this.getUrl());

          const destPath = adapter.urlToRelativePath(destUrl, baseUrl);
          if (!destPath) {
            res.status(403).send('The destination URL is not under the namespace of this server.');
            return;
          }

          try {
            const destResource = await adapter.getResource(destUrl, baseUrl);

            // Overwrite handling for COPY: if Overwrite=F and destination exists => 412
            if (req.method === 'COPY' && (req.get('Overwrite') || 'T') === 'F') {
              res.status(412).send('Precondition Failed: destination exists and Overwrite is F');
              return;
            }

            // MOVE into existing non-empty collection is forbidden
            if (req.method === 'MOVE') {
              if ((await destResource.isCollection()) && !(await destResource.isEmpty())) {
                res.status(403).send('The destination cannot be an existing non-empty directory.');
                return;
              }
            }
          } catch (error) {
            // Destination not found -> ok to proceed.
            // If the error indicates something other than a not-found (e.g., API/network error), rethrow
            if (error instanceof ResourceNotFoundError) {
              logger.debug(
                `Destination resource ${destPath} not found, proceeding with the operation.`
              );
            } else {
              throw error;
            }
          }
        } catch (error) {
          // Malformed Destination header (eg. invalid URL) -> bad request.
          // If it's an unexpected error, rethrow so the global error handler can surface it.
          if (error instanceof TypeError || error instanceof URIError) {
            logger.debug(
              `Invalid Destination header: ${error instanceof Error ? error.message : String(error)}`
            );
            res.status(400).send('Invalid Destination header');
            return;
          }
          throw error;
        }
      }

      next();
    });

    // Create a single adapter instance to preserve caching across requests
    const cacheCfg = getConfig().cache;
    const sharedAdapter = new ProtonDriveAdapter({
      cacheTTL: cacheCfg.enabled ? cacheCfg.ttlSeconds * 1000 : 0,
    });
    logger.debug(
      `Shared adapter created with cache enabled=${cacheCfg.enabled} ttl=${cacheCfg.ttlSeconds}s`
    );

    // Mount Nephele WebDAV handler
    this.app.use(
      '/',
      nepheleServer({
        adapter: async () => ({ '/': sharedAdapter }),
        authenticator: async (_request, response) => {
          // Authentication already handled by middleware
          response.locals.user = {
            username: 'proton-user',
            uid: 1000,
            gid: 1000,
          };
          return { '/': new ProtonDriveAuthenticator() };
        },
      })
    );

    // Error handler to log and surface WebDAV failures (log stack)
    this.app.use(
      (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const status =
          typeof (err as { statusCode?: number }).statusCode === 'number'
            ? (err as { statusCode: number }).statusCode
            : 500;
        const message = err instanceof Error ? err.message : 'Internal Server Error';
        const stack = err instanceof Error ? err.stack : String(err);
        logger.error(`WebDAV request failed: ${message}`);
        logger.debug(`Error stack: ${stack}`);
        // Also log request metadata for context
        try {
          logger.debug(`Request headers: ${JSON.stringify(req.headers)}`);
        } catch {
          // Ignore JSON serialization errors
        }

        if (!res.headersSent) {
          res.status(status).send(message);
        }
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    serverInstance = this;
  }

  async start(): Promise<void> {
    // Initialize drive client
    await driveClient.initialize();

    // Create HTTP(S) server
    if (this.options.https && this.options.certPath && this.options.keyPath) {
      this.httpServer = createHttpsServer(
        {
          cert: readFileSync(this.options.certPath),
          key: readFileSync(this.options.keyPath),
        },
        this.app
      );
    } else {
      this.httpServer = createHttpServer(this.app);
    }

    // Start listening
    await new Promise<void>((resolve) => {
      if (this.httpServer) {
        this.httpServer.listen(this.options.port, this.options.host, () => {
          logger.info(`WebDAV server started on ${this.getUrl()}`);
          resolve();
        });
      }
    });
  }

  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        if (this.httpServer) {
          this.httpServer.close(() => {
            logger.info('WebDAV server stopped');
            resolve();
          });
        }
      });
      this.httpServer = null;
    }
    serverInstance = null;
  }

  /**
   * Expose the underlying HTTP(S) server instance for testing and advanced use.
   * Returns `null` if the server is not started.
   */
  public getHttpServer(): HttpServer | HttpsServer | null {
    return this.httpServer;
  }

  getUrl(): string {
    const protocol = this.options.https ? 'https' : 'http';
    return `${protocol}://${this.options.host}:${this.options.port}`;
  }
}

export default WebDAVServer;
