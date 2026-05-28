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
        <Text style={styles.fallbackTitle}>Camera permission: {status}</Text>
        <Pressable
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
    <Camera
      device={device}
      isActive={active}
      mirrorMode="auto"
      outputs={[frameOutput]}
      style={StyleSheet.absoluteFill}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b1117',
    padding: 16,
    gap: 14,
  },
  fallbackTitle: {
    color: '#f5f7fb',
    fontWeight: '700',
  },
  permissionButton: {
    borderColor: '#dfe7ef',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  permissionButtonText: {
    color: '#f5f7fb',
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.72,
  },
});
