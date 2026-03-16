import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const PROJECT_ROOT = process.cwd();
const TSX_LOADER = pathToFileURL(join(PROJECT_ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href;

test("doctor command runs without unix-only shell assumptions", () => {
  const home = mkdtempSync(join(tmpdir(), "athena-doctor-"));

  try {
    const output = execFileSync(
      process.execPath,
      ["--import", TSX_LOADER, "src/bootstrap.ts", "--home", home, "doctor"],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );

    assert.match(output, /athena doctor/i);
    assert.match(output, /Auth/);
    assert.match(output, /Machines/);
    assert.match(output, /Storage/);
    assert.match(output, /Dependencies/);
    assert.match(output, /git:/i);
    assert.match(output, /ssh:/i);
    assert.doesNotMatch(output, /could not check/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reports missing project config cleanly in a fresh workspace", () => {
  const home = mkdtempSync(join(tmpdir(), "athena-doctor-home-"));
  const workspace = mkdtempSync(join(tmpdir(), "athena-doctor-workspace-"));

  try {
    const output = execFileSync(
      process.execPath,
      ["--import", TSX_LOADER, join(PROJECT_ROOT, "src/bootstrap.ts"), "--home", home, "doctor"],
      { cwd: workspace, encoding: "utf8" },
    );

    assert.match(output, /athena doctor/i);
    assert.match(output, /Project/);
    assert.match(output, /athena\.json not found/i);
    assert.match(output, /Storage/);
    assert.match(output, /Dependencies/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("doctor warns when project config exists but is malformed", () => {
  const home = mkdtempSync(join(tmpdir(), "athena-doctor-home-"));
  const workspace = mkdtempSync(join(tmpdir(), "athena-doctor-bad-config-"));

  try {
    writeFileSync(join(workspace, "athena.json"), "{ invalid json\n", "utf8");

    const output = execFileSync(
      process.execPath,
      ["--import", TSX_LOADER, join(PROJECT_ROOT, "src/bootstrap.ts"), "--home", home, "doctor"],
      { cwd: workspace, encoding: "utf8" },
    );

    assert.match(output, /Project/);
    assert.match(output, /could not parse/i);
    assert.match(output, /Dependencies/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
