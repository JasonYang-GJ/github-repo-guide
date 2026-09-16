import { createHash } from "node:crypto";

import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type { GroundedFactPack } from "../facts/domain.js";
import {
  calculateOpenAICompatibleCost,
  OpenAICompatibleProviderError,
} from "../model/openai-compatible-provider.js";
import {
  buildOpenAICompatibleChatCompletionsRequestBody,
  type OpenAICompatibleChatCompletionsRequestBody,
} from "../model/openai-compatible-request.js";
import type { StructuredGenerationRequest } from "../model/provider.js";
import { QWEN_MAX_BENCHMARK_PROFILE, createQwenMaxNonThinkingProvider } from "../model/qwen-profile.js";
import { buildStructuredPrompt } from "../model/structured-prompt.js";
import { structuredOutputContract } from "../model/structured-output.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import type { ApprovedEditorialStoryV1FromHuman } from "./human-story-approval.js";
import {
  type GroundedScriptContractInput,
  type GroundedScriptDraft,
  type GroundedScriptModelInput,
  type GroundedScriptSegment,
  type GroundedScriptValidationReceipt,
  type ScriptFactPack,
  type ScriptFactReferenceMap,
  validateGroundedScriptDraft,
} from "./grounded-script.js";

export const VS07_E_SCHEMA_ID = "internal:grounded-script-model-draft:1" as const;
export const VS07_E_OUTPUT_TOKEN_HARD_LIMIT = 4_000 as const;
export const VS07_E_INPUT_TOKEN_HARD_LIMIT = 18_000 as const;
export const VS07_E_HARD_BUDGET_USD = 0.05 as const;
export const VS07_E_CONSERVATIVE_CHARACTERS_PER_TOKEN = 3 as const;
export const VS07_E_APPROVED_STORY_ID = "story_abf84e2074b11ede9aff2846" as const;
export const VS07_E_REPOSITORY_COMMIT =
  "c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de" as const;

const EXPECTED_MODEL_FACT_REFS = [
  "fact_001",
  "fact_002",
  "fact_003",
  "fact_004",
  "fact_005",
] as const;

export interface GroundedScriptModelDraftPayload {
  readonly script_version: 1;
  readonly status: "GENERATED";
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: 2;
  readonly approved_angle_ref: string;
  readonly language: "zh-CN";
  readonly target_duration_seconds: { readonly min: 60; readonly max: 90 };
  readonly segments: readonly GroundedScriptSegment[];
}

export interface PreparedRealGroundedScriptCanary {
  readonly canary_version: 1;
  readonly status: "READY" | "BUDGET_PREFLIGHT_BLOCKED";
  readonly execution_baseline_sha: string;
  readonly approved_story_id: string;
  readonly approved_story_fingerprint_sha256: string;
  readonly contract: GroundedScriptContractInput;
  readonly model_input: GroundedScriptModelInput;
  readonly structured_request: StructuredGenerationRequest;
  readonly request_preview: OpenAICompatibleChatCompletionsRequestBody;
  readonly request_body_sha256: string;
  readonly model_input_fingerprint_sha256: string;
  readonly budget: {
    readonly status: "PASS" | "BLOCKED";
    readonly hard_budget_usd: 0.05;
    readonly input_usd_per_million: number;
    readonly output_usd_per_million: number;
    readonly request_body_characters: number;
    readonly conservative_input_token_ceiling: number;
    readonly output_token_ceiling: 4000;
    readonly worst_case_cost_usd: number;
    readonly pricing_basis: string;
    readonly pricing_sources: readonly string[];
  };
}

export interface ApprovedStoryFidelityReceipt {
  readonly approved_story_fidelity_version: 1;
  readonly status: "PASS" | "PARTIAL" | "FAIL";
  readonly findings: readonly string[];
  readonly core_fact_refs_expected: readonly string[];
  readonly core_fact_refs_used: readonly string[];
  readonly human_editorial_takeaway_present: boolean;
  readonly prohibited_story_drift_present: boolean;
}

export interface RealGroundedScriptQualityReview {
  readonly script_quality_review_version: 1;
  readonly basis: "OFFLINE_HUMAN_STYLE_REVIEW_NOT_TRUTH";
  readonly truth_gate_status: "PASS" | "FAIL";
  readonly story_fidelity: "PASS" | "PARTIAL" | "FAIL";
  readonly hook_quality: "HIGH" | "MEDIUM" | "LOW" | "NOT_EVALUATED";
  readonly clarity: "PASS" | "PARTIAL" | "FAIL" | "NOT_EVALUATED";
  readonly narrative_coherence: "PASS" | "PARTIAL" | "FAIL" | "NOT_EVALUATED";
  readonly spoken_naturalness: "HIGH" | "MEDIUM" | "LOW" | "NOT_EVALUATED";
  readonly technical_density: "HIGH" | "MEDIUM" | "LOW" | "NOT_EVALUATED";
  readonly developer_relevance: "HIGH" | "MEDIUM" | "LOW" | "NOT_EVALUATED";
  readonly caveat_handling: "PASS" | "PARTIAL" | "FAIL" | "NOT_EVALUATED";
  readonly would_publish_after_light_editing: "YES" | "MAYBE" | "NO";
}

