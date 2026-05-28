import {
  cosineSimilarity,
  createDemoEmbedding,
  findBestMatch,
  jitterEmbedding,
} from '../src/ml/embedding';
import type { EnrolledUser } from '../src/ml/types';

test('cosine similarity returns one for identical embeddings', () => {
  const embedding = createDemoEmbedding('atharva');
  expect(cosineSimilarity(embedding, embedding)).toBeCloseTo(1, 5);
});

test('matcher accepts nearest enrolled embedding above threshold', () => {
  const userEmbedding = createDemoEmbedding('user-one');
  const users: EnrolledUser[] = [
    {
      id: 'usr_1',
      name: 'User One',
      deviceId: 'dev_1',
      createdAt: 1,
      embeddings: [userEmbedding],
    },
  ];

  const result = findBestMatch(jitterEmbedding(userEmbedding, 0.005), users, 0.75);
  expect(result.accepted).toBe(true);
  expect(result.user?.id).toBe('usr_1');
});

test('matcher rejects unrelated embeddings', () => {
  const users: EnrolledUser[] = [
    {
      id: 'usr_1',
      name: 'User One',
      deviceId: 'dev_1',
      createdAt: 1,
      embeddings: [createDemoEmbedding('user-one')],
    },
  ];

  const result = findBestMatch(createDemoEmbedding('different-person'), users, 0.75);
  expect(result.accepted).toBe(false);
});
