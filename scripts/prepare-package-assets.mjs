import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const cacheDir = path.join(projectRoot, ".packaging-cache");
const githubReadmePath = path.join(projectRoot, "README.md");
const backupReadmePath = path.join(cacheDir, "README.github.md");
const packageReadmePath = path.join(projectRoot, "packaging", "README.clawhub.md");
const packageJsonPath = path.join(projectRoot, "package.json");
const backupPackageJsonPath = path.join(cacheDir, "package.json.backup");
const excludedFilesDir = path.join(cacheDir, "excluded");
const excludedManifestPath = path.join(cacheDir, "excluded-files.json");
const distDir = path.join(projectRoot, "dist");
const excludedExactRelativePaths = new Set([
  path.join("dist", "dev", "render-alert-card-demo.d.ts"),
  path.join("dist", "dev", "render-alert-card-demo.js"),
]);

function walkFiles(dirPath) {
  if (!existsSync(dirPath)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function listExcludedRelativePaths() {
  return walkFiles(distDir)
    .map((filePath) => path.relative(projectRoot, filePath))
    .filter(
      (relativePath) =>
        relativePath.endsWith(".test.js") ||
        relativePath.endsWith(".test.d.ts") ||
        excludedExactRelativePaths.has(relativePath),
    )
    .sort();
}

function assertCleanPackagingCache() {
  if (!existsSync(cacheDir)) {
    return;
  }

  const entries = readdirSync(cacheDir);
  if (entries.length === 0) {
    rmSync(cacheDir, { recursive: true, force: true });
    return;
  }

  throw new Error(
    [
      "Found stale .packaging-cache from a previous pack/publish run.",
      "Run `node ./scripts/restore-package-assets.mjs` before retrying.",
      "Aborting to avoid overwriting current README/package.json changes.",
    ].join(" "),
  );
}

assertCleanPackagingCache();

mkdirSync(cacheDir, { recursive: true });
copyFileSync(githubReadmePath, backupReadmePath);
copyFileSync(packageJsonPath, backupPackageJsonPath);
copyFileSync(packageReadmePath, githubReadmePath);

const packageReadme = readFileSync(packageReadmePath, "utf8");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
packageJson.readme = packageReadme;
packageJson.readmeFilename = "README.md";
writeFileSync(
  packageJsonPath,
  `${JSON.stringify(packageJson, null, 2)}\n`,
);

const excludedRelativePaths = listExcludedRelativePaths();
writeFileSync(
  excludedManifestPath,
  `${JSON.stringify(excludedRelativePaths, null, 2)}\n`,
);

for (const relativePath of excludedRelativePaths) {
  const originalPath = path.join(projectRoot, relativePath);
  const cachedPath = path.join(excludedFilesDir, relativePath);
  mkdirSync(path.dirname(cachedPath), { recursive: true });
  renameSync(originalPath, cachedPath);
}
