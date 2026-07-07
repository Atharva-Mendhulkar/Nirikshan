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
    expectedInput: 'YuNet source ONNX: 1x3x640x640, outputs bbox + 5 landmarks',
  },
  {
    id: 'liveness',
    label: 'Liveness',
    fileName: 'minifasnet_v2.tflite',
    expectedInput: 'MiniFASNetV2 source ONNX: batch x 3 x 80 x 80, 3 classes',
  },
  {
    id: 'recognition',
    label: 'Recognition',
    fileName: 'mobilefacenet_arcface.tflite',
    expectedInput: 'buffalo_s MBF source ONNX: batch x 3 x 112 x 112, 512-d embedding',
  },
] as const;
