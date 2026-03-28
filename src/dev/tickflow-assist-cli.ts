#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";

import JSON5 from "json5";

type JsonObject = Record<string, unknown>;
type AllowTarget = { type: "global" } | { type: "agent"; id: string };

type CliOptions = {
  command: "configure-openclaw" | "help";
  configPath?: string;
  pluginDir?: string;
  agentId?: string;
  globalTarget: boolean;
  nonInteractive: boolean;
  restart: boolean;
  enable: boolean;
  pythonSetup: boolean;
  openclawBin: string;
  overrides: Partial<PluginConfigInput>;
};

type PluginConfigInput = {
  tickflowApiUrl: string;
  tickflowApiKey: string;
  tickflowApiKeyLevel: "Free" | "Start" | "Pro" | "Expert";
  mxSearchApiUrl: string;
  mxSearchApiKey: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  requestInterval: number;
  dailyUpdateNotify: boolean;
  alertChannel: string;
  openclawCliBin: string;
  alertAccount: string;
  alertTarget: string;
  pythonBin: string;
  pythonArgs: string[];
  pythonWorkdir: string;
  databasePath: string;
  calendarFile: string;
};

const PLUGIN_ID = "tickflow-assist";
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".openclaw", "openclaw.json");
const DEFAULTS = {
  tickflowApiUrl: "https://api.tickflow.org",
  tickflowApiKeyLevel: "Free" as const,
  mxSearchApiUrl: "https://mkapi2.dfcfs.com/finskillshub/api/claw",
  mxSearchApiKey: "",
  llmBaseUrl: "https://api.openai.com/v1",
  llmModel: "gpt-4o",
  requestInterval: 30,
  dailyUpdateNotify: true,
  alertChannel: "telegram",
  openclawCliBin: "openclaw",
  alertAccount: "default",
  pythonBin: "uv",
  pythonArgs: ["run", "python"],
} as const;

function printUsage(): void {
  console.log(`TickFlow Assist CLI

Usage:
  tickflow-assist configure-openclaw [options]

Options:
  --config-path <path>         Override OpenClaw config path
  --plugin-dir <path>          Override installed plugin directory
  --agent <id>                Apply tools.allow to a specific agent
  --global                    Apply tools.allow to top-level tools config
  --non-interactive           Use existing config / flags only, no prompts
  --no-enable                 Do not run 'openclaw plugins enable'
  --no-restart                Do not run 'openclaw gateway restart'
  --no-python-setup           Do not run 'uv sync' for Python dependencies
  --openclaw-bin <path>       OpenClaw CLI binary, default: openclaw
  --tickflow-api-key <key>
  --tickflow-api-key-level <Free|Start|Pro|Expert>
  --mx-search-api-key <key>
  --llm-base-url <url>
  --llm-api-key <key>
  --llm-model <name>
  --alert-channel <name>
  --alert-account <name>
  --alert-target <target>
  -h, --help                  Show this help
`);
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let command: CliOptions["command"] = "help";
  const options: CliOptions = {
    command,
    globalTarget: false,
    nonInteractive: false,
    restart: true,
    enable: true,
    pythonSetup: true,
    openclawBin: DEFAULTS.openclawCliBin,
    overrides: {},
  };

  const first = args[0];
  if (first && !first.startsWith("-")) {
    if (first === "configure-openclaw") {
      command = "configure-openclaw";
      args.shift();
    } else if (first === "help") {
      command = "help";
      args.shift();
    }
  } else {
    command = "configure-openclaw";
  }
  options.command = command;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];
    const requireValue = (flag: string): string => {
      if (!next || next.startsWith("-")) {
        throw new Error(`${flag} requires a value`);
      }
      index += 1;
      return next;
    };

    switch (token) {
      case "-h":
      case "--help":
        options.command = "help";
        break;
      case "--config-path":
        options.configPath = requireValue(token);
        break;
      case "--plugin-dir":
        options.pluginDir = requireValue(token);
        break;
      case "--agent":
        options.agentId = requireValue(token);
        break;
      case "--global":
        options.globalTarget = true;
        break;
      case "--non-interactive":
        options.nonInteractive = true;
        break;
      case "--no-restart":
        options.restart = false;
        break;
      case "--no-python-setup":
        options.pythonSetup = false;
        break;
      case "--no-enable":
        options.enable = false;
        break;
      case "--openclaw-bin":
        options.openclawBin = requireValue(token);
        break;
      case "--tickflow-api-key":
        options.overrides.tickflowApiKey = requireValue(token);
        break;
      case "--tickflow-api-key-level":
        options.overrides.tickflowApiKeyLevel = normalizeApiKeyLevel(requireValue(token));
        break;
      case "--mx-search-api-key":
        options.overrides.mxSearchApiKey = requireValue(token);
        break;
      case "--llm-base-url":
        options.overrides.llmBaseUrl = requireValue(token);
        break;
      case "--llm-api-key":
        options.overrides.llmApiKey = requireValue(token);
        break;
      case "--llm-model":
        options.overrides.llmModel = requireValue(token);
        break;
      case "--alert-channel":
        options.overrides.alertChannel = requireValue(token);
        break;
      case "--alert-account":
        options.overrides.alertAccount = requireValue(token);
        break;
      case "--alert-target":
        options.overrides.alertTarget = requireValue(token);
        break;
      default:
        throw new Error(`unknown argument: ${token}`);
    }
  }

  return options;
}

