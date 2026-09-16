import type { GroundedFact, GroundedFactPack } from "../facts/domain.js";
import {
  calculateOpenAICompatibleCost,
  type OpenAICompatiblePricing,
} from "../model/openai-compatible-provider.js";
import type {
  ModelProvider,
  ModelRequestConfiguration,
  StructuredGenerationRequest,
} from "../model/provider.js";
import { buildStructuredPrompt } from "../model/structured-prompt.js";
import { structuredOutputContract } from "../model/structured-output.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import type {
  BriefCoverageCategory,
  GroundedBrief,
  GroundedBriefPlan,
  GroundedBriefStatementKind,
} from "./domain.js";
import {
  validateGroundedBrief,
  type GroundedBriefValidationReceipt,
} from "./validation.js";

export const GROUNDED_BRIEF_SURFACE_DRAFT_SCHEMA_ID =
  "internal:grounded-brief-surface-draft:1" as const;

export const VS03_C_AUTHORIZED_BUDGET = {
  hardBudgetUsd: 0.02,
  inputTokenHardLimit: 10_000,
  outputTokenHardLimit: 2_500,
  requestedOutputTokens: 1_700,
  conservativeCharactersPerToken: 3,
} as const;

export const VS03_C2_AUTHORIZED_BUDGET = {
  hardBudgetUsd: 0.02,
  inputTokenHardLimit: 7_500,
  outputTokenHardLimit: 2_500,
  requestedOutputTokens: 2_500,
  conservativeCharactersPerToken: 3,
} as const;

export interface GroundedBriefSurfaceCanaryBudget {
  readonly hardBudgetUsd: number;
  readonly inputTokenHardLimit: number;
  readonly outputTokenHardLimit: number;
  readonly requestedOutputTokens: number;
  readonly conservativeCharactersPerToken: number;
  readonly pricing: OpenAICompatiblePricing;
}

export interface GroundedBriefCorePolicy {
  readonly policy_version: 1;
  readonly required_fact_ids: readonly string[];
  readonly optional_fact_ids: readonly string[];
  readonly required_coverage: readonly BriefCoverageCategory[];
}

export interface GroundedBriefSurfaceCanaryFact {
  readonly id: string;
  readonly section_id: string;
  readonly required: boolean;
  readonly statement_kind: Extract<
    GroundedBriefStatementKind,
    "TECHNICAL_FACT" | "DOCUMENTATION"
  >;
  readonly fact_type: GroundedFact["fact_type"];
  readonly subject_label: string;
  readonly predicate: GroundedFact["predicate"];
  readonly object_label: string;
  readonly scope: GroundedFact["scope"];
  readonly qualifiers: readonly string[];
  readonly limitations: GroundedFact["limitations"];
}

export interface GroundedBriefSurfaceCanaryModelInput {
  readonly input_contract_version: 1;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly brief_plan_version: GroundedBriefPlan["brief_plan_version"];
  readonly sections: readonly {
    readonly id: string;
    readonly title: string;
  }[];
  readonly selected_facts: readonly GroundedBriefSurfaceCanaryFact[];
  readonly known_unknowns: readonly {
    readonly id: string;
    readonly section_id: "not_proven";
    readonly reason: string;
  }[];
  readonly output_rules: readonly string[];
}

export interface GroundedBriefSurfaceDraftStatement {
  readonly id: string;
  readonly section_id: string;
  readonly kind:
    | "TECHNICAL_FACT"
    | "DOCUMENTATION"
    | "TRANSITION"
    | "UNKNOWN";
  readonly text: string;
  readonly fact_ids: readonly string[];
  readonly unknown_ids: readonly string[];
}

export interface GroundedBriefSurfaceDraft {
  readonly draft_version: 1;
  readonly statements: readonly GroundedBriefSurfaceDraftStatement[];
}

export interface GroundedBriefSurfaceMaterializationMetadata {
  readonly provider: string;
  readonly model: string;
}

export interface GroundedBriefSurfaceMaterialization {
  readonly brief: GroundedBrief;
  readonly factsUsed: number;
  readonly coreFactsRequired: number;
  readonly coreFactsCovered: number;
  readonly technicalStatements: number;
  readonly documentationStatements: number;
  readonly transitions: number;
  readonly knownUnknowns: number;
}