export interface ValidatedRealGroundedScript {
  readonly draft: GroundedScriptDraft;
  readonly validation: GroundedScriptValidationReceipt;
  readonly story_fidelity: ApprovedStoryFidelityReceipt;
  readonly quality: RealGroundedScriptQualityReview;
  readonly canary_verdict:
    | "GROUNDED_SCRIPT_CANARY_PASS"
    | "GROUNDED_SCRIPT_CANARY_PARTIAL"
    | "GROUNDED_SCRIPT_CANARY_FAIL";
}

interface GenerationIdentity {
  readonly provider: "dashscope";
  readonly model: "qwen3.8-max";
  readonly input_tokens: number;
  readonly output_tokens: number;
}

export type RealGroundedScriptCanaryResult =
  | ({
      readonly status: "COMPLETED";
      readonly raw_output: string;
      readonly generation: {
        readonly provider: "dashscope";
        readonly model: "qwen3.8-max";
        readonly mode: "NON_THINKING";
        readonly enable_thinking: false;
        readonly paid_requests: 1;
        readonly http_attempts: 1;
        readonly retries: 0;
        readonly resampling: 0;
        readonly fallbacks: 0;
        readonly input_tokens: number;
        readonly output_tokens: number;
        readonly finish_reason: string | null;
        readonly truncated: false;
        readonly duration_ms: number;
        readonly actual_cost_usd: number;
        readonly secret_reads: 1;
        readonly secret_exposure: 0;
        readonly repository_executions: 0;
        readonly request_body_sha256: string;
      };
    } & ValidatedRealGroundedScript)
  | {
      readonly status: "FAIL_CLOSED";
      readonly raw_output: string;
      readonly failure: {
        readonly failure_code: string;
        readonly paid_requests: 0 | 1;
        readonly http_attempts: 0 | 1;
        readonly retries: 0;
        readonly resampling: 0;
        readonly fallbacks: 0;
        readonly input_tokens: number | null;
        readonly output_tokens: number | null;
        readonly finish_reason: string | null;
        readonly truncated: boolean | null;
        readonly duration_ms: number;
        readonly actual_cost_usd: number | null;
        readonly secret_reads: 1;
        readonly secret_exposure: 0;
        readonly repository_executions: 0;
      };
    };

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex");
}

function sameRepository(
  left: GroundedFactPack["repository"],
  right: GroundedFactPack["repository"],
): boolean {
  return left.url === right.url && left.owner === right.owner && left.name === right.name;
}

