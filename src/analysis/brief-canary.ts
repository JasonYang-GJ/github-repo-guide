import type { BriefNarrative } from "./brief-builder.js";
import type { CodebaseBrief, EvidenceRecord, QualityReceipt } from "./domain.js";
import {
  buildCanonicalBrief,
  buildSnapshotSummary,
  prepareBriefGeneration,
} from "./pipeline.js";
import {
  calculateOpenAICompatibleCost,
  type OpenAICompatiblePricing,
} from "../model/openai-compatible-provider.js";
import type { ModelProvider } from "../model/provider.js";
import { buildStructuredPrompt } from "../model/structured-prompt.js";
import { structuredOutputContract } from "../model/structured-output.js";
import type { RepositorySnapshot } from "../repo/contracts.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import {
  evaluateBriefNarrativeSemantics,
  type BriefNarrativeSemanticsReceipt,
} from "../quality/brief-narrative-semantics.js";
import { evaluateBriefQualityGate } from "../quality/gates.js";

export interface BriefCanaryBudget {
  readonly hardBudgetUsd: number;
  readonly inputTokenHardLimit: number;
  readonly outputTokenHardLimit: number;
  readonly preflightInputTokens: number;
  readonly pricing: OpenAICompatiblePricing;
}

export interface BriefCanaryExperimentalControl {
  readonly expectedHighestReadScope: number;
  readonly expectedFilesRead: readonly string[];
  readonly expectedRepositoryCharactersPassed: number;
  readonly expectedPromptCharacters: number;
}

export interface BriefCanaryOptions {
  readonly provider: ModelProvider;
  readonly schemas: SchemaRegistry;
  readonly generatedAt: string;
  readonly expectedCommitSha: string;
  readonly experimentalControl: BriefCanaryExperimentalControl;
  readonly budget: BriefCanaryBudget;
}

export interface BriefCanaryGenerationReceipt {
  readonly provider: string;
  readonly model: string;
  readonly paidRequests: number;
  readonly httpAttempts: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheHitInputTokens: number | null;
  readonly cacheMissInputTokens: number | null;
  readonly outputTokenLimit: number;
  readonly actualCostUsd: number;
  readonly preflightWorstCaseCostUsd: number;
  readonly highestReadScope: number;
  readonly filesRead: readonly string[];
  readonly filesPassed: readonly string[];
  readonly repositoryCharactersPassed: number;
  readonly promptCharacters: number;
  readonly schemaValidated: boolean;
  readonly repairActions: readonly string[];
  readonly endpoint: "none" | "local_loopback" | "remote_https";
  readonly truncated: false;
}

export interface BriefClaimSemanticsCanaryResult {
  readonly narrative: BriefNarrative;
  readonly canonicalBrief: CodebaseBrief;
  readonly evidence: readonly EvidenceRecord[];
  readonly briefQuality: QualityReceipt;
  readonly narrativeSemantics: BriefNarrativeSemanticsReceipt;
  readonly generation: BriefCanaryGenerationReceipt;
  readonly repositoryExecutions: 0;
}

