import type { EnrolledUser } from './types';

export const EMBEDDING_DIMENSIONS = 128;

export function normalizeEmbedding(values: ArrayLike<number>): number[] {
  let norm = 0;
  for (let index = 0; index < values.length; index += 1) {
    norm += values[index] * values[index];
  }
  const denominator = Math.sqrt(norm) || 1;
  const normalized = new Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    normalized[index] = values[index] / denominator;
  }
  return normalized;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a.length !== b.length) {
    throw new Error(`Embedding length mismatch: ${a.length} != ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

export function findBestMatch(
  queryEmbedding: number[],
  users: EnrolledUser[],
  threshold: number,
) {
  let bestUser: EnrolledUser | null = null;
  let bestSimilarity = -1;

  for (const user of users) {
    for (const enrolledEmbedding of user.embeddings) {
      const similarity = cosineSimilarity(queryEmbedding, enrolledEmbedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestUser = user;
      }
    }
  }

  return {
    accepted: bestSimilarity >= threshold,
    similarity: bestSimilarity,
    user: bestUser,
  };
}

export function createDemoEmbedding(seed: string): number[] {
  const values = new Array(EMBEDDING_DIMENSIONS);
  let state = hashSeed(seed);
  for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
    state = lcg(state);
    values[index] = state / 4294967295 - 0.5;
  }
  return normalizeEmbedding(values);
}

export function jitterEmbedding(embedding: number[], amount: number): number[] {
  const values = embedding.map((value, index) => {
    const wobble = Math.sin(index * 12.9898 + 78.233) * amount;
    return value + wobble;
  });
  return normalizeEmbedding(values);
}

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash + seed.charCodeAt(index)) % 4294967296;
    hash = (hash * 16777619) % 4294967296;
  }
  return hash;
}

function lcg(state: number) {
  return (1664525 * state + 1013904223) % 4294967296;
}
