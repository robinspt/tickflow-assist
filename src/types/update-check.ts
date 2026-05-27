export type UpdateCheckResultType = "up_to_date" | "update_available" | "notify_failed" | "failed";

export interface UpdateCheckState {
  lastCheckAt: string | null;
  lastCheckDate: string | null;
  currentVersion: string | null;
  latestVersion: string | null;
  latestSource: string | null;
  latestUrl: string | null;
  lastResultType: UpdateCheckResultType | null;
  lastResultSummary: string | null;
  lastError: string | null;
  lastNotifiedVersion: string | null;
  lastNotifiedAt: string | null;
}
