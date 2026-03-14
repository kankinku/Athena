import test from "node:test";
import assert from "node:assert/strict";
import { createReadFileTool, createWriteFileTool } from "./file-ops.js";
import { SecurityManager } from "../security/policy.js";

test("read_file rejects protected secret paths in enforce mode", async () => {
  const tool = createReadFileTool(
    {
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    } as never,
    new SecurityManager({ mode: "enforce" }),
  );

  await assert.rejects(
    tool.execute({ machine_id: "local", path: "/home/test/.ssh/id_rsa" }),
    /requires approval/i,
  );
});

test("write_file rejects protected system paths in enforce mode", async () => {
  const tool = createWriteFileTool(
    {
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    } as never,
    new SecurityManager({ mode: "enforce" }),
  );

  await assert.rejects(
    tool.execute({ machine_id: "local", path: "/etc/passwd", content: "oops" }),
    /blocked this path/i,
  );
});

test("write_file respects capability-scoped write roots", async () => {
  const tool = createWriteFileTool(
    {
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    } as never,
    new SecurityManager({
      mode: "enforce",
      capabilityPolicy: {
        allowedMachineIds: ["local"],
        allowedToolCategories: ["filesystem"],
        allowedWritePathRoots: ["/workspace/project/tmp"],
      },
    }),
  );

  await assert.rejects(
    tool.execute({ machine_id: "local", path: "/workspace/project/out.txt", content: "oops" }),
    /outside approved write roots/i,
  );
});