export interface GroundedBriefSurfaceCanaryOptions {
  readonly provider: ModelProvider;
  readonly schemas: SchemaRegistry;
  readonly budget: GroundedBriefSurfaceCanaryBudget;
  readonly expectedRequestConfiguration: ModelRequestConfiguration;
  readonly clock?: () => number;
}

export interface GroundedBriefSurfaceCanaryGenerationReceipt {
  readonly provider: "deepseek-api";
  readonly model: "deepseek-v4-pro";
  readonly paidRequests: 1;
  readonly httpAttempts: 1;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly thinking: ModelRequestConfiguration["thinking"];
  readonly reasoningEffort: ModelRequestConfiguration["reasoningEffort"];
  readonly reasoningTokens: number | null;
  readonly reasoningContentCharacters: number;
  readonly visibleContentTokens: number | null;
  readonly durationMs: number;
  readonly costPerAcceptedTechnicalStatementUsd: number | null;
  readonly cacheHitInputTokens: number | null;
  readonly cacheMissInputTokens: number | null;
  readonly requestedOutputTokens: number;
  readonly actualCostUsd: number;
  readonly preflightWorstCaseCostUsd: number;
  readonly promptCharacters: number;
  readonly estimatedInputTokens: number;
  readonly sourceCodeSentToModel: false;
  readonly readmeSentToModel: "NO";
  readonly factsAvailable: number;
  readonly factsSelected: number;
  readonly factsSentToModel: number;
  readonly factsUsed: number;
  readonly coreFactsRequired: number;
  readonly coreFactsCovered: number;
  readonly technicalStatements: number;
  readonly documentationStatements: number;
  readonly transitions: number;
  readonly knownUnknowns: number;
  readonly repairActions: readonly string[];
  readonly truncated: false;
}

export interface GroundedBriefSurfaceCanaryResult {
  readonly status: "ACCEPTED" | "REJECTED";
  readonly rawDraft: GroundedBriefSurfaceDraft;
  readonly rawModelOutput: string;
  readonly acceptedBrief: GroundedBrief | null;
  readonly materialization: GroundedBriefSurfaceMaterialization;
  readonly validation: GroundedBriefValidationReceipt;
  readonly groundedBriefSchema: {
    readonly valid: boolean;
    readonly errors: readonly string[];
  };
  readonly corePolicy: GroundedBriefCorePolicy;
  readonly generation: GroundedBriefSurfaceCanaryGenerationReceipt;
  readonly repositoryExecutions: 0;
}

export interface PreparedGroundedBriefSurfaceCanary {
  readonly request: StructuredGenerationRequest;
  readonly corePolicy: GroundedBriefCorePolicy;
  readonly modelInput: GroundedBriefSurfaceCanaryModelInput;
  readonly promptCharacters: number;
  readonly estimatedInputTokens: number;
  readonly preflightWorstCaseCostUsd: number;
}

const REQUIRED_COVERAGE: readonly BriefCoverageCategory[] = [
  "PACKAGE_SURFACE",
  "CORE_STRUCTURE",
  "CORE_RELATIONS",
  "VERIFIED_BEHAVIOR",
  "TYPE_SURFACE",
  "KNOWN_UNKNOWNS",
];

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function assertIdentity(pack: GroundedFactPack, plan: GroundedBriefPlan): void {
  if (
    plan.repository.url !== pack.repository.url ||
    plan.repository.owner !== pack.repository.owner ||
    plan.repository.name !== pack.repository.name ||
    plan.commit !== pack.commit ||
    plan.fact_ir_version !== pack.fact_ir_version
  ) {
    throw new Error("SURFACE_CANARY_IDENTITY_MISMATCH");
  }
}

function isDocumentationFact(
  fact: GroundedFact,
  objectFieldPointer: string | undefined,
): boolean {
  return (
    fact.source_kind === "documentation" ||
    (fact.fact_type === "CONFIGURATION" &&
      objectFieldPointer === "/description")
  );
}

