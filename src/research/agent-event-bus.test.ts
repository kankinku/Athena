import test from "node:test";
import assert from "node:assert/strict";

test("AgentEventBus: publish and subscribe", async () => {
  const { AgentEventBus } = await import("./agent-event-bus.js");
  const bus = new AgentEventBus();

  const received: unknown[] = [];
  bus.on("agent:response", (evt) => received.push(evt));

  bus.publish({
    eventId: "evt_1",
    type: "agent:response",
    meetingId: "mtg_1",
    agentId: "agent:be",
    round: 1,
    payload: { stance: "support" },
    timestamp: Date.now(),
  });

  assert.equal(received.length, 1);
  bus.dispose();
});

test("AgentEventBus: catch-all (*) listener", async () => {
  const { AgentEventBus } = await import("./agent-event-bus.js");
  const bus = new AgentEventBus();

  const all: unknown[] = [];
  bus.on("*", (evt) => all.push(evt));

  bus.publish({
    eventId: "evt_a",
    type: "round:advance",
    meetingId: "mtg_1",
    payload: {},
    timestamp: Date.now(),
  });
  bus.publish({
    eventId: "evt_b",
    type: "broadcast",
    meetingId: "mtg_1",
    payload: {},
    timestamp: Date.now(),
  });

  assert.equal(all.length, 2);
  bus.dispose();
});

test("AgentEventBus: receiveResponse fills waiter + resolves immediately if all received", async () => {
  const { AgentEventBus } = await import("./agent-event-bus.js");
  const bus = new AgentEventBus({ defaultTimeoutMs: 5000 });

  // Pre-submit responses before waiting
  bus.receiveResponse({
    meetingId: "mtg_w",
    positionId: "pos_1",
    agentId: "agent:be",
    moduleId: "mod-be",
    round: 1,
    position: "support" as any,
    impact: "low",
    risk: "low",
    requiredChanges: [],
    createdAt: Date.now(),
  });
  bus.receiveResponse({
    meetingId: "mtg_w",
    positionId: "pos_2",
    agentId: "agent:fe",
    moduleId: "mod-fe",
    round: 1,
    position: "support" as any,
    impact: "low",
    risk: "low",
    requiredChanges: [],
    createdAt: Date.now(),
  });

  // All expected agents already responded → resolves immediately
  const responses = await bus.waitForResponses("mtg_w", 1, ["agent:be", "agent:fe"]);
  assert.equal(responses.length, 2);
  bus.dispose();
});

test("AgentEventBus: getResponses, getPendingAgents, hasQuorum", async () => {
  const { AgentEventBus } = await import("./agent-event-bus.js");
  const bus = new AgentEventBus({ quorumRatio: 0.5 });

  bus.receiveResponse({
    meetingId: "mtg_q",
    positionId: "pos_q1",
    agentId: "agent:be",
    moduleId: "mod-be",
    round: 2,
    position: "support" as any,
    impact: "low",
    risk: "low",
    requiredChanges: [],
    createdAt: Date.now(),
  });

  const responses = bus.getResponses("mtg_q", 2);
  assert.equal(responses.length, 1);

  const pending = bus.getPendingAgents("mtg_q", 2, ["agent:be", "agent:fe"]);
  assert.deepEqual(pending, ["agent:fe"]);

  // quorum: 1/2 = 0.5 >= 0.5 → true
  assert.equal(bus.hasQuorum("mtg_q", 2, 2), true);
  // quorum: 1/3 ~ 0.33 < 0.5 → false
  assert.equal(bus.hasQuorum("mtg_q", 2, 3), false);

  bus.dispose();
});

test("AgentEventBus: broadcast sends broadcast event", async () => {
  const { AgentEventBus } = await import("./agent-event-bus.js");
  const bus = new AgentEventBus();

  const broadcasts: unknown[] = [];
  bus.on("broadcast", (evt) => broadcasts.push(evt));

  bus.broadcast("mtg_bc", "hello agents", { extra: true });
  assert.equal(broadcasts.length, 1);

  bus.dispose();
});

test("AgentEventBus: cleanup clears meeting resources", async () => {
  const { AgentEventBus } = await import("./agent-event-bus.js");
  const bus = new AgentEventBus();

  bus.receiveResponse({
    meetingId: "mtg_cl",
    positionId: "pos_cl",
    agentId: "agent:be",
    moduleId: "mod-be",
    round: 1,
    position: "support" as any,
    impact: "low",
    risk: "low",
    requiredChanges: [],
    createdAt: Date.now(),
  });

  assert.equal(bus.getResponses("mtg_cl", 1).length, 1);
  bus.cleanup("mtg_cl");
  assert.equal(bus.getResponses("mtg_cl", 1).length, 0);

  bus.dispose();
});

test("AgentEventBus: waitForResponses timeout triggers forfeit events", async () => {
  const { AgentEventBus } = await import("./agent-event-bus.js");
  const bus = new AgentEventBus({ defaultTimeoutMs: 100 });

  const timeoutEvents: unknown[] = [];
  bus.on("agent:timeout", (evt) => timeoutEvents.push(evt));

  // Wait for agent that never responds → timeout after 100ms
  const responses = await bus.waitForResponses("mtg_to", 1, ["agent:slow"], 100);
  assert.equal(responses.length, 0);
  assert.equal(timeoutEvents.length, 1);

  bus.dispose();
});
