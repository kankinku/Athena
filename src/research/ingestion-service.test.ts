import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";

import { TeamStore } from "./team-store.js";
import { TeamOrchestrator } from "./team-orchestrator.js";
import { MemoryStore } from "../memory/memory-store.js";
import { GraphMemory } from "../memory/graph-memory.js";
import { IngestionService } from "./ingestion-service.js";
import { SessionStore } from "../store/session-store.js";
import { closeDb } from "../store/database.js";

test("ingestion service extracts claims from text, document, and url inputs", async () => {
  const home = mkdtempSync(join(tmpdir(), "athena-ingestion-service-"));
  process.env.ATHENA_HOME = home;

  const docPath = join(home, "source.md");
  writeFileSync(
    docPath,
    "# Findings\n\nGradient checkpointing reduced peak memory by 28% in repeated experiments. However, small-model throughput became slower during the same benchmark.",
    "utf8",
  );

  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><head><title>Latency Note</title></head><body><article><p>Measured telemetry shows runtime improved by 12% after batching writes.</p><p>However, the first revision did not improve rollback safety.</p></article></body></html>");
  });

  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("failed to start test server");
    const url = `http://127.0.0.1:${address.port}/note`;

    const sessionStore = new SessionStore();
    const session = sessionStore.createSession("openai", "gpt-5.4");
    const teamStore = new TeamStore();
    const memoryStore = new MemoryStore(session.id);
    const graphMemory = new GraphMemory(memoryStore);
    const orchestrator = new TeamOrchestrator(teamStore, graphMemory, () => session.id);
    const service = new IngestionService(teamStore, orchestrator);

    const textResult = await service.ingest({
      inputType: "text",
      value: "Benchmark data shows memory usage dropped by 18% after checkpointing. However, the same trial was not reproducible on the smallest GPU.",
      sessionId: session.id,
      problemArea: "training stability",
      title: "Inline note",
    });
    const docResult = await service.ingest({
      inputType: "document",
      value: docPath,
      sessionId: session.id,
      problemArea: "training stability",
    });
    const urlResult = await service.ingest({
      inputType: "url",
      value: url,
      sessionId: session.id,
      problemArea: "runtime optimization",
    });

    assert.ok(textResult.pack.claims.length > 0);
    assert.ok(textResult.pack.claims.some((claim) => claim.citationSpans?.length));
    assert.ok(textResult.pack.claims.some((claim) => claim.disposition === "contradiction" || claim.disposition === "mixed"));
    assert.equal(docResult.source.status, "ingested");
    assert.ok(docResult.pack.claims.length > 0);
    assert.match(urlResult.source.title, /Latency Note/);
    assert.ok(urlResult.pack.canonicalClaims && urlResult.pack.canonicalClaims.length > 0);

    const sources = teamStore.listIngestionSources(session.id);
    assert.equal(sources.length, 3);
    assert.ok(sources.every((source) => source.extractedClaims && source.extractedClaims.length > 0));
    assert.ok(sources.some((source) => source.canonicalClaims?.some((claim) => (claim.sourceAttributions?.length ?? 0) > 0)));
  } finally {
    server.close();
    closeDb();
    rmSync(home, { recursive: true, force: true });
    delete process.env.ATHENA_HOME;
  }
});
