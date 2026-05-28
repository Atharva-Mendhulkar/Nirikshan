import { randomBytes } from 'react-native-quick-crypto';

export function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}
