import { getDb } from "../store/database.js";
import type { MemoryStore } from "./memory-store.js";
import type {
  GraphEdgeRecord,
  GraphNodeRecord,
  KnowledgeSubgraph,
  ResearchCandidatePack,
} from "../research/contracts.js";
import {
  buildCanonicalClaimPath,
  buildSourceClaimPath,
  CLAIM_GRAPH_RELATIONSHIPS,
} from "../research/claim-graph.js";
import { buildCanonicalClaims } from "../research/ingestion.js";

type EdgeDirection = "outgoing" | "incoming" | "both";

interface MemoryEdgeRow {
  source_path: string;
  target_path: string;
  relationship: string;
  weight: number;
  metadata: string | null;
}

export class GraphMemory {
  constructor(private memory: MemoryStore) {}

  private get sessionId(): string {
    return this.memory.getSessionId();
  }

  upsertNode(node: GraphNodeRecord): void {
    const content = node.content ?? JSON.stringify(node.metadata ?? {}, null, 2);
    this.memory.write(node.id, node.gist ?? node.label, content);
  }

  link(edge: GraphEdgeRecord): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO memory_edges (
         session_id, source_path, target_path, relationship, weight, metadata, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, source_path, target_path, relationship) DO UPDATE SET
         weight = excluded.weight,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
    ).run(
      this.sessionId,
      edge.sourceId,
      edge.targetId,
      edge.relationship,
      edge.weight ?? 1,
      edge.metadata ? JSON.stringify(edge.metadata) : null,
      now,
      now,
    );
  }

  listEdges(nodeId: string, direction: EdgeDirection = "both"): GraphEdgeRecord[] {
    const db = getDb();
    let rows: MemoryEdgeRow[] = [];

    if (direction === "outgoing" || direction === "both") {
      rows = rows.concat(
        db
          .prepare(
            `SELECT source_path, target_path, relationship, weight, metadata
             FROM memory_edges
             WHERE session_id = ? AND source_path = ?`,
          )
          .all(this.sessionId, nodeId) as MemoryEdgeRow[],
      );
    }

    if (direction === "incoming" || direction === "both") {
      rows = rows.concat(
        db
          .prepare(
            `SELECT source_path, target_path, relationship, weight, metadata
             FROM memory_edges
             WHERE session_id = ? AND target_path = ?`,
          )
          .all(this.sessionId, nodeId) as MemoryEdgeRow[],
      );
    }

    return rows.map((row) => ({
      sourceId: row.source_path,
      targetId: row.target_path,
      relationship: row.relationship,
      weight: row.weight,
      metadata: row.metadata ? safeParse(row.metadata) : undefined,
    }));
  }

  buildSubgraph(rootIds: string[], depth = 1, maxNodes = 25): KnowledgeSubgraph {
    const queue = [...rootIds];
    const distances = new Map<string, number>(rootIds.map((id) => [id, 0]));
    const nodes = new Map<string, GraphNodeRecord>();
    const edges = new Map<string, GraphEdgeRecord>();

    while (queue.length > 0 && nodes.size < maxNodes) {
      const current = queue.shift()!;
      const distance = distances.get(current) ?? 0;
      const node = this.memory.read(current);
      if (node) {
        nodes.set(current, {
          id: node.path,
          label: node.gist,
          gist: node.gist,
          content: node.content ?? undefined,
          kind: inferNodeKind(node.path),
        });
      }

      if (distance >= depth) continue;

      for (const edge of this.listEdges(current, "both")) {
        edges.set(edgeKey(edge), edge);
        const neighbor = edge.sourceId === current ? edge.targetId : edge.sourceId;
        if (!distances.has(neighbor) && nodes.size + queue.length < maxNodes) {
          distances.set(neighbor, distance + 1);
          queue.push(neighbor);
        }
      }
    }

    return {
      rootIds,
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
    };
  }

  buildRankedSubgraph(
    rootIds: string[],
    options: { query?: string; depth?: number; maxNodes?: number } = {},
  ): KnowledgeSubgraph {
    const subgraph = this.buildSubgraph(rootIds, options.depth ?? 1, Math.max((options.maxNodes ?? 25) * 2, 25));
    const queryTerms = (options.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const rankedNodes = [...subgraph.nodes]
      .sort((left, right) => this.scoreNode(right, queryTerms) - this.scoreNode(left, queryTerms))
      .slice(0, options.maxNodes ?? 25);
    const allowed = new Set(rankedNodes.map((node) => node.id));
    return {
      rootIds,
      nodes: rankedNodes,
      edges: subgraph.edges.filter((edge) => allowed.has(edge.sourceId) && allowed.has(edge.targetId)),
    };
  }

  formatSubgraph(rootIds: string[], depth = 1, maxNodes = 12): string {
    const subgraph = this.buildSubgraph(rootIds, depth, maxNodes);
    if (subgraph.nodes.length === 0) return "(empty graph context)";

    const nodeLines = subgraph.nodes.map((node) => {
      const content = node.content
        ? node.content.replace(/\s+/g, " ").slice(0, 140)
        : "";
      return `- ${node.id} [${node.kind}] ${node.gist ?? node.label}${content ? ` :: ${content}` : ""}`;
    });

    const edgeLines = subgraph.edges.map(
      (edge) => `- ${edge.sourceId} --${edge.relationship}--> ${edge.targetId}`,
    );

    return [
      "Nodes:",
      ...nodeLines,
      edgeLines.length > 0 ? "Edges:" : null,
      ...edgeLines,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private scoreNode(node: GraphNodeRecord, queryTerms: string[]): number {
    const record = this.memory.read(node.id);
    const haystack = `${node.label} ${node.gist ?? ""} ${node.content ?? ""}`.toLowerCase();
    const queryScore = queryTerms.reduce(
      (score, term) => score + (haystack.includes(term) ? 0.25 : 0),
      0,
    );
    const sameReasonBoost = queryTerms.some(
      (term) => haystack.includes(`supports:${term}`) || haystack.includes(`contradicted_by:${term}`),
    )
      ? 0.15
      : 0;
    const recencyScore = record ? Math.min(1, (record.updatedAt / Date.now())) * 0.2 : 0;
    const kindScore = node.kind === "decision" ? 0.18 : node.kind === "proposal" ? 0.14 : node.kind === "result" ? 0.12 : 0.05;
    return queryScore + sameReasonBoost + recencyScore + kindScore;
  }

  ingestCandidatePack(pack: ResearchCandidatePack): KnowledgeSubgraph {
    const packPath = `/research/candidates/${pack.candidateId}`;
    this.memory.write(packPath, pack.problemArea, JSON.stringify(pack, null, 2));

    const rootIds = [packPath];
    const canonicalClaims = pack.canonicalClaims ?? buildCanonicalClaims(pack.claims);

    for (const canonicalClaim of canonicalClaims) {
      const canonicalPath = buildCanonicalClaimPath(canonicalClaim.canonicalClaimId);
      this.memory.write(canonicalPath, canonicalClaim.statement, JSON.stringify(canonicalClaim, null, 2));
      this.link({
        sourceId: packPath,
        targetId: canonicalPath,
        relationship: CLAIM_GRAPH_RELATIONSHIPS.citesClaim,
      });
      rootIds.push(canonicalPath);
    }

    for (const claim of pack.claims) {
      const claimPath = buildSourceClaimPath(pack.candidateId, claim.sourceClaimId ?? claim.claimId);
      this.memory.write(claimPath, claim.statement, JSON.stringify(claim, null, 2));
      this.link({
        sourceId: packPath,
        targetId: claimPath,
        relationship: CLAIM_GRAPH_RELATIONSHIPS.containsClaim,
      });
      if (claim.canonicalClaimId) {
        this.link({
          sourceId: claimPath,
          targetId: buildCanonicalClaimPath(claim.canonicalClaimId),
          relationship: CLAIM_GRAPH_RELATIONSHIPS.canonicalizedAs,
          metadata: {
            semanticKey: claim.semanticKey,
            normalizedStatement: claim.normalizedStatement,
          },
        });
      }
      for (const evidenceId of claim.evidenceIds ?? []) {
        const evidencePath = `${packPath}/evidence/${evidenceId}`;
        this.memory.write(evidencePath, evidenceId, JSON.stringify({ evidenceId, claimId: claim.claimId }, null, 2));
        this.link({
          sourceId: claim.canonicalClaimId ? buildCanonicalClaimPath(claim.canonicalClaimId) : claimPath,
          targetId: evidencePath,
          relationship: CLAIM_GRAPH_RELATIONSHIPS.supportedBy,
          metadata: {
            sourceClaimId: claim.sourceClaimId ?? claim.claimId,
          },
        });
      }
      rootIds.push(claimPath);
    }

    for (const [index, method] of (pack.normalizedMethods ?? pack.methods).entries()) {
      const methodPath = `${packPath}/methods/method-${index + 1}`;
      this.memory.write(methodPath, method, method);
      this.link({
        sourceId: packPath,
        targetId: methodPath,
        relationship: CLAIM_GRAPH_RELATIONSHIPS.proposesMethod,
      });
    }

    for (const [index, contradiction] of (pack.contradictions ?? pack.counterEvidence).entries()) {
      const contradictionPath = `${packPath}/counter-evidence/item-${index + 1}`;
      this.memory.write(contradictionPath, contradiction, contradiction);
      this.link({
        sourceId: packPath,
        targetId: contradictionPath,
        relationship: CLAIM_GRAPH_RELATIONSHIPS.hasCounterEvidence,
      });
    }

    return this.buildSubgraph(rootIds, 1, 50);
  }

  listNodesByKind(kind: GraphNodeRecord["kind"]): GraphNodeRecord[] {
    return this.memory
      .tree("/research")
      .filter((node) => !node.isDir && inferNodeKind(node.path) === kind)
      .map((node) => ({
        id: node.path,
        label: node.gist,
        gist: node.gist,
        kind,
      }));
  }
}

function safeParse(value: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function edgeKey(edge: GraphEdgeRecord): string {
  return `${edge.sourceId}::${edge.relationship}::${edge.targetId}`;
}

function inferNodeKind(path: string): GraphNodeRecord["kind"] {
  if (path.startsWith("/research/claims/")) return "claim";
  if (path.includes("/candidates/") && path.includes("/claims/")) return "source_claim";
  if (path.includes("/claims/")) return "claim";
  if (path.includes("/methods/")) return "method";
  if (path.includes("/proposal")) return "proposal";
  if (path.includes("/experiments/")) return "experiment";
  if (path.includes("/results/")) return "result";
  if (path.includes("/candidates/")) return "document";
  return "note";
}
