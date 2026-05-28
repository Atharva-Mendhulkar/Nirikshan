import { Buffer } from '@craftzdog/react-native-buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'react-native-quick-crypto';
import * as Keychain from 'react-native-keychain';
import { deserializeEmbedding, serializeEmbedding } from '../ml/serialization';

const KEYCHAIN_SERVICE = 'nirikshan.biometric-key.v1';
const KEYCHAIN_USER = 'embedding-aes-key';

export type EncryptedEmbedding = {
  ciphertext: string;
  iv: string;
  tag: string;
};

export async function encryptEmbedding(
  embedding: number[],
): Promise<EncryptedEmbedding> {
  const key = await getOrCreateBiometricKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(serializeEmbedding(embedding), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export async function decryptEmbedding(
  encrypted: EncryptedEmbedding,
): Promise<number[]> {
  const key = await getOrCreateBiometricKey();
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(encrypted.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return deserializeEmbedding(decrypted.toString('utf8'));
}

async function getOrCreateBiometricKey(): Promise<Buffer> {
  const existing = await Keychain.getGenericPassword({
    service: KEYCHAIN_SERVICE,
  });

  if (existing) {
    return Buffer.from(existing.password, 'base64');
  }

  const key = randomBytes(32);
  await Keychain.setGenericPassword(KEYCHAIN_USER, key.toString('base64'), {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}
