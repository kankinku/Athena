import type React from "react";
import type { Orchestrator } from "../core/orchestrator.js";
import type { ConnectionPool } from "../remote/connection-pool.js";
import type { RemoteExecutor } from "../remote/executor.js";
import type { MetricStore } from "../metrics/store.js";
import type { MetricCollector } from "../metrics/collector.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { StickyManager, StickyNote } from "../core/stickies.js";
import type { ReasoningEffort } from "../providers/types.js";
import type { SessionSummary } from "../store/session-store.js";
import type { Message } from "./types.js";
import { formatError, formatMetricValue } from "./format.js";
import { sparkline } from "./panels/metrics-dashboard.js";
import { ClaudeProvider } from "../providers/claude/provider.js";
import { savePreferences } from "../store/preferences.js";
import {
  loadMachines,
  addMachine as addMachineConfig,
  removeMachine as removeMachineConfig,
  parseMachineSpec,
} from "../remote/config.js";
import {
  loadHubConfig,
  saveHubConfig,
  removeHubConfig,
} from "../hub/config.js";
import { HubClient } from "../hub/client.js";
import { createHubTools } from "../tools/hub.js";
import { buildWriteupSystemPrompt } from "../tools/writeup.js";
import { formatHelpText } from "./command-registry.js";

export interface CommandContext {
  orchestrator: Orchestrator;
  addMessage: (role: Message["role"], content: string) => number;
  updateMessage: (id: number, updates: Partial<Message>) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  messages: Message[];
  setIsStreaming: (value: boolean) => void;
  connectionPool?: ConnectionPool;
  metricStore?: MetricStore;
  metricCollector?: MetricCollector;
  memoryStore?: MemoryStore;
  stickyManager?: StickyManager;
  setStickyNotes?: React.Dispatch<React.SetStateAction<StickyNote[]>>;
  executor?: RemoteExecutor;
  restoreMessages: (messages: Array<{ role: string; content: string }>) => Message[];
}

type CommandHandler = (args: string[], ctx: CommandContext) => Promise<void> | void;

let lastSessionListing: SessionSummary[] = [];

export async function handleSlashCommand(
  input: string,
  ctx: CommandContext,
): Promise<void> {
  const parts = input.slice(1).split(" ");
  const command = parts[0];
  const args = parts.slice(1);

  const handler = commandHandlers[command];
  if (!handler) {
    ctx.addMessage("system", `Unknown command: /${command}. Try /help`);
    return;
  }

  await handler(args, ctx);
}

