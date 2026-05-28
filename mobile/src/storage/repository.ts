import type { QueryResult, Scalar } from '@op-engineering/op-sqlite';
import type {
  EnrolledUser,
  PendingSyncEvent,
  RecentAuthEvent,
} from '../ml/types';
import { createId } from '../utils/id';
import { getDeviceId } from '../utils/deviceId';
import { decryptEmbedding, encryptEmbedding } from './crypto';
import { getDatabase, migrateDatabase } from './database';

type InsertAuthEventInput = Omit<RecentAuthEvent, 'synced'>;

export class NirikshanRepository {
  async initialize() {
    migrateDatabase(getDatabase());
    await getDeviceId(this);
  }

  async getState(key: string) {
    const result = await getDatabase().execute(
      'SELECT value FROM sync_state WHERE key = ?',
      [key],
    );
    return rowString(result, 'value');
  }

  async setState(key: string, value: string) {
    await getDatabase().execute(
      'INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)',
      [key, value],
    );
  }

  async createUserWithEmbeddings(name: string, embeddings: number[][]) {
    const user = {
      id: createId('usr'),
      name,
      deviceId: await getDeviceId(this),
      createdAt: Date.now(),
    };

    await getDatabase().execute(
      'INSERT INTO users (id, name, device_id, created_at, synced) VALUES (?, ?, ?, ?, 0)',
      [user.id, user.name, user.deviceId, user.createdAt],
    );

    for (const embedding of embeddings) {
      const encrypted = await encryptEmbedding(embedding);
      await getDatabase().execute(
        `INSERT INTO face_embeddings
          (id, user_id, ciphertext, iv, tag, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          createId('emb'),
          user.id,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.tag,
          Date.now(),
        ],
      );
    }

    return user;
  }

  async loadEnrolledUsers(): Promise<EnrolledUser[]> {
    const usersResult = await getDatabase().execute(
      'SELECT id, name, device_id, created_at FROM users ORDER BY created_at DESC',
    );
    const users: EnrolledUser[] = [];

    for (const row of usersResult.rows) {
      const userId = String(row.id);
      const embeddingsResult = await getDatabase().execute(
        'SELECT ciphertext, iv, tag FROM face_embeddings WHERE user_id = ? ORDER BY created_at ASC',
        [userId],
      );
      const embeddings = [];
      for (const embeddingRow of embeddingsResult.rows) {
        embeddings.push(
          await decryptEmbedding({
            ciphertext: String(embeddingRow.ciphertext),
            iv: String(embeddingRow.iv),
            tag: String(embeddingRow.tag),
          }),
        );
      }

      users.push({
        id: userId,
        name: String(row.name),
        deviceId: String(row.device_id),
        createdAt: Number(row.created_at),
        embeddings,
      });
    }

    return users;
  }

  async insertAuthEvent(input: InsertAuthEventInput) {
    const deviceId = await getDeviceId(this);
    await getDatabase().execute(
      `INSERT INTO auth_events
        (id, device_id, user_id, user_name, result, confidence, liveness_score, latency_ms, timestamp, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        input.id,
        deviceId,
        input.userId,
        input.userName,
        input.result,
        input.confidence,
        input.livenessScore,
        input.latencyMs,
        input.timestamp,
      ],
    );
  }

  async listRecentEvents(limit: number): Promise<RecentAuthEvent[]> {
    const result = await getDatabase().execute(
      `SELECT id, user_id, user_name, result, confidence, liveness_score,
              latency_ms, timestamp, synced
         FROM auth_events
        ORDER BY timestamp DESC
        LIMIT ?`,
      [limit],
    );
    return result.rows.map(rowToRecentEvent);
  }

  async getPendingEvents(): Promise<PendingSyncEvent[]> {
    const result = await getDatabase().execute(
      `SELECT id, device_id, user_id, user_name, result, confidence,
              liveness_score, latency_ms, timestamp, synced
         FROM auth_events
        WHERE synced = 0
        ORDER BY timestamp ASC
        LIMIT 100`,
    );
    return result.rows.map(row => ({
      ...rowToRecentEvent({ ...row, synced: 0 }),
      deviceId: String(row.device_id),
    }));
  }

  async countPendingEvents() {
    const result = await getDatabase().execute(
      'SELECT COUNT(*) AS count FROM auth_events WHERE synced = 0',
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async markEventsSynced(ids: string[]) {
    for (const id of ids) {
      await getDatabase().execute(
        'UPDATE auth_events SET synced = 1, last_sync_error = NULL WHERE id = ?',
        [id],
      );
    }
  }

  async markEventsSyncFailed(ids: string[], error: string) {
    for (const id of ids) {
      await getDatabase().execute(
        `UPDATE auth_events
            SET sync_attempts = sync_attempts + 1,
                last_sync_error = ?
          WHERE id = ?`,
        [error, id],
      );
    }
  }
}

function rowToRecentEvent(row: Record<string, Scalar>): RecentAuthEvent {
  return {
    id: String(row.id),
    result: String(row.result) as RecentAuthEvent['result'],
    userId: row.user_id == null ? null : String(row.user_id),
    userName: row.user_name == null ? null : String(row.user_name),
    confidence: nullableNumber(row.confidence),
    livenessScore: nullableNumber(row.liveness_score),
    latencyMs: nullableNumber(row.latency_ms),
    timestamp: Number(row.timestamp),
    synced: Number(row.synced) === 1,
  };
}

function rowString(result: QueryResult, field: string) {
  const value = result.rows[0]?.[field];
  return value == null ? null : String(value);
}

function nullableNumber(value: Scalar | undefined) {
  return value == null ? null : Number(value);
}
