import { readFile } from "node:fs/promises";
import path from "node:path";

import { createAppContext } from "../bootstrap.js";
import { normalizePluginConfig, resolvePluginConfigPaths } from "../config/normalize.js";

interface LocalConfigShape {
  plugin?: Record<string, unknown>;
}

async function main(): Promise<void> {
  const [, , toolName, ...rest] = process.argv;
  if (!toolName) {
    throw new Error("usage: npm run tool -- <tool-name> [json-or-plain-args]");
  }

  const config = await loadLocalConfig();
  const app = createAppContext(config, { configSource: "local_config" });
  const normalizedToolName = normalizeToolName(toolName);
  const tool = app.tools.find((entry) => entry.name === normalizedToolName);
  if (!tool) {
    throw new Error(`tool not found: ${toolName}`);
  }

  const rawInput = parseToolInput(rest);
  const output = await tool.run({ rawInput });
  process.stdout.write(`${output}\n`);
}

async function loadLocalConfig() {
  const configPath = path.resolve("local.config.json");
  const raw = await readFile(configPath, "utf-8");
  const parsed = JSON.parse(raw) as LocalConfigShape;
  return resolvePluginConfigPaths(normalizePluginConfig(parsed.plugin ?? {}), process.cwd());
}

function parseToolInput(args: string[]): unknown {
  if (args.length === 0) {
    return undefined;
  }

  const joined = args.join(" ").trim();
  if (!joined) {
    return undefined;
  }

  try {
    return JSON.parse(joined);
  } catch {
    return joined;
  }
}

function normalizeToolName(name: string): string {
  return name.replace(/-/g, "_");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
