export interface MonitorState {
  running: boolean;
  startedAt: string | null;
  lastStoppedAt: string | null;
  lastMode: "manual" | "system";
  workerPid: number | null;
  expectedStop: boolean;
  runtimeHost: "plugin_service" | "fallback_process" | null;
  runtimeObservedAt: string | null;
  lastObservedPhase: "non_trading_day" | "pre_market" | "trading" | "lunch_break" | "closed" | null;
  lastObservedPhaseDate: string | null;
  sessionNotificationsDate: string | null;
  sessionNotificationsSent: string[];
}
