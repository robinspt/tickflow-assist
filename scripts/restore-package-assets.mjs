import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const cacheDir = path.join(projectRoot, ".packaging-cache");
const githubReadmePath = path.join(projectRoot, "README.md");
const backupReadmePath = path.join(cacheDir, "README.github.md");
const packageJsonPath = path.join(projectRoot, "package.json");
const backupPackageJsonPath = path.join(cacheDir, "package.json.backup");
const excludedFilesDir = path.join(cacheDir, "excluded");
const excludedManifestPath = path.join(cacheDir, "excluded-files.json");

if (existsSync(backupReadmePath)) {
  copyFileSync(backupReadmePath, githubReadmePath);
}

if (existsSync(backupPackageJsonPath)) {
  copyFileSync(backupPackageJsonPath, packageJsonPath);
}

if (existsSync(excludedManifestPath)) {
  const cachedRelativePaths = JSON.parse(
    readFileSync(excludedManifestPath, "utf8"),
  );

  for (const relativePath of cachedRelativePaths) {
    const cachedPath = path.join(excludedFilesDir, relativePath);
    const originalPath = path.join(projectRoot, relativePath);

    if (!existsSync(cachedPath)) {
      continue;
    }

    mkdirSync(path.dirname(originalPath), { recursive: true });
    renameSync(cachedPath, originalPath);
  }
}

rmSync(cacheDir, { recursive: true, force: true });
