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

    // Add authentication middleware if required
    if (this.options.requireAuth) {
      this.app.use(createAuthMiddleware(this.options.username, this.options.passwordHash));
    }

    // Create a single adapter instance to preserve caching across requests
    const sharedAdapter = new ProtonDriveAdapter();

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

    // Error handler to surface WebDAV failures during tests and runtime
    this.app.use(
      (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const status =
          typeof (err as { statusCode?: number }).statusCode === 'number'
            ? (err as { statusCode: number }).statusCode
            : 500;
        const message = err instanceof Error ? err.message : 'Internal Server Error';
        logger.error(`WebDAV request failed: ${message}`);

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
