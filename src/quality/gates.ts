import { createHash } from "node:crypto";

import type {
  BriefClaim,
  CodebaseBrief,
  EvidenceRecord,
  GateResult,
  QualityReceipt,
  SnapshotSummary,
} from "../analysis/domain.js";
import type { ReportBundle as AnalysisBundle } from "../analysis/pipeline.js";
import { buildMermaid } from "../artifacts/mermaid.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import { evaluateClaimSemantics } from "./claim-semantics.js";

type BriefGateBundle = Pick<AnalysisBundle, "brief" | "evidence">;

const KNOWN_TECHNICAL_ENTITIES = [
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "Redis",
  "SQLite",
  "React",
  "Vue",
  "Angular",
  "Next.js",
  "Express",
  "Fastify",
  "NestJS",
  "Prisma",
  "Drizzle",
  "Supabase",
  "Firebase",
  "Docker",
  "Kubernetes",
  "Kafka",
  "RabbitMQ",
  "GraphQL",
  "gRPC",
  "AWS",
  "Azure",
  "GCP",
] as const;

function gate(id: string, passed: boolean, details: string): GateResult {
  return { id, critical: true, passed, details };
}

function schemaValidity(bundle: AnalysisBundle, schemas: SchemaRegistry): GateResult {
  const errors: string[] = [];
  const brief = schemas.validate("CodebaseBrief", bundle.brief);
  if (!brief.valid) errors.push(...brief.errors.map((error) => `brief: ${error}`));
  for (const record of bundle.evidence) {
    const result = schemas.validate("EvidenceRecord", record);
    if (!result.valid) {
      errors.push(...result.errors.map((error) => `${record.id}: ${error}`));
    }
  }
  for (const angle of bundle.angles) {
    const result = schemas.validate("ContentAngle", angle);
    if (!result.valid) {
      errors.push(...result.errors.map((error) => `${angle.id}: ${error}`));
    }
  }
  const embeddedIds = bundle.brief.evidence.map((record) => record.id).sort();
  const standaloneIds = bundle.evidence.map((record) => record.id).sort();
  if (JSON.stringify(embeddedIds) !== JSON.stringify(standaloneIds)) {
    errors.push("brief.evidence and evidence artifact contain different IDs");
  }
  return gate(
    "schema_validity",
    errors.length === 0,
    errors.length === 0 ? "All core objects match their versioned schemas." : errors.join("; "),
  );
}

