import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const releaseDir = path.join(projectRoot, "release");
const outputPath = path.join(releaseDir, "Athena.exe");
const entryPath = path.join(projectRoot, "scripts", "windows", "athena-launcher.cjs");
const pkgCliPath = path.join(projectRoot, "node_modules", "@yao-pkg", "pkg", "lib-es5", "bin.js");

function run(command, args, cwd = projectRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });

    child.on("error", reject);
  });
}

await mkdir(releaseDir, { recursive: true });

await run(process.execPath, [
  pkgCliPath,
  entryPath,
  "--target",
  "node20-win-x64",
  "--output",
  outputPath,
]);

console.log(`Built Windows launcher: ${outputPath}`);
