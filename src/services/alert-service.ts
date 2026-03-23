
import { spawn } from "node:child_process";

import type {
  OpenClawPluginConfig,
  OpenClawPluginRuntime,
} from "../runtime/plugin-api.js";
import { calculateProfitPct, formatCostPrice } from "../utils/cost-price.js";

interface AlertRuntimeContext {
  config: OpenClawPluginConfig;
  runtime: OpenClawPluginRuntime;
}

interface AlertServiceOptions {
  openclawCliBin: string;
  channel: string;
  account: string;
  target: string;
  runtime?: AlertRuntimeContext;
}

export class AlertService {
  private lastError: string | null = null;

  constructor(private readonly options: AlertServiceOptions) {}

  async send(message: string): Promise<boolean> {
    this.lastError = null;

    const runtimeError = await this.trySendViaRuntime(message);
    if (runtimeError === null) {
      return true;
    }

    const fallbackError = this.options.runtime
      ? await this.trySendViaRuntimeCommand(message)
      : await this.trySendViaSpawn(message);

    if (fallbackError === null) {
      return true;
    }

    this.lastError = this.combineErrors(runtimeError, fallbackError);
    return false;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getCliBinary(): string {
    return this.options.openclawCliBin;
  }

  formatSystemNotification(title: string, lines: string[]): string {
    return [title, lines.join("\n")].filter(Boolean).join("\n\n").trim();
  }

  formatPriceAlert(params: {
    symbol: string;
    name: string;
    currentPrice: number;
    ruleName: string;
    ruleDescription: string;
    levelPrice: number;
    costPrice: number | null;
  }): string {
    const profitPct = calculateProfitPct(params.currentPrice, params.costPrice);

    return [
      `🚨 ${params.ruleName}告警`,
      "",
      `📌 ${params.name}（${params.symbol}）`,
      `💹 当前价: ${params.currentPrice.toFixed(2)}`,
      `📊 触发价位: ${params.levelPrice.toFixed(2)}`,
      `📝 ${params.ruleDescription}`,
      ...(profitPct == null
        ? []
        : [
            `💰 持仓盈亏: ${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%（成本 ${formatCostPrice(params.costPrice)}）`,
          ]),
      "",
      "⏰ 请及时关注！",
    ].join("\n");
  }

  formatVolumeAlert(params: {
    symbol: string;
    name: string;
    currentPrice: number;
    currentVolume: number;
    avgVolume: number;
    ratio: number;
  }): string {
    return [
      "📊 成交量异动",
      "",
      `📌 ${params.name}（${params.symbol}）`,
      `💹 当前价: ${params.currentPrice.toFixed(2)}`,
      `📈 当前成交量: ${params.currentVolume.toLocaleString("en-US")}`,
      `📉 近5日均量: ${params.avgVolume.toFixed(0)}`,
      `⚡ 量比: ${params.ratio.toFixed(1)}倍`,
      "",
      "⚠️ 成交量显著放大，请关注盘面变化！",
    ].join("\n");
  }

  private get channel(): string {
    return this.options.channel.trim().toLowerCase();
  }

  private combineErrors(runtimeError: string | null, fallbackError: string): string {
    if (!runtimeError || runtimeError === "runtime delivery unavailable") {
      return fallbackError;
    }
    return `${runtimeError}; ${fallbackError}`;
  }

  private async trySendViaRuntime(message: string): Promise<string | null> {
    const runtimeContext = this.options.runtime;
    if (!runtimeContext || !this.options.target.trim()) {
      return "runtime delivery unavailable";
    }

    const baseOptions = {
      accountId: this.options.account || undefined,
      cfg: runtimeContext.config,
    };

    try {
      switch (this.channel) {
        case "telegram":
          await runtimeContext.runtime.channel.telegram.sendMessageTelegram(
            this.options.target,
            message,
            baseOptions,
          );
          return null;
        case "discord":
          await runtimeContext.runtime.channel.discord.sendMessageDiscord(
            this.options.target,
            message,
            baseOptions,
          );
          return null;
        case "slack":
          await runtimeContext.runtime.channel.slack.sendMessageSlack(
            this.options.target,
            message,
            baseOptions,
          );
          return null;
        case "signal":
          await runtimeContext.runtime.channel.signal.sendMessageSignal(
            this.options.target,
            message,
            baseOptions,
          );
          return null;
        case "imessage":
          await runtimeContext.runtime.channel.imessage.sendMessageIMessage(
            this.options.target,
            message,
            {
              accountId: this.options.account || undefined,
              config: runtimeContext.config,
            },
          );
          return null;
        case "whatsapp":
          await runtimeContext.runtime.channel.whatsapp.sendMessageWhatsApp(
            this.options.target,
            message,
            {
              verbose: false,
              cfg: runtimeContext.config,
              accountId: this.options.account || undefined,
            },
          );
          return null;
        default:
          return `runtime delivery not supported for channel: ${this.channel}`;
      }
    } catch (error) {
      return `runtime delivery failed: ${formatErrorMessage(error)}`;
    }
  }

  private async trySendViaRuntimeCommand(message: string): Promise<string | null> {
    const runtimeContext = this.options.runtime;
    if (!runtimeContext) {
      return "runtime command unavailable";
    }

    try {
      const result = await runtimeContext.runtime.system.runCommandWithTimeout(
        this.buildCliArgs(message),
        { timeoutMs: 15_000 },
      );
      if (result.code === 0) {
        return null;
      }

      return (
        result.stderr.trim()
        || result.stdout.trim()
        || `command exited with ${result.code ?? "unknown"}`
      );
    } catch (error) {
      return `runtime command failed: ${formatErrorMessage(error)}`;
    }
  }

  private async trySendViaSpawn(message: string): Promise<string | null> {
    const argv = this.buildCliArgs(message);
    const [command, ...args] = argv;

    return new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (value: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        finish(`spawn failed: ${error.message}`);
      });
      child.on("close", (code) => {
        finish(code === 0 ? null : (stderr || stdout || `exit code ${code}`).trim());
      });
    });
  }

  private buildCliArgs(message: string): string[] {
    const args = [
      this.options.openclawCliBin,
      "message",
      "send",
      "--channel",
      this.channel,
      "--message",
      message,
    ];

    if (this.options.target) {
      args.push("--target", this.options.target);
    }
    if (this.options.account) {
      args.push("--account", this.options.account);
    }
    return args;
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