function money(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function assertFrozenStoryAndFactPack(args: {
  readonly story: ApprovedEditorialStoryV1FromHuman;
  readonly scriptFactPack: ScriptFactPack;
  readonly referenceMap: ScriptFactReferenceMap;
}): void {
  const { story, scriptFactPack, referenceMap } = args;
  if (
    story.story_id !== VS07_E_APPROVED_STORY_ID ||
    story.source !== "HUMAN_COMPOSITION" ||
    story.source_kind !== "HUMAN_COMPOSITION" ||
    story.status !== "CURRENT" ||
    story.commit !== VS07_E_REPOSITORY_COMMIT ||
    story.fact_ir_version !== 2 ||
    story.host_semantics_version !== 3 ||
    story.host_validation.status !== "PASS" ||
    !story.approval_provenance.human_confirmed ||
    !story.script_eligibility.contract_eligible
  ) {
    throw new Error("VS07_E_APPROVED_STORY_NOT_CURRENT_OR_ELIGIBLE");
  }
  if (
    !sameRepository(story.repository, scriptFactPack.repository) ||
    story.commit !== scriptFactPack.commit ||
    story.fact_ir_version !== scriptFactPack.fact_ir_version ||
    story.story_id !== scriptFactPack.approved_angle_ref ||
    story.story_fingerprint_sha256 !== scriptFactPack.approved_angle_fingerprint_sha256 ||
    scriptFactPack.context_facts.length !== 0 ||
    scriptFactPack.known_unknowns.length !== 3 ||
    scriptFactPack.core_facts.length !== EXPECTED_MODEL_FACT_REFS.length ||
    JSON.stringify(scriptFactPack.core_facts.map((fact) => fact.model_fact_ref)) !==
      JSON.stringify(EXPECTED_MODEL_FACT_REFS)
  ) {
    throw new Error("VS07_E_SCRIPT_FACT_PACK_DRIFT");
  }
  if (
    !sameRepository(referenceMap.repository, story.repository) ||
    referenceMap.commit !== story.commit ||
    referenceMap.fact_ir_version !== 2 ||
    referenceMap.entries.length !== EXPECTED_MODEL_FACT_REFS.length ||
    referenceMap.entries.some(
      (entry, index) =>
        entry.model_fact_ref !== EXPECTED_MODEL_FACT_REFS[index] ||
        entry.role !== "CORE_FACT" ||
        entry.canonical_fact_id !== story.supporting_fact_ids[index] ||
        entry.commit !== story.commit ||
        entry.fact_ir_version !== 2 ||
        !sameRepository(entry.repository, story.repository),
    )
  ) {
    throw new Error("VS07_E_SCRIPT_REFERENCE_MAP_DRIFT");
  }
}

const SCRIPT_INSTRUCTIONS = [
  "You are performing Grounded Generative Expression only. Do not discover Facts, Angles, Stories, or Truth.",
  "Write one natural spoken Chinese technical script for developers and Vibe Coding users. Target 60-90 seconds.",
  "The ApprovedEditorialStory is read-only and is the highest editorial authority. Preserve its title direction, thesis, takeaway, and caveats.",
  "Use all five core Facts exactly as supplied. Do not invent or add Facts. Context Facts are empty and must remain empty.",
  "Each TECHNICAL_FACT segment must express exactly one Fact and cite exactly one matching fact_### in supporting_fact_refs.",
  "Never put fact_###, gap_* IDs, Canonical Fact IDs, or evidence IDs into spoken text.",
  "CALLS means one direct static call expression. It does not prove runtime execution, order, data flow, frequency, outcome, or transitive calls.",
  "THROWS_WHEN means an authored local throw branch exists. It does not prove the condition occurs at runtime or covers every runtime path.",
  "Preserve all three known unknowns in concise CAVEAT metadata and natural spoken caveat wording.",
  "Do not claim security, SSRF prevention, attack prevention, correctness, reliability, performance, author design intent, novelty, exclusivity, or guarantees.",
  "Do not generalize about most developers, most AI agents, industry trends, other projects, or best-practice statistics.",
  "Symbol names do not prove behavior beyond the supplied Fact tuple.",
  "Editorial framing may say that AI writing a happy path does not mean the work is complete and that failure paths and boundaries deserve inspection.",
  "Do not turn the story into an SSRF tutorial, security analysis, architecture overview, renderer pipeline, or performance discussion.",
  "Return one GroundedScriptDraft v1 JSON object matching the schema. No Markdown and no commentary.",
].join("\n");

export function buildRealGroundedScriptCanaryPreflight(args: {
  readonly story: ApprovedEditorialStoryV1FromHuman;
  readonly scriptFactPack: ScriptFactPack;
  readonly referenceMap: ScriptFactReferenceMap;
  readonly executionBaselineSha: string;
}): PreparedRealGroundedScriptCanary {
  assertFrozenStoryAndFactPack(args);
  if (!/^[0-9a-f]{40}$/.test(args.executionBaselineSha)) {
    throw new Error("VS07_E_EXECUTION_BASELINE_INVALID");
  }
  const modelInput: GroundedScriptModelInput = {
    script_input_version: 1,
    repository: { ...args.story.repository },
    commit: args.story.commit,
    fact_ir_version: 2,
    approved_angle: {
      approved_angle_ref: args.story.story_id,
      title: args.story.title,
      editorial_thesis: `${args.story.editorial_thesis}\n\n${args.story.why_this_story}`,
      source_kind: "HUMAN_COMPOSITION",
      human_confirmed: true,
      known_caveats: [...args.story.known_caveats],
    },
    script_fact_pack: args.scriptFactPack,
    style_profile: {
      script_style_profile_version: 1,
      language: "zh-CN",
      audience: "TECHNICAL_CREATOR",
      tone: "CLEAR_TECHNICAL",
      sentence_length: "SHORT_TO_MEDIUM",
      verbosity: "CONCISE",
      spoken_rhythm: "NATURAL",
      target_duration_seconds: { min: 60, max: 90 },
      speech_rate: { unit: "CHARACTERS_PER_SECOND", value: 4 },
      truth_authority: "NONE",
    },
    output_contract: {
      schema: "GroundedScriptDraft v1",
      structured_output_only: true,
      approved_angle_read_only: true,
      fact_discovery_forbidden: true,
      analogy_forbidden: true,
    },
    authorization: {
      mode: "REAL_SCRIPT_CANARY",
      real_model_authorized: true,
      authorization_id: "VS07-E",
      max_paid_requests: 1,
      max_http_attempts: 1,
      retries: 0,
      resampling: 0,
      fallbacks: 0,
    },
  };
  const modelInputFingerprint = sha256(modelInput);
  const contract: GroundedScriptContractInput = {
    eligibility: {
      script_eligibility_version: 1,
      status: "ELIGIBLE",
      reason: "CURRENT_HOST_VALIDATED_HUMAN_CONFIRMED_STORY",
      fixture_only: false,
      real_model_authorized: true,
    },
    script_fact_pack: args.scriptFactPack,
    reference_map: args.referenceMap,
    model_input: modelInput,
    input_fingerprint_sha256: modelInputFingerprint,
  };
  const structuredRequest: StructuredGenerationRequest = {
    stage: "content",
    schemaId: VS07_E_SCHEMA_ID,
    systemInstructions: SCRIPT_INSTRUCTIONS,
    untrustedRepositoryContext: [],
    untrustedRepositorySignals: modelInput as unknown as Readonly<Record<string, unknown>>,
    signalSerialization: "compact",
    repositoryReadReceipt: {
      highestScope: 0,
      filesConsidered: [],
      filesRead: [],
    },
    maxOutputTokens: VS07_E_OUTPUT_TOKEN_HARD_LIMIT,
    cacheKey: `vs07-e:${modelInputFingerprint}`,
  };
  const outputContract = structuredOutputContract(structuredRequest.schemaId);
  if (outputContract === null) throw new Error("VS07_E_STRUCTURED_OUTPUT_CONTRACT_MISSING");
  const prompt = buildStructuredPrompt(structuredRequest, outputContract.schema);
  const requestPreview = buildOpenAICompatibleChatCompletionsRequestBody({
    model: QWEN_MAX_BENCHMARK_PROFILE.model,
    enableThinking: false,
    prompt,
    maxOutputTokens: VS07_E_OUTPUT_TOKEN_HARD_LIMIT,
  });
  const requestBody = JSON.stringify(requestPreview);
  const conservativeInputCeiling = Math.ceil(
    requestBody.length / VS07_E_CONSERVATIVE_CHARACTERS_PER_TOKEN,
  );
  if (conservativeInputCeiling > VS07_E_INPUT_TOKEN_HARD_LIMIT) {
    throw new Error("VS07_E_INPUT_TOKEN_HARD_LIMIT_EXCEEDED");
  }
  const worstCaseCost = money(
    (conservativeInputCeiling * QWEN_MAX_BENCHMARK_PROFILE.inputUsdPerMillion +
      VS07_E_OUTPUT_TOKEN_HARD_LIMIT * QWEN_MAX_BENCHMARK_PROFILE.outputUsdPerMillion) /
      1_000_000,
  );
  const budgetStatus = worstCaseCost <= VS07_E_HARD_BUDGET_USD ? "PASS" : "BLOCKED";
  return {
    canary_version: 1,
    status: budgetStatus === "PASS" ? "READY" : "BUDGET_PREFLIGHT_BLOCKED",
    execution_baseline_sha: args.executionBaselineSha,
    approved_story_id: args.story.story_id,
    approved_story_fingerprint_sha256: args.story.story_fingerprint_sha256,
    contract,
    model_input: modelInput,
    structured_request: structuredRequest,
    request_preview: requestPreview,
    request_body_sha256: sha256(JSON.parse(requestBody)),
    model_input_fingerprint_sha256: modelInputFingerprint,
    budget: {
      status: budgetStatus,
      hard_budget_usd: VS07_E_HARD_BUDGET_USD,
      input_usd_per_million: QWEN_MAX_BENCHMARK_PROFILE.inputUsdPerMillion,
      output_usd_per_million: QWEN_MAX_BENCHMARK_PROFILE.outputUsdPerMillion,
      request_body_characters: requestBody.length,
      conservative_input_token_ceiling: conservativeInputCeiling,
      output_token_ceiling: VS07_E_OUTPUT_TOKEN_HARD_LIMIT,
      worst_case_cost_usd: worstCaseCost,
      pricing_basis: "china-beijing-official-2026-09-03",
      pricing_sources: [
        "https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max",
        "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      ],
    },
  };
}

function storyFidelity(
  draft: GroundedScriptDraft,
  preflight: PreparedRealGroundedScriptCanary,
): ApprovedStoryFidelityReceipt {
  const technicalRefs = [
    ...new Set(
      draft.segments
        .filter((segment) => segment.statement_kind === "TECHNICAL_FACT")
        .flatMap((segment) => segment.supporting_fact_refs),
    ),
  ].sort();
  const spoken = draft.segments.map((segment) => segment.text).join("\n");
  const nonCaveat = draft.segments
    .filter((segment) => segment.statement_kind !== "CAVEAT")
    .map((segment) => segment.text)
    .join("\n");
  const findings: string[] = [];
  if (JSON.stringify(technicalRefs) !== JSON.stringify([...EXPECTED_MODEL_FACT_REFS])) {
    findings.push("APPROVED_STORY_CORE_FACT_COVERAGE_INCOMPLETE");
  }
  const titleDirection = /请求/.test(spoken) && /失败|边界/.test(spoken);
  const takeaway =
    /AI/i.test(spoken) &&
    /成功路径|happy\s*path/i.test(spoken) &&
    /失败路径|边界条件/.test(spoken) &&
    /检查|核对|审视/.test(spoken);
  if (!titleDirection) findings.push("APPROVED_STORY_TITLE_DIRECTION_MISSING");
  if (!takeaway) findings.push("APPROVED_STORY_EDITORIAL_TAKEAWAY_MISSING");
  const prohibitedDrift =
    /SSRF|恶意\s*URL|防住攻击|防止攻击|安全教程|架构总览|Renderer\s*Pipeline|性能优化|行业趋势|大多数(?:开发者|AI)|最常见(?:问题|漏洞)/i.test(
      nonCaveat,
    );
  if (prohibitedDrift) findings.push("SCRIPT_STORY_DRIFT");
  const status = prohibitedDrift
    ? "FAIL"
    : findings.length === 0
      ? "PASS"
      : technicalRefs.length === EXPECTED_MODEL_FACT_REFS.length
        ? "PARTIAL"
        : "FAIL";
  return {
    approved_story_fidelity_version: 1,
    status,
    findings,
    core_fact_refs_expected: [...EXPECTED_MODEL_FACT_REFS],
    core_fact_refs_used: technicalRefs,
    human_editorial_takeaway_present: takeaway,
    prohibited_story_drift_present: prohibitedDrift,
  };
}

function additionalTruthFindings(
  draft: GroundedScriptDraft,
  preflight: PreparedRealGroundedScriptCanary,
  fidelity: ApprovedStoryFidelityReceipt,
): GroundedScriptValidationReceipt["findings"] {
  const findings: GroundedScriptValidationReceipt["findings"][number][] = [];
  const spoken = draft.segments.map((segment) => segment.text).join("\n");
  if (/fact_\d{3}|gap_[a-z0-9_]+|fact_(?:call|branch)_/i.test(spoken)) {
    findings.push({
      code: "MODEL_REFERENCE_IN_SPOKEN_TEXT",
      segment_id: null,
      details: "Model, gap, and Canonical Fact references are metadata, not spoken prose.",
    });
  }
  if (draft.segments.some((segment) => segment.context_fact_refs.length > 0)) {
    findings.push({
      code: "SCRIPT_CONTEXT_FACT_LEAKAGE",
      segment_id: null,
      details: "The frozen VS07-E Script Fact Pack contains zero Context Facts.",
    });
  }
  const caveatUnknownRefs = new Set(
    draft.segments
      .filter((segment) => segment.statement_kind === "CAVEAT")
      .flatMap((segment) => segment.known_unknown_refs),
  );
  const expectedUnknownRefs = preflight.model_input.script_fact_pack.known_unknowns.map(
    (unknown) => unknown.unknown_ref,
  );
  if (expectedUnknownRefs.some((reference) => !caveatUnknownRefs.has(reference))) {
    findings.push({
      code: "KNOWN_UNKNOWN_COVERAGE_INCOMPLETE",
      segment_id: null,
      details: "Every frozen Known Unknown must remain represented in CAVEAT metadata.",
    });
  }
  for (const segment of draft.segments) {
    const boundaryCaveat =
      segment.statement_kind === "CAVEAT" &&
      /不证明|不能证明|无法证明|不代表|并不意味着|未证明|没有被证明|\b(?:does not|cannot|not)\s+(?:prove|establish|guarantee)\b/i.test(
        segment.text,
      ) &&
      !/(?:但是|但|却|然而)[^。！？!?]*(?:保证|确保|证明|安全|可靠|正确)|\b(?:but|however)\b[^.!?;]*(?:guarantees?|ensures?|safe|secure)/i.test(
        segment.text,
      );
    const positiveSafetyOrGuarantee =
      /(?:保证|确保|证明)[^。！？!?]*(?:安全|可靠|正确)|(?:防住|防止|阻止)[^。！？!?]*(?:攻击|恶意|SSRF)|\b(?:guarantees?|ensures?|prevents?)\b[^.!?;]*(?:safe|secure|reliable|correct)/i.test(
        segment.text,
      );
    const designIntent =
      /作者[^。！？!?]*(?:意图|为了|旨在|想要)|设计(?:目的|哲学)|\b(?:author intent|designed to|intended to)\b/i.test(
        segment.text,
      );
    const externalGeneralization =
      /行业|大多数(?:开发者|项目|AI)|多数(?:开发者|项目|AI)|其他项目|相比于|普遍(?:都会|存在)|\b(?:industry|most developers|most ai|other projects|compared with)\b/i.test(
        segment.text,
      );
    const universalRuntime =
      /所有运行路径都会|每次运行都会|必然执行|一定执行|保证顺序|\b(?:all runtime paths|always executes?|guaranteed order)\b/i.test(
        segment.text,
      );
    if (positiveSafetyOrGuarantee && !boundaryCaveat) {
      findings.push({
        code: "SAFETY_OUTCOME_UNSUPPORTED",
        segment_id: segment.segment_id,
        details: "The Script Fact Pack does not support a safety, correctness, or reliability guarantee.",
      });
    }
    if (designIntent && !boundaryCaveat) {
      findings.push({
        code: "DESIGN_INTENT_UNSUPPORTED",
        segment_id: segment.segment_id,
        details: "Author design intent is not established by the selected Facts.",
      });
    }
    if (externalGeneralization && !boundaryCaveat) {
      findings.push({
        code: "EXTERNAL_GENERALIZATION_UNSUPPORTED",
        segment_id: segment.segment_id,
        details: "VS07-E has no external research layer.",
      });
    }
    if (universalRuntime && !boundaryCaveat) {
      findings.push({
        code: "UNIVERSAL_RUNTIME_CLAIM_UNSUPPORTED",
        segment_id: segment.segment_id,
        details: "Static local Facts do not establish universal runtime execution or order.",
      });
    }
  }
  if (fidelity.status === "FAIL") {
    findings.push({
      code: "SCRIPT_STORY_DRIFT",
      segment_id: null,
      details: "The Script no longer faithfully expresses the Human-confirmed ApprovedEditorialStory.",
    });
  }
  return findings;
}

function evaluateQuality(
  draft: GroundedScriptDraft,
  validation: GroundedScriptValidationReceipt,
  fidelity: ApprovedStoryFidelityReceipt,
): RealGroundedScriptQualityReview {
  if (validation.truth_gate !== "PASS") {
    return {
      script_quality_review_version: 1,
      basis: "OFFLINE_HUMAN_STYLE_REVIEW_NOT_TRUTH",
      truth_gate_status: "FAIL",
      story_fidelity: fidelity.status,
      hook_quality: "NOT_EVALUATED",
      clarity: "NOT_EVALUATED",
      narrative_coherence: "NOT_EVALUATED",
      spoken_naturalness: "NOT_EVALUATED",
      technical_density: "NOT_EVALUATED",
      developer_relevance: "NOT_EVALUATED",
      caveat_handling: "NOT_EVALUATED",
      would_publish_after_light_editing: "NO",
    };
  }
  const spoken = draft.segments.map((segment) => segment.text).join("\n");
  const hook = draft.segments.find((segment) => segment.role === "HOOK")?.text ?? "";
  const roles = new Set(draft.segments.map((segment) => segment.role));
  const technicalCount = draft.segments.filter(
    (segment) => segment.statement_kind === "TECHNICAL_FACT",
  ).length;
  const hookQuality =
    hook.length >= 18 && hook.length <= 80 && /[？?]/.test(hook) && /失败|边界/.test(hook)
      ? "HIGH"
      : hook.length >= 10 && hook.length <= 100
        ? "MEDIUM"
        : "LOW";
  const clarity = draft.segments.every((segment) => segment.text.length <= 180)
    ? "PASS"
    : draft.segments.every((segment) => segment.text.length <= 260)
      ? "PARTIAL"
      : "FAIL";
  const narrativeCoherence =
    roles.has("HOOK") &&
    roles.has("SETUP") &&
    roles.has("TECHNICAL_EXPLANATION") &&
    roles.has("CAVEAT") &&
    roles.has("CLOSE")
      ? "PASS"
      : roles.has("HOOK") && roles.has("TECHNICAL_EXPLANATION")
        ? "PARTIAL"
        : "FAIL";
  const legaleseCount = spoken.match(/静态分析|当前证据|不能证明|不证明/g)?.length ?? 0;
  const spokenNaturalness =
    !/^(?:#{1,6}|[-*]\s|\d+\.\s)/m.test(spoken) && legaleseCount <= 3
      ? "HIGH"
      : legaleseCount <= 6
        ? "MEDIUM"
        : "LOW";
  const technicalDensity = technicalCount >= 4 && technicalCount <= 6 ? "HIGH" : "MEDIUM";
  const developerRelevance =
    /开发者/.test(spoken) && /Vibe\s*Coding/i.test(spoken) && /AI/i.test(spoken)
      ? "HIGH"
      : /开发者|Vibe\s*Coding/i.test(spoken)
        ? "MEDIUM"
        : "LOW";
  const caveatSegments = draft.segments.filter((segment) => segment.role === "CAVEAT");
  const caveatHandling =
    caveatSegments.length === 1 &&
    caveatSegments[0]!.known_unknown_refs.length ===
      new Set(caveatSegments[0]!.known_unknown_refs).size &&
    caveatSegments[0]!.known_unknown_refs.length === 3
      ? "PASS"
      : caveatSegments.length > 0
        ? "PARTIAL"
        : "FAIL";
  const wouldPublish =
    fidelity.status === "PASS" &&
    hookQuality !== "LOW" &&
    clarity === "PASS" &&
    narrativeCoherence === "PASS" &&
    spokenNaturalness !== "LOW" &&
    developerRelevance !== "LOW" &&
    caveatHandling === "PASS" &&
    validation.duration_estimate.range_result !== "OUT_OF_RANGE"
      ? "YES"
      : fidelity.status !== "FAIL" && spokenNaturalness !== "LOW"
        ? "MAYBE"
        : "NO";
  return {
    script_quality_review_version: 1,
    basis: "OFFLINE_HUMAN_STYLE_REVIEW_NOT_TRUTH",
    truth_gate_status: "PASS",
    story_fidelity: fidelity.status,
    hook_quality: hookQuality,
    clarity,
    narrative_coherence: narrativeCoherence,
    spoken_naturalness: spokenNaturalness,
    technical_density: technicalDensity,
    developer_relevance: developerRelevance,
    caveat_handling: caveatHandling,
    would_publish_after_light_editing: wouldPublish,
  };
}

export function validateRealGroundedScriptDraft(args: {
  readonly modelDraft: GroundedScriptModelDraftPayload;
  readonly preflight: PreparedRealGroundedScriptCanary;
  readonly factPack: GroundedFactPack;
  readonly canonical: CanonicalGroundedBriefArtifact;
  readonly schemas: SchemaRegistry;
  readonly generation: GenerationIdentity;
}): ValidatedRealGroundedScript {
  const draft: GroundedScriptDraft = {
    ...args.modelDraft,
    generation_metadata: {
      mode: "real_model_canary",
      provider: "dashscope",
      model: "qwen3.8-max",
      paid_api_requests: 1,
      real_model_requests: 1,
      secret_reads: 1,
      repository_executions: 0,
    },
  };
  args.schemas.assert("GroundedScriptDraft", draft);
  const base = validateGroundedScriptDraft({
    draft,
    contract: args.preflight.contract,
    factPack: args.factPack,
    canonical: args.canonical,
  });
  const fidelity = storyFidelity(draft, args.preflight);
  const extra = additionalTruthFindings(draft, args.preflight, fidelity);
  const uniqueFindings = [
    ...new Map(
      [...base.findings, ...extra].map((finding) => [
        `${finding.code}:${finding.segment_id ?? ""}:${finding.details}`,
        finding,
      ]),
    ).values(),
  ];
  const passed = uniqueFindings.length === 0;
  const validation: GroundedScriptValidationReceipt = {
    ...base,
    status: passed ? "PASS" : "FAIL",
    decision: passed ? "HOST_VALIDATED" : "HOST_REJECTED",
    truth_gate: passed ? "PASS" : "FAIL",
    findings: uniqueFindings,
  };
  const quality = evaluateQuality(draft, validation, fidelity);
  const canaryVerdict =
    validation.truth_gate !== "PASS" || fidelity.status === "FAIL"
      ? "GROUNDED_SCRIPT_CANARY_FAIL"
      : fidelity.status === "PASS" &&
          quality.spoken_naturalness !== "LOW" &&
          quality.spoken_naturalness !== "NOT_EVALUATED" &&
          quality.would_publish_after_light_editing === "YES"
        ? "GROUNDED_SCRIPT_CANARY_PASS"
        : "GROUNDED_SCRIPT_CANARY_PARTIAL";
  return {
    draft,
    validation,
    story_fidelity: fidelity,
    quality,
    canary_verdict: canaryVerdict,
  };
}

export async function executeRealGroundedScriptCanary(input: {
  readonly preflight: PreparedRealGroundedScriptCanary;
  readonly factPack: GroundedFactPack;
  readonly canonical: CanonicalGroundedBriefArtifact;
  readonly schemas: SchemaRegistry;
  readonly readSecret: (name: "DASHSCOPE_API_KEY") => string | undefined;
  readonly fetch: typeof fetch;
  readonly now?: () => number;
}): Promise<RealGroundedScriptCanaryResult> {
  if (input.preflight.status !== "READY" || input.preflight.budget.status !== "PASS") {
    throw new Error("BUDGET_PREFLIGHT_BLOCKED");
  }
  const now = input.now ?? Date.now;
  const startedAt = now();
  const secret = input.readSecret("DASHSCOPE_API_KEY");
  if (secret === undefined || secret.length === 0) {
    return {
      status: "FAIL_CLOSED",
      raw_output: "",
      failure: {
        failure_code: "DASHSCOPE_API_KEY_NOT_CONFIGURED",
        paid_requests: 0,
        http_attempts: 0,
        retries: 0,
        resampling: 0,
        fallbacks: 0,
        input_tokens: null,
        output_tokens: null,
        finish_reason: null,
        truncated: null,
        duration_ms: now() - startedAt,
        actual_cost_usd: null,
        secret_reads: 1,
        secret_exposure: 0,
        repository_executions: 0,
      },
    };
  }
  let forwardingCalls = 0;
  let capturedRawOutput = "";
  const expectedBody = JSON.stringify(input.preflight.request_preview);
  const auditedFetch: typeof fetch = async (url, init) => {
    if (forwardingCalls >= 1) throw new Error("VS07_E_SECOND_HTTP_ATTEMPT_FORBIDDEN");
    if (
      String(url) !==
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" ||
      String(init?.body) !== expectedBody ||
      sha256(JSON.parse(String(init?.body))) !== input.preflight.request_body_sha256
    ) {
      throw new Error("VS07_E_ACTUAL_REQUEST_DRIFT");
    }
    forwardingCalls += 1;
    const response = await input.fetch(url, init);
    try {
      const envelope = (await response.clone().json()) as {
        choices?: readonly { message?: { content?: unknown } }[];
      };
      const content = envelope.choices?.[0]?.message?.content;
      if (typeof content === "string") capturedRawOutput = content;
    } catch {
      // The Provider owns envelope validation. This clone only preserves raw model text.
    }
    return response;
  };
  try {
    const provider = createQwenMaxNonThinkingProvider({
      environment: { DASHSCOPE_API_KEY: secret },
      fetch: auditedFetch,
    });
    const modelResult = await provider.generateStructured<GroundedScriptModelDraftPayload>(
      input.preflight.structured_request,
    );
    if (
      modelResult.provider !== "dashscope" ||
      modelResult.model !== "qwen3.8-max" ||
      modelResult.requestConfiguration?.thinking !== "disabled" ||
      modelResult.networkCalls !== 1 ||
      forwardingCalls !== 1 ||
      modelResult.usage.inputTokens > VS07_E_INPUT_TOKEN_HARD_LIMIT ||
      modelResult.usage.outputTokens > VS07_E_OUTPUT_TOKEN_HARD_LIMIT
    ) {
      throw new Error("VS07_E_EXECUTION_IDENTITY_OR_CEILING_VIOLATION");
    }
    const cost = calculateOpenAICompatibleCost(modelResult.usage, provider.pricing);
    if (cost.totalCost > VS07_E_HARD_BUDGET_USD) {
      throw new Error("VS07_E_ACTUAL_BUDGET_EXCEEDED");
    }
    const validated = validateRealGroundedScriptDraft({
      modelDraft: modelResult.value,
      preflight: input.preflight,
      factPack: input.factPack,
      canonical: input.canonical,
      schemas: input.schemas,
      generation: {
        provider: "dashscope",
        model: "qwen3.8-max",
        input_tokens: modelResult.usage.inputTokens,
        output_tokens: modelResult.usage.outputTokens,
      },
    });
    return {
      status: "COMPLETED",
      raw_output: modelResult.rawOutput ?? capturedRawOutput,
      ...validated,
      generation: {
        provider: "dashscope",
        model: "qwen3.8-max",
        mode: "NON_THINKING",
        enable_thinking: false,
        paid_requests: 1,
        http_attempts: 1,
        retries: 0,
        resampling: 0,
        fallbacks: 0,
        input_tokens: modelResult.usage.inputTokens,
        output_tokens: modelResult.usage.outputTokens,
        finish_reason: modelResult.finishReason ?? null,
        truncated: false,
        duration_ms: now() - startedAt,
        actual_cost_usd: cost.totalCost,
        secret_reads: 1,
        secret_exposure: 0,
        repository_executions: 0,
        request_body_sha256: input.preflight.request_body_sha256,
      },
    };
  } catch (error) {
    const providerError = error instanceof OpenAICompatibleProviderError ? error : null;
    const usage = providerError?.telemetry?.usage;
    const actualCost =
      usage === undefined
        ? null
        : calculateOpenAICompatibleCost(usage, {
            currency: "USD",
            inputCacheHitUsdPerMillion: QWEN_MAX_BENCHMARK_PROFILE.inputUsdPerMillion,
            inputCacheMissUsdPerMillion: QWEN_MAX_BENCHMARK_PROFILE.inputUsdPerMillion,
            outputUsdPerMillion: QWEN_MAX_BENCHMARK_PROFILE.outputUsdPerMillion,
          }).totalCost;
    return {
      status: "FAIL_CLOSED",
      raw_output: capturedRawOutput,
      failure: {
        failure_code:
          providerError?.code ??
          (error instanceof Error ? error.message : "VS07_E_UNKNOWN_FAILURE"),
        paid_requests: forwardingCalls === 0 ? 0 : 1,
        http_attempts: forwardingCalls === 0 ? 0 : 1,
        retries: 0,
        resampling: 0,
        fallbacks: 0,
        input_tokens: usage?.inputTokens ?? null,
        output_tokens: usage?.outputTokens ?? null,
        finish_reason: providerError?.telemetry?.finishReason ?? null,
        truncated:
          providerError?.code === "TRUNCATED_OUTPUT"
            ? true
            : providerError?.telemetry?.finishReason === "stop"
              ? false
              : null,
        duration_ms: now() - startedAt,
        actual_cost_usd: actualCost,
        secret_reads: 1,
        secret_exposure: 0,
        repository_executions: 0,
      },
    };
  }
}

function inline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function renderRealGroundedScriptPreview(
  result: Extract<RealGroundedScriptCanaryResult, { status: "COMPLETED" }>,
  preflight: PreparedRealGroundedScriptCanary,
): string {
  const spoken = result.draft.segments.map((segment) => inline(segment.text)).join("\n\n");
  const technicalClauses = result.validation.clause_trace.filter(
    (clause) => clause.statement_kind === "TECHNICAL_FACT",
  );
  const traced = technicalClauses.filter((clause) => clause.status === "FACT_TRACED").length;
  const lines = [
    "# Final Spoken Draft",
    "",
    `## ${inline(preflight.model_input.approved_angle.title)}`,
    "",
    spoken,
    "",
    "## Validation",
    "",
    `Estimated Duration: **${result.validation.duration_estimate.estimated_seconds}s (ESTIMATE)**`,
    "Target Duration: **60–90s**",
    `Grounded: **${result.validation.truth_gate === "PASS" ? "YES" : "NO"}**`,
    `Story Fidelity: **${result.story_fidelity.status}**`,
    `Canary Verdict: **${result.canary_verdict}**`,
    `Grounded Facts: **${result.story_fidelity.core_fact_refs_used.length}/5**`,
    `Technical Trace: **${traced}/${technicalClauses.length}**`,
    `Unsupported Clauses: **${result.validation.findings.length}**`,
    "Human Final Review Required: **YES**",
    "Automatic Approval: **NO**",
    "Automatic Publish: **NO**",
    "",
    "## Quality Review",
    "",
    `Hook Quality: **${result.quality.hook_quality}**`,
    `Clarity: **${result.quality.clarity}**`,
    `Narrative Coherence: **${result.quality.narrative_coherence}**`,
    `Spoken Naturalness: **${result.quality.spoken_naturalness}**`,
    `Technical Density: **${result.quality.technical_density}**`,
    `Developer Relevance: **${result.quality.developer_relevance}**`,
    `Caveat Handling: **${result.quality.caveat_handling}**`,
    `Would Publish After Light Editing: **${result.quality.would_publish_after_light_editing}**`,
    "",
    "## Evidence / Fact Trace",
    "",
    "<details>",
    "<summary>Show bounded technical trace</summary>",
    "",
  ];
  for (const clause of result.validation.clause_trace) {
    lines.push(
      `- ${clause.segment_id}.${clause.clause_index}: ${clause.status}`,
      `  - Spoken clause: ${inline(clause.text)}`,
      `  - Model Fact refs: ${clause.supporting_fact_refs.join(", ") || "None"}`,
      `  - Evidence: ${clause.evidence_ids.length > 0 ? "Available" : "Not attached"}`,
    );
  }
  if (result.validation.findings.length > 0) {
    lines.push("", "### Rejected Clauses / Findings", "");
    for (const finding of result.validation.findings) {
      lines.push(`- ${finding.code} (${finding.segment_id ?? "script"}): ${finding.details}`);
    }
  }
  lines.push("", "</details>", "");
  return lines.join("\n");
}
