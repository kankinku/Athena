import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { C, G, METRIC_COLORS, nameHash } from "../theme.js";
import { renderMarkdown } from "../markdown.js";
import { sparkline } from "./metrics-dashboard.js";
import { formatMetricValue, truncate } from "../format.js";
import type { Message, ToolData } from "../types.js";

interface ConversationPanelProps {
  messages: Message[];
  isStreaming: boolean;
}

export function ConversationPanel({ messages, isStreaming }: ConversationPanelProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingBottom={1}>
      {messages.map((message) => (
        <MessageLine key={message.id} message={message} />
      ))}
      {isStreaming && (
        <Box paddingLeft={2}>
          <PulsingIndicator />
        </Box>
      )}
    </Box>
  );
}

function MessageLine({ message }: { message: Message }) {
  switch (message.role) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text wrap="wrap">
            <Text color={C.primary} bold>{G.active} </Text>
            <Text color={C.text}>{message.content}</Text>
          </Text>
        </Box>
      );

    case "assistant":
      return (
        <Box paddingLeft={2}>
          <Text wrap="wrap">{renderMarkdown(message.content)}</Text>
        </Box>
      );

    case "tool":
      return message.tool ? <ToolCallBlock tool={message.tool} /> : null;

    case "error":
      return (
        <Box paddingLeft={2}>
          <Text wrap="wrap" color={C.error}>! {message.content}</Text>
        </Box>
      );

    case "system":
      return (
        <Box paddingLeft={2} marginTop={1}>
          <Text color={C.primary} dimColor wrap="wrap">{message.content}</Text>
        </Box>
      );

    default:
      return (
        <Box paddingLeft={2}>
          <Text wrap="wrap">{message.content}</Text>
        </Box>
      );
  }
}

const PULSE_FRAMES = [".", "..", "..."];

function PulsingIndicator() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((value) => (value + 1) % PULSE_FRAMES.length);
    }, 120);
    return () => clearInterval(timer);
  }, []);

  return <Text color={C.primary}>{PULSE_FRAMES[frame]}</Text>;
}

function ToolCallBlock({ tool }: { tool: ToolData }) {
  switch (tool.name) {
    case "remote_exec":
      return <ExecDisplay tool={tool} />;
    case "remote_exec_background":
      return <ExecBackgroundDisplay tool={tool} />;
    case "remote_upload":
    case "remote_download":
      return <FileSyncDisplay tool={tool} />;
    case "sleep":
      return <SleepDisplay tool={tool} />;
    case "start_monitor":
      return <MonitorDisplay tool={tool} />;
    case "stop_monitor":
      return <MonitorStopDisplay />;
    case "task_output":
      return <TaskOutputDisplay tool={tool} />;
    case "list_machines":
      return <ListMachinesDisplay tool={tool} />;
    case "show_metrics":
      return <ShowMetricsDisplay tool={tool} />;
    case "compare_runs":
      return <CompareRunsDisplay tool={tool} />;
    default:
      return <GenericToolDisplay tool={tool} />;
  }
}

function ToolHeader({ label, detail }: { label: string; detail?: string }) {
  return (
    <Box>
      <Text wrap="wrap">
        <Text color={C.dim}>[{label}]</Text>
        {detail ? <Text color={C.text}> {detail}</Text> : null}
      </Text>
    </Box>
  );
}

function ToolLine({
  text,
  color = C.dim,
}: {
  text: string;
  color?: typeof C.dim | typeof C.text | typeof C.error | typeof C.primary | typeof C.success | typeof C.bright;
}) {
  return (
    <Box paddingLeft={2}>
      <Text color={C.dim}>- </Text>
      <Text color={color} wrap="wrap">{text}</Text>
    </Box>
  );
}

function parseResult(tool: ToolData): Record<string, unknown> | null {
  if (!tool.result) {
    return null;
  }

  try {
    return JSON.parse(tool.result);
  } catch {
    return null;
  }
}

function trimOutput(text: string, maxLines: number): string {
  const lines = text.trimEnd().split("\n");
  if (lines.length <= maxLines) {
    return text.trimEnd();
  }

  return `... ${lines.length - maxLines} lines hidden ...\n${lines.slice(-maxLines).join("\n")}`;
}

