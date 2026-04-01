import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

export const POSIX_OPENCLAW_TMP_DIR = "/tmp/openclaw";

const TMP_DIR_ACCESS_MODE = fsSync.constants.W_OK | fsSync.constants.X_OK;

interface TempDirStatLike {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  mode?: number;
  uid?: number;
}

interface ResolvePreferredOpenClawTmpDirOptions {
  accessSync?: (path: string, mode?: number) => void;
  chmodSync?: (path: string, mode: number) => void;
  lstatSync?: (path: string) => TempDirStatLike;
  mkdirSync?: (path: string, opts: { recursive: boolean; mode?: number }) => void;
  getuid?: () => number | undefined;
  tmpdir?: () => string;
  warn?: (message: string) => void;
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export function resolvePreferredOpenClawTmpDir(
  options: ResolvePreferredOpenClawTmpDirOptions = {},
): string {
  const accessSync = options.accessSync ?? fsSync.accessSync;
  const chmodSync = options.chmodSync ?? fsSync.chmodSync;
  const lstatSync = options.lstatSync ?? fsSync.lstatSync;
  const mkdirSync = options.mkdirSync ?? fsSync.mkdirSync;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const getuid = options.getuid ?? (() => {
    try {
      return typeof process.getuid === "function" ? process.getuid() : undefined;
    } catch {
      return undefined;
    }
  });
  const resolveTmpdir = options.tmpdir ?? os.tmpdir;

  const uid = getuid();

  const isSecureDirForUser = (stats: TempDirStatLike): boolean => {
    if (uid === undefined) {
      return true;
    }
    if (typeof stats.uid === "number" && stats.uid !== uid) {
      return false;
    }
    if (typeof stats.mode === "number" && (stats.mode & 0o022) !== 0) {
      return false;
    }
    return true;
  };

  const fallback = (): string => {
    const suffix = uid === undefined ? "openclaw" : `openclaw-${uid}`;
    return path.join(resolveTmpdir(), suffix);
  };

  const isTrustedTmpDir = (stats: TempDirStatLike): boolean =>
    stats.isDirectory() && !stats.isSymbolicLink() && isSecureDirForUser(stats);

  const resolveDirState = (candidatePath: string): "available" | "missing" | "invalid" => {
    try {
      if (!isTrustedTmpDir(lstatSync(candidatePath))) {
        return "invalid";
      }
      accessSync(candidatePath, TMP_DIR_ACCESS_MODE);
      return "available";
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        return "missing";
      }
      return "invalid";
    }
  };

  const tryRepairWritableBits = (candidatePath: string): boolean => {
    try {
      const stats = lstatSync(candidatePath);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        return false;
      }
      if (uid !== undefined && typeof stats.uid === "number" && stats.uid !== uid) {
        return false;
      }
      if (typeof stats.mode !== "number" || (stats.mode & 0o022) === 0) {
        return false;
      }

      chmodSync(candidatePath, 0o700);
      warn(`[tickflow-assist] tightened permissions on temp dir: ${candidatePath}`);
      return resolveDirState(candidatePath) === "available";
    } catch {
      return false;
    }
  };

  const ensureTrustedFallbackDir = (): string => {
    const fallbackPath = fallback();
    const state = resolveDirState(fallbackPath);
    if (state === "available") {
      return fallbackPath;
    }
    if (state === "invalid") {
      if (tryRepairWritableBits(fallbackPath)) {
        return fallbackPath;
      }
      throw new Error(`Unsafe fallback OpenClaw temp dir: ${fallbackPath}`);
    }

    try {
      mkdirSync(fallbackPath, { recursive: true, mode: 0o700 });
      chmodSync(fallbackPath, 0o700);
    } catch {
      throw new Error(`Unable to create fallback OpenClaw temp dir: ${fallbackPath}`);
    }

    if (resolveDirState(fallbackPath) !== "available" && !tryRepairWritableBits(fallbackPath)) {
      throw new Error(`Unsafe fallback OpenClaw temp dir: ${fallbackPath}`);
    }
    return fallbackPath;
  };

  const existingPreferredState = resolveDirState(POSIX_OPENCLAW_TMP_DIR);
  if (existingPreferredState === "available") {
    return POSIX_OPENCLAW_TMP_DIR;
  }
  if (existingPreferredState === "invalid") {
    if (tryRepairWritableBits(POSIX_OPENCLAW_TMP_DIR)) {
      return POSIX_OPENCLAW_TMP_DIR;
    }
    return ensureTrustedFallbackDir();
  }

  try {
    accessSync("/tmp", TMP_DIR_ACCESS_MODE);
    mkdirSync(POSIX_OPENCLAW_TMP_DIR, { recursive: true, mode: 0o700 });
    chmodSync(POSIX_OPENCLAW_TMP_DIR, 0o700);
    if (resolveDirState(POSIX_OPENCLAW_TMP_DIR) !== "available"
      && !tryRepairWritableBits(POSIX_OPENCLAW_TMP_DIR)) {
      return ensureTrustedFallbackDir();
    }
    return POSIX_OPENCLAW_TMP_DIR;
  } catch {
    return ensureTrustedFallbackDir();
  }
}
