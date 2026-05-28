import { createDemoEmbedding } from '../src/ml/embedding';
import {
  deserializeEmbedding,
  serializeEmbedding,
} from '../src/ml/serialization';

test('embedding serialization roundtrips float32 values', () => {
  const embedding = createDemoEmbedding('roundtrip');
  const restored = deserializeEmbedding(serializeEmbedding(embedding));

  expect(restored).toHaveLength(embedding.length);
  for (let index = 0; index < embedding.length; index += 1) {
    expect(restored[index]).toBeCloseTo(embedding[index], 6);
  }
});