function assertPositiveLimit(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function runBriefClaimSemanticsCanary(
  snapshot: RepositorySnapshot,
  options: BriefCanaryOptions,
): Promise<BriefClaimSemanticsCanaryResult> {
  if (snapshot.repository.commitSha !== options.expectedCommitSha) {
    throw new Error("BRIEF_CANARY_COMMIT_MISMATCH");
  }
  assertPositiveLimit("inputTokenHardLimit", options.budget.inputTokenHardLimit);
  assertPositiveLimit("outputTokenHardLimit", options.budget.outputTokenHardLimit);
  assertPositiveLimit("preflightInputTokens", options.budget.preflightInputTokens);
  if (options.budget.preflightInputTokens > options.budget.inputTokenHardLimit) {
    throw new Error("BRIEF_CANARY_INPUT_LIMIT_EXCEEDED");
  }

  const prepared = prepareBriefGeneration(snapshot, options.provider.id);
  if (prepared.request.maxOutputTokens !== options.budget.outputTokenHardLimit) {
    throw new Error("BRIEF_CANARY_OUTPUT_LIMIT_MISMATCH");
  }
  if (snapshot.highestScope !== options.experimentalControl.expectedHighestReadScope) {
    throw new Error("BRIEF_CANARY_READ_SCOPE_DRIFT");
  }
  if (
    !sameStrings(
      prepared.request.repositoryReadReceipt.filesRead,
      options.experimentalControl.expectedFilesRead,
    )
  ) {
    throw new Error("BRIEF_CANARY_FILES_READ_DRIFT");
  }
  const repositoryCharactersPassed = prepared.request.untrustedRepositoryContext.reduce(
    (sum, chunk) => sum + chunk.content.length,
    0,
  );
  if (
    repositoryCharactersPassed !==
    options.experimentalControl.expectedRepositoryCharactersPassed
  ) {
    throw new Error("BRIEF_CANARY_CONTEXT_DRIFT");
  }
  const contract = structuredOutputContract(prepared.request.schemaId);
  if (contract === null) {
    throw new Error("BRIEF_CANARY_SCHEMA_CONTRACT_MISSING");
  }
  const promptCharacters = buildStructuredPrompt(prepared.request, contract.schema).length;
  if (promptCharacters !== options.experimentalControl.expectedPromptCharacters) {
    throw new Error("BRIEF_CANARY_PROMPT_DRIFT");
  }
  const preflightCost = calculateOpenAICompatibleCost(
    {
      inputTokens: options.budget.preflightInputTokens,
      outputTokens: options.budget.outputTokenHardLimit,
    },
    options.budget.pricing,
  );
  if (preflightCost.totalCost > options.budget.hardBudgetUsd) {
    throw new Error("BRIEF_CANARY_BUDGET_PREFLIGHT_FAILED");
  }

  const modelResult = await options.provider.generateStructured<BriefNarrative>(
    prepared.request,
  );
  if (modelResult.networkCalls !== 1 || !modelResult.paid) {
    throw new Error("BRIEF_CANARY_REQUEST_COUNT_INVALID");
  }
  if (
    modelResult.context.highestReadScope !== options.experimentalControl.expectedHighestReadScope ||
    !sameStrings(modelResult.context.filesRead, options.experimentalControl.expectedFilesRead) ||
    modelResult.context.repositoryCharactersPassed !== repositoryCharactersPassed ||
    modelResult.context.promptCharacters !== promptCharacters ||
    !modelResult.context.schemaValidated
  ) {
    throw new Error("BRIEF_CANARY_PROVIDER_CONTEXT_DRIFT");
  }
  if (
    modelResult.usage.inputTokens > options.budget.inputTokenHardLimit ||
    modelResult.usage.outputTokens > options.budget.outputTokenHardLimit
  ) {
    throw new Error("BRIEF_CANARY_ACTUAL_TOKEN_LIMIT_EXCEEDED");
  }
  const actualCost = calculateOpenAICompatibleCost(modelResult.usage, options.budget.pricing);
  if (actualCost.totalCost > options.budget.hardBudgetUsd) {
    throw new Error("BRIEF_CANARY_ACTUAL_BUDGET_EXCEEDED");
  }

  const built = buildCanonicalBrief(snapshot, prepared, options.generatedAt);
  const briefQuality = evaluateBriefQualityGate(
    built.brief,
    built.evidence,
    buildSnapshotSummary(snapshot),
    options.schemas,
  );
  const narrativeSemantics = evaluateBriefNarrativeSemantics(
    modelResult.value,
    built.evidence,
  );

  return {
    narrative: modelResult.value,
    canonicalBrief: built.brief,
    evidence: built.evidence,
    briefQuality,
    narrativeSemantics,
    generation: {
      provider: modelResult.provider,
      model: modelResult.model,
      paidRequests: 1,
      httpAttempts: modelResult.networkCalls,
      inputTokens: modelResult.usage.inputTokens,
      outputTokens: modelResult.usage.outputTokens,
      cacheHitInputTokens: modelResult.usage.cacheHitInputTokens ?? null,
      cacheMissInputTokens: modelResult.usage.cacheMissInputTokens ?? null,
      outputTokenLimit: prepared.request.maxOutputTokens,
      actualCostUsd: actualCost.totalCost,
      preflightWorstCaseCostUsd: preflightCost.totalCost,
      highestReadScope: modelResult.context.highestReadScope,
      filesRead: modelResult.context.filesRead,
      filesPassed: modelResult.context.filesPassed,
      repositoryCharactersPassed: modelResult.context.repositoryCharactersPassed,
      promptCharacters: modelResult.context.promptCharacters,
      schemaValidated: modelResult.context.schemaValidated,
      repairActions: modelResult.context.repairActions,
      endpoint: modelResult.context.endpoint,
      truncated: false,
    },
    repositoryExecutions: 0,
  };
}