function ExecDisplay({ tool }: { tool: ToolData }) {
  const machine = (tool.args.machine_id as string) ?? "?";
  const command = (tool.args.command as string) ?? "";
  const result = parseResult(tool);
  const stdout = result?.stdout as string | undefined;
  const stderr = result?.stderr as string | undefined;
  const exitCode = result?.exit_code as number | undefined;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <ToolHeader label="exec" detail={`${machine} ${command}`.trim()} />
      {stdout ? <ToolLine text={trimOutput(stdout, 20)} color={C.text} /> : null}
      {stderr ? <ToolLine text={trimOutput(stderr, 5)} color={C.error} /> : null}
      {exitCode !== undefined ? (
        <ToolLine text={`exit ${exitCode}`} color={exitCode === 0 ? C.dim : C.error} />
      ) : null}
      {!tool.result ? <ToolLine text="running..." /> : null}
    </Box>
  );
}

function ExecBackgroundDisplay({ tool }: { tool: ToolData }) {
  const machine = (tool.args.machine_id as string) ?? "?";
  const command = (tool.args.command as string) ?? "";
  const result = parseResult(tool);
  const pid = result?.pid as number | undefined;
  const logPath = result?.log_path as string | undefined;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <ToolHeader label="exec-bg" detail={`${machine} ${command}`.trim()} />
      {result ? (
        <ToolLine text={`pid ${pid ?? "?"}${logPath ? `  log ${logPath}` : ""}`} />
      ) : (
        <ToolLine text="launching..." />
      )}
    </Box>
  );
}

function FileSyncDisplay({ tool }: { tool: ToolData }) {
  const machine = (tool.args.machine_id as string) ?? "?";
  const local = (tool.args.local_path as string) ?? "";
  const remote = (tool.args.remote_path as string) ?? "";
  const direction =
    tool.name === "remote_upload"
      ? `${local} -> ${machine}:${remote}`
      : `${machine}:${remote} -> ${local}`;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <ToolHeader label={tool.name.replace("remote_", "")} detail={direction} />
      {tool.result ? <ToolLine text={truncate(tool.result, 120)} color={tool.isError ? C.error : C.dim} /> : null}
    </Box>
  );
}

function SleepDisplay({ tool }: { tool: ToolData }) {
  const reason = (tool.args.reason as string) ?? "";
  const result = parseResult(tool);

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <ToolHeader label="sleep" detail={truncate(reason, 80, true)} />
      {result && !tool.isError ? (
        <ToolLine
          text={`session ${String(result.session_id ?? "?").slice(0, 8)}${result.deadline ? `  deadline ${String(result.deadline)}` : ""}`}
        />
      ) : null}
      {tool.isError && tool.result ? <ToolLine text={truncate(tool.result, 120)} color={C.error} /> : null}
    </Box>
  );
}

function TaskOutputDisplay({ tool }: { tool: ToolData }) {
  const machine = (tool.args.machine_id as string) ?? "?";
  const pid = tool.args.pid as number | undefined;
  const result = parseResult(tool);
  const output = result?.output as string | undefined;
  const running = result?.running as boolean | undefined;
  const status = running === undefined ? undefined : running ? "running" : "stopped";

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <ToolHeader label="task-output" detail={`${machine}:${pid ?? "?"}${status ? ` ${status}` : ""}`} />
      {output ? <ToolLine text={trimOutput(output, 20)} color={C.text} /> : null}
      {!tool.result ? <ToolLine text="fetching..." /> : null}
      {result?.error ? <ToolLine text={String(result.error)} color={C.error} /> : null}
    </Box>
  );
}

function ListMachinesDisplay({ tool }: { tool: ToolData }) {
  const result = parseResult(tool);
  const machines = (result?.machines ?? []) as Array<{
    id: string;
    connected: boolean;
    error?: string;
  }>;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <ToolHeader label="machines" />
      {machines.length > 0
        ? machines.map((machine) => (
            <ToolLine
              key={machine.id}
              text={`${machine.connected ? "connected" : "disconnected"} ${machine.id}${machine.error ? `  ${machine.error}` : ""}`}
              color={machine.connected ? C.success : C.dim}
            />
          ))
        : <ToolLine text={!tool.result ? "fetching..." : "no machines"} />}
    </Box>
  );
}