const commandHandlers: Record<string, CommandHandler> = {
  switch: (args, ctx) => {
    const provider = args[0] as "claude" | "openai" | undefined;
    if (provider !== "claude" && provider !== "openai") {
      ctx.addMessage("system", "Usage: /switch <claude|openai>");
      return;
    }
    ctx.addMessage("system", `Switching to ${provider}...`);
    ctx.orchestrator.switchProvider(provider).then(
      () => ctx.addMessage("system", `Switched to ${provider}`),
      (error) => ctx.addMessage("error", `Failed to switch: ${formatError(error)}`),
    );
  },

  model: (args, ctx) => {
    const modelId = args[0];
    if (!modelId) {
      ctx.addMessage(
        "system",
        `Current model: ${ctx.orchestrator.currentModel ?? "default"}\nUsage: /model <model-id>`,
      );
      return;
    }
    ctx.addMessage("system", `Setting model to ${modelId}...`);
    ctx.orchestrator.setModel(modelId).then(
      () => {
        savePreferences({ model: modelId });
        ctx.addMessage("system", `Model set to ${modelId}`);
      },
      (error) => ctx.addMessage("error", `Failed to set model: ${formatError(error)}`),
    );
  },

  reasoning: (args, ctx) => {
    const level = args[0];
    const validLevels = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
    if (!level || !validLevels.includes(level)) {
      const provider = ctx.orchestrator.currentProvider?.name;
      const hint = provider === "claude"
        ? "Claude: medium, high, max"
        : "OpenAI: none, minimal, low, medium, high, xhigh";
      ctx.addMessage(
        "system",
        `Current reasoning effort: ${ctx.orchestrator.reasoningEffort ?? "medium"}\n${hint}\nUsage: /reasoning <level>`,
      );
      return;
    }
    ctx.orchestrator.setReasoningEffort(level as ReasoningEffort).then(
      () => {
        savePreferences({ reasoningEffort: level });
        ctx.addMessage("system", `Reasoning effort set to ${level}`);
      },
      (error) => ctx.addMessage("error", `Failed: ${formatError(error)}`),
    );
  },

  models: (_args, ctx) => {
    ctx.addMessage("system", "Fetching available models...");
    ctx.orchestrator.fetchModels().then(
      (models) => {
        const current = ctx.orchestrator.currentModel;
        const lines = models.map((model) => {
          const marker = model.id === current ? " *" : "";
          const description = model.description ? ` - ${model.description}` : "";
          return `  ${model.id}${marker}${description}`;
        });
        ctx.addMessage("system", `Available models:\n${lines.join("\n")}`);
      },
      (error) => ctx.addMessage("error", `Failed to fetch models: ${formatError(error)}`),
    );
  },

  "claude-mode": (args, ctx) => {
    const mode = args[0];
    if (mode !== "cli" && mode !== "api") {
      const current = (ctx.orchestrator.getProvider("claude") as ClaudeProvider | null)?.currentAuthMode;
      ctx.addMessage(
        "system",
        `Current Claude mode: ${current === "cli" ? "cli (Agent SDK)" : "api (API key)"}\nUsage: /claude-mode <cli|api>`,
      );
      return;
    }
    const claude = ctx.orchestrator.getProvider("claude") as ClaudeProvider | null;
    if (!claude) {
      ctx.addMessage("error", "Claude provider not registered");
      return;
    }
    claude.setPreferredAuthMode(mode);
    savePreferences({ claudeAuthMode: mode });
    claude.authenticate().then(
      () => ctx.addMessage("system", `Claude mode set to ${mode === "cli" ? "cli (Agent SDK)" : "api (API key)"}`),
      (error) => ctx.addMessage("error", `Failed to switch Claude mode: ${formatError(error)}`),
    );
  },

  machine: (args, ctx) => {
    handleMachineCommand(args, ctx);
  },

  machines: (_args, ctx) => {
    handleMachineCommand(["list"], ctx);
  },

  resume: (args, ctx) => {
    const index = args[0] ? Number.parseInt(args[0], 10) : Number.NaN;

    if (Number.isNaN(index)) {
      const sessions = ctx.orchestrator.sessionStore.listSessionSummaries(20);
      if (sessions.length === 0) {
        ctx.addMessage("system", "No past sessions found.");
        return;
      }
      lastSessionListing = sessions;
      const lines = sessions.map((session, i) => {
        const date = new Date(session.lastActiveAt).toLocaleString();
        const preview = session.firstUserMessage ?? "(no messages)";
        const msgCount = `${session.messageCount} msg${session.messageCount !== 1 ? "s" : ""}`;
        return `  ${i + 1}. [${date}] ${session.provider} (${msgCount})\n     ${preview}`;
      });
      ctx.addMessage(
        "system",
        `Recent sessions:\n${lines.join("\n")}\n\nUse /resume <number> to resume a session.`,
      );
      return;
    }

    if (index < 1 || index > lastSessionListing.length) {
      ctx.addMessage(
        "system",
        lastSessionListing.length === 0
          ? "Run /resume first to list sessions."
          : `Invalid index. Choose 1-${lastSessionListing.length}.`,
      );
      return;
    }

    const target = lastSessionListing[index - 1];
    ctx.addMessage("system", `Resuming session from ${new Date(target.lastActiveAt).toLocaleString()}...`);
    const storedMessages = ctx.orchestrator.sessionStore.getMessages(target.id, 500);
    const restored = ctx.restoreMessages(
      storedMessages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({ role: message.role, content: message.content })),
    );
    ctx.setMessages(restored);

    ctx.orchestrator.resumeSession(target.id).then(
      () => ctx.addMessage(
        "system",
        `Session resumed (${target.provider}, ${storedMessages.length} messages loaded)`,
      ),
      (error) => ctx.addMessage("error", `Failed to resume session: ${formatError(error)}`),
    );
  },

  metric: (args, ctx) => {
    handleMetricCommand(args, ctx);
  },

  metrics: (args, ctx) => {
    handleMetricCommand(args, ctx);
  },

  writeup: async (_args, ctx) => {
    await handleWriteupCommand(ctx);
  },

  help: (_args, ctx) => {
    ctx.addMessage("system", formatHelpText());
  },

  status: (_args, ctx) => {
    ctx.addMessage(
      "system",
      [
        `Provider: ${ctx.orchestrator.currentProvider?.displayName ?? "None"}`,
        `Model: ${ctx.orchestrator.currentModel ?? "default"}`,
        `Reasoning: ${ctx.orchestrator.reasoningEffort ?? "medium"}`,
        `State: ${ctx.orchestrator.currentState}`,
        `Cost: $${ctx.orchestrator.totalCostUsd.toFixed(4)}`,
      ].join("\n"),
    );
  },

  sticky: (args, ctx) => {
    if (!ctx.stickyManager || !ctx.setStickyNotes) {
      ctx.addMessage("system", "Sticky notes not available.");
      return;
    }
    const text = args.join(" ").trim();
    if (!text) {
      ctx.addMessage("system", "Usage: /sticky <text to pin>");
      return;
    }
    const note = ctx.stickyManager.add(text);
    ctx.setStickyNotes(ctx.stickyManager.list());
    ctx.addMessage("system", `Pinned sticky #${note.num}: ${text}`);
  },

  stickies: (args, ctx) => {
    if (!ctx.stickyManager || !ctx.setStickyNotes) {
      ctx.addMessage("system", "Sticky notes not available.");
      return;
    }
    if (args[0] === "rm" && args[1]) {
      const number = Number.parseInt(args[1], 10);
      if (Number.isNaN(number)) {
        ctx.addMessage("system", "Usage: /stickies rm <number>");
        return;
      }
      const removed = ctx.stickyManager.remove(number);
      ctx.setStickyNotes(ctx.stickyManager.list());
      ctx.addMessage("system", removed ? `Removed sticky #${number}` : `Sticky #${number} not found`);
      return;
    }

    const notes = ctx.stickyManager.list();
    if (notes.length === 0) {
      ctx.addMessage("system", "No sticky notes. Use /sticky <text> to add one.");
      return;
    }
    const listing = notes.map((note) => `  [${note.num}] ${note.text}`).join("\n");
    ctx.addMessage("system", `Sticky notes:\n${listing}`);
  },

  memory: (args, ctx) => {
    if (!ctx.memoryStore) {
      ctx.addMessage("system", "Memory system not initialized.");
      return;
    }
    const path = args[0] ?? "/";
    const tree = ctx.memoryStore.formatTree(path);
    ctx.addMessage("system", `Memory tree (${path}):\n${tree}`);
  },

  hub: (args, ctx) => {
    handleHubCommand(args, ctx);
  },

  clear: (_args, ctx) => {
    ctx.setMessages([]);
  },

  quit: () => {
    process.exit(0);
  },

  exit: () => {
    process.exit(0);
  },
};

