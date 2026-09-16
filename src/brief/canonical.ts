import type { GroundedEvidenceRef, GroundedFactPack } from "../facts/domain.js";
import { validateGroundedFactPackIntegrity } from "../facts/integrity.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import {
  evaluateGroundedBriefOffline,
  type GroundedBriefOfflineAssessment,
} from "./assessment.js";
import type {
  GroundedBrief,
  GroundedBriefPlan,
  GroundedBriefStatementKind,
} from "./domain.js";
import { buildGroundedBriefPlan } from "./plan.js";
import { renderDeterministicGroundedBrief } from "./renderer.js";
import {
  validateGroundedBrief,
  type GroundedBriefGateCode,
  type GroundedBriefValidationReceipt,
} from "./validation.js";

export const CANONICAL_GROUNDED_BRIEF_VERSION = 1 as const;

export interface CanonicalGroundedBriefAcceptance {
  readonly schema: "PASS";
  readonly fact_references: "PASS";
  readonly statement_to_fact_trace: "PASS";
  readonly fact_to_evidence_trace: "PASS";
  readonly unsupported_entities: 0;
  readonly predicate_expansions: 0;
  readonly scope_expansions: 0;
  readonly unsupported_safety_or_outcome: 0;
  readonly compound_claim_leakage: 0;
  readonly documentation_boundary: "PASS";
  readonly known_unknown_preservation: "PASS";
  readonly repository_commit_binding: "PASS";
  readonly determinism: "PASS";
  readonly technical_utility: "PASS";
  readonly readability: "PASS";
}

export interface CanonicalGroundedBriefArtifact {
  readonly canonical_grounded_brief_version: typeof CANONICAL_GROUNDED_BRIEF_VERSION;
  readonly status: "ACCEPTED";
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly brief_contract_version: GroundedBrief["brief_version"];
  readonly brief_plan_version: GroundedBriefPlan["brief_plan_version"];
  readonly selection_policy_version: GroundedBriefPlan["selection_policy_version"];
  readonly generation_mode: "deterministic";
  readonly selected_fact_ids: readonly string[];
  readonly statement_to_fact_trace: readonly {
    readonly statement_id: string;
    readonly statement_kind: Extract<
      GroundedBriefStatementKind,
      "TECHNICAL_FACT" | "DOCUMENTATION"
    >;
    readonly fact_ids: readonly string[];
  }[];
  readonly fact_to_evidence_trace: readonly {
    readonly fact_id: string;
    readonly evidence_ids: readonly string[];
    readonly evidence_refs: readonly GroundedEvidenceRef[];
  }[];
  readonly known_unknowns: GroundedBrief["unknowns"];
  readonly limitations: GroundedBrief["limitations"];
  readonly brief: GroundedBrief;
  readonly acceptance: CanonicalGroundedBriefAcceptance;
  readonly source_artifacts: {
    readonly grounded_fact_pack: "grounded-fact-pack.json";
    readonly brief_plan: "brief-plan.json";
  };
  readonly downstream_truth_source: {
    readonly allowed_inputs: readonly [
      "grounded_fact_pack",
      "canonical_grounded_brief",
      "known_unknowns",
      "canonical_evidence_when_needed",
    ];
    readonly forbidden_inputs: readonly [
      "raw_llm_brief",
      "raw_repository",
      "vs02_model_outputs",
      "vs03_c_draft",
      "vs03_c2_draft",
    ];
    readonly content_angle_permissions: readonly [
      "select",
      "rank",
      "group",
      "frame",
    ];
    readonly canonical_fact_prohibitions: readonly [
      "create",
      "upgrade",
      "rewrite",
      "replace",
    ];
  };
}

export interface CanonicalGroundedBriefFreezeResult {
  readonly artifact: CanonicalGroundedBriefArtifact;
  readonly plan: GroundedBriefPlan;
  readonly brief: GroundedBrief;
  readonly validation: GroundedBriefValidationReceipt;
  readonly assessment: GroundedBriefOfflineAssessment;
}

