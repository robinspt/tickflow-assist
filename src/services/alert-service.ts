import { randomBytes } from "node:crypto";
import { copyFile, mkdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createCommandRunner, type RunCommandWithTimeout } from "../runtime/command-runner.js";
import type {
  OpenClawPluginConfig,
  OpenClawPluginRuntime,
} from "../runtime/plugin-api.js";
import type { KeyLevels } from "../types/domain.js";
import {
  AlertDiagnosticLogger,
  basenameOrUndefined,
  buildAlertMessageHash,
  buildAlertSendId,
  truncateDiagnosticText,
} from "../utils/alert-diagnostic-log.js";
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
  diagnosticLogger?: AlertDiagnosticLogger;
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

interface AlertSendDiagnosticContext {
  sendId: string;
  step: "primary" | "text_fallback";
  messageHash: string;
}

interface PreparedCommandPayload {
  payload: AlertSendInput;
  cleanup: () => Promise<void>;
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
    const sendId = buildAlertSendId(payload.message);
    const messageHash = buildAlertMessageHash(payload.message);
    const diagnosticContext: AlertSendDiagnosticContext = {
      sendId,
      step: "primary",
      messageHash,
    };

    const mediaAttempted = Boolean(payload.mediaPath);
    await this.logDiagnostic("send_started", {
      sendId,
      step: diagnosticContext.step,
      channel: this.channel,
      messageHash,
      messageLength: payload.message.length,
      hasMedia: mediaAttempted,
      mediaFile: basenameOrUndefined(payload.mediaPath),
      filename: payload.filename,
      accountConfigured: Boolean(this.options.account.trim()),
      targetConfigured: Boolean(this.options.target.trim()),
      runtimeAvailable: Boolean(this.options.runtime),
      messagePreview: truncateDiagnosticText(payload.message.split("\n")[0] ?? ""),
    });

    const primaryFailure = await this.trySendPayload(payload, diagnosticContext);
    if (primaryFailure === null) {
      const result = {
        ok: true,
        mediaAttempted,
        mediaDelivered: mediaAttempted,
        error: null,
      };
      await this.logCompletion(sendId, messageHash, payload, result);
      return result;
    }

    if (payload.mediaPath) {
      if (primaryFailure.ambiguous) {
        const result = {
          ok: false,
          mediaAttempted: true,
          mediaDelivered: false,
          error: primaryFailure.error,
          deliveryUncertain: true,
        };
        await this.logCompletion(sendId, messageHash, payload, result);
        return result;
      }

      const textFallback = normalizeSendInput(payload.message);
      const textFallbackFailure = await this.trySendPayload(textFallback, {
        sendId,
        step: "text_fallback",
        messageHash,
      });
      if (textFallbackFailure === null) {
        const result = {
          ok: true,
          mediaAttempted: true,
          mediaDelivered: false,
          error: primaryFailure.error,
        };
        await this.logCompletion(sendId, messageHash, payload, result);
        return result;
      }

      const result = {
        ok: false,
        mediaAttempted: true,
        mediaDelivered: false,
        error: this.combineErrors(primaryFailure.error, textFallbackFailure.error),
      };
      await this.logCompletion(sendId, messageHash, payload, result);
      return result;
    }

    const result = {
      ok: false,
      mediaAttempted: false,
      mediaDelivered: false,
      error: primaryFailure.error,
    };
    await this.logCompletion(sendId, messageHash, payload, result);
    return result;
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

  private async trySendPayload(
    payload: AlertSendInput,
    context: AlertSendDiagnosticContext,
  ): Promise<AlertDeliveryFailure | null> {
    // OpenClaw documents `api.runtime.channel` as channel-plugin-specific helper
    // surface. For a regular tool/service plugin like tickflow-assist, Telegram
    // and QQ Bot delivery are more reliable via the shared
    // `openclaw message send` CLI path.
    if (this.channel === "telegram" || this.channel === "qqbot") {
      return await this.trySendViaCommand(payload, context);
    }

    const runtimeFailure = await this.trySendViaRuntime(payload, context);
    if (runtimeFailure === null) {
      return null;
    }

    // Only image/media sends are risky to replay after an ambiguous transport error.
    // Text-only notifications (for example session boundary notifications) should
    // still fall back to the CLI path so transient runtime failures do not drop them.
    if (runtimeFailure.ambiguous && payload.mediaPath) {
      return runtimeFailure;
    }

    return await this.trySendViaCommand(payload, context);
  }

