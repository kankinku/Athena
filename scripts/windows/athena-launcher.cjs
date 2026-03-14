#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function uniquePaths(paths) {
  const seen = new Set();
  const result = [];
  for (const value of paths) {
    if (!value) {
      continue;
    }
    const normalized = path.resolve(value);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function resolveAppRoot() {
  const execDir = path.dirname(process.execPath);
  const candidates = uniquePaths([
    process.env.ATHENA_APP_ROOT,
    process.cwd(),
    execDir,
    path.join(execDir, ".."),
  ]);

  for (const candidate of candidates) {
    const bootstrapPath = path.join(candidate, "dist", "bootstrap.js");
    if (fs.existsSync(bootstrapPath)) {
      return candidate;
    }
  }

  return null;
}

async function main() {
  const appRoot = resolveAppRoot();
  if (!appRoot) {
    console.error("Athena launcher could not find dist/bootstrap.js.");
    console.error("Set ATHENA_APP_ROOT or place Athena.exe in the repo root or release directory.");
    process.exit(1);
  }

  process.env.ATHENA_APP_ROOT = appRoot;
  process.chdir(appRoot);

  const bootstrapPath = path.join(appRoot, "dist", "bootstrap.js");
  const nodeCommand = process.env.ATHENA_NODE || "node";
  const commonOptions = {
    cwd: appRoot,
    env: {
      ...process.env,
      ATHENA_APP_ROOT: appRoot,
    },
    stdio: "inherit",
    shell: false,
  };

  const child = spawn(nodeCommand, [bootstrapPath, ...process.argv.slice(1)], commonOptions);

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error("Failed to launch Node.js for Athena.");
    console.error("Install Node.js 20+ or set ATHENA_NODE to a valid node executable.");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error("Failed to start Athena.");
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
