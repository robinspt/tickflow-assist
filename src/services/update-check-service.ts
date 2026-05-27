import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { UpdateCheckState } from "../types/update-check.js";
import { formatChinaDateTime } from "../utils/china-time.js";
import { AlertService } from "./alert-service.js";

const UPDATE_CHECK_TIME = "21:00";
const DEFAULT_PACKAGE_NAME = "tickflow-assist";
const DEFAULT_REPOSITORY = "robinspt/tickflow-assist";
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

const DEFAULT_STATE: UpdateCheckState = {
  lastCheckAt: null,
  lastCheckDate: null,
  currentVersion: null,
  latestVersion: null,
  latestSource: null,
  latestUrl: null,
  lastResultType: null,
  lastResultSummary: null,
  lastError: null,
  lastNotifiedVersion: null,
  lastNotifiedAt: null,
};

export interface UpdateCheckRunResult {
  checked: boolean;
  updateAvailable: boolean;
  notified: boolean;
  reason: string;
}

interface UpdateCheckOptions {
  packageName?: string;
  repository?: string;
  currentVersion?: string;
  fetchImpl?: typeof fetch;
}

interface VersionSource {
  source: "npm" | "github_release";
  version: string;
  url: string;
}

interface SourceFetchResult {
  source: VersionSource | null;
  error: string | null;
}

export class UpdateCheckService {
  private readonly packageName: string;
  private readonly repository: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly baseDir: string,
    private readonly enabled: boolean,
    private readonly alertService: AlertService,
    private readonly options: UpdateCheckOptions = {},
  ) {
    this.packageName = options.packageName ?? DEFAULT_PACKAGE_NAME;
    this.repository = options.repository ?? DEFAULT_REPOSITORY;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async runScheduledCheck(date = new Date()): Promise<UpdateCheckRunResult> {
    if (!this.enabled) {
      return {
        checked: false,
        updateAvailable: false,
        notified: false,
        reason: "disabled",
      };
    }

    const now = formatChinaDateTime(date);
    const today = now.slice(0, 10);
    const hhmm = now.slice(11, 16);
    if (hhmm < UPDATE_CHECK_TIME) {
      return {
        checked: false,
        updateAvailable: false,
        notified: false,
        reason: "before_update_check_time",
      };
    }

    const state = await this.readState();
    if (state.lastCheckDate === today) {
      return {
        checked: false,
        updateAvailable: compareVersions(state.latestVersion ?? "0.0.0", state.currentVersion ?? "0.0.0") > 0,
        notified: false,
        reason: "already_checked_today",
      };
    }

    return this.checkNow(state, now, today);
  }

  async getDelayUntilNextCheckMs(date = new Date()): Promise<number> {
    if (!this.enabled) {
      return 60 * 60 * 1000;
    }

    const state = await this.readState();
    const now = formatChinaDateTime(date);
    const today = now.slice(0, 10);
    const hhmm = now.slice(11, 16);
    if (hhmm >= UPDATE_CHECK_TIME && state.lastCheckDate !== today) {
      return 0;
    }

    const targetDate = hhmm < UPDATE_CHECK_TIME ? today : addChinaDays(today, 1);
    const targetMs = parseChinaDateTimeMs(`${targetDate} ${UPDATE_CHECK_TIME}:00`);
    return Math.max(1_000, targetMs - date.getTime());
  }

  async getState(): Promise<UpdateCheckState> {
    return this.readState();
  }

  private async checkNow(
    state: UpdateCheckState,
    now: string,
    today: string,
  ): Promise<UpdateCheckRunResult> {
    try {
      const currentVersion = await this.getCurrentVersion();
      const sourceResults = await Promise.all([
        this.fetchNpmLatestVersion(),
        this.fetchGithubLatestReleaseVersion(),
      ]);
      const sources = sourceResults
        .map((result) => result.source)
        .filter((source): source is VersionSource => source != null);
      const errors = sourceResults
        .map((result) => result.error)
        .filter((error): error is string => Boolean(error));

      if (sources.length === 0) {
        throw new Error(`无法获取最新版本: ${errors.join("; ") || "unknown error"}`);
      }

      const latest = selectLatestSource(sources);
      const updateAvailable = compareVersions(latest.version, currentVersion) > 0;
      const nextState: UpdateCheckState = {
        ...state,
        lastCheckAt: now,
        lastCheckDate: today,
        currentVersion,
        latestVersion: latest.version,
        latestSource: latest.source,
        latestUrl: latest.url,
        lastResultType: updateAvailable ? "update_available" : "up_to_date",
        lastResultSummary: updateAvailable
          ? `发现新版本 ${formatVersion(latest.version)}`
          : `当前已是最新版本 ${formatVersion(currentVersion)}`,
        lastError: errors.length > 0 ? errors.join("; ") : null,
      };

      let notified = false;
      if (updateAvailable && state.lastNotifiedVersion !== latest.version) {
        notified = await this.alertService.send(this.buildUpdateMessage(currentVersion, latest, sources));
        if (notified) {
          nextState.lastNotifiedVersion = latest.version;
          nextState.lastNotifiedAt = now;
        } else {
          nextState.lastResultType = "notify_failed";
          nextState.lastResultSummary = `发现新版本 ${formatVersion(latest.version)}，但通知发送失败`;
          nextState.lastError = this.alertService.getLastError() ?? "alert delivery failed";
        }
      }

      await this.writeState(nextState);
      return {
        checked: true,
        updateAvailable,
        notified,
        reason: nextState.lastResultType ?? "checked",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.writeState({
        ...state,
        lastCheckAt: now,
        lastCheckDate: today,
        lastResultType: "failed",
        lastResultSummary: "自动检查更新失败",
        lastError: message,
      });
      return {
        checked: true,
        updateAvailable: false,
        notified: false,
        reason: "failed",
      };
    }
  }

  private async getCurrentVersion(): Promise<string> {
    if (this.options.currentVersion) {
      return normalizeVersion(this.options.currentVersion);
    }

    const packageJsonUrl = new URL("../../package.json", import.meta.url);
    const raw = await readFile(packageJsonUrl, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version !== "string" || !parsed.version.trim()) {
      throw new Error("package.json version is missing");
    }
    return normalizeVersion(parsed.version);
  }

  private async fetchNpmLatestVersion(): Promise<SourceFetchResult> {
    try {
      const payload = await this.fetchJson(`https://registry.npmjs.org/${encodeURIComponent(this.packageName)}/latest`);
      const version = getNonEmptyString(payload.version);
      if (!version) {
        throw new Error("npm response missing version");
      }

      return {
        source: {
          source: "npm",
          version: normalizeVersion(version),
          url: `https://www.npmjs.com/package/${this.packageName}/v/${normalizeVersion(version)}`,
        },
        error: null,
      };
    } catch (error) {
      return {
        source: null,
        error: `npm: ${formatErrorMessage(error)}`,
      };
    }
  }

  private async fetchGithubLatestReleaseVersion(): Promise<SourceFetchResult> {
    try {
      const payload = await this.fetchJson(`https://api.github.com/repos/${this.repository}/releases/latest`);
      const tagName = getNonEmptyString(payload.tag_name);
      if (!tagName) {
        throw new Error("GitHub release response missing tag_name");
      }

      return {
        source: {
          source: "github_release",
          version: normalizeVersion(tagName),
          url: getNonEmptyString(payload.html_url) ?? `https://github.com/${this.repository}/releases/latest`,
        },
        error: null,
      };
    } catch (error) {
      return {
        source: null,
        error: `github_release: ${formatErrorMessage(error)}`,
      };
    }
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "tickflow-assist-update-check",
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      if (!isRecord(payload)) {
        throw new Error("response is not a JSON object");
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildUpdateMessage(
    currentVersion: string,
    latest: VersionSource,
    sources: VersionSource[],
  ): string {
    const sourceLines = sources.map((source) => {
      const label = source.source === "npm" ? "npm" : "GitHub Release";
      return `${label}: ${formatVersion(source.version)} (${source.url})`;
    });

    return this.alertService.formatSystemNotification(
      "🔔 TickFlow Assist 有新版本",
      [
        `当前版本: ${formatVersion(currentVersion)}`,
        `最新版本: ${formatVersion(latest.version)}`,
        `来源: ${latest.source === "npm" ? "npm" : "GitHub Release"}`,
        ...sourceLines,
        "建议: 更新插件后重启 OpenClaw Gateway。",
      ],
    );
  }

  private async readState(): Promise<UpdateCheckState> {
    const file = this.getStateFilePath();
    try {
      const raw = await readFile(file, "utf-8");
      return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<UpdateCheckState>) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...DEFAULT_STATE };
      }
      throw error;
    }
  }

  private async writeState(state: UpdateCheckState): Promise<void> {
    const file = this.getStateFilePath();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(state, null, 2), "utf-8");
  }

  private getStateFilePath(): string {
    return path.join(this.baseDir, "update-check-state.json");
  }
}

