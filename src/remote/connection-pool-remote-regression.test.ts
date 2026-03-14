import test from "node:test";
import assert from "node:assert/strict";
import { ConnectionPool } from "./connection-pool.js";
import type { RemoteMachine } from "./types.js";

function getRemoteState(pool: ConnectionPool): {
  connections: Map<string, unknown>;
  machines: Map<string, RemoteMachine>;
} {
  return pool as unknown as {
    connections: Map<string, unknown>;
    machines: Map<string, RemoteMachine>;
  };
}

test("ConnectionPool reconnects stale remote connections on demand", async () => {
  const pool = new ConnectionPool();
  const state = getRemoteState(pool);

  state.machines.set("gpu-1", {
    id: "gpu-1",
    host: "gpu.example",
    port: 22,
    username: "runner",
    authMethod: "agent",
  });

  const calls: string[] = [];
  state.connections.set("gpu-1", {
    client: {
      exec: (command: string, callback: (err: Error | null, stream: any) => void) => {
        calls.push(command);
        const listeners: Record<string, ((value?: any) => void)[]> = {};
        const stream = {
          stderr: {
            on: (event: string, handler: (data: Buffer) => void) => {
              listeners[`stderr:${event}`] = [...(listeners[`stderr:${event}`] ?? []), handler as unknown as (value?: any) => void];
            },
          },
          on: (event: string, handler: (value?: any) => void) => {
            listeners[event] = [...(listeners[event] ?? []), handler];
          },
        };
        callback(null, stream);
        for (const handler of listeners.data ?? []) {
          handler(Buffer.from("reconnected"));
        }
        for (const handler of listeners.close ?? []) {
          handler(0);
        }
      },
    },
    machine: state.machines.get("gpu-1"),
    connected: true,
    lastUsedAt: Date.now(),
    reconnectAttempts: 0,
  });

  const originalConnect = pool.connect.bind(pool);
  pool.connect = async (machineId: string) => {
    calls.push(`connect:${machineId}`);
    return originalConnect(machineId);
  };

  const existing = state.connections.get("gpu-1") as { connected: boolean };
  existing.connected = false;

  let reconnectCount = 0;
  pool.connect = async (machineId: string) => {
    reconnectCount += 1;
    const current = state.connections.get(machineId) as {
      connected: boolean;
      lastUsedAt: number;
    };
    current.connected = true;
    current.lastUsedAt = Date.now();
  };

  const result = await pool.exec("gpu-1", "echo hello");
  assert.equal(reconnectCount, 1);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "reconnected");
  assert.deepEqual(calls, ["echo hello"]);
});

test("ConnectionPool status reflects remote connection errors after failed connect", async () => {
  const pool = new ConnectionPool();
  pool.addMachine({
    id: "broken",
    host: "broken.example",
    port: 22,
    username: "runner",
    authMethod: "agent",
  });

  pool.connect = async () => {
    const state = getRemoteState(pool);
    state.connections.set("broken", {
      client: null,
      machine: state.machines.get("broken"),
      connected: false,
      lastUsedAt: Date.now(),
      reconnectAttempts: 1,
      lastError: "connect ECONNREFUSED",
    });
    throw new Error("connect ECONNREFUSED");
  };

  await assert.rejects(() => pool.exec("broken", "hostname"), /ECONNREFUSED/);
  const status = pool.getStatus("broken");
  assert.equal(status.connected, false);
  assert.match(status.error ?? "", /ECONNREFUSED/);
});
