import React, { useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
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
import type { RecentAuthEvent } from './src/ml/types';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'info';
type ActionVariant = 'primary' | 'secondary' | 'danger' | 'quiet';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={palette.gray50} />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const controller = useNirikshanController();
  const statusTone = getStatusTone(controller.status);

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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardRoot}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled">
          <View style={styles.serviceHeader}>
            <View style={styles.serviceHeaderTop}>
              <View style={styles.brandBlock}>
                <Text style={styles.kicker}>Offline Identity Service</Text>
                <Text
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  style={styles.title}>
                  Nirikshan
                </Text>
              </View>
              <ToneBadge label="Offline ready" tone="success" />
            </View>
            <View style={styles.serviceMetaRow}>
              <ToneBadge label={`Mode ${MODEL_MODE}`} tone="info" />
              <ToneBadge
                label={`${controller.users.length} enrolled`}
                tone="neutral"
              />
              <ToneBadge
                label={`${controller.pendingEvents} queued`}
                tone={controller.pendingEvents > 0 ? 'warning' : 'neutral'}
              />
            </View>
          </View>

          <View style={styles.cameraPanel}>
            <FaceAuthCamera
              active={controller.cameraActive}
              onPipelineResult={controller.handlePipelineResult}
            />
            <View style={styles.cameraTopBar}>
              <Text style={styles.cameraLabel}>Front camera</Text>
              <View style={styles.liveDot} />
            </View>
            <View style={styles.telemetryBar}>
              <Text numberOfLines={2} style={styles.telemetryText}>
                {controller.telemetryLabel}
              </Text>
            </View>
          </View>

          <View
            accessibilityRole="tablist"
            style={styles.segmentedControl}>
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

          <StatusCard
            busy={controller.busy}
            status={controller.status}
            tone={statusTone}
          />

          {controller.mode === 'enroll' ? (
            <Section
              action={
                <Text style={styles.sectionMeta}>
                  {controller.enrollmentSamples.length}/5
                </Text>
              }
              eyebrow="Enrollment"
              title="Register a person">
              <TextInput
                accessibilityLabel="Enrollment name"
                autoCapitalize="words"
                onChangeText={controller.setEnrollmentName}
                placeholder="Full name"
                placeholderTextColor={palette.gray500}
                style={styles.input}
                value={controller.enrollmentName}
              />
              <ProgressDots
                count={5}
                value={controller.enrollmentSamples.length}
              />
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${controller.enrollmentProgress * 100}%` },
                  ]}
                />
              </View>
              <PrimaryAction
                disabled={controller.busy}
                label="Capture sample"
                onPress={controller.captureEnrollmentSample}
                variant="primary"
              />
            </Section>
          ) : (
            <Section eyebrow="Authentication" title="Verify identity">
              <View style={styles.actionGrid}>
                <PrimaryAction
                  disabled={controller.busy}
                  label="Real face"
                  onPress={controller.simulateGenuineAuth}
                  variant="primary"
                />
                <PrimaryAction
                  disabled={controller.busy}
                  label="Wrong person"
                  onPress={controller.simulateWrongPerson}
                  variant="secondary"
                />
                <PrimaryAction
                  disabled={controller.busy}
                  label="Spoof"
                  onPress={controller.simulateSpoof}
                  variant="danger"
                />
                <PrimaryAction
                  disabled={controller.busy}
                  label="Sync queue"
                  onPress={handleSync}
                  variant="quiet"
                />
              </View>
            </Section>
          )}

          <View style={styles.statsGrid}>
            <Metric
              label="Users"
              tone="primary"
              value={String(controller.users.length)}
            />
            <Metric
              label="Queued"
              tone={controller.pendingEvents > 0 ? 'warning' : 'success'}
              value={String(controller.pendingEvents)}
            />
            <Metric label="Runtime" tone="info" value={MODEL_MODE} />
          </View>

          <Section eyebrow="Assets" title="Model readiness">
            <View style={styles.modelList}>
              {REQUIRED_MODELS.map(model => (
                <View key={model.id} style={styles.modelRow}>
                  <View style={styles.modelIcon}>
                    <Text style={styles.modelIconText}>OK</Text>
                  </View>
                  <View style={styles.modelCopy}>
                    <Text numberOfLines={1} style={styles.modelName}>
                      {model.label}
                    </Text>
                    <Text numberOfLines={1} style={styles.modelStatus}>
                      {model.fileName}
                    </Text>
                  </View>
                  <ToneBadge label="Ready" tone="success" />
                </View>
              ))}
            </View>
          </Section>

          <Section
            action={<ToneBadge label="Latest 8" tone="neutral" />}
            eyebrow="Audit"
            title="Recent events">
            {controller.recentEvents.length === 0 ? (
              <EmptyState />
            ) : (
              <View style={styles.eventList}>
                {controller.recentEvents.map(event => (
                  <EventRow event={event} key={event.id} />
                ))}
              </View>
            )}
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
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
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.segmentButton,
        active && styles.segmentButtonActive,
        pressed && styles.pressed,
      ]}>
      <Text
        numberOfLines={1}
        style={[
          styles.segmentButtonText,
          active && styles.segmentButtonTextActive,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Section({
  action,
  children,
  eyebrow,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleBlock}>
          <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
          <Text numberOfLines={2} style={styles.sectionTitle}>
            {title}
          </Text>
        </View>
        {action == null ? null : <View>{action}</View>}
      </View>
      {children}
    </View>
  );
}

function PrimaryAction({
  disabled,
  label,
  onPress,
  variant,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  variant: ActionVariant;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        actionButtonStyle[variant],
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[styles.actionButtonText, actionTextStyle[variant]]}>
        {label}
      </Text>
    </Pressable>
  );
}

function StatusCard({
  busy,
  status,
  tone,
}: {
  busy: boolean;
  status: string;
  tone: Tone;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.statusCard,
        {
          backgroundColor: toneStyle[tone].soft,
          borderColor: toneStyle[tone].border,
        },
      ]}>
      <View style={styles.statusContent}>
        <Text style={[styles.statusLabel, { color: toneStyle[tone].text }]}>
          Status
        </Text>
        <Text style={styles.statusText}>{status}</Text>
      </View>
      {busy ? (
        <ActivityIndicator color={toneStyle[tone].text} />
      ) : (
        <View
          style={[styles.statusMarker, { backgroundColor: toneStyle[tone].text }]}
        />
      )}
    </View>
  );
}

function Metric({
  label,
  tone,
  value,
}: {
  label: string;
  tone: Tone;
  value: string;
}) {
  return (
    <View style={[styles.metric, { borderColor: toneStyle[tone].border }]}>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[styles.metricValue, { color: toneStyle[tone].text }]}>
        {value}
      </Text>
      <Text numberOfLines={1} style={styles.metricLabel}>
        {label}
      </Text>
    </View>
  );
}

function ToneBadge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: toneStyle[tone].soft,
          borderColor: toneStyle[tone].border,
        },
      ]}>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[styles.badgeText, { color: toneStyle[tone].text }]}>
        {label}
      </Text>
    </View>
  );
}

function ProgressDots({ count, value }: { count: number; value: number }) {
  return (
    <View style={styles.progressDots}>
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={[
            styles.progressDot,
            index < value && styles.progressDotActive,
          ]}
        />
      ))}
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>No events yet</Text>
      <Text style={styles.emptyText}>Awaiting first audit record.</Text>
    </View>
  );
}

function EventRow({ event }: { event: RecentAuthEvent }) {
  const tone = eventTone(event.result);
  return (
    <View style={styles.eventRow}>
      <View style={styles.eventMain}>
        <ToneBadge label={formatEventResult(event.result)} tone={tone} />
        <Text numberOfLines={1} style={styles.eventName}>
          {event.userName ?? 'Unknown user'}
        </Text>
      </View>
      <View style={styles.eventMetaRow}>
        <Text numberOfLines={1} style={styles.eventMeta}>
          {formatTime(event.timestamp)}
        </Text>
        <Text style={styles.eventSeparator}>|</Text>
        <Text numberOfLines={1} style={styles.eventMeta}>
          {event.synced ? 'Synced' : 'Queued'}
        </Text>
      </View>
    </View>
  );
}

function getStatusTone(status: string): Tone {
  const normalized = status.toLowerCase();
  if (normalized.includes('spoof') || normalized.includes('failed')) {
    return 'danger';
  }
  if (normalized.includes('reject') || normalized.includes('offline')) {
    return 'warning';
  }
  if (
    normalized.includes('authenticated') ||
    normalized.includes('enrolled') ||
    normalized.includes('synced') ||
    normalized === 'ready'
  ) {
    return 'success';
  }
  return 'primary';
}

function eventTone(result: RecentAuthEvent['result']): Tone {
  if (result === 'authenticated' || result === 'enrolled') {
    return 'success';
  }
  if (result === 'spoof') {
    return 'danger';
  }
  return 'warning';
}

function formatEventResult(result: RecentAuthEvent['result']) {
  switch (result) {
    case 'authenticated':
      return 'Authenticated';
    case 'enrolled':
      return 'Enrolled';
    case 'spoof':
      return 'Spoof';
    case 'rejected':
      return 'Rejected';
    default:
      return result;
  }
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const palette = {
  primary900: '#392095',
  primary800: '#4A2BC2',
  primary: '#613AF5',
  primary600: '#774BFF',
  primary50: '#FAEFFF',
  success: '#3C9718',
  success50: '#ECF7E8',
  info: '#007DBA',
  info50: '#E6F6FF',
  warning: '#B77224',
  warning50: '#FFF4E8',
  danger: '#B7131A',
  danger50: '#FDECEC',
  white: '#FFFFFF',
  page: '#F3F3F3',
  gray50: '#F8F9FA',
  gray100: '#E9ECEF',
  gray200: '#DDD',
  gray500: '#727272',
  gray700: '#4B4B4B',
  dark: '#212121',
};

const toneStyle: Record<
  Tone,
  { border: string; soft: string; text: string }
> = {
  primary: {
    border: '#DAB2FF',
    soft: palette.primary50,
    text: palette.primary900,
  },
  success: {
    border: '#BFE4B0',
    soft: palette.success50,
    text: '#2F7415',
  },
  warning: {
    border: '#F0D0AD',
    soft: palette.warning50,
    text: '#87500F',
  },
  danger: {
    border: '#F0B6BA',
    soft: palette.danger50,
    text: palette.danger,
  },
  neutral: {
    border: palette.gray200,
    soft: palette.gray50,
    text: palette.gray700,
  },
  info: {
    border: '#B7E4FF',
    soft: palette.info50,
    text: '#005F8F',
  },
};

const actionButtonStyle: Record<ActionVariant, object> = {
  primary: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  secondary: {
    backgroundColor: palette.white,
    borderColor: palette.primary,
  },
  danger: {
    backgroundColor: palette.danger,
    borderColor: palette.danger,
  },
  quiet: {
    backgroundColor: palette.white,
    borderColor: palette.gray200,
  },
};

const actionTextStyle: Record<ActionVariant, object> = {
  primary: {
    color: palette.white,
  },
  secondary: {
    color: palette.primary900,
  },
  danger: {
    color: palette.white,
  },
  quiet: {
    color: palette.dark,
  },
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.page,
  },
  keyboardRoot: {
    flex: 1,
  },
  container: {
    gap: 14,
    padding: 16,
    paddingBottom: 28,
  },
  serviceHeader: {
    gap: 14,
    backgroundColor: palette.primary900,
    borderRadius: 8,
    padding: 16,
  },
  serviceHeaderTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  brandBlock: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  kicker: {
    color: palette.primary50,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  title: {
    color: palette.white,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 36,
  },
  serviceMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cameraPanel: {
    backgroundColor: palette.dark,
    borderColor: palette.gray200,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 332,
    overflow: 'hidden',
  },
  cameraTopBar: {
    alignItems: 'center',
    backgroundColor: 'rgba(33, 33, 33, 0.78)',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    left: 12,
    minHeight: 34,
    paddingHorizontal: 12,
    position: 'absolute',
    top: 12,
  },
  cameraLabel: {
    color: palette.white,
    fontSize: 12,
    fontWeight: '800',
  },
  liveDot: {
    backgroundColor: palette.success,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  telemetryBar: {
    backgroundColor: 'rgba(33, 33, 33, 0.86)',
    borderRadius: 8,
    bottom: 12,
    justifyContent: 'center',
    left: 12,
    minHeight: 42,
    paddingHorizontal: 12,
    position: 'absolute',
    right: 12,
  },
  telemetryText: {
    color: palette.white,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  segmentedControl: {
    backgroundColor: palette.white,
    borderColor: palette.gray200,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  segmentButton: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  segmentButtonActive: {
    backgroundColor: palette.primary,
  },
  segmentButtonText: {
    color: palette.gray700,
    fontSize: 14,
    fontWeight: '800',
  },
  segmentButtonTextActive: {
    color: palette.white,
  },
  statusCard: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 82,
    padding: 14,
  },
  statusContent: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  statusText: {
    color: palette.dark,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 21,
  },
  statusMarker: {
    borderRadius: 7,
    height: 14,
    width: 14,
  },
  section: {
    backgroundColor: palette.white,
    borderColor: palette.gray200,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 14,
    padding: 14,
  },
  sectionHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  sectionTitleBlock: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  sectionEyebrow: {
    color: palette.primary800,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    color: palette.dark,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 24,
  },
  sectionMeta: {
    color: palette.gray700,
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
    backgroundColor: palette.white,
    borderColor: palette.gray200,
    borderRadius: 8,
    borderWidth: 1,
    color: palette.dark,
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 12,
  },
  progressDots: {
    flexDirection: 'row',
    gap: 8,
  },
  progressDot: {
    backgroundColor: palette.gray200,
    borderRadius: 5,
    flex: 1,
    height: 10,
  },
  progressDotActive: {
    backgroundColor: palette.success,
  },
  progressTrack: {
    backgroundColor: palette.gray100,
    borderRadius: 4,
    height: 8,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: palette.success,
    borderRadius: 4,
    height: 8,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 12,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  metric: {
    backgroundColor: palette.white,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 82,
    padding: 12,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 28,
    textTransform: 'capitalize',
  },
  metricLabel: {
    color: palette.gray500,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  modelList: {
    gap: 10,
  },
  modelRow: {
    alignItems: 'center',
    backgroundColor: palette.gray50,
    borderColor: palette.gray200,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 64,
    padding: 10,
  },
  modelIcon: {
    alignItems: 'center',
    backgroundColor: palette.success50,
    borderColor: '#BFE4B0',
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  modelIconText: {
    color: '#2F7415',
    fontSize: 11,
    fontWeight: '900',
  },
  modelCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  modelName: {
    color: palette.dark,
    fontSize: 14,
    fontWeight: '800',
  },
  modelStatus: {
    color: palette.gray500,
    fontSize: 12,
    fontWeight: '600',
  },
  badge: {
    alignItems: 'center',
    borderRadius: 50,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 30,
    paddingHorizontal: 10,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
  },
  eventList: {
    gap: 10,
  },
  eventRow: {
    backgroundColor: palette.gray50,
    borderColor: palette.gray200,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    padding: 10,
  },
  eventMain: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  eventName: {
    color: palette.dark,
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
  },
  eventMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  eventMeta: {
    color: palette.gray500,
    fontSize: 12,
    fontWeight: '700',
  },
  eventSeparator: {
    color: palette.gray500,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyState: {
    backgroundColor: palette.gray50,
    borderColor: palette.gray200,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 3,
    padding: 14,
  },
  emptyTitle: {
    color: palette.dark,
    fontSize: 14,
    fontWeight: '800',
  },
  emptyText: {
    color: palette.gray500,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.48,
  },
});

export default App;