function jsonPointer(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) return undefined;
  let current: unknown = root;
  for (const rawPart of pointer.slice(1).split("/")) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evidencePathErrors(
  evidence: readonly EvidenceRecord[],
  snapshot: SnapshotSummary,
): string[] {
  const errors: string[] = [];
  const treePaths = new Set(snapshot.tree_paths);
  const files = new Map(snapshot.files.map((file) => [file.path, file]));
  const symbols = new Set(
    snapshot.symbols.map(
      (symbol) => `${symbol.path}:${symbol.name}:${symbol.line_start}:${symbol.line_end}`,
    ),
  );
  const symbolNames = new Set(
    snapshot.symbols.map((symbol) => `${symbol.path}:${symbol.name}`),
  );

  for (const record of evidence) {
    if (record.verification_status !== "verified" && record.verification_status !== "documentation") {
      continue;
    }
    const locator = record.locator;
    if (record.repository?.url !== snapshot.repository_url) {
      errors.push(`${record.id} has a different repository URL`);
    }
    if (record.repository?.commit_sha !== snapshot.commit_sha) {
      errors.push(`${record.id} has a different commit SHA`);
    }
    if (locator === undefined || !treePaths.has(locator.source_path)) {
      errors.push(`${record.id} points to a missing path`);
      continue;
    }
    if (
      locator.blob_sha !== undefined &&
      snapshot.tree_blobs[locator.source_path] !== locator.blob_sha
    ) {
      errors.push(`${record.id} has the wrong blob SHA`);
    }

    const file = files.get(locator.source_path);
    if (locator.line_start !== undefined || locator.line_end !== undefined) {
      if (
        file === undefined ||
        locator.line_start === undefined ||
        locator.line_end === undefined ||
        locator.line_start < 1 ||
        locator.line_end < locator.line_start
      ) {
        errors.push(`${record.id} has an unverifiable line range`);
      } else {
        const lines = file.text.split(/\r?\n/);
        const excerpt = lines
          .slice(locator.line_start - 1, locator.line_end)
          .join("\n")
          .slice(0, 1200);
        if (locator.line_end > lines.length || locator.excerpt !== excerpt) {
          errors.push(`${record.id} excerpt does not match its line range`);
        }
      }
    }
    if (locator.symbol !== undefined) {
      const key = `${locator.source_path}:${locator.symbol.name}:${locator.line_start}:${locator.line_end}`;
      const symbolFound =
        record.evidence_type === "symbol_declaration"
          ? symbols.has(key)
          : symbolNames.has(`${locator.source_path}:${locator.symbol.name}`);
      if (!symbolFound) {
        errors.push(`${record.id} symbol declaration was not found by the AST extractor`);
      }
    }
    if (locator.field_pointer !== undefined) {
      let pointerRoot: unknown = snapshot.manifest;
      if (record.evidence_type === "config_field") {
        try {
          pointerRoot = file === undefined ? undefined : JSON.parse(file.text);
        } catch {
          pointerRoot = undefined;
        }
      }
      const value = jsonPointer(pointerRoot, locator.field_pointer);
      if (value === undefined || locator.excerpt !== JSON.stringify(value)) {
        errors.push(`${record.id} field pointer does not match its excerpt`);
      }
    }
    if (locator.excerpt !== undefined && locator.excerpt_sha256 !== undefined) {
      const hash = createHash("sha256").update(locator.excerpt, "utf8").digest("hex");
      if (hash !== locator.excerpt_sha256) {
        errors.push(`${record.id} excerpt hash does not match`);
      }
    }
  }
  return errors;
}

function verifiedClaimErrors(bundle: BriefGateBundle): string[] {
  const errors: string[] = [];
  const evidenceById = new Map(bundle.evidence.map((record) => [record.id, record]));
  for (const claim of bundle.brief.claims) {
    for (const evidenceId of claim.evidence_ids) {
      const record = evidenceById.get(evidenceId);
      if (record === undefined) {
        errors.push(`${claim.id} references missing evidence ${evidenceId}`);
      } else if (record.claim_id !== claim.id || record.claim !== claim.statement) {
        errors.push(`${evidenceId} does not prove the claim it is attached to`);
      }
    }
    if (claim.status === "verified") {
      const verified = claim.evidence_ids.some(
        (id) => evidenceById.get(id)?.verification_status === "verified",
      );
      if (!verified) {
        errors.push(`${claim.id} is verified without verified evidence`);
      }
    }
  }
  return errors;
}

function claimSemanticErrors(bundle: BriefGateBundle): string[] {
  const errors: string[] = [];
  const evidenceById = new Map(bundle.evidence.map((record) => [record.id, record]));
  for (const claim of bundle.brief.claims.filter((candidate) => candidate.status === "verified")) {
    const assessment = evaluateClaimSemantics(
      { statement: claim.statement, requestedStatus: claim.status },
      claim.evidence_ids
        .map((id) => evidenceById.get(id))
        .filter((record): record is EvidenceRecord => record !== undefined),
    );
    if (!assessment.verifiedAllowed) {
      errors.push(
        `${claim.id} ${assessment.semanticStatus}: ${assessment.reason}${
          assessment.narrowedStatement === undefined
            ? ""
            : ` Suggested narrow claim: ${assessment.narrowedStatement}`
        }`,
      );
    }
  }
  return errors;
}

function relationshipErrors(bundle: AnalysisBundle): string[] {
  const errors: string[] = [];
  const moduleIds = new Set(bundle.brief.core_modules.map((module) => module.id));
  const evidenceIds = new Set(bundle.evidence.map((record) => record.id));
  for (const relationship of bundle.brief.relationships) {
    if (!moduleIds.has(relationship.from_module_id) || !moduleIds.has(relationship.to_module_id)) {
      errors.push(`${relationship.id} references an unknown module`);
    }
    if (relationship.evidence_ids.some((id) => !evidenceIds.has(id))) {
      errors.push(`${relationship.id} references missing evidence`);
    }
  }
  return errors;
}

