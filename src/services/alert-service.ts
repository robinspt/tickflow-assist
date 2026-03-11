import { spawn } from "node:child_process";

export class AlertService {
  private lastError: string | null = null;

  constructor(
    private readonly openclawCliBin: string,
    private readonly channel: string,
    private readonly account: string,
    private readonly target: string,
  ) {}

  async send(message: string): Promise<boolean> {
    this.lastError = null;
    const args = ["message", "send", "--channel", this.channel, "--message", message];
    if (this.target) {
      args.push("--target", this.target);
    }
    if (this.account) {
      args.push("--account", this.account);
    }

    return new Promise((resolve) => {
      const child = spawn(this.openclawCliBin, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        this.lastError = `spawn failed: ${error.message}`;
        resolve(false);
      });
      child.on("close", (code) => {
        if (code !== 0) {
          this.lastError = (stderr || stdout || `exit code ${code}`).trim();
        }
        resolve(code === 0);
      });
    });
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getCliBinary(): string {
    return this.openclawCliBin;
  }

  formatSystemNotification(title: string, lines: string[]): string {
    return `${title}\n\n${lines.join("\n")}`.trim();
  }

  formatPriceAlert(params: {
    symbol: string;
    name: string;
    currentPrice: number;
    ruleName: string;
    ruleDescription: string;
    levelPrice: number;
    costPrice: number;
  }): string {
    const profitPct = params.costPrice > 0
      ? ((params.currentPrice - params.costPrice) / params.costPrice) * 100
      : null;

    return [
      `🚨 ${params.ruleName}告警`,
      "",
      `📌 ${params.name}（${params.symbol}）`,
      `💹 当前价: ${params.currentPrice.toFixed(2)}`,
      `📊 触发价位: ${params.levelPrice.toFixed(2)}`,
      `📝 ${params.ruleDescription}`,
      ...(profitPct == null ? [] : [`💰 持仓盈亏: ${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%（成本 ${params.costPrice.toFixed(2)}）`]),
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
}
