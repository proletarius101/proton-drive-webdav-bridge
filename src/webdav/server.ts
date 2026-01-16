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
import nepheleServer from 'nephele';
import { logger } from '../logger.js';
import { getConfig } from '../config.js';
import { driveClient } from '../drive.js';
import ProtonDriveAdapter from './ProtonDriveAdapter.js';
import ProtonDriveAuthenticator from './ProtonDriveAuthenticator.js';

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
    const [providedUsername, password] = credentials.split(':');

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

    // Advertise WebDAV compliance via OPTIONS (RFC 4918)
    this.app.use((req, res, next) => {
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

    // Mount Nephele WebDAV handler
    this.app.use(
      '/',
      nepheleServer({
        adapter: async () => ({ '/': new ProtonDriveAdapter() }),
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

  getUrl(): string {
    const protocol = this.options.https ? 'https' : 'http';
    return `${protocol}://${this.options.host}:${this.options.port}`;
  }
}

export default WebDAVServer;
