import { Box, Text } from "ink";
import { C } from "../theme.js";
import type { IterationCycleRecord, ProposalBrief } from "../../research/contracts.js";

interface ResearchDetailPanelProps {
  iterations?: IterationCycleRecord[];
  proposals?: ProposalBrief[];
  width?: number;
}

export function ResearchDetailPanel({ iterations = [], proposals = [], width }: ResearchDetailPanelProps) {
  const panelWidth = width ?? ((process.stdout.columns || 80) - 2);

  if (iterations.length === 0 && proposals.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" width={panelWidth} paddingLeft={1}>
      {iterations.length > 0 && (
        <Box flexDirection="column">
          <Text color={C.dim}>ITERATIONS ({iterations.length})</Text>
          {iterations.slice(-3).map((cycle) => (
            <Box key={cycle.cycleId}>
              <Text color={C.dim}>  #{cycle.iterationIndex} </Text>
              <Text color={reasonColor(cycle.reason)}>{formatReason(cycle.reason)}</Text>
              <Text color={C.dim}> </Text>
              <Text color={C.text}>{cycle.entryState}</Text>
              <Text color={C.dim}>{" → "}</Text>
              <Text color={C.text}>{cycle.exitState}</Text>
              {cycle.proposalId && (
                <>
                  <Text color={C.dim}> prop=</Text>
                  <Text color={C.primary}>{cycle.proposalId.slice(0, 12)}</Text>
                </>
              )}
            </Box>
          ))}
        </Box>
      )}
      {proposals.length > 0 && (
        <Box flexDirection="column">
          <Text color={C.dim}>PROPOSALS ({proposals.length})</Text>
          {proposals.slice(0, 5).map((proposal) => (
            <Box key={proposal.proposalId}>
              <Text color={C.dim}>  </Text>
              <Text color={statusColor(proposal.status)}>{proposal.status.padEnd(12)}</Text>
              <Text color={C.dim}> score=</Text>
              <Text color={C.text}>{proposal.scorecard?.decisionScore?.toFixed(2) ?? "n/a"}</Text>
              <Text color={C.dim}> ev=</Text>
              <Text color={C.text}>{proposal.claimSupport?.evidenceStrength?.toFixed(2) ?? "n/a"}</Text>
              <Text color={C.dim}> </Text>
              <Text color={C.text} wrap="truncate">{proposal.title.slice(0, 40)}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

function formatReason(reason: IterationCycleRecord["reason"]): string {
  switch (reason) {
    case "reconsideration_trigger_satisfied":
      return "reconsider";
    case "operator_requested_revisit":
      return "operator";
    case "evidence_invalidated":
      return "invalidated";
    case "simulation_regression":
      return "regression";
    default:
      return reason;
  }
}

function reasonColor(reason: IterationCycleRecord["reason"]): string {
  switch (reason) {
    case "simulation_regression":
      return C.error;
    case "evidence_invalidated":
      return C.primary;
    default:
      return C.text;
  }
}

function statusColor(status: ProposalBrief["status"]): string {
  switch (status) {
    case "ready_for_experiment":
    case "scoped_trial":
      return C.success;
    case "archived":
      return C.error;
    case "revisit_due":
      return C.primary;
    default:
      return C.text;
  }
}
