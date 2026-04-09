export type DailyUpdateResultType = "success" | "skipped" | "failed";

export interface DailyUpdateState {
  running: boolean;
  startedAt: string | null;
  lastStoppedAt: string | null;
  workerPid: number | null;
  expectedStop: boolean;
  runtimeHost: "project_scheduler" | "plugin_service" | null;
  runtimeObservedAt: string | null;
  runtimeConfigSource: "openclaw_plugin" | "local_config" | null;
  lastHeartbeatAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptDate: string | null;
  lastSuccessAt: string | null;
  lastSuccessDate: string | null;
  lastResultType: DailyUpdateResultType | null;
  lastResultSummary: string | null;
  consecutiveFailures: number;
  lastReviewAttemptAt: string | null;
  lastReviewAttemptDate: string | null;
  lastReviewSuccessAt: string | null;
  lastReviewSuccessDate: string | null;
  lastReviewResultType: DailyUpdateResultType | null;
  lastReviewResultSummary: string | null;
  reviewConsecutiveFailures: number;
  lastPreMarketAttemptAt: string | null;
  lastPreMarketAttemptDate: string | null;
  lastPreMarketSuccessAt: string | null;
  lastPreMarketSuccessDate: string | null;
  lastPreMarketResultType: DailyUpdateResultType | null;
  lastPreMarketResultSummary: string | null;
  preMarketConsecutiveFailures: number;
}
