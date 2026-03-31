import type { Dirent } from "node:fs";
import { mkdir, readdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AlertImageInput } from "./alert-image-service.js";
import { renderAlertCardPng } from "./alert-image-service.js";
import { formatChinaDateTime } from "../utils/china-time.js";

const DEFAULT_RETENTION_HOURS = 24;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export interface AlertMediaFile {
  filePath: string;
  filename: string;
  mediaLocalRoots: readonly string[];
}

export class AlertMediaService {
  private lastCleanupAt = 0;

  constructor(
    private readonly baseDir: string,
    private readonly retentionHours = DEFAULT_RETENTION_HOURS,
    private readonly cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
  ) {}

  getTempRootDir(): string {
    return path.resolve(this.baseDir, "..", "alert-media", "tmp");
  }

  async writeAlertCard(params: {
    symbol: string;
    ruleName: string;
    image: AlertImageInput;
  }): Promise<AlertMediaFile> {
    await this.maybeCleanupExpired();

    const now = formatChinaDateTime();
    const dateDir = now.slice(0, 10);
    const outputDir = path.join(this.getTempRootDir(), dateDir);
    await mkdir(outputDir, { recursive: true });

    const filename = [
      sanitizeFilePart(now.replace(/[: ]/g, "-")),
      sanitizeFilePart(params.symbol),
      sanitizeFilePart(params.ruleName),
    ].join("_") + ".png";

    const filePath = path.join(outputDir, filename);
    const png = await renderAlertCardPng(params.image);
    await writeFile(filePath, png);

    return {
      filePath,
      filename,
      mediaLocalRoots: [outputDir],
    };
  }

  async removeFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    await this.removeEmptyParents(path.dirname(filePath));
  }

  async maybeCleanupExpired(nowMs = Date.now()): Promise<void> {
    if (nowMs - this.lastCleanupAt < this.cleanupIntervalMs) {
      return;
    }
    this.lastCleanupAt = nowMs;

    const cutoffMs = nowMs - this.retentionHours * 60 * 60 * 1000;
    await this.cleanupDirectory(this.getTempRootDir(), cutoffMs);
  }

  private async cleanupDirectory(dir: string, cutoffMs: number): Promise<boolean> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return true;
      }
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const empty = await this.cleanupDirectory(fullPath, cutoffMs);
        if (empty) {
          await safeRemoveDir(fullPath);
        }
        continue;
      }

      const fileStat = await stat(fullPath);
      if (fileStat.mtimeMs < cutoffMs) {
        await unlink(fullPath);
      }
    }

    const remaining = await readdir(dir);
    if (remaining.length === 0 && dir !== this.getTempRootDir()) {
      await safeRemoveDir(dir);
      return true;
    }
    return remaining.length === 0;
  }

  private async removeEmptyParents(dir: string): Promise<void> {
    const root = this.getTempRootDir();
    let current = dir;

    while (current.startsWith(root) && current !== root) {
      let remaining: string[];
      try {
        remaining = await readdir(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          current = path.dirname(current);
          continue;
        }
        throw error;
      }

      if (remaining.length > 0) {
        return;
      }

      await safeRemoveDir(current);
      current = path.dirname(current);
    }
  }
}

async function safeRemoveDir(dir: string): Promise<void> {
  try {
    await rmdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY") {
      throw error;
    }
  }
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