function buildCorePolicy(
  pack: GroundedFactPack,
  plan: GroundedBriefPlan,
): GroundedBriefCorePolicy {
  const facts = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const entities = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const selected = plan.selected_facts;
  const required = selected.filter((item) => {
    const fact = facts.get(item.fact_id);
    if (fact === undefined) throw new Error(`Unknown selected Fact ${item.fact_id}.`);
    const objectLabel = entities.get(fact.object_ref)?.display_label;
    if (item.section_id === "overview") return true;
    if (item.section_id === "public_surface") {
      return fact.scope === "PACKAGE" || objectLabel === pack.repository.name;
    }
    if (item.section_id === "core_structure") {
      return (
        item.priority ===
        Math.min(
          ...selected
            .filter((candidate) => candidate.section_id === "core_structure")
            .map((candidate) => candidate.priority),
        )
      );
    }
    if (item.section_id === "structure_relationships") return true;
    if (item.section_id === "verified_behavior") {
      const requiredBehaviorPriorities = selected
        .filter((candidate) => candidate.section_id === "verified_behavior")
        .map((candidate) => candidate.priority)
        .sort((left, right) => left - right)
        .slice(0, 2);
      return requiredBehaviorPriorities.includes(item.priority);
    }
    if (item.section_id === "type_surface") {
      return (
        item.priority ===
        Math.min(
          ...selected
            .filter((candidate) => candidate.section_id === "type_surface")
            .map((candidate) => candidate.priority),
        )
      );
    }
    return false;
  });
  const requiredIds = new Set(required.map((item) => item.fact_id));
  return {
    policy_version: 1,
    required_fact_ids: required.map((item) => item.fact_id),
    optional_fact_ids: selected
      .map((item) => item.fact_id)
      .filter((id) => !requiredIds.has(id)),
    required_coverage: REQUIRED_COVERAGE,
  };
}

function buildModelInput(
  pack: GroundedFactPack,
  plan: GroundedBriefPlan,
  corePolicy: GroundedBriefCorePolicy,
): GroundedBriefSurfaceCanaryModelInput {
  const facts = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const entities = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const requiredIds = new Set(corePolicy.required_fact_ids);
  return {
    input_contract_version: 1,
    repository: { ...pack.repository },
    commit: pack.commit,
    fact_ir_version: pack.fact_ir_version,
    brief_plan_version: plan.brief_plan_version,
    sections: plan.section_plan.map((section) => ({
      id: section.id,
      title: section.title,
    })),
    selected_facts: plan.selected_facts.map((selected) => {
      const fact = facts.get(selected.fact_id);
      if (fact === undefined) {
        throw new Error(`Unknown selected Fact ${selected.fact_id}.`);
      }
      const subject = entities.get(fact.subject_ref);
      const object = entities.get(fact.object_ref);
      if (subject === undefined || object === undefined) {
        throw new Error(`Selected Fact ${fact.id} has an unknown Entity.`);
      }
      return {
        id: fact.id,
        section_id: selected.section_id,
        required: requiredIds.has(fact.id),
        statement_kind: isDocumentationFact(fact, object.field_pointer)
          ? "DOCUMENTATION"
          : "TECHNICAL_FACT",
        fact_type: fact.fact_type,
        subject_label: subject.display_label,
        predicate: fact.predicate,
        object_label: object.display_label,
        scope: fact.scope,
        qualifiers: fact.qualifiers.map(
          (qualifier) => `${qualifier.key}=${qualifier.value}`,
        ),
        limitations: [...fact.limitations],
      };
    }),
    known_unknowns: plan.known_gaps.map((gap) => ({
      id: gap.id,
      section_id: "not_proven" as const,
      reason: gap.reason,
    })),
    output_rules: [
      "JSON only; follow the Surface Draft schema.",
      "Use each required Fact once; omit optional Facts in this Canary.",
      "One Fact per factual Statement; keep its section and kind.",
      "Preserve every Unknown once and never assert its opposite.",
      "Add no Facts, entities, predicates, scope, outcomes, safety, performance, or runtime behavior.",
      "No INFERENCE or ANALOGY; at most one fact-free TRANSITION.",
      "Use compact, plain technical English.",
    ],
  };
}

