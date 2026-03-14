import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPatchFileTool, createReadFileTool, createWriteFileTool } from "./file-ops.js";

const sandbox = mkdtempSync(join(tmpdir(), "athena-file-ops-local-"));

test("read_file uses local filesystem APIs for local paths", async () => {
  const filePath = join(sandbox, "read-target.txt");
  writeFileSync(filePath, "one\ntwo\nthree\nfour\n", "utf-8");

  let execCalled = false;
  const tool = createReadFileTool({
    exec: async () => {
      execCalled = true;
      return { stdout: "", stderr: "", exitCode: 1 };
    },
  } as never);

  const raw = await tool.execute({ machine_id: "local", path: filePath, offset: 2, limit: 2 });
  const result = JSON.parse(raw) as { content: string; lines: { from: number; to: number; total: number } };

  assert.equal(execCalled, false);
  assert.equal(result.content, "two\nthree");
  assert.deepEqual(result.lines, { from: 2, to: 3, total: 4 });
});

test("read_file resolves a unique snapshot-style path to the workspace file", async () => {
  const previousCwd = process.cwd();
  const workspace = mkdtempSync(join(tmpdir(), "athena-snapshot-workspace-"));
  const nestedDir = join(workspace, "scripts", "windows");
  const actualPath = join(nestedDir, "athena-launcher.cjs");

  try {
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(actualPath, "launcher content\n", "utf-8");
    process.chdir(workspace);

    const tool = createReadFileTool({
      exec: async () => {
        throw new Error("exec should not be called for local reads");
      },
    } as never);

    const raw = await tool.execute({ machine_id: "local", path: "C:\\snapshot\\windows\\athena-launcher.cjs" });
    const result = JSON.parse(raw) as { content: string; resolvedFrom?: string; resolvedPath?: string };

    assert.equal(result.content, "launcher content");
    assert.equal(result.resolvedFrom, "C:\\snapshot\\windows\\athena-launcher.cjs");
    assert.equal(result.resolvedPath, actualPath);
  } finally {
    process.chdir(previousCwd);
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("write_file writes local files without shell helpers", async () => {
  const filePath = join(sandbox, "nested", "write-target.txt");
  const tool = createWriteFileTool({
    exec: async () => {
      throw new Error("exec should not be called for local writes");
    },
  } as never);

  const raw = await tool.execute({ machine_id: "local", path: filePath, content: "alpha\nbeta\n" });
  const result = JSON.parse(raw) as { written: string; lines: number };

  assert.equal(result.written, filePath);
  assert.equal(result.lines, 2);
  assert.equal(readFileSync(filePath, "utf-8"), "alpha\nbeta\n");
});

test("patch_file patches local files without shell helpers", async () => {
  const filePath = join(sandbox, "patch-target.txt");
  writeFileSync(filePath, "before middle after", "utf-8");
  const tool = createPatchFileTool({
    exec: async () => {
      throw new Error("exec should not be called for local patches");
    },
  } as never);

  const raw = await tool.execute({
    machine_id: "local",
    path: filePath,
    old_string: "middle",
    new_string: "patched",
  });
  const result = JSON.parse(raw) as { patched: string };

  assert.equal(result.patched, filePath);
  assert.equal(readFileSync(filePath, "utf-8"), "before patched after");
});

test.after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});