  private async trySendViaRuntime(
    payload: AlertSendInput,
    context: AlertSendDiagnosticContext,
  ): Promise<AlertDeliveryFailure | null> {
    const runtimeContext = this.options.runtime;
    if (!runtimeContext || !this.options.target.trim()) {
      const failure = {
        error: "runtime delivery unavailable",
        ambiguous: false,
      };
      await this.logTransportFailure("runtime_unavailable", context, payload, failure);
      return failure;
    }

    const baseOptions = {
      accountId: this.options.account || undefined,
      cfg: runtimeContext.config,
      mediaUrl: payload.mediaPath,
      mediaLocalRoots: payload.mediaLocalRoots,
    };

    try {
      switch (this.channel) {
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
          break;
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
          break;
        case "signal":
          await this.invokeRuntimeChannelSend(
            runtimeContext.runtime.channel,
            "signal",
            "sendMessageSignal",
            this.options.target,
            payload.message,
            baseOptions,
          );
          break;
        default:
          // OpenClaw 2026.3.31 narrows the typed runtime channel surface.
          // Fall back to `openclaw message send` for channels not exposed here.
          const failure = {
            error: `runtime delivery not supported for channel: ${this.channel}`,
            ambiguous: false,
          };
          await this.logTransportFailure("runtime_unsupported", context, payload, failure);
          return failure;
      }
      await this.logDiagnostic("transport_success", {
        sendId: context.sendId,
        step: context.step,
        transport: "runtime",
        channel: this.channel,
        messageHash: context.messageHash,
        hasMedia: Boolean(payload.mediaPath),
        mediaFile: basenameOrUndefined(payload.mediaPath),
      });
      return null;
    } catch (error) {
      const detail = formatErrorMessage(error);
      const failure = {
        error: `runtime delivery failed: ${detail}`,
        ambiguous: !isRuntimeCapabilityUnavailableError(detail),
      };
      await this.logTransportFailure("runtime_failed", context, payload, failure);
      return failure;
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

  private async trySendViaCommand(
    payload: AlertSendInput,
    context: AlertSendDiagnosticContext,
  ): Promise<AlertDeliveryFailure | null> {
    const prepared = await this.prepareCommandPayload(payload);
    const commandOptions = this.getCommandRunOptions(prepared.payload);

    try {
      const result = await this.runCommandWithTimeout(
        this.buildCliArgs(prepared.payload),
        commandOptions,
      );
      if (result.code === 0) {
        const commandOutcome = inspectCommandDeliveryResult(result.stdout);
        if (commandOutcome?.error) {
          const failure = {
            error: commandOutcome.error,
            ambiguous: false,
          };
          await this.logTransportFailure("command_reported_error", context, payload, failure, {
            timeoutMs: commandOptions.timeoutMs,
            termination: result.termination,
            messageId: commandOutcome.messageId,
            stdout: truncateDiagnosticText(result.stdout.trim()),
          });
          return failure;
        }

        await this.logDiagnostic("transport_success", {
          sendId: context.sendId,
          step: context.step,
          transport: "command",
          channel: this.channel,
          messageHash: context.messageHash,
          hasMedia: Boolean(payload.mediaPath),
          mediaFile: basenameOrUndefined(payload.mediaPath),
          timeoutMs: commandOptions.timeoutMs,
          termination: result.termination,
          messageId: commandOutcome?.messageId,
        });
        return null;
      }

      const failure = {
        error:
          result.stderr.trim()
          || result.stdout.trim()
          || `command exited with ${result.code ?? "unknown"}`,
        ambiguous: true,
      };
      await this.logTransportFailure("command_failed", context, payload, failure, {
        code: result.code,
        timeoutMs: commandOptions.timeoutMs,
        termination: result.termination,
        stderr: truncateDiagnosticText(result.stderr.trim()),
        stdout: truncateDiagnosticText(result.stdout.trim()),
      });
      return failure;
    } catch (error) {
      const failure = {
        error: `command delivery failed: ${formatErrorMessage(error)}`,
        ambiguous: false,
      };
      await this.logTransportFailure("command_error", context, payload, failure);
      return failure;
    } finally {
      await prepared.cleanup();
    }
  }

  private async prepareCommandPayload(payload: AlertSendInput): Promise<PreparedCommandPayload> {
    if (!shouldStageQQBotMedia(this.channel, payload.mediaPath)) {
      return {
        payload,
        cleanup: async () => {},
      };
    }

    const stagedMediaPath = await stageQQBotMediaFile(payload.mediaPath);
    return {
      payload: {
        ...payload,
        mediaPath: stagedMediaPath,
      },
      cleanup: async () => {
        await unlink(stagedMediaPath).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        });
      },
    };
  }

  private getCommandRunOptions(payload: AlertSendInput): { timeoutMs: number } {
    if (payload.mediaPath) {
      return { timeoutMs: 45_000 };
    }

    return { timeoutMs: 15_000 };
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
    args.push("--json");
    return args;
  }

  private async logCompletion(
    sendId: string,
    messageHash: string,
    payload: AlertSendInput,
    result: AlertSendResult,
  ): Promise<void> {
    await this.logDiagnostic("send_completed", {
      sendId,
      channel: this.channel,
      messageHash,
      hasMedia: Boolean(payload.mediaPath),
      mediaFile: basenameOrUndefined(payload.mediaPath),
      ok: result.ok,
      mediaAttempted: result.mediaAttempted,
      mediaDelivered: result.mediaDelivered,
      deliveryUncertain: result.deliveryUncertain === true,
      error: result.error ? truncateDiagnosticText(result.error) : null,
    });
  }

