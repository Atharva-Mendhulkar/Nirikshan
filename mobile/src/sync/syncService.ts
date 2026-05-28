import NetInfo from '@react-native-community/netinfo';
import { SYNC_API_BASE_URL } from '../config/runtime';
import type { NirikshanRepository } from '../storage/repository';
import { buildSyncPayload } from './payload';

export async function syncPendingEvents(repository: NirikshanRepository) {
  const network = await NetInfo.fetch();
  if (!network.isConnected) {
    return { synced: 0, message: 'Offline: events remain queued' };
  }

  if (SYNC_API_BASE_URL.length === 0) {
    return { synced: 0, message: 'Sync endpoint not configured' };
  }

  const events = await repository.getPendingEvents();
  if (events.length === 0) {
    return { synced: 0, message: 'No pending events' };
  }

  const response = await fetch(`${SYNC_API_BASE_URL}/sync/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildSyncPayload(events)),
  });

  if (!response.ok) {
    const message = await response.text();
    await repository.markEventsSyncFailed(
      events.map(event => event.id),
      message,
    );
    throw new Error(message || `HTTP ${response.status}`);
  }

  await repository.markEventsSynced(events.map(event => event.id));
  return { synced: events.length, message: `Synced ${events.length} events` };
}

export { buildSyncPayload };