function handleMachineCommand(args: string[], ctx: CommandContext): void {
  const subCommand = args[0];

  if (!subCommand || subCommand === "list") {
    const machines = loadMachines();
    if (machines.length === 0) {
      ctx.addMessage("system", "No machines configured.\nUsage: /machine add <id> <user@host[:port]> [--key <path>]");
      return;
    }
    const lines = machines.map((machine) => {
      const status = ctx.connectionPool?.getStatus(machine.id);
      let statusText = status?.connected ? "connected" : "disconnected";
      if (!status?.connected && status?.error) {
        statusText += ` - ${status.error}`;
      }
      return `  ${machine.id}  ${machine.username}@${machine.host}:${machine.port}  [${machine.authMethod}]  ${statusText}`;
    });
    ctx.addMessage("system", `Machines:\n${lines.join("\n")}`);
    return;
  }

  if (subCommand === "add") {
    const id = args[1];
    const spec = args[2];
    if (!id || !spec) {
      ctx.addMessage("system", "Usage: /machine add <id> <user@host[:port]> [--key <path>]");
      return;
    }

    const options: { key?: string; auth?: string } = {};
    for (let i = 3; i < args.length; i++) {
      if (args[i] === "--key" && args[i + 1]) {
        options.key = args[++i];
      } else if (args[i] === "--auth" && args[i + 1]) {
        options.auth = args[++i];
      }
    }

    try {
      const machine = parseMachineSpec(id, spec, options);
      addMachineConfig(machine);
      ctx.connectionPool?.addMachine(machine);
      ctx.addMessage("system", `Added machine "${id}" (${machine.username}@${machine.host}:${machine.port}). Connecting...`);
      ctx.connectionPool?.connect(id).then(
        () => ctx.addMessage("system", `Machine "${id}" connected.`),
        (error) => ctx.addMessage("error", `Machine "${id}" added but connection failed: ${formatError(error)}\nThe agent can still try to connect later.`),
      );
    } catch (error) {
      ctx.addMessage("error", `Failed to add machine: ${formatError(error)}`);
    }
    return;
  }

  if (subCommand === "rm" || subCommand === "remove") {
    const id = args[1];
    if (!id) {
      ctx.addMessage("system", "Usage: /machine rm <id>");
      return;
    }
    if (removeMachineConfig(id)) {
      ctx.connectionPool?.removeMachine(id);
      ctx.addMessage("system", `Removed machine "${id}"`);
    } else {
      ctx.addMessage("error", `Machine "${id}" not found`);
    }
    return;
  }

  ctx.addMessage("system", "Usage: /machine <add|rm|list>");
}

