import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { logger } from '../logger.js';
import { getDataDir } from '../paths.js';

export interface MetaStorage {
  props?: { [k: string]: unknown };
  // future: locks could be stored here if switching from SQLite locks
}

interface MetaRow {
  node_uid: string;
  props: string | null;
  updated_at: number;
  version: number;
}

export class MetadataManager {
  private db: InstanceType<typeof Database>;
  private static instance: MetadataManager | null = null;

  private constructor() {
    // Allow overriding the locks DB path via environment variable so tests
    // (or CI) can isolate the DB per-run. If not provided, fall back to the
    // platform-specific data directory.
    const envPath = process.env.METADATA_DB_PATH;
    const dbPath = envPath ? envPath : join(getDataDir(), 'metadata.db');

    // Creates the parent directory if it doesn't exist
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
    } catch (error) {
      // Directory might already exist, which is fine
      logger.debug(`Directory creation for ${dbPath}: ${error}`);
    }

    this.db = new Database(dbPath);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        node_uid TEXT PRIMARY KEY,
        props TEXT,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_metadata_updated_at ON metadata(updated_at);
    `);

    logger.info(`Metadata DB initialized at ${dbPath}`);
  }

  static getInstance(): MetadataManager {
    if (!MetadataManager.instance) {
      MetadataManager.instance = new MetadataManager();
    }
    return MetadataManager.instance;
  }

  get(nodeUid: string): MetaStorage | null {
    const row = this.db
      .prepare<[string], MetaRow>('SELECT * FROM metadata WHERE node_uid = ?')
      .get(nodeUid);
    if (!row) return null;
    return { props: row.props ? JSON.parse(row.props) : undefined };
  }

  save(nodeUid: string, meta: MetaStorage): void {
    const now = Date.now();
    const propsJson = meta.props ? JSON.stringify(meta.props) : null;

    const existing = this.db
      .prepare<[string], MetaRow>('SELECT * FROM metadata WHERE node_uid = ?')
      .get(nodeUid);
    if (existing) {
      this.db
        .prepare(
          'UPDATE metadata SET props = ?, updated_at = ?, version = version + 1 WHERE node_uid = ?'
        )
        .run(propsJson, now, nodeUid);
    } else {
      this.db
        .prepare('INSERT INTO metadata (node_uid, props, updated_at, version) VALUES (?, ?, ?, 1)')
        .run(nodeUid, propsJson, now);
    }
  }

  delete(nodeUid: string): void {
    this.db.prepare('DELETE FROM metadata WHERE node_uid = ?').run(nodeUid);
  }

  close(): void {
    this.db.close();
    MetadataManager.instance = null;
  }
}

export default MetadataManager;
