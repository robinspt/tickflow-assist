import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PluginConfig } from "../config/schema.js";
import { normalizePluginConfig, resolvePluginConfigPaths } from "../config/normalize.js";

const CONFIG_B64_ENV = "TICKFLOW_ASSIST_CONFIG_B64";
const CONFIG_SOURCE_ENV = "TICKFLOW_ASSIST_CONFIG_SOURCE";

interface LocalConfigShape {
  plugin?: Record<string, unknown>;
}

export interface LoadedProcessConfig {
  config: PluginConfig;
  configSource: "openclaw_plugin" | "local_config";
}

export function buildProcessConfigEnv(
  config: PluginConfig,
  configSource: "openclaw_plugin" | "local_config",
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    [CONFIG_B64_ENV]: Buffer.from(JSON.stringify(config), "utf-8").toString("base64"),
    [CONFIG_SOURCE_ENV]: configSource,
  };
}

export async function loadProcessConfig(): Promise<LoadedProcessConfig> {
  const encoded = process.env[CONFIG_B64_ENV];
  if (encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    return {
      config: resolvePluginConfigPaths(normalizePluginConfig(JSON.parse(decoded)), process.cwd()),
      configSource: normalizeConfigSource(process.env[CONFIG_SOURCE_ENV]),
    };
  }

  return {
    config: await loadLocalConfig(),
    configSource: "local_config",
  };
}

export async function loadLocalConfig(): Promise<PluginConfig> {
  const configPath = path.resolve("local.config.json");
  const raw = await readFile(configPath, "utf-8");
  const parsed = JSON.parse(raw) as LocalConfigShape;
  return resolvePluginConfigPaths(normalizePluginConfig(parsed.plugin ?? {}), process.cwd());
}

function normalizeConfigSource(value: string | undefined): "openclaw_plugin" | "local_config" {
  return value === "openclaw_plugin" ? "openclaw_plugin" : "local_config";
}
