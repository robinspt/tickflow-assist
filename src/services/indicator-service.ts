import path from "node:path";

import type { RunCommandWithTimeout } from "../runtime/command-runner.js";
import type { IndicatorInputRow, IndicatorRow } from "../types/indicator.js";

export class IndicatorService {
  constructor(
    private readonly pythonBin: string,
    private readonly pythonArgs: string[],
    private readonly pythonWorkdir: string,
    private readonly runCommandWithTimeout: RunCommandWithTimeout,
  ) {}

  async calculate(rows: IndicatorInputRow[]): Promise<IndicatorRow[]> {
    if (rows.length === 0) {
      throw new Error("K-line data must contain at least 1 row to calculate indicators");
    }

    const payload = rows.map((row) => ({
      trade_date: row.trade_date,
      trade_time: row.trade_time,
      period: row.period,
      timestamp: row.timestamp,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      amount: row.amount,
      prev_close: row.prev_close,
    }));

    const raw = await this.runPythonJson(payload);
    const parsed = JSON.parse(raw) as IndicatorRow[];
    return parsed.map((row) => ({
      ...row,
      trade_date: String(row.trade_date),
      trade_time: row.trade_time == null ? undefined : String(row.trade_time),
      period: row.period == null ? undefined : String(row.period),
      timestamp: row.timestamp == null ? undefined : Number(row.timestamp),
    }));
  }

  private runPythonJson(payload: unknown): Promise<string> {
    const scriptPath = path.join(this.pythonWorkdir, "indicator_runner.py");
    const argv = [this.pythonBin, ...this.pythonArgs, scriptPath];

    return this.runCommandWithTimeout(argv, {
      cwd: path.dirname(scriptPath),
      input: JSON.stringify(payload),
      timeoutMs: 30_000,
      noOutputTimeoutMs: 30_000,
    }).then((result) => {
      if (result.code === 0) {
        return result.stdout;
      }

      throw new Error(
        `indicator_runner failed with code ${result.code}: ${result.stderr || result.stdout}` +
          `\npython command: ${argv.join(" ")}`,
      );
    });
  }
}
