# Meeting Record Schema

This document describes Athena's meeting artifact at two levels:

- the product meaning of a meeting record
- the exact runtime fields currently defined in code

The exact runtime contract lives in `src/research/contracts.ts` as `MeetingSessionRecord`, with supporting types such as `AgentPositionRecord` and `MeetingFollowUpAction`.

## Product Meaning

A meeting record captures structured deliberation around a proposal when Athena needs more explicit review than the default loop provides.

Meetings are not the center of Athena.

They are escalation artifacts used when:

- the change is higher risk
- multiple agents or modules must align
- conflict points must be preserved
- follow-up review work must be tracked

## Exact Runtime Contract

In code today, `MeetingSessionRecord` contains:

- `meetingId`
- `proposalId`
- `state`
- `currentRound`
- `mandatoryAgents`
- `conditionalAgents`
- `observerAgents`
- `respondedAgents`
- `absentAgents`
- `keyPositions`
- `conflictPoints`
- `consensusType`
- `consensusReachedAt`
- `executionPlanId`
- `followUpActions`
- `scheduledAt`
- `startedAt`
- `completedAt`
- `createdAt`
- `updatedAt`

Supporting artifacts currently include:

- `AgentPositionRecord`
  - `positionId`
  - `meetingId`
  - `agentId`
  - `moduleId`
  - `round`
  - `position`
  - `impact`
  - `risk`
  - `requiredChanges`
  - `vote`
  - `approvalCondition`
  - `notes`
  - `createdAt`
- `MeetingFollowUpAction`
  - `actionId`
  - `description`
  - `assignedAgent`
  - `dueAt`
  - `status`

## Interpretation Of Important Fields

### Participation

- `mandatoryAgents` are the agents Athena expects to hear from
- `conditionalAgents` are invited based on impact or relevance
- `observerAgents` are read-only participants

### Deliberation

- `currentRound` tracks which stage of the meeting is active
- `keyPositions` summarize the main stances
- `conflictPoints` preserve disagreements that matter to execution

### Outcome

- `consensusType` records the shape of the decision
- `executionPlanId` links the meeting to the next bounded execution artifact
- `followUpActions` preserve any remaining work after the meeting closes

## What This Schema Is Not

This is not Athena's primary control surface and not a requirement for every loop iteration.

Meeting records exist only when the default loop needs stronger structured review.

## Documentation Rule

If this document and the code ever disagree, the exact runtime source of truth is:

- `src/research/contracts.ts`
