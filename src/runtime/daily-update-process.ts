import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { PluginConfig } from "../config/schema.js";
import { buildProcessConfigEnv } from "./process-config.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DAILY_UPDATE_LOOP_SCRIPT = fileURLToPath(new URL("../dev/run-daily-update-loop.js", import.meta.url));

export function spawnDailyUpdateLoop(
  config: PluginConfig,
  configSource: "openclaw_plugin" | "local_config",
): number | null {
  const child = spawn(process.execPath, [DAILY_UPDATE_LOOP_SCRIPT], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
    env: buildProcessConfigEnv(config, configSource),
  });
  child.unref();
  return child.pid ?? null;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
