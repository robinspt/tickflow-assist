import { createCommandRunner, type RunCommandWithTimeout } from "../runtime/command-runner.js";
import type {
  OpenClawPluginConfig,
  OpenClawPluginRuntime,
} from "../runtime/plugin-api.js";
import type { KeyLevels } from "../types/domain.js";
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

export interface AlertSendInput {
  message: string;
  mediaPath?: string;
  mediaLocalRoots?: readonly string[];
  filename?: string;
}

export interface AlertSendResult {
  ok: boolean;
  mediaAttempted: boolean;
  mediaDelivered: boolean;
  error: string | null;
  deliveryUncertain?: boolean;
}

interface AlertDeliveryFailure {
  error: string;
  ambiguous: boolean;
}

export class AlertService {
  private lastError: string | null = null;
  private readonly runCommandWithTimeout: RunCommandWithTimeout;

  constructor(private readonly options: AlertServiceOptions) {
    this.runCommandWithTimeout = createCommandRunner(options.runtime?.runtime);
  }

  async send(input: string | AlertSendInput): Promise<boolean> {
    const result = await this.sendWithResult(input);
    this.lastError = result.ok ? null : result.error;
    return result.ok;
  }

  async sendWithResult(input: string | AlertSendInput): Promise<AlertSendResult> {
    this.lastError = null;
    const payload = normalizeSendInput(input);

    const mediaAttempted = Boolean(payload.mediaPath);
    const primaryFailure = await this.trySendPayload(payload);
    if (primaryFailure === null) {
      return {
        ok: true,
        mediaAttempted,
        mediaDelivered: mediaAttempted,
        error: null,
      };
    }

    if (payload.mediaPath) {
      if (primaryFailure.ambiguous) {
        return {
          ok: false,
          mediaAttempted: true,
          mediaDelivered: false,
          error: primaryFailure.error,
          deliveryUncertain: true,
        };
      }

      const textFallback = normalizeSendInput(payload.message);
      const textFallbackFailure = await this.trySendPayload(textFallback);
      if (textFallbackFailure === null) {
        return {
          ok: true,
          mediaAttempted: true,
          mediaDelivered: false,
          error: primaryFailure.error,
        };
      }

      return {
        ok: false,
        mediaAttempted: true,
        mediaDelivered: false,
        error: this.combineErrors(primaryFailure.error, textFallbackFailure.error),
      };
    }

    return {
      ok: false,
      mediaAttempted: false,
      mediaDelivered: false,
      error: primaryFailure.error,
    };
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
    ruleCode: string;
    title: string;
    ruleDescription: string;
    levelPrice: number;
    costPrice: number | null;
    referenceLabel?: string;
    dailyChangePct?: number | null;
    relatedLevels?: KeyLevels | null;
  }): string {
    const profitPct = calculateProfitPct(params.currentPrice, params.costPrice);
    const distancePct = params.levelPrice > 0
      ? ((params.currentPrice - params.levelPrice) / params.levelPrice) * 100
      : null;
    const style = getAlertStyle(params.ruleCode, params.title);
    const levelRail = formatLevelRail(params.currentPrice, params.relatedLevels);
    const referenceLabel = params.referenceLabel ?? "触发位";
    const referenceIcon = params.referenceLabel ? "📊" : "🎯";
    const metrics = [
      params.dailyChangePct == null
        ? null
        : `${params.dailyChangePct >= 0 ? "📈" : "📉"} 当日 ${formatSignedPercent(params.dailyChangePct)}`,
      distancePct == null ? null : `📏 偏离 ${formatSignedPercent(distancePct)}`,
    ].filter((value): value is string => Boolean(value));

    return [
      `**${style.banner}【${style.label}】**`,
      `📌 ${params.name}（${params.symbol}）`,
      `💹 现价 ${params.currentPrice.toFixed(2)} | ${referenceIcon} ${referenceLabel} ${params.levelPrice.toFixed(2)}`,
      ...(!metrics.length ? [] : [metrics.join(" | ")]),
      `📍 信号：${params.ruleDescription}`,
      ...(levelRail ? [`🧭 位阶图：${levelRail}`] : []),
      ...(profitPct == null
        ? []
        : [
            `💰 持仓盈亏：${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%（成本 ${formatCostPrice(params.costPrice)}）`,
          ]),
      "⏰ 请及时关注",
    ].join("\n");
  }

  formatVolumeAlert(params: {
    symbol: string;
    name: string;
    currentPrice: number;
    currentVolume: number;
    avgVolume: number;
    ratio: number;
    dailyChangePct?: number | null;
    relatedLevels?: KeyLevels | null;
  }): string {
    const levelRail = formatLevelRail(params.currentPrice, params.relatedLevels);

    return [
      "**🟪【放量异动】**",
      `📌 ${params.name}（${params.symbol}）`,
      [
        `💹 现价 ${params.currentPrice.toFixed(2)}`,
        params.dailyChangePct == null
          ? null
          : `${params.dailyChangePct >= 0 ? "📈" : "📉"} 当日 ${formatSignedPercent(params.dailyChangePct)}`,
      ].filter((value): value is string => Boolean(value)).join(" | "),
      `📈 当前成交量 ${params.currentVolume.toLocaleString("en-US")} | 📉 近5日均量 ${params.avgVolume.toFixed(0)}`,
      `⚡ 量比 ${params.ratio.toFixed(1)}倍`,
      ...(levelRail ? [`🧭 位阶图：${levelRail}`] : []),
      "📍 信号：成交量显著放大，请关注盘面变化",
      "⏰ 请及时关注",
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

  private async trySendPayload(payload: AlertSendInput): Promise<AlertDeliveryFailure | null> {
    const runtimeFailure = await this.trySendViaRuntime(payload);
    if (runtimeFailure === null) {
      return null;
    }

    if (runtimeFailure.ambiguous) {
      return runtimeFailure;
    }

    return await this.trySendViaCommand(payload);
  }

  private async trySendViaRuntime(payload: AlertSendInput): Promise<AlertDeliveryFailure | null> {
    const runtimeContext = this.options.runtime;
    if (!runtimeContext || !this.options.target.trim()) {
      return {
        error: "runtime delivery unavailable",
        ambiguous: false,
      };
    }

    const baseOptions = {
      accountId: this.options.account || undefined,
      cfg: runtimeContext.config,
      mediaUrl: payload.mediaPath,
      mediaLocalRoots: payload.mediaLocalRoots,
    };

    try {
      switch (this.channel) {
        case "telegram":
          await this.invokeRuntimeChannelSend(
            runtimeContext.runtime.channel,
            "telegram",
            "sendMessageTelegram",
            this.options.target,
            payload.message,
            baseOptions,
          );
          return null;
        case "discord":
          await this.invokeRuntimeChannelSend(
            runtimeContext.runtime.channel,
            "discord",
            "sendMessageDiscord",
            this.options.target,
            payload.message,
            {
              ...baseOptions,
              filename: payload.filename,
            },
          );
          return null;
        case "slack":
          await this.invokeRuntimeChannelSend(
            runtimeContext.runtime.channel,
            "slack",
            "sendMessageSlack",
            this.options.target,
            payload.message,
            {
              ...baseOptions,
              uploadFileName: payload.filename,
              uploadTitle: payload.filename,
            },
          );
          return null;
        case "signal":
          await this.invokeRuntimeChannelSend(
            runtimeContext.runtime.channel,
            "signal",
            "sendMessageSignal",
            this.options.target,
            payload.message,
            baseOptions,
          );
          return null;
        default:
          // OpenClaw 2026.3.31 narrows the typed runtime channel surface.
          // Fall back to `openclaw message send` for channels not exposed here.
          return {
            error: `runtime delivery not supported for channel: ${this.channel}`,
            ambiguous: false,
          };
      }
    } catch (error) {
      return {
        error: `runtime delivery failed: ${formatErrorMessage(error)}`,
        ambiguous: true,
      };
    }
  }

  private async invokeRuntimeChannelSend(
    runtimeChannel: unknown,
    channelName: string,
    methodName: string,
    target: string,
    message: string,
    options: Record<string, unknown>,
  ): Promise<void> {
    const channelApi = getRuntimeChannelApi(runtimeChannel, channelName);
    const method = channelApi?.[methodName];
    if (typeof method !== "function") {
      throw new Error(`runtime channel ${channelName}.${methodName} unavailable`);
    }

    await method.call(channelApi, target, message, options);
  }

  private async trySendViaCommand(payload: AlertSendInput): Promise<AlertDeliveryFailure | null> {
    try {
      const result = await this.runCommandWithTimeout(
        this.buildCliArgs(payload),
        { timeoutMs: 15_000 },
      );
      if (result.code === 0) {
        return null;
      }

      return {
        error:
          result.stderr.trim()
          || result.stdout.trim()
          || `command exited with ${result.code ?? "unknown"}`,
        ambiguous: true,
      };
    } catch (error) {
      return {
        error: `command delivery failed: ${formatErrorMessage(error)}`,
        ambiguous: false,
      };
    }
  }

  private buildCliArgs(payload: AlertSendInput): string[] {
    const args = [
      this.options.openclawCliBin,
      "message",
      "send",
      "--channel",
      this.channel,
    ];

    if (payload.message) {
      args.push("--message", payload.message);
    }

    if (payload.mediaPath) {
      args.push("--media", payload.mediaPath);
    }
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

function normalizeSendInput(input: string | AlertSendInput): AlertSendInput {
  return typeof input === "string"
    ? { message: input }
    : input;
}

function getRuntimeChannelApi(runtimeChannel: unknown, channelName: string): Record<string, unknown> | null {
  if (!isRecord(runtimeChannel)) {
    return null;
  }

  const channelApi = runtimeChannel[channelName];
  return isRecord(channelApi) ? channelApi : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAlertStyle(ruleCode: string, fallbackTitle: string): { banner: string; label: string } {
  switch (ruleCode) {
    case "stop_loss_hit":
      return { banner: "🟥", label: "止损执行" };
    case "stop_loss_near":
      return { banner: "🟧", label: "止损预警" };
    case "breakthrough_hit":
      return { banner: "🟩", label: "突破确认" };
    case "support_near":
      return { banner: "🟦", label: "支撑观察" };
    case "resistance_near":
      return { banner: "🟨", label: "压力试探" };
    case "take_profit_hit":
      return { banner: "🟪", label: "止盈兑现" };
    case "change_pct_涨":
      return { banner: "🟩", label: "涨幅异动" };
    case "change_pct_跌":
      return { banner: "🟥", label: "跌幅异动" };
    default:
      return { banner: "🚨", label: fallbackTitle };
  }
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatLevelRail(currentPrice: number, levels?: KeyLevels | null): string | null {
  const markers = [
    { icon: "⛔", label: "止损", value: levels?.stop_loss },
    { icon: "🛡️", label: "支撑", value: levels?.support },
    { icon: "💹", label: "现价", value: currentPrice },
    { icon: "🚧", label: "压力", value: levels?.resistance },
    { icon: "🚀", label: "突破", value: levels?.breakthrough },
    { icon: "🎯", label: "止盈", value: levels?.take_profit },
  ];

  const merged = new Map<string, { value: number; parts: string[] }>();
  for (const marker of markers) {
    if (!(marker.value != null && Number.isFinite(marker.value) && marker.value > 0)) {
      continue;
    }

    const key = marker.value.toFixed(2);
    const part = `${marker.icon}${marker.label}`;
    const existing = merged.get(key);
    if (existing) {
      if (!existing.parts.includes(part)) {
        existing.parts.push(part);
      }
      continue;
    }

    merged.set(key, {
      value: marker.value,
      parts: [part],
    });
  }

  if (merged.size < 2) {
    return null;
  }

  return [...merged.values()]
    .sort((left, right) => left.value - right.value)
    .map((entry) => `${entry.parts.join("/")} ${entry.value.toFixed(2)}`)
    .join(" → ");
}