export function prepareGroundedBriefSurfaceCanary(
  pack: GroundedFactPack,
  plan: GroundedBriefPlan,
  budget: GroundedBriefSurfaceCanaryBudget,
): PreparedGroundedBriefSurfaceCanary {
  assertIdentity(pack, plan);
  assertPositiveInteger("inputTokenHardLimit", budget.inputTokenHardLimit);
  assertPositiveInteger("outputTokenHardLimit", budget.outputTokenHardLimit);
  assertPositiveInteger("requestedOutputTokens", budget.requestedOutputTokens);
  assertPositiveInteger(
    "conservativeCharactersPerToken",
    budget.conservativeCharactersPerToken,
  );
  if (budget.hardBudgetUsd <= 0) throw new Error("hardBudgetUsd must be positive.");
  if (budget.requestedOutputTokens > budget.outputTokenHardLimit) {
    throw new Error("SURFACE_CANARY_OUTPUT_LIMIT_EXCEEDED");
  }
  const preflightCost = calculateOpenAICompatibleCost(
    {
      inputTokens: budget.inputTokenHardLimit,
      outputTokens: budget.requestedOutputTokens,
    },
    budget.pricing,
  );
  if (preflightCost.totalCost > budget.hardBudgetUsd) {
    throw new Error("SURFACE_CANARY_BUDGET_PREFLIGHT_FAILED");
  }

  const corePolicy = buildCorePolicy(pack, plan);
  const modelInput = buildModelInput(pack, plan, corePolicy);
  const request: StructuredGenerationRequest = {
    stage: "brief",
    schemaId: GROUNDED_BRIEF_SURFACE_DRAFT_SCHEMA_ID,
    systemInstructions:
      "Surface-realize immutable Grounded Facts only. The host owns truth, identity, assertions, scope, Evidence trace, verification, and acceptance. Return a compact structured draft; do not research or add technical knowledge.",
    untrustedRepositoryContext: [],
    untrustedRepositorySignals: {
      grounded_brief_surface_input: modelInput,
    },
    repositoryReadReceipt: {
      highestScope: 0,
      filesConsidered: [],
      filesRead: [],
    },
    maxOutputTokens: budget.requestedOutputTokens,
    cacheKey: `${pack.repository.owner}/${pack.repository.name}:${pack.commit}:grounded-brief-surface-v1`,
  };
  const contract = structuredOutputContract(request.schemaId);
  if (contract === null) throw new Error("SURFACE_CANARY_SCHEMA_MISSING");
  const promptCharacters = buildStructuredPrompt(request, contract.schema).length;
  const estimatedInputTokens = Math.ceil(
    promptCharacters / budget.conservativeCharactersPerToken,
  );
  if (estimatedInputTokens > budget.inputTokenHardLimit) {
    throw new Error("SURFACE_CANARY_INPUT_LIMIT_EXCEEDED");
  }
  return {
    request,
    corePolicy,
    modelInput,
    promptCharacters,
    estimatedInputTokens,
    preflightWorstCaseCostUsd: preflightCost.totalCost,
  };
}

function failSurfaceDraft(code: string, detail?: string): never {
  throw new Error(detail === undefined ? code : `${code}:${detail}`);
}

