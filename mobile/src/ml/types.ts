export type AuthMode = 'authenticate' | 'enroll';

export type AuthEventResult =
  | 'authenticated'
  | 'rejected'
  | 'spoof'
  | 'enrolled';

export type PipelineTiming = {
  detectionMs: number;
  livenessMs: number;
  recognitionMs: number;
  totalMs: number;
};

export type PipelineResult =
  | {
      kind: 'embedding';
      embedding: number[];
      livenessScore: number;
      timing: PipelineTiming;
    }
  | {
      kind: 'spoof';
      livenessScore: number;
      timing: PipelineTiming;
    }
  | {
      kind: 'no-face' | 'multiple-faces' | 'low-quality';
      reason: string;
      timing: PipelineTiming;
    };

export type EnrolledUser = {
  id: string;
  name: string;
  deviceId: string;
  createdAt: number;
  embeddings: number[][];
};

export type RecentAuthEvent = {
  id: string;
  result: AuthEventResult;
  userId: string | null;
  userName: string | null;
  confidence: number | null;
  livenessScore: number | null;
  latencyMs: number | null;
  timestamp: number;
  synced: boolean;
};

export type PendingSyncEvent = RecentAuthEvent & {
  deviceId: string;
};
