import { spawn } from "node:child_process";
import path from "node:path";

import type { TickFlowKlineRow } from "../types/tickflow.js";
import type { IndicatorRow } from "../types/indicator.js";

export class IndicatorService {
  constructor(
    private readonly pythonBin: string,
    private readonly pythonArgs: string[],
    private readonly pythonWorkdir: string,
  ) {}

  async calculate(rows: TickFlowKlineRow[]): Promise<IndicatorRow[]> {
    if (rows.length < 5) {
      throw new Error("K-line data must contain at least 5 rows to calculate indicators");
    }

    const payload = rows.map((row) => ({
      trade_date: row.trade_date,
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
    }));
  }

  private runPythonJson(payload: unknown): Promise<string> {
    const scriptPath = path.join(this.pythonWorkdir, "indicator_runner.py");
    const child = spawn(this.pythonBin, [...this.pythonArgs, scriptPath], {
      cwd: path.dirname(scriptPath),
      stdio: ["pipe", "pipe", "pipe"],
    });

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(
          new Error(
            `indicator_runner failed with code ${code}: ${stderr || stdout}` +
              `\npython command: ${this.pythonBin} ${[...this.pythonArgs, scriptPath].join(" ")}`,
          ),
        );
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }
}
