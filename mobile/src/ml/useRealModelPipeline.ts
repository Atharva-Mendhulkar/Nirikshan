import { useMemo } from 'react';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { useResizer } from 'react-native-vision-camera-resizer';

const detectorSource = require('../assets/models/yunet_detector.tflite');
const livenessSource = require('../assets/models/minifasnet_v2.tflite');
const recognitionSource = require('../assets/models/mobilefacenet_arcface.tflite');

export function useRealModelPipeline() {
  const detector = useTensorflowModel(detectorSource, []);
  const liveness = useTensorflowModel(livenessSource, []);
  const recognition = useTensorflowModel(recognitionSource, []);

  const detectorResizer = useResizer({
    width: 640,
    height: 640,
    channelOrder: 'bgr',
    dataType: 'float32',
    scaleMode: 'contain',
    pixelLayout: 'interleaved',
  });

  const livenessResizer = useResizer({
    width: 80,
    height: 80,
    channelOrder: 'bgr',
    dataType: 'float32',
    scaleMode: 'cover',
    pixelLayout: 'interleaved',
  });

  const recognitionResizer = useResizer({
    width: 112,
    height: 112,
    channelOrder: 'rgb',
    dataType: 'float32',
    scaleMode: 'cover',
    pixelLayout: 'interleaved',
  });

  return useMemo(
    () => ({
      detector,
      liveness,
      recognition,
      detectorResizer,
      livenessResizer,
      recognitionResizer,
      ready:
        detector.state === 'loaded' &&
        liveness.state === 'loaded' &&
        recognition.state === 'loaded' &&
        detectorResizer.state === 'ready' &&
        livenessResizer.state === 'ready' &&
        recognitionResizer.state === 'ready',
    }),
    [
      detector,
      detectorResizer,
      liveness,
      livenessResizer,
      recognition,
      recognitionResizer,
    ],
  );
}
