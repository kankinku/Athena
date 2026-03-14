import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PROJECT_ROOT = process.cwd();

test("security command shows capability envelope and audit summary", () => {
  const home = mkdtempSync(join(tmpdir(), "athena-cli-security-"));
  const projectDir = join(home, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, "athena.json"),
    JSON.stringify({
      security: {
        mode: "enforce",
        capabilityPolicy: {
          allowedMachineIds: ["local", "gpu-1"],
          allowedToolCategories: ["filesystem", "shell"],
          allowNetworkAccess: false,
          allowedReadPathRoots: ["/workspace/project"],
          allowedWritePathRoots: ["/workspace/project/tmp"],
        },
      },
    }, null, 2),
  );

  try {
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `process.chdir(${JSON.stringify(projectDir)}); process.argv = ['node', 'src/bootstrap.ts', '--home', ${JSON.stringify(home)}, 'security']; await import('./src/bootstrap.ts');`,
      ],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );

    assert.match(output, /enabled=true mode=enforce/);
    assert.match(output, /capabilities\s+enabled=true machines=2 tool_categories=2 allow_network=false/);
    assert.match(output, /roles\s+enabled=false bindings=0 tier_rules=0/);
    assert.match(output, /audit\s+total=0 allow=0 review=0 block=0/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