function angleErrors(bundle: AnalysisBundle): string[] {
  const errors: string[] = [];
  const claims = new Map(bundle.brief.claims.map((claim) => [claim.id, claim]));
  const evidenceIds = new Set(bundle.evidence.map((record) => record.id));
  for (const angle of bundle.angles) {
    const angleClaims = angle.claim_ids
      .map((id) => claims.get(id))
      .filter((claim): claim is BriefClaim => claim !== undefined);
    if (angleClaims.length !== angle.claim_ids.length) {
      errors.push(`${angle.id} references missing claims`);
    }
    const supportedEvidence = new Set(angleClaims.flatMap((claim) => claim.evidence_ids));
    if (
      angle.evidence_ids.some(
        (id) => !evidenceIds.has(id) || !supportedEvidence.has(id),
      )
    ) {
      errors.push(`${angle.id} contains missing or unrelated evidence`);
    }
    if (
      angle.script_safe_claim_ids.some(
        (id) =>
          !angle.claim_ids.includes(id) ||
          !["verified", "documentation"].includes(claims.get(id)?.status ?? "unknown"),
      )
    ) {
      errors.push(`${angle.id} marks an unsafe claim as script-safe`);
    }
  }
  return errors;
}

function confidenceErrors(bundle: AnalysisBundle): string[] {
  const errors: string[] = [];
  const claims = new Map(bundle.brief.claims.map((claim) => [claim.id, claim]));
  for (const angle of bundle.angles) {
    const sourceConfidence = angle.claim_ids
      .map((id) => claims.get(id)?.confidence)
      .filter((value): value is number => value !== undefined);
    if (
      sourceConfidence.length > 0 &&
      angle.confidence > Math.min(...sourceConfidence) + Number.EPSILON
    ) {
      errors.push(`${angle.id} is more confident than its least-confident source claim`);
    }
  }
  return errors;
}

