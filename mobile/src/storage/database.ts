import { open, type DB } from '@op-engineering/op-sqlite';

let db: DB | null = null;

export function getDatabase() {
  if (db == null) {
    db = open({ name: 'nirikshan.sqlite' });
    db.executeSync('PRAGMA journal_mode=WAL');
    db.executeSync('PRAGMA foreign_keys=ON');
  }
  return db;
}

export function migrateDatabase(database: DB) {
  database.executeSync(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      device_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    )
  `);

  database.executeSync(`
    CREATE TABLE IF NOT EXISTS face_embeddings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  database.executeSync(`
    CREATE TABLE IF NOT EXISTS auth_events (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      result TEXT NOT NULL,
      confidence REAL,
      liveness_score REAL,
      latency_ms INTEGER,
      timestamp INTEGER NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      sync_attempts INTEGER NOT NULL DEFAULT 0,
      last_sync_error TEXT
    )
  `);

  database.executeSync(`
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  database.executeSync(
    'CREATE INDEX IF NOT EXISTS idx_face_embeddings_user ON face_embeddings(user_id)',
  );
  database.executeSync(
    'CREATE INDEX IF NOT EXISTS idx_auth_events_synced ON auth_events(synced, timestamp)',
  );
}
