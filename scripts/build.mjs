import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const distPath = path.join(repoRoot, "dist");
const tscPath = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");

rmSync(distPath, { recursive: true, force: true });

const result = spawnSync(process.execPath, [tscPath], {
  cwd: repoRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
