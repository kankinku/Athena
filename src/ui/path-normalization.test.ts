import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  normalizeDisplayValue,
  normalizeSnapshotPath,
  normalizeToolResultForDisplay,
} from "./path-normalization.js";

test("normalizeSnapshotPath maps a unique snapshot path to a workspace file", () => {
  const workspace = mkdtempSync(join(tmpdir(), "athena-ui-paths-"));
  const fileDir = join(workspace, "scripts", "windows");
  const actualPath = join(fileDir, "athena-launcher.cjs");
  mkdirSync(fileDir, { recursive: true });
  writeFileSync(actualPath, "content", "utf-8");

  try {
    const normalized = normalizeSnapshotPath("C:\\snapshot\\windows\\athena-launcher.cjs", workspace);
    assert.equal(normalized, actualPath);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("normalizeDisplayValue rewrites snapshot paths recursively", () => {
  const workspace = mkdtempSync(join(tmpdir(), "athena-ui-paths-"));
  const fileDir = join(workspace, "scripts", "windows");
  const actualPath = join(fileDir, "athena-launcher.cjs");
  mkdirSync(fileDir, { recursive: true });
  writeFileSync(actualPath, "content", "utf-8");

  try {
    const normalized = normalizeDisplayValue(
      {
        path: "C:\\snapshot\\windows\\athena-launcher.cjs",
        nested: ["C:\\snapshot\\windows\\athena-launcher.cjs"],
      },
      workspace,
    ) as { path: string; nested: string[] };

    assert.equal(normalized.path, actualPath);
    assert.deepEqual(normalized.nested, [actualPath]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("normalizeToolResultForDisplay rewrites snapshot paths inside JSON payloads", () => {
  const workspace = mkdtempSync(join(tmpdir(), "athena-ui-paths-"));
  const fileDir = join(workspace, "scripts", "windows");
  const actualPath = join(fileDir, "athena-launcher.cjs");
  mkdirSync(fileDir, { recursive: true });
  writeFileSync(actualPath, "content", "utf-8");

  try {
    const normalized = normalizeToolResultForDisplay(
      JSON.stringify({ path: "C:\\snapshot\\windows\\athena-launcher.cjs" }),
      workspace,
    );

    assert.equal(normalized, JSON.stringify({ path: actualPath }));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