  private async logTransportFailure(
    event: string,
    context: AlertSendDiagnosticContext,
    payload: AlertSendInput,
    failure: AlertDeliveryFailure,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logDiagnostic(event, {
      sendId: context.sendId,
      step: context.step,
      transport: event.startsWith("command") ? "command" : "runtime",
      channel: this.channel,
      messageHash: context.messageHash,
      hasMedia: Boolean(payload.mediaPath),
      mediaFile: basenameOrUndefined(payload.mediaPath),
      ambiguous: failure.ambiguous,
      error: truncateDiagnosticText(failure.error),
      ...extra,
    });
  }

  private async logDiagnostic(event: string, details: Record<string, unknown>): Promise<void> {
    await this.options.diagnosticLogger?.append("alert_service", event, details);
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

function isRuntimeCapabilityUnavailableError(detail: string): boolean {
  return /runtime channel .* unavailable/i.test(detail);
}

function normalizeSendInput(input: string | AlertSendInput): AlertSendInput {
  return typeof input === "string"
    ? { message: input }
    : input;
}

function inspectCommandDeliveryResult(stdout: string): {
  error?: string;
  messageId?: string;
} | null {
  const payload = extractCommandJsonPayload(stdout);
  if (!payload) {
    return null;
  }

  const directResult = isRecord(payload.result) ? payload.result : null;
  const directResultMeta = isRecord(directResult?.meta) ? directResult.meta : null;
  const error = getNonEmptyString(directResult?.error)
    ?? getNonEmptyString(directResultMeta?.error)
    ?? getNonEmptyString(payload.error);
  const messageId = getNonEmptyString(directResult?.messageId)
    ?? getNonEmptyString(directResultMeta?.messageId)
    ?? getNonEmptyString(payload.messageId);

  if (!error && !messageId) {
    return null;
  }

  return {
    ...(error ? { error } : {}),
    ...(messageId ? { messageId } : {}),
  };
}

function extractCommandJsonPayload(stdout: string): Record<string, unknown> | null {
  const root = extractTrailingJsonObject(stdout);
  if (!root) {
    return null;
  }

  return isRecord(root.payload) ? root.payload : root;
}

function extractTrailingJsonObject(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  for (let start = trimmed.lastIndexOf("{"); start >= 0; start = trimmed.lastIndexOf("{", start - 1)) {
    const candidate = trimmed.slice(start);
    try {
      const parsed = JSON.parse(candidate);
      const record = isRecord(parsed) ? parsed : null;
      if (record) {
        return record;
      }
    } catch {
      // Keep scanning backward until the trailing JSON object is found.
    }
  }

  return null;
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

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function shouldStageQQBotMedia(channel: string, mediaPath?: string): mediaPath is string {
  return channel === "qqbot"
    && typeof mediaPath === "string"
    && mediaPath.length > 0
    && !isRemoteMediaPath(mediaPath)
    && !isUnderQQBotManagedMediaRoot(mediaPath);
}

function isRemoteMediaPath(mediaPath: string): boolean {
  return /^(?:https?:|data:)/i.test(mediaPath.trim());
}

function isUnderQQBotManagedMediaRoot(mediaPath: string): boolean {
  const candidate = path.resolve(mediaPath);
  const mediaRoot = path.resolve(getQQBotManagedMediaRoot());
  const relative = path.relative(mediaRoot, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function stageQQBotMediaFile(mediaPath: string): Promise<string> {
  const destinationDir = path.join(getQQBotManagedMediaRoot(), "tickflow-assist");
  await mkdir(destinationDir, { recursive: true });

  const sourceExt = path.extname(mediaPath);
  const sourceBase = path.basename(mediaPath, sourceExt);
  const safeBase = sanitizeFileNamePart(sourceBase) || "alert-media";
  const safeExt = sanitizeFileExtension(sourceExt);
  const stagedName = `${safeBase}-${Date.now()}-${randomBytes(3).toString("hex")}${safeExt}`;
  const stagedPath = path.join(destinationDir, stagedName);
  await copyFile(mediaPath, stagedPath);
  return stagedPath;
}

function getQQBotManagedMediaRoot(): string {
  return path.join(resolveHomeDir(), ".openclaw", "media", "qqbot");
}

function resolveHomeDir(): string {
  const fromOs = os.homedir();
  if (fromOs) {
    return fromOs;
  }

  return process.env.HOME || process.env.USERPROFILE || ".";
}

function sanitizeFileNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function sanitizeFileExtension(value: string): string {
  if (!value) {
    return "";
  }

  return /^\.[a-zA-Z0-9]+$/.test(value) ? value.toLowerCase() : "";
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
