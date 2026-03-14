import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import {
  getLocalShell,
  getLocalShellCommand,
  getNullDevice,
  createTempLogPath,
  getExitFilePath,
  buildBackgroundExitCommand,
} from "./local-runtime.js";
import { resolveFileSyncTransport } from "./file-sync.js";

// getLocalShell

test("win32: getLocalShell returns cmd.exe", () => {
  const shell = getLocalShell("win32");
  assert.equal(shell, process.env.ComSpec ?? "cmd.exe");
});

test("linux: getLocalShell returns bash-compatible shell", () => {
  const shell = getLocalShell("linux");
  assert.equal(shell, process.env.SHELL ?? "/bin/bash");
});

test("darwin: getLocalShell returns bash-compatible shell", () => {
  const shell = getLocalShell("darwin");
  assert.equal(shell, process.env.SHELL ?? "/bin/bash");
});

// getLocalShellCommand

test("win32: getLocalShellCommand uses /d /c args", () => {
  const cmd = getLocalShellCommand("win32");
  assert.deepEqual(cmd.args, ["/d", "/c"]);
  assert.equal(cmd.command, process.env.ComSpec ?? "cmd.exe");
});

test("linux: getLocalShellCommand uses -c arg", () => {
  const cmd = getLocalShellCommand("linux");
  assert.deepEqual(cmd.args, ["-c"]);
});

test("darwin: getLocalShellCommand uses -c arg", () => {
  const cmd = getLocalShellCommand("darwin");
  assert.deepEqual(cmd.args, ["-c"]);
});

// getNullDevice

test("win32: getNullDevice returns NUL", () => {
  assert.equal(getNullDevice("win32"), "NUL");
});

test("linux: getNullDevice returns /dev/null", () => {
  assert.equal(getNullDevice("linux"), "/dev/null");
});

test("darwin: getNullDevice returns /dev/null", () => {
  assert.equal(getNullDevice("darwin"), "/dev/null");
});

// createTempLogPath

test("createTempLogPath produces path under OS temp dir", () => {
  const logPath = createTempLogPath("athena-win-test");
  assert.ok(
    logPath.startsWith(tmpdir()),
    `Expected path to start with ${tmpdir()}, got ${logPath}`,
  );
  assert.match(logPath, /athena-win-test-/);
  assert.match(logPath, /\.log$/);
});

test("createTempLogPath produces unique paths", () => {
  const a = createTempLogPath("athena-unique");
  const b = createTempLogPath("athena-unique");
  assert.notEqual(a, b);
});

// getExitFilePath

test("getExitFilePath appends .exit suffix", () => {
  assert.equal(getExitFilePath("/tmp/run.log"), "/tmp/run.log.exit");
  assert.equal(
    getExitFilePath("C:\\Users\\test\\run.log"),
    "C:\\Users\\test\\run.log.exit",
  );
});

// buildBackgroundExitCommand

test("win32: buildBackgroundExitCommand uses echo %errorlevel%", () => {
  const cmd = buildBackgroundExitCommand(
    "python train.py",
    "C:\\temp\\run.log",
    "win32",
  );
  assert.match(cmd, /echo %errorlevel%/);
  assert.match(cmd, /run\.log\.exit/);
  assert.match(cmd, /python train\.py/);
});

test("linux: buildBackgroundExitCommand uses printf", () => {
  const cmd = buildBackgroundExitCommand(
    "python train.py",
    "/tmp/run.log",
    "linux",
  );
  assert.match(cmd, /printf/);
  assert.match(cmd, /run\.log\.exit/);
  assert.match(cmd, /python train\.py/);
});

// resolveFileSyncTransport

test("win32: resolveFileSyncTransport returns scp when rsync unavailable", async () => {
  const transport = await resolveFileSyncTransport(
    "win32",
    async (cmd) => cmd === "scp",
  );
  assert.equal(transport, "scp");
});

test("win32: resolveFileSyncTransport prefers rsync when both available", async () => {
  const transport = await resolveFileSyncTransport(
    "win32",
    async (cmd) => cmd === "rsync" || cmd === "scp",
  );
  assert.equal(transport, "rsync");
});

test("win32: resolveFileSyncTransport throws when neither rsync nor scp available", async () => {
  await assert.rejects(
    resolveFileSyncTransport("win32", async () => false),
    /requires `rsync`.*scp/i,
  );
});

test("linux: resolveFileSyncTransport throws when rsync unavailable", async () => {
  await assert.rejects(
    resolveFileSyncTransport("linux", async () => false),
    /requires `rsync`/i,
  );
});

test("linux: resolveFileSyncTransport does not fall back to scp", async () => {
  await assert.rejects(
    resolveFileSyncTransport("linux", async (cmd) => cmd === "scp"),
    /requires `rsync`/i,
  );
});
