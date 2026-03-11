export interface MonitorState {
  running: boolean;
  startedAt: string | null;
  lastStoppedAt: string | null;
  lastMode: "manual" | "system";
  workerPid: number | null;
  expectedStop: boolean;
  runtimeHost: "plugin_service" | "fallback_process" | null;
  runtimeObservedAt: string | null;
}
