import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { closeDb } from "../store/database.js";

const PROJECT_ROOT = process.cwd();

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
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );
    const runId = ingestOutput.match(/^run\s+(\S+)/m)?.[1];
    if (!runId) {
      throw new Error(`failed to parse run id from output:\n${ingestOutput}`);
    }

    const workflowOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "workflow", runId],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );
    const automationOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "automation", runId],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );
    const ingestionOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "ingestion"],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
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
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );
    const listOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "ingestion"],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );

    const sourceId = listOutput.trim().split(/\s+/)[0];
    const detailOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "ingestion", sourceId],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
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
      { cwd: PROJECT_ROOT, encoding: "utf8" },
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
        env: { ...process.env, ATHENA_HOME: home },
      },
    );

    const automationOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/bootstrap.ts", "--home", home, "research", "automation", runId],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
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