function selectLatestSource(sources: VersionSource[]): VersionSource {
  return [...sources].sort((left, right) => compareVersions(right.version, left.version))[0];
}

function normalizeVersion(value: string): string {
  const normalized = value.trim().replace(/^v/i, "");
  if (!parseVersion(normalized)) {
    throw new Error(`invalid semver version: ${value}`);
  }
  return normalized;
}

function formatVersion(value: string): string {
  return `v${normalizeVersion(value)}`;
}

export function compareVersions(left: string, right: string): number {
  const leftParsed = parseVersion(left);
  const rightParsed = parseVersion(right);
  if (!leftParsed || !rightParsed) {
    return left.localeCompare(right);
  }

  for (let index = 0; index < 3; index += 1) {
    const diff = leftParsed.parts[index] - rightParsed.parts[index];
    if (diff !== 0) {
      return diff;
    }
  }

  if (leftParsed.prerelease === rightParsed.prerelease) {
    return 0;
  }
  if (!leftParsed.prerelease) {
    return 1;
  }
  if (!rightParsed.prerelease) {
    return -1;
  }
  return leftParsed.prerelease.localeCompare(rightParsed.prerelease);
}

function parseVersion(value: string): { parts: [number, number, number]; prerelease: string } | null {
  const match = value.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) {
    return null;
  }
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? "",
  };
}

function addChinaDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0));
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function parseChinaDateTimeMs(value: string): number {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(`invalid China datetime: ${value}`);
  }
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 8,
    Number(minute),
    Number(second),
  );
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
