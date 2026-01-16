import { Database } from 'bun:sqlite';
import { join } from 'path';
import { getDataDir } from '../paths.js';
import { logger } from '../logger.js';

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
  private db: Database;
  private static instance: MetadataManager | null = null;

  private constructor() {
    const dbPath = join(getDataDir(), 'locks.db'); // reuse same DB for now
    this.db = new Database(dbPath);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS metadata (
        node_uid TEXT PRIMARY KEY,
        props TEXT,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_metadata_updated_at ON metadata(updated_at)`);

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
      .query<MetaRow, [string]>('SELECT * FROM metadata WHERE node_uid = ?')
      .get(nodeUid);
    if (!row) return null;
    return { props: row.props ? JSON.parse(row.props) : undefined };
  }

  save(nodeUid: string, meta: MetaStorage): void {
    const now = Date.now();
    const propsJson = meta.props ? JSON.stringify(meta.props) : null;

    const existing = this.db
      .query<MetaRow, [string]>('SELECT * FROM metadata WHERE node_uid = ?')
      .get(nodeUid);
    if (existing) {
      this.db.run(
        'UPDATE metadata SET props = ?, updated_at = ?, version = version + 1 WHERE node_uid = ?',
        [propsJson, now, nodeUid]
      );
    } else {
      this.db.run(
        'INSERT INTO metadata (node_uid, props, updated_at, version) VALUES (?, ?, ?, 1)',
        [nodeUid, propsJson, now]
      );
    }
  }

  delete(nodeUid: string): void {
    this.db.run('DELETE FROM metadata WHERE node_uid = ?', [nodeUid]);
  }

  close(): void {
    this.db.close();
    MetadataManager.instance = null;
  }
}

export default MetadataManager;
