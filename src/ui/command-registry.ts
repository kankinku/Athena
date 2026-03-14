export interface SlashCommand {
  name: string;
  args?: string;
  description: string;
}

export const COMMANDS: SlashCommand[] = [
  { name: "help", description: "Show available commands and keybindings" },
  { name: "switch", args: "<claude|openai>", description: "Switch model provider" },
  { name: "model", args: "<model-id>", description: "Set model (e.g. gpt-5.4, claude-opus-4-6)" },
  { name: "models", description: "List available models for current provider" },
  { name: "reasoning", args: "<level>", description: "Set reasoning effort (none/low/medium/high/max)" },
  { name: "claude-mode", args: "<cli|api>", description: "Switch Claude auth mode (cli = Agent SDK, api = API key)" },
  { name: "resume", args: "[number]", description: "List or resume a past session" },
  { name: "metric", args: "[name1 name2 ...]", description: "Show sparklines for named metrics" },
  { name: "metrics", args: "clear", description: "Clear all collected metrics" },
  { name: "writeup", description: "Generate an experiment writeup from the session" },
  { name: "machine", args: "<add|rm|list>", description: "Manage remote machines" },
  { name: "machines", description: "List configured remote machines" },
  { name: "hub", args: "[connect|disconnect|status]", description: "AgentHub collaboration (self-register)" },
  { name: "sticky", args: "<text>", description: "Pin a sticky note (always visible to the model)" },
  { name: "stickies", args: "[rm <num>]", description: "List sticky notes, or remove one by number" },
  { name: "memory", args: "[path]", description: "Show the memory tree (virtual filesystem)" },
  { name: "status", description: "Show provider, model, state, and cost" },
  { name: "clear", description: "Clear conversation history" },
  { name: "quit", description: "Exit Athena" },
];

export function formatHelpText(): string {
  const maxLength = COMMANDS.reduce((max, command) => {
    const full = `  /${command.name}${command.args ? ` ${command.args}` : ""}`;
    return Math.max(max, full.length);
  }, 0);

  const lines = COMMANDS.map((command) => {
    const full = `  /${command.name}${command.args ? ` ${command.args}` : ""}`;
    return `${full.padEnd(maxLength + 2)}${command.description}`;
  });

  return [
    "Commands:",
    ...lines,
    "",
    "Keys:",
    "  Tab        Autocomplete command",
    "  Up/Down    Navigate menu / history",
    "  Left/Right Move cursor",
    "  Ctrl+T     Task output overlay",
    "  Ctrl+G     Metrics overlay",
    "  Escape     Interrupt / close overlay",
    "  Ctrl+A/E   Start / end of line",
    "  Ctrl+W     Delete word backward",
    "  Ctrl+U     Clear line",
    "  Ctrl+C     Interrupt / Exit",
  ].join("\n");
}
