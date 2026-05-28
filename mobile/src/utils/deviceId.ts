import type { NirikshanRepository } from '../storage/repository';
import { createId } from './id';

const DEVICE_ID_KEY = 'device_id';

export async function getDeviceId(repository: Pick<NirikshanRepository, 'getState' | 'setState'>) {
  const existing = await repository.getState(DEVICE_ID_KEY);
  if (existing != null) {
    return existing;
  }

  const deviceId = createId('dev');
  await repository.setState(DEVICE_ID_KEY, deviceId);
  return deviceId;
}
