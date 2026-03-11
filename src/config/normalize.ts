import path from "node:path";

import { DEFAULT_PLUGIN_CONFIG, type PluginConfig } from "./schema.js";

type RawConfig = Partial<PluginConfig> & Record<string, unknown>;

function normalizeString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value == null) {
    return fallback;
  }
  return String(value).trim();
}

function normalizeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : fallback;
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return fallback;
}

export function normalizePluginConfig(input: unknown): PluginConfig {
  const raw = (input ?? {}) as RawConfig;

  return {
    tickflowApiUrl: normalizeString(raw.tickflowApiUrl, DEFAULT_PLUGIN_CONFIG.tickflowApiUrl),
    tickflowApiKey: normalizeString(raw.tickflowApiKey),
    llmBaseUrl: normalizeString(raw.llmBaseUrl, DEFAULT_PLUGIN_CONFIG.llmBaseUrl),
    llmApiKey: normalizeString(raw.llmApiKey),
    llmModel: normalizeString(raw.llmModel, DEFAULT_PLUGIN_CONFIG.llmModel),
    databasePath: path.resolve(normalizeString(raw.databasePath, DEFAULT_PLUGIN_CONFIG.databasePath)),
    calendarFile: path.resolve(normalizeString(raw.calendarFile, DEFAULT_PLUGIN_CONFIG.calendarFile)),
    requestInterval: normalizeInteger(raw.requestInterval, DEFAULT_PLUGIN_CONFIG.requestInterval),
    dailyUpdateNotify: normalizeBoolean(raw.dailyUpdateNotify, DEFAULT_PLUGIN_CONFIG.dailyUpdateNotify),
    alertChannel: normalizeString(raw.alertChannel, DEFAULT_PLUGIN_CONFIG.alertChannel),
    openclawCliBin: normalizeString(raw.openclawCliBin, DEFAULT_PLUGIN_CONFIG.openclawCliBin),
    alertAccount: normalizeString(raw.alertAccount, DEFAULT_PLUGIN_CONFIG.alertAccount),
    alertTarget: normalizeString(raw.alertTarget),
    pythonBin: normalizeString(raw.pythonBin, DEFAULT_PLUGIN_CONFIG.pythonBin),
    pythonArgs: normalizeStringArray(raw.pythonArgs, DEFAULT_PLUGIN_CONFIG.pythonArgs),
    pythonWorkdir: path.resolve(normalizeString(raw.pythonWorkdir, DEFAULT_PLUGIN_CONFIG.pythonWorkdir)),
  };
}

export function validatePluginConfig(config: PluginConfig): string[] {
  const errors: string[] = [];

  if (!config.tickflowApiKey) {
    errors.push("tickflowApiKey is required");
  }
  if (!config.llmApiKey) {
    errors.push("llmApiKey is required");
  }
  if (!config.alertTarget) {
    errors.push("alertTarget is required");
  }
  if (!config.tickflowApiUrl.startsWith("http://") && !config.tickflowApiUrl.startsWith("https://")) {
    errors.push("tickflowApiUrl must be an absolute http(s) URL");
  }
  if (config.requestInterval < 5) {
    errors.push("requestInterval must be at least 5 seconds");
  }

  return errors;
}
