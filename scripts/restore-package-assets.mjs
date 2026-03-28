import { copyFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const cacheDir = path.join(projectRoot, ".packaging-cache");
const githubReadmePath = path.join(projectRoot, "README.md");
const backupReadmePath = path.join(cacheDir, "README.github.md");

if (existsSync(backupReadmePath)) {
  copyFileSync(backupReadmePath, githubReadmePath);
}

rmSync(cacheDir, { recursive: true, force: true });
