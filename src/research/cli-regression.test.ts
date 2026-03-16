import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { closeDb } from "../store/database.js";

const PROJECT_ROOT = process.cwd();
const CLI_ENV = { ...process.env, ANTHROPIC_API_KEY: "test-key" };

test("research CLI renders workflow and automation operator views from persisted state", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-cli-regression-"));
  process.env.ATHENA_HOME = home;

  try {
    const docPath = join(home, "workflow-source.txt");
    writeFileSync(
      docPath,
      "Measured benchmark evidence shows batching writes improved runtime by 14%. However, rollback safety did not improve in the first revision.",
      "utf8",
    );

    const ingestOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "ingest", docPath, "--type", "document", "--problem-area", "runtime optimization"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );
    const runId = ingestOutput.match(/^run\s+(\S+)/m)?.[1];
    if (!runId) {
      throw new Error(`failed to parse run id from output:\n${ingestOutput}`);
    }

    const workflowOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "workflow", runId],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );
    const automationOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "automation", runId],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );
    const ingestionOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "ingestion"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );

    assert.match(workflowOutput, /transition\s+draft -> ready reason=goal accepted for research planning/);
    assert.match(workflowOutput, /transition\s+ready -> running reason=collection workflow started/);
    assert.doesNotMatch(workflowOutput, /ready -> approved/);
    assert.match(automationOutput, /mode=manual/);
    assert.match(automationOutput, /retry\s+count=0\/2/);
    assert.match(ingestionOutput, /claims=\d+/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("research CLI ingests a document and exposes extracted claim details", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-cli-ingest-"));
  process.env.ATHENA_HOME = home;

  try {
    const docPath = join(home, "ingest.txt");
    writeFileSync(
      docPath,
      "Measured benchmark evidence shows batching writes improved runtime by 14%. However, the rollback path did not improve in the first revision.",
      "utf8",
    );

    const ingestOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "ingest", docPath, "--type", "document", "--problem-area", "runtime optimization"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );
    const listOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "ingestion"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );

    const sourceId = listOutput.trim().split(/\s+/)[0];
    const detailOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "ingestion", sourceId],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );

    assert.match(ingestOutput, /claims\s+extracted=/);
    assert.match(listOutput, /claims=\d+/);
    assert.match(detailOutput, /citation\s+sentence:/);
    assert.match(detailOutput, /claim\s+(support|mixed|contradiction)/);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("research CLI renders autonomy policy details for fully autonomous runs", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-cli-autonomy-"));
  process.env.ATHENA_HOME = home;

  try {
    const docPath = join(home, "autonomy-source.txt");
    writeFileSync(
      docPath,
      "Measured benchmark evidence shows batching writes improved runtime by 14%.",
      "utf8",
    );

    const ingestOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "ingest", docPath, "--type", "document", "--problem-area", "runtime optimization"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );
    const runId = ingestOutput.match(/^run\s+(\S+)/m)?.[1];
    if (!runId) {
      throw new Error(`failed to parse run id from output:\n${ingestOutput}`);
    }

    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--import",
        "tsx",
        "-e",
        `
          const { TeamStore } = await import("./src/research/team-store.ts");
          const { closeDb } = await import("./src/store/database.ts");
          const teamStore = new TeamStore();
          const run = teamStore.getTeamRun(${JSON.stringify(runId)});
          if (!run) throw new Error("failed to load seeded run");
          teamStore.configureAutomation(run.id, {
            automationPolicy: {
              ...run.automationPolicy,
              mode: "fully-autonomous",
              requireProposalApproval: false,
              requireExperimentApproval: false,
              requireRevisitApproval: false,
              autonomyPolicy: {
                maxRiskTier: "safe",
                maxRetryCount: 1,
                maxWallClockMinutes: 45,
                maxCostUsd: 8,
                requireEvidenceFloor: 0.7,
                requireRollbackPlan: true,
                allowedMachineIds: ["local"],
              },
            },
          });
          closeDb();
        `,
      ],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        env: { ...CLI_ENV, ATHENA_HOME: home },
      },
    );

    const automationOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "automation", runId],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );

    assert.match(automationOutput, /mode=fully-autonomous/);
    assert.match(automationOutput, /autonomy\s+risk=safe/);
    assert.match(automationOutput, /retry_cap=1/);
    assert.match(automationOutput, /machines=local/);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("research CLI exposes queue, incident, and journal operator views", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-cli-operator-views-"));
  process.env.ATHENA_HOME = home;

  try {
    const seedOutput = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--import",
        "tsx",
        "-e",
        `
          const { SessionStore } = await import("./src/store/session-store.ts");
          const { TeamStore } = await import("./src/research/team-store.ts");
          const { closeDb } = await import("./src/store/database.ts");
          const sessionStore = new SessionStore();
          const session = sessionStore.createSession("openai", "gpt-5.4");
          const teamStore = new TeamStore();
          const run = teamStore.createTeamRun(session.id, "Operator queue test");
          teamStore.saveProposalBrief(session.id, {
            proposalId: "proposal-queue",
            title: "Needs approval",
            summary: "Queue this proposal",
            targetModules: ["trainer"],
            expectedGain: "moderate",
            expectedRisk: "low",
            codeChangeScope: ["config"],
            status: "candidate",
            experimentBudget: { maxWallClockMinutes: 5 },
            stopConditions: [],
            reconsiderConditions: [],
            claimIds: [],
          });
          teamStore.saveActionJournal({
            actionId: "action-queue",
            sessionId: session.id,
            runId: run.id,
            actionType: "session_tick",
            state: "running",
            dedupeKey: "tick:run",
            summary: "Tick running",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          teamStore.saveIncident({
            incidentId: "incident-queue",
            sessionId: session.id,
            runId: run.id,
            type: "automation_block",
            severity: "warning",
            summary: "Automation blocked",
            status: "open",
            actionRequired: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          console.log(run.id);
          closeDb();
        `,
      ],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        env: { ...CLI_ENV, ATHENA_HOME: home },
      },
    );
    const runId = seedOutput.trim();

    const queueOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "queue"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );
    const incidentsOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "incidents"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );
    const journalOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "journal", runId],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );

    assert.match(queueOutput, /approval_needed/);
    assert.match(incidentsOutput, /automation_block/);
    assert.match(journalOutput, /session_tick/);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("research CLI operate is session scoped and clears operator backlog on resume", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-cli-operate-"));
  process.env.ATHENA_HOME = home;

  try {
    const seedOutput = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--import",
        "tsx",
        "-e",
        `
          const { SessionStore } = await import("./src/store/session-store.ts");
          const { TeamStore } = await import("./src/research/team-store.ts");
          const { closeDb } = await import("./src/store/database.ts");
          const sessionStore = new SessionStore();
          const session = sessionStore.createSession("openai", "gpt-5.4");
          const teamStore = new TeamStore();
          const run = teamStore.createTeamRun(session.id, "Operator operate test");
          teamStore.noteAutomationBlock(run.id, "resume", "manual recovery required");
          console.log(JSON.stringify({ sessionId: session.id, runId: run.id }));
          closeDb();
        `,
      ],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        env: { ...CLI_ENV, ATHENA_HOME: home },
      },
    );
    const { sessionId, runId } = JSON.parse(seedOutput.trim()) as { sessionId: string; runId: string };

    const resumeOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "operate", runId, "--action", "resume"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home, ATHENA_SESSION_ID: sessionId } },
    );
    const queueOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "queue"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home, ATHENA_SESSION_ID: sessionId } },
    );
    const incidentsOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "incidents"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home, ATHENA_SESSION_ID: sessionId } },
    );

    assert.match(resumeOutput, /resumed automation/);
    assert.doesNotMatch(queueOutput, /blocked:/);
    assert.doesNotMatch(incidentsOutput, /status=open/);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});

test("research CLI exposes eval fixtures, soak artifacts, and supervised checklist views", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-cli-verification-"));
  process.env.ATHENA_HOME = home;

  try {
    const evalsOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "evals"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );
    const soakOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "soak"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );
    const checklistOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "checklist"],
      { cwd: PROJECT_ROOT, encoding: "utf8", env: { ...CLI_ENV, ATHENA_HOME: home } },
    );

    assert.match(evalsOutput, /operator_intervention/);
    assert.match(evalsOutput, /proposal-evidence-floor/);
    assert.match(soakOutput, /artifact\s+/);
    // Soak output now shows synthetic_only (smoke-only is synthetic, not a real soak)
    assert.match(soakOutput, /overall=synthetic_only/);
    assert.match(checklistOutput, /Athena Supervised Production Checklist/);
    assert.match(checklistOutput, /overall=synthetic_only/);
    assert.match(checklistOutput, /single_remote: status=blocked/);
  } finally {
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
