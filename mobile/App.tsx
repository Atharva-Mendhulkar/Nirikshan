import React, { useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { FaceAuthCamera } from './src/components/FaceAuthCamera';
import { MODEL_MODE, REQUIRED_MODELS } from './src/config/runtime';
import { useNirikshanController } from './src/hooks/useNirikshanController';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#101820" />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const controller = useNirikshanController();

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        controller.restoreSensitiveMemory().catch(() => undefined);
      } else {
        controller.clearSensitiveMemory();
      }
    });
    return () => subscription.remove();
  }, [controller]);

  const handleSync = useCallback(() => {
    controller.syncNow().catch(error => {
      controller.setStatus(`Sync failed: ${String(error.message ?? error)}`);
    });
  }, [controller]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Nirikshan</Text>
          <Text style={styles.subtitle}>
            Offline face authentication, Android MVP
          </Text>
        </View>

        <View style={styles.cameraPanel}>
          <FaceAuthCamera
            active={controller.cameraActive}
            onPipelineResult={controller.handlePipelineResult}
          />
          <View style={styles.telemetryBar}>
            <Text style={styles.telemetryText}>
              {controller.telemetryLabel}
            </Text>
          </View>
        </View>

        <View style={styles.modeRow}>
          <SegmentButton
            active={controller.mode === 'authenticate'}
            label="Authenticate"
            onPress={() => controller.setMode('authenticate')}
          />
          <SegmentButton
            active={controller.mode === 'enroll'}
            label="Enroll"
            onPress={() => controller.setMode('enroll')}
          />
        </View>

        {controller.mode === 'enroll' ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Enrollment</Text>
            <TextInput
              autoCapitalize="words"
              onChangeText={controller.setEnrollmentName}
              placeholder="Name"
              placeholderTextColor="#6b7280"
              style={styles.input}
              value={controller.enrollmentName}
            />
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${controller.enrollmentProgress * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.muted}>
              {controller.enrollmentSamples.length}/5 valid samples
            </Text>
            <Pressable
              disabled={controller.busy}
              onPress={controller.captureEnrollmentSample}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
                controller.busy && styles.disabled,
              ]}>
              <Text style={styles.primaryButtonText}>Capture Sample</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Authentication</Text>
            <View style={styles.actionGrid}>
              <Pressable
                disabled={controller.busy}
                onPress={controller.simulateGenuineAuth}
                style={({ pressed }) => [
                  styles.actionButton,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.actionButtonText}>Real Face</Text>
              </Pressable>
              <Pressable
                disabled={controller.busy}
                onPress={controller.simulateWrongPerson}
                style={({ pressed }) => [
                  styles.actionButton,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.actionButtonText}>Wrong Person</Text>
              </Pressable>
              <Pressable
                disabled={controller.busy}
                onPress={controller.simulateSpoof}
                style={({ pressed }) => [
                  styles.destructiveButton,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.destructiveButtonText}>Spoof</Text>
              </Pressable>
              <Pressable
                disabled={controller.busy}
                onPress={handleSync}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.secondaryButtonText}>Sync</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.statusPanel}>
          <View>
            <Text style={styles.statusLabel}>Status</Text>
            <Text style={styles.statusText}>{controller.status}</Text>
          </View>
          {controller.busy ? <ActivityIndicator color="#f5f7fb" /> : null}
        </View>

        <View style={styles.grid}>
          <Metric label="Users" value={String(controller.users.length)} />
          <Metric label="Queued" value={String(controller.pendingEvents)} />
          <Metric label="Mode" value={MODEL_MODE} />
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Model Gate</Text>
          {REQUIRED_MODELS.map(model => (
            <View key={model.id} style={styles.modelRow}>
              <Text style={styles.modelName}>{model.label}</Text>
              <Text style={styles.modelStatus}>{model.fileName}</Text>
            </View>
          ))}
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Recent Events</Text>
          {controller.recentEvents.length === 0 ? (
            <Text style={styles.muted}>No events yet</Text>
          ) : (
            controller.recentEvents.map(event => (
              <View key={event.id} style={styles.eventRow}>
                <Text style={styles.eventResult}>{event.result}</Text>
                <Text style={styles.eventMeta}>
                  {event.userName ?? 'unknown'} |{' '}
                  {new Date(event.timestamp).toLocaleTimeString()}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SegmentButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.segmentButton,
        active && styles.segmentButtonActive,
        pressed && styles.pressed,
      ]}>
      <Text
        style={[
          styles.segmentButtonText,
          active && styles.segmentButtonTextActive,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#101820',
  },
  container: {
    padding: 16,
    gap: 14,
  },
  header: {
    gap: 4,
  },
  title: {
    color: '#f5f7fb',
    fontSize: 30,
    fontWeight: '800',
  },
  subtitle: {
    color: '#9aa7b2',
    fontSize: 14,
  },
  cameraPanel: {
    height: 320,
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: '#17212b',
    borderColor: '#263443',
    borderWidth: StyleSheet.hairlineWidth,
  },
  telemetryBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(16,24,32,0.86)',
    paddingHorizontal: 12,
  },
  telemetryText: {
    color: '#f5f7fb',
    fontSize: 12,
    fontWeight: '600',
  },
  modeRow: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 8,
    backgroundColor: '#17212b',
  },
  segmentButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  segmentButtonActive: {
    backgroundColor: '#f5f7fb',
  },
  segmentButtonText: {
    color: '#9aa7b2',
    fontWeight: '700',
  },
  segmentButtonTextActive: {
    color: '#101820',
  },
  panel: {
    gap: 12,
    borderRadius: 8,
    backgroundColor: '#17212b',
    borderColor: '#263443',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  panelTitle: {
    color: '#f5f7fb',
    fontSize: 16,
    fontWeight: '800',
  },
  input: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: '#101820',
    color: '#f5f7fb',
    paddingHorizontal: 12,
    borderColor: '#263443',
    borderWidth: StyleSheet.hairlineWidth,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#101820',
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34d399',
  },
  muted: {
    color: '#9aa7b2',
    fontSize: 13,
  },
  primaryButton: {
    minHeight: 46,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#34d399',
  },
  primaryButtonText: {
    color: '#06130f',
    fontWeight: '800',
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    flexGrow: 1,
    minWidth: '45%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#f5f7fb',
  },
  actionButtonText: {
    color: '#101820',
    fontWeight: '800',
  },
  destructiveButton: {
    flexGrow: 1,
    minWidth: '45%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#f97373',
  },
  destructiveButtonText: {
    color: '#210b0b',
    fontWeight: '800',
  },
  secondaryButton: {
    flexGrow: 1,
    minWidth: '45%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderColor: '#f5f7fb',
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryButtonText: {
    color: '#f5f7fb',
    fontWeight: '800',
  },
  statusPanel: {
    minHeight: 72,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#263443',
    padding: 14,
  },
  statusLabel: {
    color: '#9aa7b2',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  statusText: {
    color: '#f5f7fb',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 4,
  },
  grid: {
    flexDirection: 'row',
    gap: 10,
  },
  metric: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#17212b',
    borderColor: '#263443',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  metricValue: {
    color: '#f5f7fb',
    fontSize: 22,
    fontWeight: '800',
  },
  metricLabel: {
    color: '#9aa7b2',
    fontSize: 12,
    fontWeight: '700',
  },
  modelRow: {
    gap: 2,
  },
  modelName: {
    color: '#f5f7fb',
    fontWeight: '700',
  },
  modelStatus: {
    color: '#9aa7b2',
    fontSize: 12,
  },
  eventRow: {
    gap: 2,
    borderTopColor: '#263443',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  eventResult: {
    color: '#f5f7fb',
    fontWeight: '800',
  },
  eventMeta: {
    color: '#9aa7b2',
    fontSize: 12,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.45,
  },
});

export default App;
