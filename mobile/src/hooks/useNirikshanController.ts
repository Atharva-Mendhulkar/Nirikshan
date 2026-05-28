import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUTH_THRESHOLD, ENROLLMENT_SAMPLE_COUNT } from '../config/runtime';
import {
  createDemoEmbedding,
  findBestMatch,
  jitterEmbedding,
} from '../ml/embedding';
import type {
  AuthMode,
  EnrolledUser,
  PipelineResult,
  RecentAuthEvent,
} from '../ml/types';
import { NirikshanRepository } from '../storage/repository';
import { syncPendingEvents } from '../sync/syncService';
import { createId } from '../utils/id';

export function useNirikshanController() {
  const repositoryRef = useRef<NirikshanRepository | null>(null);
  const [mode, setMode] = useState<AuthMode>('authenticate');
  const [status, setStatus] = useState('Initializing local vault');
  const [busy, setBusy] = useState(true);
  const [cameraActive] = useState(true);
  const [users, setUsers] = useState<EnrolledUser[]>([]);
  const [recentEvents, setRecentEvents] = useState<RecentAuthEvent[]>([]);
  const [pendingEvents, setPendingEvents] = useState(0);
  const [enrollmentName, setEnrollmentName] = useState('');
  const [enrollmentSamples, setEnrollmentSamples] = useState<number[][]>([]);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const repository = repositoryRef.current;
    if (repository == null) {
      return;
    }
    const [loadedUsers, events, pending] = await Promise.all([
      repository.loadEnrolledUsers(),
      repository.listRecentEvents(8),
      repository.countPendingEvents(),
    ]);
    setUsers(loadedUsers);
    setRecentEvents(events);
    setPendingEvents(pending);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function boot() {
      try {
        const repository = new NirikshanRepository();
        await repository.initialize();
        repositoryRef.current = repository;
        await refresh();
        if (mounted) {
          setStatus('Ready');
        }
      } catch (error) {
        if (mounted) {
          setStatus(`Initialization failed: ${String(error)}`);
        }
      } finally {
        if (mounted) {
          setBusy(false);
        }
      }
    }
    boot();
    return () => {
      mounted = false;
    };
  }, [refresh]);

  const logAuthentication = useCallback(
    async (
      result: 'authenticated' | 'rejected' | 'spoof',
      options: {
        userId?: string | null;
        userName?: string | null;
        confidence?: number | null;
        livenessScore?: number | null;
        latencyMs?: number | null;
      },
    ) => {
      const repository = repositoryRef.current;
      if (repository == null) {
        return;
      }
      await repository.insertAuthEvent({
        id: createId('evt'),
        result,
        userId: options.userId ?? null,
        userName: options.userName ?? null,
        confidence: options.confidence ?? null,
        livenessScore: options.livenessScore ?? null,
        latencyMs: options.latencyMs ?? null,
        timestamp: Date.now(),
      });
      await refresh();
    },
    [refresh],
  );

  const authenticateEmbedding = useCallback(
    async (embedding: number[], livenessScore: number | null = 1) => {
      const started = Date.now();
      const match = findBestMatch(embedding, users, AUTH_THRESHOLD);
      const latencyMs = Date.now() - started;
      setLastLatencyMs(latencyMs);

      if (match.accepted && match.user != null) {
        setStatus(
          `Authenticated ${match.user.name} (${match.similarity.toFixed(3)})`,
        );
        await logAuthentication('authenticated', {
          userId: match.user.id,
          userName: match.user.name,
          confidence: match.similarity,
          livenessScore,
          latencyMs,
        });
      } else {
        setStatus(`Rejected (${match.similarity.toFixed(3)})`);
        await logAuthentication('rejected', {
          confidence: match.similarity,
          livenessScore,
          latencyMs,
        });
      }
    },
    [logAuthentication, users],
  );

  const handlePipelineResult = useCallback(
    async (result: PipelineResult) => {
      if (result.kind === 'spoof') {
        setLastLatencyMs(result.timing.totalMs);
        setStatus(`Spoof rejected (${result.livenessScore.toFixed(3)})`);
        await logAuthentication('spoof', {
          livenessScore: result.livenessScore,
          latencyMs: result.timing.totalMs,
        });
        return;
      }

      if (result.kind === 'embedding') {
        setLastLatencyMs(result.timing.totalMs);
        if (mode === 'enroll') {
          setEnrollmentSamples(current => {
            if (current.length >= ENROLLMENT_SAMPLE_COUNT) {
              return current;
            }
            return [...current, result.embedding];
          });
        } else {
          await authenticateEmbedding(result.embedding, result.livenessScore);
        }
      }
    },
    [authenticateEmbedding, logAuthentication, mode],
  );

  const captureEnrollmentSample = useCallback(async () => {
    const trimmedName = enrollmentName.trim();
    if (trimmedName.length < 2) {
      setStatus('Enter a name before enrollment');
      return;
    }
    setBusy(true);
    try {
      const sample = createDemoEmbedding(
        `${trimmedName}:${enrollmentSamples.length}`,
      );
      const nextSamples = [...enrollmentSamples, sample];
      setEnrollmentSamples(nextSamples);
      setStatus(`Captured sample ${nextSamples.length}/5`);

      if (nextSamples.length >= ENROLLMENT_SAMPLE_COUNT) {
        const repository = repositoryRef.current;
        if (repository == null) {
          throw new Error('Repository not ready');
        }
        const user = await repository.createUserWithEmbeddings(
          trimmedName,
          nextSamples,
        );
        await repository.insertAuthEvent({
          id: createId('evt'),
          result: 'enrolled',
          userId: user.id,
          userName: user.name,
          confidence: 1,
          livenessScore: 1,
          latencyMs: null,
          timestamp: Date.now(),
        });
        setEnrollmentName('');
        setEnrollmentSamples([]);
        setMode('authenticate');
        setStatus(`Enrolled ${user.name}`);
        await refresh();
      }
    } catch (error) {
      setStatus(`Enrollment failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [enrollmentName, enrollmentSamples, refresh]);

  const simulateGenuineAuth = useCallback(async () => {
    if (users.length === 0) {
      setStatus('Enroll a user first');
      return;
    }
    setBusy(true);
    try {
      const firstUser = users[0];
      const embedding = jitterEmbedding(firstUser.embeddings[0], 0.006);
      await authenticateEmbedding(embedding, 0.96);
    } finally {
      setBusy(false);
    }
  }, [authenticateEmbedding, users]);

  const simulateWrongPerson = useCallback(async () => {
    setBusy(true);
    try {
      await authenticateEmbedding(createDemoEmbedding('unknown-person'), 0.94);
    } finally {
      setBusy(false);
    }
  }, [authenticateEmbedding]);

  const simulateSpoof = useCallback(async () => {
    setBusy(true);
    try {
      setLastLatencyMs(41);
      setStatus('Spoof rejected (0.113)');
      await logAuthentication('spoof', {
        livenessScore: 0.113,
        latencyMs: 41,
      });
    } finally {
      setBusy(false);
    }
  }, [logAuthentication]);

  const syncNow = useCallback(async () => {
    const repository = repositoryRef.current;
    if (repository == null) {
      return;
    }
    setBusy(true);
    try {
      const result = await syncPendingEvents(repository);
      await refresh();
      setStatus(result.message);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const clearSensitiveMemory = useCallback(() => {
    setUsers([]);
    setStatus('Sensitive cache cleared');
  }, []);

  const telemetryLabel = useMemo(() => {
    const latency = lastLatencyMs == null ? 'not measured' : `${lastLatencyMs}ms`;
    return `threshold ${AUTH_THRESHOLD.toFixed(2)} | latency ${latency} | 5 FPS`;
  }, [lastLatencyMs]);

  return {
    busy,
    cameraActive,
    clearSensitiveMemory,
    captureEnrollmentSample,
    enrollmentName,
    enrollmentProgress: enrollmentSamples.length / ENROLLMENT_SAMPLE_COUNT,
    enrollmentSamples,
    handlePipelineResult,
    mode,
    pendingEvents,
    recentEvents,
    restoreSensitiveMemory: refresh,
    setEnrollmentName,
    setMode,
    setStatus,
    simulateGenuineAuth,
    simulateSpoof,
    simulateWrongPerson,
    status,
    syncNow,
    telemetryLabel,
    users,
  };
}