function handleMetricCommand(args: string[], ctx: CommandContext): void {
  if (!ctx.metricStore) {
    ctx.addMessage("error", "Metric store not available");
    return;
  }

  if (args[0] === "clear") {
    const deleted = ctx.metricStore.clear();
    ctx.metricCollector?.reset();
    ctx.addMessage("system", `Cleared ${deleted} metric points.`);
    return;
  }

  if (args.length === 0) {
    const allNames = ctx.metricStore.getAllMetricNames();
    if (allNames.length === 0) {
      ctx.addMessage("system", "No metrics recorded yet.");
      return;
    }
    ctx.addMessage(
      "system",
      `Known metrics:\n  ${allNames.join("  ")}\n\nUsage: /metric <name1> [name2] ... | /metrics clear`,
    );
    return;
  }

  const lines: string[] = [];
  for (const name of args) {
    const series = ctx.metricStore.getSeriesAcrossTasks(name, 50);
    if (series.length === 0) {
      lines.push(`  ${name}  (no data)`);
      continue;
    }
    const values = series.map((point) => point.value);
    const latest = values[values.length - 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    lines.push(
      `  ${name}  ${sparkline(values, 30)}  ${formatMetricValue(latest)}  (min ${formatMetricValue(min)} max ${formatMetricValue(max)})`,
    );
  }
  ctx.addMessage("system", lines.join("\n"));
}

function handleHubCommand(args: string[], ctx: CommandContext): void {
  const subCommand = args[0];

  if (!subCommand || subCommand === "status") {
    const config = loadHubConfig();
    if (!config) {
      ctx.addMessage("system", "AgentHub not configured.\nUsage: /hub connect <url> [agent-name]");
      return;
    }
    const client = new HubClient(config);
    ctx.addMessage(
      "system",
      `AgentHub: ${config.url}\nAgent: ${config.agentName ?? "(unnamed)"}\nChecking connection...`,
    );
    client.health().then(
      () => ctx.addMessage("system", "AgentHub connection OK"),
      (error) => ctx.addMessage("error", `AgentHub unreachable: ${formatError(error)}`),
    );
    return;
  }

  if (subCommand === "connect") {
    const url = args[1];
    const agentName = args[2] ?? `athena-${Math.random().toString(36).slice(2, 8)}`;
    if (!url) {
      ctx.addMessage("system", "Usage: /hub connect <url> [agent-name]");
      return;
    }
    const cleanUrl = (url.startsWith("http://") || url.startsWith("https://") ? url : `http://${url}`).replace(/\/+$/, "");
    ctx.addMessage("system", `Registering "${agentName}" on ${cleanUrl}...`);

    HubClient.selfRegister(cleanUrl, agentName).then(
      (result) => {
        const config = { url: cleanUrl, apiKey: result.api_key, agentName: result.id };
        saveHubConfig(config);
        if (ctx.executor) {
          const client = new HubClient(config);
          ctx.orchestrator.registerTools(createHubTools(client, ctx.executor));
          ctx.addMessage("system", `Registered as "${result.id}" on ${cleanUrl}\nHub tools are now available.`);
        } else {
          ctx.addMessage("system", `Registered as "${result.id}". Restart Athena to activate hub tools.`);
        }
      },
      (error) => ctx.addMessage("error", `Registration failed: ${formatError(error)}`),
    );
    return;
  }

  if (subCommand === "disconnect") {
    removeHubConfig();
    ctx.addMessage("system", "AgentHub config removed. Restart Athena to remove hub tools.");
    return;
  }

  ctx.addMessage("system", "Usage: /hub [connect <url> [name] | disconnect | status]");
}

async function handleWriteupCommand(ctx: CommandContext): Promise<void> {
  if (ctx.messages.length === 0) {
    ctx.addMessage("system", "No conversation to write up.");
    return;
  }

  const transcript = ctx.messages
    .map((message) => {
      if (message.role === "user") return `[USER] ${message.content}`;
      if (message.role === "assistant") return `[ASSISTANT] ${message.content}`;
      if (message.role === "tool" && message.tool) {
        const result = message.tool.result ? `\nResult: ${message.tool.result}` : "";
        return `[TOOL: ${message.tool.name}] ${JSON.stringify(message.tool.args)}${result}`;
      }
      if (message.role === "system") return `[SYSTEM] ${message.content}`;
      if (message.role === "error") return `[ERROR] ${message.content}`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");

  ctx.addMessage("system", "Generating writeup...");
  ctx.setIsStreaming(true);

  try {
    const provider = ctx.orchestrator.currentProvider;
    if (!provider) {
      ctx.addMessage("error", "No active provider");
      return;
    }

    const writeupSession = await provider.createSession({
      systemPrompt: buildWriteupSystemPrompt({ transcript: true }),
    });

    try {
      let writeupText = "";
      let writeupMessageId: number | null = null;

      for await (const event of provider.send(
        writeupSession,
        `Here is the full experiment session transcript:\n\n${transcript}`,
        [],
      )) {
        if (event.type === "text" && event.delta) {
          writeupText += event.delta;
          if (writeupMessageId === null) {
            writeupMessageId = ctx.addMessage("assistant", writeupText);
          } else {
            ctx.updateMessage(writeupMessageId, { content: writeupText });
          }
        }
      }
    } finally {
      await provider.closeSession(writeupSession).catch(() => {});
    }
  } catch (error) {
    ctx.addMessage("error", `Writeup failed: ${formatError(error)}`);
  } finally {
    ctx.setIsStreaming(false);
  }
}
