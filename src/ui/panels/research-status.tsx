import { Box, Text } from "ink";
import { C } from "../theme.js";
import type { IngestionSourceRecord, TeamRunRecord } from "../../research/contracts.js";

interface ResearchStatusPanelProps {
  run: TeamRunRecord | null;
  source?: IngestionSourceRecord | null;
  securityMode?: string;
  width?: number;
}

export function ResearchStatusPanel({ run, source, securityMode, width }: ResearchStatusPanelProps) {
  const panelWidth = width ?? ((process.stdout.columns || 80) - 2);

  if (!run) {
    return (
      <Box width={panelWidth} paddingLeft={1}>
        <Text color={C.dim}>RESEARCH </Text>
        <Text color={C.dim} dimColor>no active run</Text>
        {securityMode && (
          <>
            <Text>  </Text>
            <Text color={C.dim}>SEC </Text>
            <Text color={securityMode === "enforce" ? C.success : C.primary}>{securityMode}</Text>
          </>
        )}
      </Box>
    );
  }

  const mode = run.automationPolicy.mode;
  const autonomyPolicy = run.automationPolicy.mode === "fully-autonomous"
    ? run.automationPolicy.autonomyPolicy
    : undefined;
  const goal = run.goal.replace(/\s+/g, " ").trim();

  return (
    <Box width={panelWidth} paddingLeft={1}>
      <Text color={C.dim}>RUN </Text>
      <Text color={C.primary}>{run.id}</Text>
      <Text>  </Text>
      <Text color={C.dim}>STATE </Text>
      <Text color={workflowColor(run.workflowState)}>{run.workflowState}</Text>
      <Text>  </Text>
      <Text color={C.dim}>MODE </Text>
      <Text color={C.text}>{mode}</Text>
      <Text>  </Text>
      {autonomyPolicy && (
        <>
          <Text color={C.dim}>AUTO </Text>
          <Text color={C.text}>
            {`risk=${autonomyPolicy.maxRiskTier} retry<=${autonomyPolicy.maxRetryCount ?? "n/a"} wall<=${autonomyPolicy.maxWallClockMinutes ?? "n/a"}m`}
          </Text>
          <Text>  </Text>
        </>
      )}
      {securityMode && (
        <>
          <Text color={C.dim}>SEC </Text>
          <Text color={securityMode === "enforce" ? C.success : C.primary}>{securityMode}</Text>
          <Text>  </Text>
        </>
      )}
      {source && (
        <>
          <Text color={C.dim}>INGEST </Text>
          <Text color={source.status === "failed" ? C.error : source.status === "ingested" ? C.success : C.primary}>
            {source.claimCount ?? 0}/{source.canonicalClaims?.length ?? 0}
          </Text>
          <Text>  </Text>
        </>
      )}
      <Text color={C.dim}>GOAL </Text>
      <Text color={C.text} wrap="truncate">{goal}</Text>
    </Box>
  );
}

function workflowColor(state: TeamRunRecord["workflowState"]): string {
  switch (state) {
    case "failed":
      return C.error;
    case "reported":
      return C.success;
    case "revisit_due":
      return C.primary;
    default:
      return C.text;
  }
}
