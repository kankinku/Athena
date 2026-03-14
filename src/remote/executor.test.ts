import test from "node:test";
import assert from "node:assert/strict";
import { RemoteExecutor } from "./executor.js";
import type { ExecResult } from "./types.js";
import type { SecurityExecutionContext } from "../security/policy.js";

interface PoolLike {
  exec: (machineId: string, command: string, timeoutMs?: number, securityContext?: SecurityExecutionContext) => Promise<ExecResult>;
  execBackground: (machineId: string, command: string, logPath?: string, securityContext?: SecurityExecutionContext) => Promise<{ pid: number; logPath: string }>;
  isProcessRunning: (machineId: string, pid: number) => Promise<boolean>;
  tailFile: (machineId: string, path: string, lines?: number, securityContext?: SecurityExecutionContext) => Promise<string>;
  readBackgroundExitCode: (machineId: string, logPath: string, securityContext?: SecurityExecutionContext) => Promise<number | null>;
}

function createPool(overrides: Partial<PoolLike> = {}): PoolLike {
  return {
    exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    execBackground: async () => ({ pid: 1234, logPath: "/tmp/run.log" }),
    isProcessRunning: async () => false,
    tailFile: async () => "done",
    readBackgroundExitCode: async () => 0,
    ...overrides,
  };
}

test("RemoteExecutor.exec delegates local execution without timeout wrapping", async () => {
  const calls: Array<{ machineId: string; command: string; timeoutMs?: number }> = [];
  const pool = createPool({
    exec: async (machineId, command, timeoutMs) => {
      calls.push({ machineId, command, timeoutMs });
      return { stdout: "ok", stderr: "", exitCode: 0 };
    },
  });

  const executor = new RemoteExecutor(pool as never);
  const result = await executor.exec("local", "python train.py", 15_000);

  assert.equal(result.stdout, "ok");
  assert.deepEqual(calls, [{ machineId: "local", command: "python train.py", timeoutMs: 15_000 }]);
});

test("RemoteExecutor.exec wraps remote execution with timeout command", async () => {
  const calls: Array<{ machineId: string; command: string; timeoutMs?: number }> = [];
  const pool = createPool({
    exec: async (machineId, command, timeoutMs) => {
      calls.push({ machineId, command, timeoutMs });
      return { stdout: "remote", stderr: "", exitCode: 0 };
    },
  });

  const executor = new RemoteExecutor(pool as never);
  await executor.exec("gpu-1", "python train.py", 12_345);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.machineId, "gpu-1");
  assert.equal(calls[0]?.command, "timeout 13 python train.py");
  assert.equal(calls[0]?.timeoutMs, undefined);
});

test("RemoteExecutor.execBackground stores background process metadata", async () => {
  const pool = createPool({
    execBackground: async () => ({ pid: 4321, logPath: "/tmp/athena.log" }),
  });

  const executor = new RemoteExecutor(pool as never);
  const proc = await executor.execBackground("local", "python train.py", undefined, {
    metricNames: ["loss"],
    metricPatterns: { acc: "acc=([0-9.]+)" },
  });

  assert.equal(proc.machineId, "local");
  assert.equal(proc.pid, 4321);
  assert.equal(proc.logPath, "/tmp/athena.log");
  assert.deepEqual(proc.metricNames, ["loss"]);
  assert.deepEqual(proc.metricPatterns, { acc: "acc=([0-9.]+)" });

  const stored = executor.getBackgroundProcess("local", 4321);
  assert.deepEqual(stored, proc);
  assert.equal(executor.getBackgroundProcesses().length, 1);
});

test("RemoteExecutor.removeBackgroundProcess removes tracked process", async () => {
  const executor = new RemoteExecutor(createPool() as never);
  await executor.execBackground("local", "echo ok");
  assert.equal(executor.getBackgroundProcesses().length, 1);

  executor.removeBackgroundProcess("local:1234");
  assert.equal(executor.getBackgroundProcesses().length, 0);
});

test("RemoteExecutor delegates runtime helper methods to the pool", async () => {
  const calls: string[] = [];
  const pool = createPool({
    isProcessRunning: async () => {
      calls.push("isRunning");
      return true;
    },
    tailFile: async (_machineId, _path, lines) => {
      calls.push(`tail:${lines}`);
      return "line-a\nline-b";
    },
    readBackgroundExitCode: async () => {
      calls.push("exit");
      return 17;
    },
  });

  const executor = new RemoteExecutor(pool as never);

  assert.equal(await executor.isRunning("gpu-1", 99), true);
  assert.equal(await executor.tail("gpu-1", "/tmp/run.log", 7), "line-a\nline-b");
  assert.equal(await executor.readExitCode("gpu-1", "/tmp/run.log"), 17);
  assert.deepEqual(calls, ["isRunning", "tail:7", "exit"]);
});
