export type FaceDetection = {
  box: { x: number; y: number; width: number; height: number };
  landmarks: Array<{ x: number; y: number }>;
  score: number;
};

export function selectBestFace(
  detections: FaceDetection[],
  minimumScore = 0.8,
): FaceDetection | null {
  const validDetections = detections.filter(face => face.score >= minimumScore);
  if (validDetections.length !== 1) {
    return null;
  }
  return validDetections[0];
}

export function softmax(logits: ArrayLike<number>) {
  const max = Math.max(...Array.from(logits));
  const exps = Array.from(logits, value => Math.exp(value - max));
  const sum = exps.reduce((total, value) => total + value, 0);
  return exps.map(value => value / sum);
}

export function isLiveFace(probabilities: ArrayLike<number>, liveIndex = 0) {
  return probabilities[liveIndex] >= 0.7;
}
