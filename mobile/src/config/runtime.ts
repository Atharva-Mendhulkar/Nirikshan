export const MODEL_MODE = 'mock' as const;

export const AUTH_THRESHOLD = 0.75;
export const ENROLLMENT_SAMPLE_COUNT = 5;

export const LOCAL_SYNC_API_BASE_URL = 'http://10.0.2.2:3001';
export const SYNC_API_BASE_URL = __DEV__ ? LOCAL_SYNC_API_BASE_URL : '';

export const REQUIRED_MODELS = [
  {
    id: 'detector',
    label: 'Face detector',
    fileName: 'yunet_detector.tflite',
    expectedInput: '320x320 RGB',
  },
  {
    id: 'liveness',
    label: 'Liveness',
    fileName: 'minifasnet_v2.tflite',
    expectedInput: '80x80 or validated model shape',
  },
  {
    id: 'recognition',
    label: 'Recognition',
    fileName: 'mobilefacenet_arcface.tflite',
    expectedInput: '112x112 aligned RGB',
  },
] as const;
