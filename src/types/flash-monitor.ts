export interface FlashMonitorState {
  initialized: boolean;
  lastSeenKey: string | null;
  lastSeenPublishedAt: string | null;
  lastSeenUrl: string | null;
  backfillCursor: string | null;
  runtimeHost: "plugin_service" | "fallback_process" | null;
  runtimeObservedAt: string | null;
  lastHeartbeatAt: string | null;
  lastPollAt: string | null;
  lastPollStored: number;
  lastPollCandidates: number;
  lastPollAlerts: number;
  lastPrunedAt: string | null;
  lastLoopError: string | null;
  lastLoopErrorAt: string | null;
}
