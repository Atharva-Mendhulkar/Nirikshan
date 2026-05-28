import { Buffer } from 'buffer';
import { EMBEDDING_DIMENSIONS } from './embedding';

export function serializeEmbedding(embedding: number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSIONS} values, received ${embedding.length}`,
    );
  }
  const floats = new Float32Array(embedding);
  return Buffer.from(floats.buffer).toString('base64');
}

export function deserializeEmbedding(serialized: string): number[] {
  const buffer = Buffer.from(serialized, 'base64');
  const view = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return Array.from(view);
}