export function materializeGroundedBriefSurfaceDraft(
  draft: GroundedBriefSurfaceDraft,
  pack: GroundedFactPack,
  plan: GroundedBriefPlan,
  corePolicy: GroundedBriefCorePolicy,
  metadata: GroundedBriefSurfaceMaterializationMetadata,
): GroundedBriefSurfaceMaterialization {
  assertIdentity(pack, plan);
  if (draft.draft_version !== 1) failSurfaceDraft("SURFACE_DRAFT_VERSION_INVALID");
  const facts = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const entities = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const selected = new Map(plan.selected_facts.map((item) => [item.fact_id, item]));
  const sections = new Map(plan.section_plan.map((section) => [section.id, section]));
  const gaps = new Map(plan.known_gaps.map((gap) => [gap.id, gap]));
  const coreIds = new Set(corePolicy.required_fact_ids);
  const statementIds = new Set<string>();
  const factIdsUsed = new Set<string>();
  const unknownIdsUsed = new Set<string>();
  let transitionCount = 0;

  const statements = draft.statements.map((candidate) => {
    if (
      candidate.id.trim().length === 0 ||
      candidate.text.trim().length < 10 ||
      candidate.text.trim() !== candidate.text
    ) {
      failSurfaceDraft("SURFACE_DRAFT_STATEMENT_INVALID", candidate.id);
    }
    if (statementIds.has(candidate.id)) {
      failSurfaceDraft("SURFACE_DRAFT_DUPLICATE_STATEMENT", candidate.id);
    }
    statementIds.add(candidate.id);
    const section = sections.get(candidate.section_id);
    if (section === undefined) {
      failSurfaceDraft("SURFACE_DRAFT_UNKNOWN_SECTION", candidate.section_id);
    }

    if (
      candidate.kind === "TECHNICAL_FACT" ||
      candidate.kind === "DOCUMENTATION"
    ) {
      if (candidate.fact_ids.length !== 1 || candidate.unknown_ids.length !== 0) {
        failSurfaceDraft("SURFACE_DRAFT_FACT_REFERENCE_INVALID", candidate.id);
      }
      const factId = candidate.fact_ids[0] ?? "";
      const selectedFact = selected.get(factId);
      const fact = facts.get(factId);
      if (selectedFact === undefined || fact === undefined) {
        failSurfaceDraft("SURFACE_DRAFT_UNKNOWN_OR_UNSELECTED_FACT", factId);
      }
      if (factIdsUsed.has(factId)) {
        failSurfaceDraft("SURFACE_DRAFT_DUPLICATE_FACT", factId);
      }
      if (selectedFact.section_id !== candidate.section_id) {
        failSurfaceDraft("SURFACE_DRAFT_FACT_SECTION_MISMATCH", factId);
      }
      const object = entities.get(fact.object_ref);
      const expectedKind = isDocumentationFact(fact, object?.field_pointer)
        ? "DOCUMENTATION"
        : "TECHNICAL_FACT";
      if (candidate.kind !== expectedKind) {
        failSurfaceDraft("SURFACE_DRAFT_FACT_KIND_MISMATCH", factId);
      }
      factIdsUsed.add(factId);
      return {
        id: candidate.id,
        text: candidate.text,
        kind: candidate.kind,
        scope: fact.scope,
        fact_ids: [fact.id],
        entity_refs: [fact.subject_ref, fact.object_ref],
        assertions: [
          {
            fact_id: fact.id,
            subject_ref: fact.subject_ref,
            predicate: fact.predicate,
            object_ref: fact.object_ref,
          },
        ],
        unknown_ids: [],
        limitations: [...fact.limitations],
        section_id: candidate.section_id,
      } as const;
    }

    if (candidate.kind === "UNKNOWN") {
      if (candidate.fact_ids.length !== 0 || candidate.unknown_ids.length !== 1) {
        failSurfaceDraft("SURFACE_DRAFT_UNKNOWN_REFERENCE_INVALID", candidate.id);
      }
      const unknownId = candidate.unknown_ids[0] ?? "";
      const gap = gaps.get(unknownId);
      if (gap === undefined || !section.known_gap_ids.includes(unknownId)) {
        failSurfaceDraft("SURFACE_DRAFT_UNKNOWN_GAP", unknownId);
      }
      if (unknownIdsUsed.has(unknownId)) {
        failSurfaceDraft("SURFACE_DRAFT_DUPLICATE_UNKNOWN", unknownId);
      }
      unknownIdsUsed.add(unknownId);
      return {
        id: candidate.id,
        text: candidate.text,
        kind: "UNKNOWN" as const,
        scope: "NONE" as const,
        fact_ids: [],
        entity_refs: [],
        assertions: [],
        unknown_ids: [unknownId],
        limitations: [
          "An unavailable fact is not evidence that the opposite statement is true.",
        ],
        section_id: candidate.section_id,
      } as const;
    }

    if (candidate.fact_ids.length !== 0 || candidate.unknown_ids.length !== 0) {
      failSurfaceDraft("SURFACE_DRAFT_TRANSITION_REFERENCE_INVALID", candidate.id);
    }
    transitionCount += 1;
    if (transitionCount > 1) failSurfaceDraft("SURFACE_DRAFT_TRANSITION_LIMIT");
    return {
      id: candidate.id,
      text: candidate.text,
      kind: "TRANSITION" as const,
      scope: "NONE" as const,
      fact_ids: [],
      entity_refs: [],
      assertions: [],
      unknown_ids: [],
      limitations: [],
      section_id: candidate.section_id,
    } as const;
  });

  const missingCore = [...coreIds].filter((id) => !factIdsUsed.has(id));
  if (missingCore.length > 0) {
    failSurfaceDraft("SURFACE_CANARY_CORE_COVERAGE_FAIL", missingCore.join(","));
  }
  const missingUnknowns = plan.known_gaps
    .map((gap) => gap.id)
    .filter((id) => !unknownIdsUsed.has(id));
  if (missingUnknowns.length > 0 || unknownIdsUsed.size !== plan.known_gaps.length) {
    failSurfaceDraft(
      "SURFACE_CANARY_KNOWN_UNKNOWN_PRESERVATION_FAIL",
      missingUnknowns.join(","),
    );
  }

  const briefStatements = statements.map(({ section_id: _sectionId, ...statement }) =>
    statement,
  );
  const unknownText = new Map(
    statements.flatMap((statement) =>
      statement.kind === "UNKNOWN"
        ? statement.unknown_ids.map((id) => [id, statement.text] as const)
        : [],
    ),
  );
  const brief: GroundedBrief = {
    brief_version: 1,
    repository: { ...pack.repository },
    commit: pack.commit,
    fact_ir_version: pack.fact_ir_version,
    brief_plan_version: plan.brief_plan_version,
    sections: plan.section_plan.map((section) => ({
      id: section.id,
      title: section.title,
      statements: statements
        .filter((statement) => statement.section_id === section.id)
        .map((statement) => {
          const { section_id: _sectionId, ...value } = statement;
          return value;
        }),
    })),
    fact_references: briefStatements
      .filter((statement) => statement.fact_ids.length > 0)
      .map((statement) => ({
        statement_id: statement.id,
        fact_ids: [...statement.fact_ids],
      })),
    unknowns: plan.known_gaps.map((gap) => {
      const statement = unknownText.get(gap.id);
      if (statement === undefined) {
        failSurfaceDraft("SURFACE_CANARY_UNKNOWN_TEXT_MISSING", gap.id);
      }
      return {
        id: gap.id,
        statement,
        source_gap_ids: [gap.source_unsupported_area_id],
        evidence_needed: gap.evidence_needed,
      };
    }),
    limitations: [
      ...pack.limitations,
      "Only host-selected Grounded Facts may be surface-realized by the model.",
      "Model prose does not create or upgrade Facts, Evidence, scope, predicates, or verification.",
      "Known unknowns identify missing evidence; they are not negative facts.",
    ],
    generation_metadata: {
      mode: "model_surface",
      generator: "grounded-brief-surface-canary-v1",
      provider: metadata.provider,
      model: metadata.model,
      paid_api_requests: 1,
      real_model_requests: 1,
      repository_executions: 0,
    },
  };
  const technicalStatements = briefStatements.filter(
    (statement) => statement.kind === "TECHNICAL_FACT",
  ).length;
  const documentationStatements = briefStatements.filter(
    (statement) => statement.kind === "DOCUMENTATION",
  ).length;
  return {
    brief,
    factsUsed: factIdsUsed.size,
    coreFactsRequired: coreIds.size,
    coreFactsCovered: [...coreIds].filter((id) => factIdsUsed.has(id)).length,
    technicalStatements,
    documentationStatements,
    transitions: transitionCount,
    knownUnknowns: unknownIdsUsed.size,
  };
}

