import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { formatChinaDateTime } from "./china-time.js";

const DEFAULT_LOG_FILE = "alert-delivery-debug.ndjson";

export class AlertDiagnosticLogger {
  private readonly filePath: string;

  constructor(baseDir: string, fileName: string = DEFAULT_LOG_FILE) {
    this.filePath = path.join(baseDir, fileName);
  }

  getFilePath(): string {
    return this.filePath;
  }

  async append(scope: string, event: string, details: Record<string, unknown> = {}): Promise<void> {
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await appendFile(
        this.filePath,
        `${JSON.stringify({
          at: formatChinaDateTime(),
          scope,
          event,
          ...details,
        })}\n`,
        "utf-8",
      );
    } catch {
      // Diagnostic logging must never break alert delivery.
    }
  }
}

export function buildAlertMessageHash(message: string): string {
  return createHash("sha1")
    .update(message)
    .digest("hex")
    .slice(0, 12);
}

export function buildAlertSendId(message: string): string {
  return `${formatChinaDateTime().replace(/[^0-9]/g, "").slice(0, 14)}-${buildAlertMessageHash(message)}`;
}

export function basenameOrUndefined(filePath?: string): string | undefined {
  if (!filePath) {
    return undefined;
  }
  return path.basename(filePath);
}

export function truncateDiagnosticText(value: string, maxLength: number = 160): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}