function ShowMetricsDisplay({ tool }: { tool: ToolData }) {
  const result = parseResult(tool);
  const metrics = (result?.metrics ?? []) as Array<{
    name: string;
    values: number[];
    latest: number | null;
    min: number | null;
    max: number | null;
    trend: string;
  }>;

  const trendIcon = (trend: string): string => {
    switch (trend) {
      case "decreasing":
        return "down";
      case "increasing":
        return "up";
      case "plateau":
        return "flat";
      case "unstable":
        return "unstable";
      default:
        return "?";
    }
  };

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <ToolHeader label="metrics" />
      {metrics.length > 0 ? (
        metrics.map((metric) => {
          const color = METRIC_COLORS[nameHash(metric.name) % METRIC_COLORS.length];
          const latest = metric.latest === null ? "n/a" : formatMetricValue(metric.latest);
          const min = metric.min === null ? "n/a" : formatMetricValue(metric.min);
          const max = metric.max === null ? "n/a" : formatMetricValue(metric.max);
          return (
            <Box key={metric.name} paddingLeft={2}>
              <Text color={C.dim}>- </Text>
              <Text color={color}>{metric.name}</Text>
              {metric.values.length > 0 ? <Text color={color}> {sparkline(metric.values, 30)}</Text> : null}
              <Text color={C.text}> {latest}</Text>
              <Text color={C.dim}> min {min} max {max} {trendIcon(metric.trend)}</Text>
            </Box>
          );
        })
      ) : (
        <ToolLine text={!tool.result ? "loading..." : "no metrics found"} />
      )}
    </Box>
  );
}

function MonitorDisplay({ tool }: { tool: ToolData }) {
  const goal = (tool.args.goal as string) ?? "";
  const interval = (tool.args.interval_minutes as number) ?? 2;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <ToolHeader label="monitor" detail={`every ${interval}m`} />
      <ToolLine text={goal} />
    </Box>
  );
}

function MonitorStopDisplay() {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <ToolHeader label="monitor" detail="stopped" />
    </Box>
  );
}

function CompareRunsDisplay({ tool }: { tool: ToolData }) {
  const taskA = (tool.args.task_a as string) ?? "?";
  const taskB = (tool.args.task_b as string) ?? "?";
  const result = parseResult(tool);
  const comparisons = (result?.comparisons ?? []) as Array<{
    metric: string;
    baseline: { latest: number; min: number; max: number } | null;
    experiment: { latest: number; min: number; max: number } | null;
    delta: number | null;
    direction: string;
  }>;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <ToolHeader label="compare" detail={`${taskA} vs ${taskB}`} />
      {comparisons.length > 0 ? (
        comparisons.map((comparison) => {
          const color = METRIC_COLORS[nameHash(comparison.metric) % METRIC_COLORS.length];
          const baseline = comparison.baseline?.latest ?? null;
          const experiment = comparison.experiment?.latest ?? null;
          const delta = comparison.delta;
          return (
            <Box key={comparison.metric} paddingLeft={2}>
              <Text color={C.dim}>- </Text>
              <Text color={color}>{comparison.metric}</Text>
              <Text color={C.dim}> {baseline === null ? "n/a" : formatMetricValue(baseline)} {"->"} </Text>
              <Text color={C.text}>{experiment === null ? "n/a" : formatMetricValue(experiment)}</Text>
              {delta !== null ? (
                <Text color={C.dim}> ({comparison.direction} {delta > 0 ? "+" : ""}{formatMetricValue(delta)})</Text>
              ) : null}
            </Box>
          );
        })
      ) : (
        <ToolLine text={!tool.result ? "comparing..." : result?.error ? String(result.error) : "no comparison data"} color={result?.error ? C.error : C.dim} />
      )}
    </Box>
  );
}

function GenericToolDisplay({ tool }: { tool: ToolData }) {
  const argText = Object.entries(tool.args)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? truncate(value, 60) : JSON.stringify(value)}`)
    .join("  ");

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <ToolHeader label={tool.name} detail={argText} />
      {tool.result ? <ToolLine text={truncate(tool.result, 120)} color={tool.isError ? C.error : C.dim} /> : null}
    </Box>
  );
}