export async function runGroundedBriefSurfaceCanary(
  pack: GroundedFactPack,
  plan: GroundedBriefPlan,
  options: GroundedBriefSurfaceCanaryOptions,
): Promise<GroundedBriefSurfaceCanaryResult> {
  const prepared = prepareGroundedBriefSurfaceCanary(
    pack,
    plan,
    options.budget,
  );
  const clock = options.clock ?? Date.now;
  const requestStartedAt = clock();
  const modelResult = await options.provider.generateStructured<GroundedBriefSurfaceDraft>(
    prepared.request,
  );
  const requestCompletedAt = clock();
  if (
    !Number.isFinite(requestStartedAt) ||
    !Number.isFinite(requestCompletedAt) ||
    requestCompletedAt < requestStartedAt
  ) {
    throw new Error("SURFACE_CANARY_DURATION_INVALID");
  }
  const durationMs = requestCompletedAt - requestStartedAt;
  if (
    modelResult.provider !== "deepseek-api" ||
    modelResult.model !== "deepseek-v4-pro" ||
    modelResult.networkCalls !== 1 ||
    !modelResult.paid
  ) {
    throw new Error("SURFACE_CANARY_REQUEST_IDENTITY_INVALID");
  }
  if (
    modelResult.requestConfiguration === undefined ||
    modelResult.requestConfiguration.thinking !==
      options.expectedRequestConfiguration.thinking ||
    modelResult.requestConfiguration.reasoningEffort !==
      options.expectedRequestConfiguration.reasoningEffort
  ) {
    throw new Error("SURFACE_CANARY_REQUEST_CONFIGURATION_INVALID");
  }
  if (modelResult.reasoning === undefined) {
    throw new Error("SURFACE_CANARY_REASONING_RECEIPT_MISSING");
  }
  if (
    modelResult.rawOutput === undefined ||
    modelResult.rawOutput.trim().length === 0 ||
    modelResult.finishReason !== "stop"
  ) {
    throw new Error("SURFACE_CANARY_RESPONSE_INCOMPLETE");
  }
  if (
    modelResult.context.highestReadScope !== 0 ||
    modelResult.context.filesConsidered.length !== 0 ||
    modelResult.context.filesRead.length !== 0 ||
    modelResult.context.filesPassed.length !== 0 ||
    modelResult.context.repositoryCharactersPassed !== 0 ||
    modelResult.context.promptCharacters !== prepared.promptCharacters ||
    !modelResult.context.schemaValidated ||
    modelResult.context.endpoint !== "remote_https"
  ) {
    throw new Error("SURFACE_CANARY_CONTEXT_DRIFT");
  }
  if (
    modelResult.usage.inputTokens > options.budget.inputTokenHardLimit ||
    modelResult.usage.outputTokens > options.budget.outputTokenHardLimit
  ) {
    throw new Error("SURFACE_CANARY_ACTUAL_TOKEN_LIMIT_EXCEEDED");
  }
  const actualCost = calculateOpenAICompatibleCost(
    modelResult.usage,
    options.budget.pricing,
  );
  if (actualCost.totalCost > options.budget.hardBudgetUsd) {
    throw new Error("SURFACE_CANARY_ACTUAL_BUDGET_EXCEEDED");
  }

  const materialization = materializeGroundedBriefSurfaceDraft(
    modelResult.value,
    pack,
    plan,
    prepared.corePolicy,
    { provider: modelResult.provider, model: modelResult.model },
  );
  const groundedBriefSchema = options.schemas.validate(
    "GroundedBrief",
    materialization.brief,
  );
  const validation = validateGroundedBrief(
    materialization.brief,
    plan,
    pack,
    { requiredFactIds: prepared.corePolicy.required_fact_ids },
  );
  const accepted = groundedBriefSchema.valid && validation.passed;
  const costPerAcceptedTechnicalStatementUsd =
    accepted && materialization.technicalStatements > 0
      ? Math.round(
          (actualCost.totalCost / materialization.technicalStatements) *
            1_000_000_000_000,
        ) / 1_000_000_000_000
      : null;
  return {
    status: accepted ? "ACCEPTED" : "REJECTED",
    rawDraft: modelResult.value,
    rawModelOutput: modelResult.rawOutput,
    acceptedBrief: accepted ? materialization.brief : null,
    materialization,
    validation,
    groundedBriefSchema,
    corePolicy: prepared.corePolicy,
    generation: {
      provider: "deepseek-api",
      model: "deepseek-v4-pro",
      paidRequests: 1,
      httpAttempts: 1,
      inputTokens: modelResult.usage.inputTokens,
      outputTokens: modelResult.usage.outputTokens,
      thinking: modelResult.requestConfiguration.thinking,
      reasoningEffort: modelResult.requestConfiguration.reasoningEffort,
      reasoningTokens: modelResult.reasoning.tokens,
      reasoningContentCharacters: modelResult.reasoning.contentCharacters,
      visibleContentTokens: modelResult.reasoning.visibleContentTokens,
      durationMs,
      costPerAcceptedTechnicalStatementUsd,
      cacheHitInputTokens: modelResult.usage.cacheHitInputTokens ?? null,
      cacheMissInputTokens: modelResult.usage.cacheMissInputTokens ?? null,
      requestedOutputTokens: options.budget.requestedOutputTokens,
      actualCostUsd: actualCost.totalCost,
      preflightWorstCaseCostUsd: prepared.preflightWorstCaseCostUsd,
      promptCharacters: prepared.promptCharacters,
      estimatedInputTokens: prepared.estimatedInputTokens,
      sourceCodeSentToModel: false,
      readmeSentToModel: "NO",
      factsAvailable: pack.facts.length,
      factsSelected: plan.selected_facts.length,
      factsSentToModel: prepared.modelInput.selected_facts.length,
      factsUsed: materialization.factsUsed,
      coreFactsRequired: materialization.coreFactsRequired,
      coreFactsCovered: materialization.coreFactsCovered,
      technicalStatements: materialization.technicalStatements,
      documentationStatements: materialization.documentationStatements,
      transitions: materialization.transitions,
      knownUnknowns: materialization.knownUnknowns,
      repairActions: [...modelResult.context.repairActions],
      truncated: false,
    },
    repositoryExecutions: 0,
  };
}
