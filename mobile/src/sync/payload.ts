import type { PendingSyncEvent } from '../ml/types';

export type SyncPayload = {
  events: Array<{
    event_id: string;
    device_id: string;
    user_id: string | null;
    user_name: string | null;
    result: string;
    confidence: number | null;
    liveness_score: number | null;
    latency_ms: number | null;
    timestamp: number;
  }>;
};

export function buildSyncPayload(events: PendingSyncEvent[]): SyncPayload {
  return {
    events: events.map(event => ({
      event_id: event.id,
      device_id: event.deviceId,
      user_id: event.userId,
      user_name: event.userName,
      result: event.result,
      confidence: event.confidence,
      liveness_score: event.livenessScore,
      latency_ms: event.latencyMs,
      timestamp: event.timestamp,
    })),
  };
}
