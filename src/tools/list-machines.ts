import type { ToolDefinition } from "../providers/types.js";
import type { ConnectionPool } from "../remote/connection-pool.js";

export function createListMachinesTool(
  pool: ConnectionPool,
): ToolDefinition {
  return {
    name: "list_machines",
    description:
      "List all configured remote machines and their connection status.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const statuses = pool.getAllStatuses();
      return JSON.stringify({
        machines: statuses.map((s) => ({
          id: s.machineId,
          connected: s.connected,
          last_connected: s.lastConnectedAt
            ? new Date(s.lastConnectedAt).toISOString()
            : null,
          error: s.error ?? null,
        })),
      });
    },
  };
}