function sameRepository(
  left: GroundedFactPack["repository"],
  right: GroundedFactPack["repository"],
): boolean {
  return (
    left.url === right.url &&
    left.owner === right.owner &&
    left.name === right.name
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function findingCount(
  receipt: GroundedBriefValidationReceipt,
  codes: readonly GroundedBriefGateCode[],
): number {
  const included = new Set<GroundedBriefGateCode>(codes);
  return receipt.findings.filter((finding) => included.has(finding.code)).length;
}

function canonicalTraces(
  plan: GroundedBriefPlan,
  brief: GroundedBrief,
  pack: GroundedFactPack,
): Pick<
  CanonicalGroundedBriefArtifact,
  "statement_to_fact_trace" | "fact_to_evidence_trace"
> {
  const statements = new Map(
    brief.sections
      .flatMap((section) => section.statements)
      .map((statement) => [statement.id, statement]),
  );
  const facts = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const evidence = new Map(pack.evidence_refs.map((record) => [record.id, record]));

  const statementToFactTrace = brief.fact_references.map((reference) => {
    const statement = statements.get(reference.statement_id);
    if (
      statement === undefined ||
      !["TECHNICAL_FACT", "DOCUMENTATION"].includes(statement.kind)
    ) {
      throw new Error(
        `Canonical statement trace cannot resolve factual statement ${reference.statement_id}.`,
      );
    }
    return {
      statement_id: reference.statement_id,
      statement_kind: statement.kind as "TECHNICAL_FACT" | "DOCUMENTATION",
      fact_ids: [...reference.fact_ids],
    };
  });

  const factToEvidenceTrace = plan.selected_facts.map((selected) => {
    const fact = facts.get(selected.fact_id);
    if (fact === undefined) {
      throw new Error(`Canonical Fact trace cannot resolve ${selected.fact_id}.`);
    }
    const evidenceRefs = fact.evidence_ids.map((evidenceId) => {
      const record = evidence.get(evidenceId);
      if (record === undefined) {
        throw new Error(
          `Canonical Evidence trace cannot resolve ${evidenceId} for ${fact.id}.`,
        );
      }
      return record;
    });
    return {
      fact_id: fact.id,
      evidence_ids: [...fact.evidence_ids],
      evidence_refs: [...evidenceRefs].sort((left, right) =>
        compareText(left.id, right.id),
      ),
    };
  });

  return {
    statement_to_fact_trace: statementToFactTrace,
    fact_to_evidence_trace: factToEvidenceTrace,
  };
}

function documentationBoundaryPass(
  plan: GroundedBriefPlan,
  brief: GroundedBrief,
  pack: GroundedFactPack,
): boolean {
  const entities = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const facts = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const selectedIds = new Set(plan.selected_facts.map((item) => item.fact_id));
  const descriptionIds = new Set(
    pack.facts
      .filter(
        (fact) =>
          selectedIds.has(fact.id) &&
          fact.fact_type === "CONFIGURATION" &&
          entities.get(fact.object_ref)?.field_pointer === "/description",
      )
      .map((fact) => fact.id),
  );
  const factualStatements = brief.sections
    .flatMap((section) => section.statements)
    .filter((statement) =>
      ["TECHNICAL_FACT", "DOCUMENTATION"].includes(statement.kind),
    );

  return factualStatements.every((statement) => {
      const referencesDescription = statement.fact_ids.some((id) =>
        descriptionIds.has(id),
      );
      if (referencesDescription) return statement.kind === "DOCUMENTATION";
      if (statement.kind === "DOCUMENTATION") return false;
      return statement.fact_ids.every((id) => facts.has(id));
    });
}

function knownUnknownsPass(
  plan: GroundedBriefPlan,
  brief: GroundedBrief,
): boolean {
  const gapIds = plan.known_gaps.map((gap) => gap.id);
  const briefUnknownIds = brief.unknowns.map((unknown) => unknown.id);
  const statementUnknownIds = brief.sections
    .flatMap((section) => section.statements)
    .filter((statement) => statement.kind === "UNKNOWN")
    .flatMap((statement) => statement.unknown_ids);
  return (
    JSON.stringify(gapIds) === JSON.stringify(briefUnknownIds) &&
    JSON.stringify(gapIds) === JSON.stringify(statementUnknownIds)
  );
}

function failIf(condition: boolean, failures: string[], label: string): void {
  if (!condition) failures.push(label);
}

export function freezeCanonicalGroundedBrief(
  pack: GroundedFactPack,
  schemas: SchemaRegistry,
): CanonicalGroundedBriefFreezeResult {
  schemas.assert("GroundedFactPack", pack);
  const integrity = validateGroundedFactPackIntegrity(pack);
  if (!integrity.valid) {
    throw new Error(
      `GroundedFactPack integrity failed: ${integrity.errors.join("; ")}`,
    );
  }

  const plan = buildGroundedBriefPlan(pack);
  const brief = renderDeterministicGroundedBrief(plan, pack);
  schemas.assert("GroundedBriefPlan", plan);
  schemas.assert("GroundedBrief", brief);
  const validation = validateGroundedBrief(brief, plan, pack);
  const assessment = evaluateGroundedBriefOffline(
    plan,
    brief,
    pack,
    validation,
  );
  const repeatedPlan = buildGroundedBriefPlan(pack);
  const repeatedBrief = renderDeterministicGroundedBrief(repeatedPlan, pack);
  const traces = canonicalTraces(plan, brief, pack);

  const selectedIds = plan.selected_facts.map((item) => item.fact_id);
  const tracedStatementFactIds = traces.statement_to_fact_trace.flatMap(
    (trace) => trace.fact_ids,
  );
  const tracedEvidenceFactIds = traces.fact_to_evidence_trace.map(
    (trace) => trace.fact_id,
  );
  const repositoryBound =
    sameRepository(plan.repository, pack.repository) &&
    sameRepository(brief.repository, pack.repository) &&
    plan.commit === pack.commit &&
    brief.commit === pack.commit;
  const zeroExecution =
    brief.generation_metadata.mode === "deterministic" &&
    brief.generation_metadata.provider === null &&
    brief.generation_metadata.model === null &&
    brief.generation_metadata.paid_api_requests === 0 &&
    brief.generation_metadata.real_model_requests === 0 &&
    brief.generation_metadata.repository_executions === 0;
  const failures: string[] = [];

  failIf(validation.passed, failures, "grounded_brief_validation");
  failIf(
    validation.statements.every((statement) => statement.passed),
    failures,
    "fact_references",
  );
  failIf(
    JSON.stringify(tracedStatementFactIds) === JSON.stringify(selectedIds),
    failures,
    "statement_to_fact_trace",
  );
  failIf(
    JSON.stringify(tracedEvidenceFactIds) === JSON.stringify(selectedIds) &&
      traces.fact_to_evidence_trace.every(
        (trace) =>
          trace.evidence_ids.length > 0 &&
          trace.evidence_refs.length === trace.evidence_ids.length &&
          trace.evidence_refs.every(
            (record) => record.verification_status === "verified",
          ),
      ),
    failures,
    "fact_to_evidence_trace",
  );
  failIf(documentationBoundaryPass(plan, brief, pack), failures, "documentation_boundary");
  failIf(knownUnknownsPass(plan, brief), failures, "known_unknown_preservation");
  failIf(repositoryBound, failures, "repository_commit_binding");
  failIf(
    JSON.stringify(plan) === JSON.stringify(repeatedPlan) &&
      JSON.stringify(brief) === JSON.stringify(repeatedBrief),
    failures,
    "determinism",
  );
  failIf(
    assessment.status === "PASS" &&
      assessment.verdicts.technical_utility === "PASS",
    failures,
    "technical_utility",
  );
  failIf(assessment.verdicts.readability === "PASS", failures, "readability");
  failIf(zeroExecution, failures, "offline_zero_execution");

  if (failures.length > 0) {
    throw new Error(
      `Canonical Grounded Brief freeze rejected: ${failures.join(", ")}`,
    );
  }

  const unsupportedSafetyOrOutcome = findingCount(validation, [
    "STATEMENT_FACT_INCOMPATIBLE",
    "TYPE_DECLARATION_CANNOT_PROVE_RUNTIME",
    "PREDICATE_EXPANSION",
    "TECHNICAL_FACT_HIDDEN_IN_TRANSITION",
  ]);
  const acceptance: CanonicalGroundedBriefAcceptance = {
    schema: "PASS",
    fact_references: "PASS",
    statement_to_fact_trace: "PASS",
    fact_to_evidence_trace: "PASS",
    unsupported_entities: findingCount(validation, [
      "UNKNOWN_ENTITY_REFERENCE",
      "UNSUPPORTED_ENTITY_INTRODUCTION",
    ]) as 0,
    predicate_expansions: findingCount(validation, ["PREDICATE_EXPANSION"]) as 0,
    scope_expansions: findingCount(validation, ["SCOPE_EXPANSION"]) as 0,
    unsupported_safety_or_outcome: unsupportedSafetyOrOutcome as 0,
    compound_claim_leakage: findingCount(validation, [
      "COMPOUND_STATEMENT_REQUIRES_ATOMIZATION",
    ]) as 0,
    documentation_boundary: "PASS",
    known_unknown_preservation: "PASS",
    repository_commit_binding: "PASS",
    determinism: "PASS",
    technical_utility: "PASS",
    readability: "PASS",
  };
  const numericFailures = Object.entries(acceptance).filter(
    ([, value]) => typeof value === "number" && value !== 0,
  );
  if (numericFailures.length > 0) {
    throw new Error(
      `Canonical Grounded Brief freeze rejected: ${numericFailures
        .map(([name]) => name)
        .join(", ")}`,
    );
  }

  const artifact: CanonicalGroundedBriefArtifact = {
    canonical_grounded_brief_version: CANONICAL_GROUNDED_BRIEF_VERSION,
    status: "ACCEPTED",
    repository: { ...pack.repository },
    commit: pack.commit,
    fact_ir_version: pack.fact_ir_version,
    brief_contract_version: brief.brief_version,
    brief_plan_version: plan.brief_plan_version,
    selection_policy_version: plan.selection_policy_version,
    generation_mode: "deterministic",
    selected_fact_ids: selectedIds,
    ...traces,
    known_unknowns: brief.unknowns,
    limitations: brief.limitations,
    brief,
    acceptance,
    source_artifacts: {
      grounded_fact_pack: "grounded-fact-pack.json",
      brief_plan: "brief-plan.json",
    },
    downstream_truth_source: {
      allowed_inputs: [
        "grounded_fact_pack",
        "canonical_grounded_brief",
        "known_unknowns",
        "canonical_evidence_when_needed",
      ],
      forbidden_inputs: [
        "raw_llm_brief",
        "raw_repository",
        "vs02_model_outputs",
        "vs03_c_draft",
        "vs03_c2_draft",
      ],
      content_angle_permissions: ["select", "rank", "group", "frame"],
      canonical_fact_prohibitions: [
        "create",
        "upgrade",
        "rewrite",
        "replace",
      ],
    },
  };

  schemas.assert("CanonicalGroundedBrief", artifact);
  return { artifact, plan, brief, validation, assessment };
}

export function serializeCanonicalGroundedBrief(
  artifact: CanonicalGroundedBriefArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

function inline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function renderCanonicalGroundedBriefMarkdown(
  artifact: CanonicalGroundedBriefArtifact,
): string {
  const evidenceByFact = new Map(
    artifact.fact_to_evidence_trace.map((trace) => [trace.fact_id, trace]),
  );
  const lines = [
    "# Canonical Grounded Brief",
    "",
    `Status: ${artifact.status}`,
    `Repository: ${inline(artifact.repository.url)}`,
    `Commit: ${artifact.commit}`,
    `Fact IR Version: ${artifact.fact_ir_version}`,
    `Brief Contract Version: ${artifact.brief_contract_version}`,
    `Brief Plan Version: ${artifact.brief_plan_version}`,
    `Generation Mode: ${artifact.generation_mode}`,
    "",
    "> This is the accepted deterministic factual explanation. Documentation remains documentation, and known unknowns remain evidence gaps.",
  ];

  for (const section of artifact.brief.sections) {
    lines.push("", `## ${inline(section.title)}`, "");
    for (const statement of section.statements) {
      lines.push(`- ${inline(statement.text)}`);
      lines.push(`  - Kind: ${statement.kind}; Scope: ${statement.scope}`);
      if (statement.fact_ids.length > 0) {
        lines.push(
          `  - Fact: ${statement.fact_ids.map((id) => `\`${id}\``).join(", ")}`,
        );
      }
      if (statement.unknown_ids.length > 0) {
        lines.push(
          `  - Known gap: ${statement.unknown_ids
            .map((id) => `\`${id}\``)
            .join(", ")}`,
        );
      }
    }
  }

  lines.push("", "## Statement to Fact to Evidence trace", "");
  for (const statementTrace of artifact.statement_to_fact_trace) {
    for (const factId of statementTrace.fact_ids) {
      const evidenceTrace = evidenceByFact.get(factId);
      if (evidenceTrace === undefined) {
        throw new Error(`Canonical Markdown cannot resolve Evidence for ${factId}.`);
      }
      lines.push(
        `- \`${statementTrace.statement_id}\` -> \`${factId}\` -> ${evidenceTrace.evidence_ids
          .map((id) => `\`${id}\``)
          .join(", ")}`,
      );
    }
  }

  lines.push("", "## Known unknowns", "");
  for (const unknown of artifact.known_unknowns) {
    lines.push(
      `- \`${unknown.id}\`: ${inline(unknown.statement)}`,
      `  - Evidence needed: ${inline(unknown.evidence_needed)}`,
    );
  }

  lines.push("", "## Limitations", "");
  for (const limitation of artifact.limitations) {
    lines.push(`- ${inline(limitation)}`);
  }

  lines.push(
    "",
    "## Canonical acceptance gate",
    "",
    ...Object.entries(artifact.acceptance).map(
      ([name, value]) => `- ${name}: ${String(value)}`,
    ),
    "",
    "## Downstream truth source",
    "",
    `- Allowed: ${artifact.downstream_truth_source.allowed_inputs.join(", ")}`,
    `- Forbidden: ${artifact.downstream_truth_source.forbidden_inputs.join(", ")}`,
    `- Content Angle may: ${artifact.downstream_truth_source.content_angle_permissions.join(", ")}`,
    `- Content layers may not: ${artifact.downstream_truth_source.canonical_fact_prohibitions.join(", ")}`,
  );

  return `${lines.join("\n")}\n`;
}