function normalizeApiKeyLevel(value: string): PluginConfigInput["tickflowApiKeyLevel"] {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "free":
      return "Free";
    case "start":
      return "Start";
    case "pro":
      return "Pro";
    case "expert":
      return "Expert";
    default:
      throw new Error(`invalid tickflowApiKeyLevel: ${value}`);
  }
}

function resolveOpenClawConfigPath(input?: string): string {
  return input || process.env.OPENCLAW_CONFIG_PATH || DEFAULT_CONFIG_PATH;
}

function resolveStateDir(configPath: string): string {
  return process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || path.dirname(configPath);
}

async function readConfigFile(configPath: string): Promise<JsonObject> {
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON5.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as JsonObject;
    }
    throw new Error("OpenClaw config must be an object");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function getObject(parent: JsonObject, key: string): JsonObject {
  const current = parent[key];
  if (typeof current === "object" && current !== null && !Array.isArray(current)) {
    return current as JsonObject;
  }
  const created: JsonObject = {};
  parent[key] = created;
  return created;
}

function getArray(parent: JsonObject, key: string): unknown[] {
  const current = parent[key];
  if (Array.isArray(current)) {
    return current;
  }
  const created: unknown[] = [];
  parent[key] = created;
  return created;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function mergeAllowlist(target: JsonObject, pluginId: string): void {
  const allow = Array.isArray(target.allow)
    ? target.allow.map((value) => String(value))
    : [];
  target.allow = uniqueStrings([...allow, pluginId]);
}

function getExistingPluginConfig(root: JsonObject): Partial<PluginConfigInput> {
  const plugins = typeof root.plugins === "object" && root.plugins !== null
    ? (root.plugins as JsonObject)
    : {};
  const entries = typeof plugins.entries === "object" && plugins.entries !== null
    ? (plugins.entries as JsonObject)
    : {};
  const entry = typeof entries[PLUGIN_ID] === "object" && entries[PLUGIN_ID] !== null
    ? (entries[PLUGIN_ID] as JsonObject)
    : {};
  const config = typeof entry.config === "object" && entry.config !== null
    ? (entry.config as JsonObject)
    : {};

  const pythonArgs = Array.isArray(config.pythonArgs)
    ? config.pythonArgs.map((value) => String(value))
    : undefined;

  const requestInterval = Number(config.requestInterval ?? DEFAULTS.requestInterval);
  const dailyUpdateNotify =
    typeof config.dailyUpdateNotify === "boolean"
      ? config.dailyUpdateNotify
      : DEFAULTS.dailyUpdateNotify;

  return {
    tickflowApiUrl: stringValue(config.tickflowApiUrl, DEFAULTS.tickflowApiUrl),
    tickflowApiKey: stringValue(config.tickflowApiKey),
    tickflowApiKeyLevel: normalizeApiKeyLevel(stringValue(config.tickflowApiKeyLevel, DEFAULTS.tickflowApiKeyLevel)),
    mxSearchApiUrl: stringValue(config.mxSearchApiUrl, DEFAULTS.mxSearchApiUrl),
    mxSearchApiKey: stringValue(config.mxSearchApiKey, DEFAULTS.mxSearchApiKey),
    llmBaseUrl: stringValue(config.llmBaseUrl, DEFAULTS.llmBaseUrl),
    llmApiKey: stringValue(config.llmApiKey),
    llmModel: stringValue(config.llmModel, DEFAULTS.llmModel),
    requestInterval: Number.isFinite(requestInterval) ? Math.max(5, Math.trunc(requestInterval)) : DEFAULTS.requestInterval,
    dailyUpdateNotify,
    alertChannel: stringValue(config.alertChannel, DEFAULTS.alertChannel),
    openclawCliBin: stringValue(config.openclawCliBin, DEFAULTS.openclawCliBin),
    alertAccount: stringValue(config.alertAccount, DEFAULTS.alertAccount),
    alertTarget: stringValue(config.alertTarget),
    pythonBin: stringValue(config.pythonBin, DEFAULTS.pythonBin),
    pythonArgs: pythonArgs && pythonArgs.length > 0 ? pythonArgs : [...DEFAULTS.pythonArgs],
    pythonWorkdir: stringValue(config.pythonWorkdir),
    databasePath: stringValue(config.databasePath),
    calendarFile: stringValue(config.calendarFile),
  };
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function inferAllowTarget(root: JsonObject, options: CliOptions): AllowTarget {
  if (options.globalTarget) {
    return { type: "global" };
  }
  if (options.agentId) {
    return { type: "agent", id: options.agentId };
  }

  const agents = typeof root.agents === "object" && root.agents !== null
    ? (root.agents as JsonObject)
    : null;
  const list = Array.isArray(agents?.list) ? agents.list : [];
  const ids = list
    .filter((entry): entry is JsonObject => typeof entry === "object" && entry !== null)
    .map((entry) => stringValue(entry.id))
    .filter(Boolean);

  if (ids.includes("stock")) {
    return { type: "agent", id: "stock" };
  }
  if (ids.length === 1) {
    return { type: "agent", id: ids[0] };
  }
  return { type: "global" };
}

type ChannelInfo = { channel: string; accounts: string[] };

async function discoverConfiguredChannels(configPath: string): Promise<ChannelInfo[]> {
  try {
    const root = await readConfigFile(configPath);
    const channels = typeof root.channels === "object" && root.channels !== null
      ? (root.channels as JsonObject)
      : {};

    const results: ChannelInfo[] = [];
    for (const [name, value] of Object.entries(channels)) {
      if (typeof value !== "object" || value === null) continue;
      const entry = value as JsonObject;
      if (entry.enabled === false) continue;

      const accounts: string[] = [];
      if (typeof entry.accounts === "object" && entry.accounts !== null) {
        for (const [acctName, acctValue] of Object.entries(entry.accounts as JsonObject)) {
          if (typeof acctValue !== "object" || acctValue === null) continue;
          if ((acctValue as JsonObject).enabled === false) continue;
          accounts.push(acctName);
        }
      }
      results.push({ channel: name, accounts });
    }
    return results;
  } catch {
    return [];
  }
}

async function promptSelect(
  rl: ReturnType<typeof createInterface>,
  label: string,
  choices: { value: string; label: string }[],
  defaultValue: string,
): Promise<string> {
  const defaultIndex = Math.max(0, choices.findIndex((c) => c.value === defaultValue));

  let promptText = `\n  ${label}\n`;
  for (let i = 0; i < choices.length; i++) {
    const marker = i === defaultIndex ? " (默认)" : "";
    promptText += `    ${i + 1}) ${choices[i].label}${marker}\n`;
  }
  promptText += `  请选择 (1-${choices.length}) [${defaultIndex + 1}]: `;

  while (true) {
    const answer = (await rl.question(promptText)).trim();
    if (!answer) {
      return choices[defaultIndex].value;
    }
    const num = Number(answer);
    if (Number.isInteger(num) && num >= 1 && num <= choices.length) {
      return choices[num - 1].value;
    }
    console.error(`  请输入 1-${choices.length}`);
  }
}

async function promptAlertChannel(
  rl: ReturnType<typeof createInterface>,
  configPath: string,
  defaultChannel: string,
): Promise<{ channel: string; account: string }> {
  const configured = await discoverConfiguredChannels(configPath);

  let selectedChannel = defaultChannel;

  if (configured.length > 0) {
    const choices = configured.map((c) => {
      const acctLabel = c.accounts.length > 0 ? ` (accounts: ${c.accounts.join(", ")})` : "";
      return { value: c.channel, label: `${c.channel}${acctLabel}` };
    });
    choices.push({ value: "__manual__", label: "手动输入其他通道" });
    selectedChannel = await promptSelect(rl, "检测到 openclaw.json 中已有配置，请选择推送通道", choices, defaultChannel);
    if (selectedChannel === "__manual__") {
      selectedChannel = await promptString(rl, "Alert Channel", defaultChannel, true);
    }
  } else {
    const knownChannels = [
      { value: "telegram", label: "telegram" },
      { value: "discord", label: "discord" },
      { value: "qqbot", label: "qqbot" },
      { value: "wecom", label: "wecom" },
    ];
    selectedChannel = await promptSelect(rl, "推送通道", knownChannels, defaultChannel);
  }

  // Resolve account
  const channelAccounts = configured.find((c) => c.channel === selectedChannel)?.accounts ?? [];
  let selectedAccount = "";

  if (channelAccounts.length === 1) {
    selectedAccount = channelAccounts[0];
    console.log(`  已自动选择账号: ${selectedAccount}`);
  } else if (channelAccounts.length > 1) {
    const acctChoices = channelAccounts.map((a) => ({ value: a, label: a }));
    selectedAccount = await promptSelect(rl, "选择账号", acctChoices, channelAccounts[0]);
  } else {
    // Default for channels that typically need an account
    if (["qqbot", "wecom"].includes(selectedChannel)) {
      selectedAccount = "default";
    }
  }

  return { channel: selectedChannel, account: selectedAccount };
}

async function promptForConfig(
  options: CliOptions,
  existing: Partial<PluginConfigInput>,
  pluginDir: string,
  configPath: string,
): Promise<PluginConfigInput> {
  const defaults: PluginConfigInput = {
    tickflowApiUrl: DEFAULTS.tickflowApiUrl,
    tickflowApiKey: "",
    tickflowApiKeyLevel: DEFAULTS.tickflowApiKeyLevel,
    mxSearchApiUrl: DEFAULTS.mxSearchApiUrl,
    mxSearchApiKey: DEFAULTS.mxSearchApiKey,
    llmBaseUrl: DEFAULTS.llmBaseUrl,
    llmApiKey: "",
    llmModel: DEFAULTS.llmModel,
    requestInterval: DEFAULTS.requestInterval,
    dailyUpdateNotify: DEFAULTS.dailyUpdateNotify,
    alertChannel: DEFAULTS.alertChannel,
    openclawCliBin: options.openclawBin || DEFAULTS.openclawCliBin,
    alertAccount: DEFAULTS.alertAccount,
    alertTarget: "",
    pythonBin: DEFAULTS.pythonBin,
    pythonArgs: [...DEFAULTS.pythonArgs],
    pythonWorkdir: path.join(pluginDir, "python"),
    databasePath: path.join(pluginDir, "data", "lancedb"),
    calendarFile: path.join(pluginDir, "day_future.txt"),
  };

  const seed: PluginConfigInput = {
    ...defaults,
    ...existing,
    ...options.overrides,
    openclawCliBin: options.openclawBin || existing.openclawCliBin || DEFAULTS.openclawCliBin,
    pythonWorkdir: path.join(pluginDir, "python"),
    databasePath: path.join(pluginDir, "data", "lancedb"),
    calendarFile: path.join(pluginDir, "day_future.txt"),
  };

  if (options.nonInteractive) {
    assertRequired(seed);
    return seed;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("TickFlow Assist 社区安装配置向导");
    console.log(`OpenClaw 配置文件: ${configPath}`);
    console.log(`插件目录: ${pluginDir}`);
    console.log("");

    seed.tickflowApiKey = await promptString(rl, "TickFlow API Key", seed.tickflowApiKey, true);

    seed.tickflowApiKeyLevel = normalizeApiKeyLevel(
      await promptSelect(rl, "TickFlow 订阅等级", [
        { value: "Free", label: "Free" },
        { value: "Start", label: "Start" },
        { value: "Pro", label: "Pro" },
        { value: "Expert", label: "Expert" },
      ], seed.tickflowApiKeyLevel),
    );

    seed.mxSearchApiKey = await promptString(rl, "MX Search API Key (可留空)", seed.mxSearchApiKey, false);
    seed.llmBaseUrl = await promptString(rl, "LLM Base URL", seed.llmBaseUrl, true);
    seed.llmApiKey = await promptString(rl, "LLM API Key", seed.llmApiKey, true);
    seed.llmModel = await promptString(rl, "LLM Model", seed.llmModel, true);

    console.log("");
    const alertResult = await promptAlertChannel(rl, configPath, seed.alertChannel);
    seed.alertChannel = alertResult.channel;
    seed.alertAccount = alertResult.account;

    let targetLabel = "Alert Target";
    if (seed.alertAccount) {
      targetLabel = `已选通道 [${seed.alertChannel}] 及账号 [${seed.alertAccount}]，请输入 Alert Target`;
    } else {
      targetLabel = `已选通道 [${seed.alertChannel}]，请输入 Alert Target`;
    }

    seed.alertTarget = await promptString(rl, targetLabel, seed.alertTarget, false);
    seed.requestInterval = await promptInteger(rl, "Request Interval (seconds)", seed.requestInterval, 5);
    seed.dailyUpdateNotify = await promptBoolean(rl, "Daily Update Notify", seed.dailyUpdateNotify);
  } finally {
    rl.close();
  }

  assertRequired(seed);
  return seed;
}

async function promptString(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: string,
  required: boolean,
): Promise<string> {
  while (true) {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    const value = answer || defaultValue;
    if (!required || value) {
      return value;
    }
    console.error(`${label} 不能为空`);
  }
}

async function promptInteger(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: number,
  minimum: number,
): Promise<number> {
  while (true) {
    const answer = (await rl.question(`${label} [${defaultValue}]: `)).trim();
    const value = answer ? Number(answer) : defaultValue;
    if (Number.isFinite(value) && value >= minimum) {
      return Math.trunc(value);
    }
    console.error(`${label} 必须是 >= ${minimum} 的整数`);
  }
}

async function promptBoolean(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  while (true) {
    const answer = (await rl.question(`${label} [${defaultValue ? "Y/n" : "y/N"}]: `)).trim().toLowerCase();
    if (!answer) {
      return defaultValue;
    }
    if (["y", "yes", "1", "true"].includes(answer)) {
      return true;
    }
    if (["n", "no", "0", "false"].includes(answer)) {
      return false;
    }
    console.error(`${label} 请输入 y 或 n`);
  }
}

function assertRequired(config: PluginConfigInput): void {
  if (!config.tickflowApiKey) {
    throw new Error("tickflowApiKey is required");
  }
  if (!config.llmApiKey) {
    throw new Error("llmApiKey is required");
  }
}

async function ensurePathNotice(targetPath: string, label: string): Promise<void> {
  try {
    await access(targetPath);
  } catch {
    console.warn(`Warning: ${label} not found at ${targetPath}`);
  }
}

function applyPluginConfig(root: JsonObject, config: PluginConfigInput, target: AllowTarget): void {
  const plugins = getObject(root, "plugins");
  plugins.enabled = true;
  const entries = getObject(plugins, "entries");
  const pluginEntry = getObject(entries, PLUGIN_ID);
  pluginEntry.enabled = true;
  pluginEntry.config = {
    tickflowApiUrl: config.tickflowApiUrl,
    tickflowApiKey: config.tickflowApiKey,
    tickflowApiKeyLevel: config.tickflowApiKeyLevel,
    mxSearchApiUrl: config.mxSearchApiUrl,
    mxSearchApiKey: config.mxSearchApiKey,
    llmBaseUrl: config.llmBaseUrl,
    llmApiKey: config.llmApiKey,
    llmModel: config.llmModel,
    databasePath: config.databasePath,
    calendarFile: config.calendarFile,
    requestInterval: config.requestInterval,
    dailyUpdateNotify: config.dailyUpdateNotify,
    alertChannel: config.alertChannel,
    openclawCliBin: config.openclawCliBin,
    alertAccount: config.alertAccount,
    alertTarget: config.alertTarget,
    pythonBin: config.pythonBin,
    pythonArgs: config.pythonArgs,
    pythonWorkdir: config.pythonWorkdir,
  };

  const pluginAllow = Array.isArray(plugins.allow)
    ? plugins.allow.map((value) => String(value))
    : [];
  plugins.allow = uniqueStrings([...pluginAllow, PLUGIN_ID]);

  if (target.type === "global") {
    const tools = getObject(root, "tools");
    mergeAllowlist(tools, PLUGIN_ID);
    return;
  }

  const agents = getObject(root, "agents");
  const list = getArray(agents, "list");
  let matched = false;

  for (const item of list) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const entry = item as JsonObject;
    if (stringValue(entry.id) !== target.id) {
      continue;
    }
    const tools = getObject(entry, "tools");
    mergeAllowlist(tools, PLUGIN_ID);
    matched = true;
  }

  if (!matched) {
    list.push({
      id: target.id,
      tools: {
        allow: [PLUGIN_ID],
      },
    });
  }
}

async function writeConfig(configPath: string, root: JsonObject): Promise<string | null> {
  await mkdir(path.dirname(configPath), { recursive: true });

  let backupPath: string | null = null;
  try {
    const existing = await readFile(configPath, "utf-8");
    backupPath = `${configPath}.backup.${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await writeFile(backupPath, existing, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await writeFile(configPath, `${JSON.stringify(root, null, 2)}\n`, "utf-8");
  return backupPath;
}

function runOpenClaw(bin: string, args: string[], description: string): void {
  const result = spawnSync(bin, args, { stdio: "inherit" });
  if (result.error) {
    console.warn(`Warning: failed to run ${description}: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    console.warn(`Warning: ${description} exited with status ${result.status}`);
  }
}

async function setupPythonDeps(pythonWorkdir: string, nonInteractive: boolean): Promise<void> {
  let uvBin = "uv";
  try {
    const which = spawnSync("which", ["uv"], { encoding: "utf-8" });
    if (which.status !== 0) {
      console.warn("\n  ⚠️ 找不到 uv (Python 包管理工具)，已跳过 Python 依赖安装。");
      console.warn("  请先手动安装 uv，再在以下目录执行 `uv sync`：");
      console.warn(`  ${pythonWorkdir}`);
      return;
    } else {
      uvBin = which.stdout.trim() || "uv";
    }
  } catch {
    // fall through with default "uv"
  }

  console.log(`Setting up Python dependencies in ${pythonWorkdir} ...`);
  const result = spawnSync(uvBin, ["sync"], { cwd: pythonWorkdir, stdio: "inherit" });
  if (result.error) {
    console.warn(`Warning: failed to run uv sync: ${result.error.message}`);
    console.warn("Please run 'uv sync' manually in:");
    console.warn(`  ${pythonWorkdir}`);
    return;
  }
  if (result.status !== 0) {
    console.warn(`Warning: uv sync exited with status ${result.status}`);
    console.warn("Please check the output above and run 'uv sync' manually if needed in:");
    console.warn(`  ${pythonWorkdir}`);
    return;
  }
  console.log("Python dependencies installed successfully.");
}

async function configureOpenClaw(options: CliOptions): Promise<void> {
  const configPath = resolveOpenClawConfigPath(options.configPath);
  const stateDir = resolveStateDir(configPath);
  const pluginDir = path.resolve(options.pluginDir || path.join(stateDir, "extensions", PLUGIN_ID));
  const root = await readConfigFile(configPath);
  const target = inferAllowTarget(root, options);
  const existing = getExistingPluginConfig(root);
  const config = await promptForConfig(options, existing, pluginDir, configPath);

  await ensurePathNotice(config.calendarFile, "calendarFile");
  await ensurePathNotice(config.pythonWorkdir, "pythonWorkdir");

  if (options.pythonSetup) {
    await setupPythonDeps(config.pythonWorkdir, options.nonInteractive);
  }

  applyPluginConfig(root, config, target);
  const backupPath = await writeConfig(configPath, root);

  console.log("");
  console.log(`Updated OpenClaw config: ${configPath}`);
  if (backupPath) {
    console.log(`Backup created: ${backupPath}`);
  }
  console.log(`Plugin dir: ${pluginDir}`);
  console.log(`Allowlist target: ${target.type === "global" ? "global tools" : `agent:${target.id}`}`);

  if (options.enable) {
    runOpenClaw(options.openclawBin, ["plugins", "enable", PLUGIN_ID], "openclaw plugins enable");
  }
  runOpenClaw(options.openclawBin, ["config", "validate"], "openclaw config validate");
  if (options.restart) {
    runOpenClaw(options.openclawBin, ["gateway", "restart"], "openclaw gateway restart");
  }
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === "help") {
      printUsage();
      return;
    }
    await configureOpenClaw(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

void main();
