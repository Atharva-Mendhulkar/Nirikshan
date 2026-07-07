import React, { useEffect } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera';
import type { PipelineResult } from '../ml/types';

type Props = {
  active: boolean;
  onPipelineResult: (result: PipelineResult) => void;
};

export function FaceAuthCamera({ active }: Props) {
  const device = useCameraDevice('front');
  const { hasPermission, canRequestPermission, requestPermission, status } =
    useCameraPermission();

  useEffect(() => {
    if (!hasPermission && canRequestPermission) {
      requestPermission().catch(() => undefined);
    }
  }, [canRequestPermission, hasPermission, requestPermission]);

  const frameOutput = useFrameOutput({
    targetResolution: { width: 1280, height: 720 },
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    enablePhysicalBufferRotation: false,
    onFrame(frame) {
      'worklet';
      frame.dispose();
    },
  });

  if (!hasPermission) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Camera permission</Text>
        <Text style={styles.fallbackText}>{status}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (canRequestPermission) {
              requestPermission().catch(() => undefined);
            } else {
              Linking.openSettings().catch(() => undefined);
            }
          }}
          style={({ pressed }) => [
            styles.permissionButton,
            pressed && styles.pressed,
          ]}>
          <Text style={styles.permissionButtonText}>
            {canRequestPermission ? 'Allow Camera' : 'Open Settings'}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Front camera unavailable</Text>
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        device={device}
        isActive={active}
        mirrorMode="auto"
        outputs={[frameOutput]}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.guideLayer}>
        <View style={styles.faceGuide} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#212121',
    padding: 16,
    gap: 14,
  },
  fallbackTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  fallbackText: {
    color: '#DDD',
    fontSize: 13,
    fontWeight: '700',
  },
  permissionButton: {
    backgroundColor: '#fff',
    borderColor: '#DDD',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  permissionButtonText: {
    color: '#392095',
    fontWeight: '800',
  },
  guideLayer: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  faceGuide: {
    width: '52%',
    aspectRatio: 0.72,
    borderColor: 'rgba(255, 255, 255, 0.82)',
    borderRadius: 120,
    borderWidth: 2,
  },
  pressed: {
    opacity: 0.72,
  },
});