function mermaidGate(bundle: AnalysisBundle): GateResult {
  try {
    const expected = buildMermaid(bundle.brief);
    return gate(
      "mermaid_grounding",
      bundle.mermaid === expected,
      bundle.mermaid === expected
        ? "Mermaid is a deterministic compilation of known modules and relationships."
        : "Mermaid differs from the validated relationship graph.",
    );
  } catch (error) {
    return gate(
      "mermaid_grounding",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function scriptErrors(bundle: AnalysisBundle): string[] {
  const errors: string[] = [];
  if (bundle.script === null) return errors;
  const claims = new Map(bundle.brief.claims.map((claim) => [claim.id, claim]));
  const evidenceIds = new Set(bundle.evidence.map((record) => record.id));
  const scriptSafeIds = new Set(
    bundle.angles.length > 0
      ? bundle.angles.flatMap((angle) => angle.script_safe_claim_ids)
      : bundle.brief.claims
          .filter((claim) => claim.status === "verified" || claim.status === "documentation")
          .map((claim) => claim.id),
  );
  const allowedEntities = new Set(
    [
      bundle.brief.overview.project_name,
      ...bundle.brief.technologies.map((technology) => technology.name),
      ...bundle.brief.core_modules.map((module) => module.name),
    ].map((entity) => entity.toLowerCase()),
  );

  if (bundle.script.text !== bundle.script.segments.map((segment) => segment.text).join("\n")) {
    errors.push("Script text differs from its grounded segments");
  }
  if (bundle.script.estimated_seconds < 60 || bundle.script.estimated_seconds > 90) {
    errors.push("Script duration is outside 60–90 seconds");
  }
  for (const segment of bundle.script.segments) {
    if (segment.kind === "claim" && segment.claim_ids.length === 0) {
      errors.push(`${segment.id} is a claim segment without claim IDs`);
    }
    if (segment.claim_ids.some((id) => !scriptSafeIds.has(id) || !claims.has(id))) {
      errors.push(`${segment.id} references a claim that is not script-safe`);
    }
    const supportedEvidence = new Set(
      segment.claim_ids.flatMap((id) => claims.get(id)?.evidence_ids ?? []),
    );
    if (
      segment.evidence_ids.some(
        (id) => !evidenceIds.has(id) || !supportedEvidence.has(id),
      )
    ) {
      errors.push(`${segment.id} references missing or unrelated evidence`);
    }
    if (
      segment.asserted_entities.some(
        (entity) => !allowedEntities.has(entity.toLowerCase()),
      )
    ) {
      errors.push(`${segment.id} asserts an entity absent from the brief`);
    }
    if (segment.kind === "claim") {
      const sourceStatements = segment.claim_ids.map((id) => claims.get(id)?.statement ?? "");
      if (!sourceStatements.includes(segment.text)) {
        errors.push(`${segment.id} claim text is not identical to a referenced claim`);
      }
    }
  }

  for (const entity of KNOWN_TECHNICAL_ENTITIES) {
    const pattern = new RegExp(`\\b${entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(bundle.script.text) && !allowedEntities.has(entity.toLowerCase())) {
      errors.push(`Script introduces ungrounded technical entity ${entity}`);
    }
  }
  return errors;
}

function instructionIsolationGate(bundle: AnalysisBundle, approvedModelHost?: string): GateResult {
  const allowedHosts = new Set([
    "api.github.com",
    "github.com",
    "codeload.github.com",
    "raw.githubusercontent.com",
    "127.0.0.1:11434",
    "localhost:11434",
    "[::1]:11434",
    "api.deepseek.com",
    "api.openai.com",
    "open.bigmodel.cn",
    "dashscope.aliyuncs.com",
    "dashscope-intl.aliyuncs.com",
  ]);
  if (approvedModelHost !== undefined) allowedHosts.add(approvedModelHost);
  const invalidHosts = bundle.security.network_hosts.filter((host) => !allowedHosts.has(host));
  const providersMatch = bundle.provider_invocations.every(
    (invocation) => invocation.provider === bundle.security.provider_id,
  );
  const passed =
    bundle.security.repository_content_role === "untrusted_data" &&
    bundle.security.repository_code_executions === 0 &&
    invalidHosts.length === 0 &&
    providersMatch;
  return gate(
    "instruction_isolation",
    passed,
    passed
      ? "Repository content stayed data; no repository code ran and no host/provider changed."
      : `Instruction isolation invariant failed${
          invalidHosts.length > 0 ? `; unexpected hosts: ${invalidHosts.join(", ")}` : ""
        }`,
  );
}

function outputBindingGate(bundle: AnalysisBundle, snapshot: SnapshotSummary): GateResult {
  const commit = snapshot.commit_sha;
  const passed =
    bundle.brief.repository.commit_sha === commit &&
    bundle.evidence.every((record) =>
      record.repository === undefined ? true : record.repository.commit_sha === commit,
    ) &&
    bundle.angles.every((angle) => angle.repository_commit_sha === commit) &&
    (bundle.script === null || bundle.script.repository_commit_sha === commit);
  return gate(
    "output_binding",
    passed,
    passed ? "All artifacts bind to one immutable commit SHA." : "Artifact commit SHAs drifted.",
  );
}

export function evaluateQualityGate(
  bundle: AnalysisBundle,
  snapshot: SnapshotSummary,
  schemas: SchemaRegistry,
  approvedModelHost?: string,
): QualityReceipt {
  const pathErrors = evidencePathErrors(bundle.evidence, snapshot);
  const claimErrors = verifiedClaimErrors(bundle);
  const semanticErrors = claimSemanticErrors(bundle);
  const relationErrors = relationshipErrors(bundle);
  const references = angleErrors(bundle);
  const escalations = confidenceErrors(bundle);
  const scripts = scriptErrors(bundle);
  const gates: GateResult[] = [
    schemaValidity(bundle, schemas),
    gate(
      "evidence_paths",
      pathErrors.length === 0,
      pathErrors.length === 0 ? "Evidence locators match the fixed snapshot." : pathErrors.join("; "),
    ),
    gate(
      "verified_claims",
      claimErrors.length === 0,
      claimErrors.length === 0 ? "Every verified claim has verified evidence." : claimErrors.join("; "),
    ),
    gate(
      "claim_semantics",
      semanticErrors.length === 0,
      semanticErrors.length === 0
        ? "Every verified claim is within the scope and strength entailed by its evidence."
        : semanticErrors.join("; "),
    ),
    gate(
      "relationship_nodes",
      relationErrors.length === 0,
      relationErrors.length === 0 ? "Every relationship references known modules." : relationErrors.join("; "),
    ),
    gate(
      "angle_references",
      references.length === 0,
      references.length === 0 ? "Every angle reference is grounded." : references.join("; "),
    ),
    gate(
      "confidence_escalation",
      escalations.length === 0,
      escalations.length === 0 ? "No downstream object raises source confidence." : escalations.join("; "),
    ),
    mermaidGate(bundle),
    ...(bundle.script === null ? [] : [gate(
      "script_grounding",
      scripts.length === 0,
      scripts.length === 0 ? "Every script fact maps to script-safe claims." : scripts.join("; "),
    )]),
    instructionIsolationGate(bundle, approvedModelHost),
    outputBindingGate(bundle, snapshot),
  ];
  return { passed: gates.every((result) => result.passed), gates };
}

function briefSchemaValidity(
  brief: CodebaseBrief,
  evidence: readonly EvidenceRecord[],
  schemas: SchemaRegistry,
): GateResult {
  const errors: string[] = [];
  const briefResult = schemas.validate("CodebaseBrief", brief);
  if (!briefResult.valid) {
    errors.push(...briefResult.errors.map((error) => `brief: ${error}`));
  }
  for (const record of evidence) {
    const result = schemas.validate("EvidenceRecord", record);
    if (!result.valid) {
      errors.push(...result.errors.map((error) => `${record.id}: ${error}`));
    }
  }
  const embeddedIds = brief.evidence.map((record) => record.id).sort();
  const standaloneIds = evidence.map((record) => record.id).sort();
  if (JSON.stringify(embeddedIds) !== JSON.stringify(standaloneIds)) {
    errors.push("brief.evidence and evidence artifact contain different IDs");
  }
  return gate(
    "schema_validity",
    errors.length === 0,
    errors.length === 0 ? "Brief and evidence match their versioned schemas." : errors.join("; "),
  );
}

export function evaluateBriefQualityGate(
  brief: CodebaseBrief,
  evidence: readonly EvidenceRecord[],
  snapshot: SnapshotSummary,
  schemas: SchemaRegistry,
): QualityReceipt {
  const bundle: BriefGateBundle = { brief, evidence };
  const pathErrors = evidencePathErrors(evidence, snapshot);
  const claimErrors = verifiedClaimErrors(bundle);
  const semanticErrors = claimSemanticErrors(bundle);
  const outputBound =
    brief.repository.commit_sha === snapshot.commit_sha &&
    evidence.every((record) =>
      record.repository === undefined
        ? true
        : record.repository.commit_sha === snapshot.commit_sha,
    );
  const gates: GateResult[] = [
    briefSchemaValidity(brief, evidence, schemas),
    gate(
      "evidence_paths",
      pathErrors.length === 0,
      pathErrors.length === 0 ? "Evidence locators match the fixed snapshot." : pathErrors.join("; "),
    ),
    gate(
      "verified_claims",
      claimErrors.length === 0,
      claimErrors.length === 0 ? "Every verified claim has verified evidence." : claimErrors.join("; "),
    ),
    gate(
      "claim_semantics",
      semanticErrors.length === 0,
      semanticErrors.length === 0
        ? "Every verified claim is within the scope and strength entailed by its evidence."
        : semanticErrors.join("; "),
    ),
    gate(
      "output_binding",
      outputBound,
      outputBound
        ? "Brief and evidence bind to the fixed commit SHA."
        : "Brief or evidence commit SHA drifted.",
    ),
  ];
  return { passed: gates.every((result) => result.passed), gates };
}
