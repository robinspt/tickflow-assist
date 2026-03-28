import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const cacheDir = path.join(projectRoot, ".packaging-cache");
const githubReadmePath = path.join(projectRoot, "README.md");
const backupReadmePath = path.join(cacheDir, "README.github.md");
const packageReadmePath = path.join(projectRoot, "packaging", "README.clawhub.md");

mkdirSync(cacheDir, { recursive: true });
copyFileSync(githubReadmePath, backupReadmePath);
copyFileSync(packageReadmePath, githubReadmePath);
