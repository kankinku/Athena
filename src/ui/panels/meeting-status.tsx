import { Box, Text } from "ink";
import { C } from "../theme.js";
import type { MeetingSessionRecord, ChangeWorkflowState } from "../../research/contracts.js";

interface MeetingStatusPanelProps {
  meeting: MeetingSessionRecord | null;
  proposalTitle?: string;
  changeState?: ChangeWorkflowState;
  width?: number;
}

export function MeetingStatusPanel({
  meeting,
  proposalTitle,
  changeState,
  width,
}: MeetingStatusPanelProps) {
  const panelWidth = width ?? ((process.stdout.columns || 80) - 2);

  if (!meeting) {
    return (
      <Box width={panelWidth} paddingLeft={1}>
        <Text color={C.dim}>MEETING </Text>
        <Text color={C.dim} dimColor>no active meeting</Text>
        {changeState && (
          <>
            <Text>  </Text>
            <Text color={C.dim}>CHANGE </Text>
            <Text color={changeStateColor(changeState)}>{changeState}</Text>
          </>
        )}
      </Box>
    );
  }

  const responded = meeting.respondedAgents.length;
  const total = meeting.mandatoryAgents.length + meeting.conditionalAgents.length;
  const conflicts = meeting.conflictPoints.length;
  const title = proposalTitle
    ? proposalTitle.replace(/\s+/g, " ").trim()
    : meeting.proposalId;

  return (
    <Box width={panelWidth} paddingLeft={1} flexDirection="column">
      {/* Line 1: Meeting state + proposal */}
      <Box>
        <Text color={C.dim}>MTG </Text>
        <Text color={C.primary}>{meeting.meetingId}</Text>
        <Text>  </Text>
        <Text color={C.dim}>STATE </Text>
        <Text color={meetingStateColor(meeting.state)}>{meeting.state}</Text>
        <Text>  </Text>
        <Text color={C.dim}>ROUND </Text>
        <Text color={C.text}>{meeting.currentRound}/5</Text>
        <Text>  </Text>
        {meeting.consensusType && (
          <>
            <Text color={C.dim}>CONSENSUS </Text>
            <Text color={consensusColor(meeting.consensusType)}>{meeting.consensusType}</Text>
            <Text>  </Text>
          </>
        )}
      </Box>

      {/* Line 2: Agents + conflicts */}
      <Box>
        <Text color={C.dim}>AGENTS </Text>
        <Text color={responded === total ? C.success : C.primary}>
          {responded}/{total} responded
        </Text>
        <Text>  </Text>
        {meeting.absentAgents.length > 0 && (
          <>
            <Text color={C.error}>
              {meeting.absentAgents.length} absent
            </Text>
            <Text>  </Text>
          </>
        )}
        <Text color={C.dim}>CONFLICTS </Text>
        <Text color={conflicts > 0 ? C.error : C.dim}>{conflicts}</Text>
        <Text>  </Text>
        <Text color={C.dim}>PROPOSAL </Text>
        <Text color={C.text} wrap="truncate">{title}</Text>
      </Box>

      {/* Line 3: Agent details (mandatory) */}
      <Box>
        <Text color={C.dim}>  MANDATORY </Text>
        {meeting.mandatoryAgents.map((agent, i) => {
          const responded_ = meeting.respondedAgents.includes(agent);
          const absent = meeting.absentAgents.includes(agent);
          const icon = absent ? "✗" : responded_ ? "✓" : "…";
          const color = absent ? C.error : responded_ ? C.success : C.primary;
          return (
            <Text key={agent}>
              {i > 0 && <Text> </Text>}
              <Text color={color}>{icon} {agent}</Text>
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}

function meetingStateColor(state: MeetingSessionRecord["state"]): string {
  switch (state) {
    case "completed":
      return C.success;
    case "failed":
      return C.error;
    case "on-hold":
    case "pending-quorum":
      return C.primary;
    default:
      return C.text;
  }
}

function changeStateColor(state: ChangeWorkflowState): string {
  switch (state) {
    case "completed":
      return C.success;
    case "failed":
    case "rejected":
      return C.error;
    case "remeeting":
    case "on-hold":
      return C.primary;
    default:
      return C.text;
  }
}

function consensusColor(type: MeetingSessionRecord["consensusType"]): string {
  switch (type) {
    case "approved":
      return C.success;
    case "rejected":
      return C.error;
    case "conditionally-approved":
    case "split-execution":
    case "experiment-first":
      return C.primary;
    default:
      return C.dim;
  }
}
