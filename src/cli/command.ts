import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { analyzeRepository } from "../application/analyze-repository.js";
import {
  createHumanRefinementSelection,
  parseAngleRefinementContext,
  renderAngleRefinementPreview,
  serializeHumanRefinementSelection,
} from "../content/angle-refinement.js";
import {
  createHumanEditorialDecision,
  parseHumanSelectionArtifact,
  renderHumanSelectionPreview,
  serializeEditorialDecision,
} from "../content/editorial-selection.js";
import {
  parseGroundedScriptReviewArtifact,
  renderGroundedScriptReviewPreview,
} from "../content/grounded-script.js";
import {
  confirmHumanEditorialComposition,
  parseHumanCompositionValidation,
  parseHumanEditorialCompositionDraft,
  parseHumanStoryComposerContext,
  renderHumanStoryComposerPreview,
  serializeHumanCompositionArtifact,
  validateHumanEditorialComposition,
} from "../content/human-story-composer.js";
import { DeterministicModelProvider } from "../model/deterministic-provider.js";
import { createDeepSeekV4ProProvider } from "../model/deepseek-profile.js";
import { OllamaProvider } from "../model/ollama-provider.js";
import { OpenAICompatibleProviderError } from "../model/openai-compatible-provider.js";
import type { ModelProvider } from "../model/provider.js";
import type { RepositorySource } from "../repo/contracts.js";
import { GitHubRepositorySource } from "../repo/github-source.js";
import { createSchemaRegistry } from "../schemas/registry.js";

export interface CliDependencies {
  readonly source?: RepositorySource;
  readonly schemaDirectory?: string;
  readonly generatedAt?: string;
  readonly networkHosts?: readonly string[];
  readonly ollamaFetch?: typeof fetch;
  readonly deepseekFetch?: typeof fetch;
  readonly modelEnvironment?: Readonly<Record<string, string | undefined>>;
  readonly modelSleep?: (milliseconds: number) => Promise<void>;
  readonly stdout?: (message: string) => void;
  readonly stderr?: (message: string) => void;
}

interface AnalyzeArguments {
  readonly url: string;
  readonly outputRoot: string;
  readonly provider: "deterministic" | "ollama" | "deepseek";
  readonly model: string | null;
}

function usage(): string {
  return [
    "Usage:",
    "  npm run cli -- analyze https://github.com/owner/repo [--output output] [--provider deterministic | deepseek | --provider ollama --model MODEL]",
    "  npm run cli -- angles <human-selection.json>",
    "  npm run cli -- approve-angle <human-selection.json> <candidate-id> --output <approved-angle.json> [--approved-at <ISO timestamp>]",
    "  npm run cli -- reject-angle <human-selection.json> <candidate-id> --output <decision.json> [--rejected-at <ISO timestamp>]",
    "  npm run cli -- script-review <grounded-script-review.json>",
    "  npm run cli -- list-angle-related-facts <angle-refinement-context.json>",
    "  npm run cli -- create-refinement-selection <angle-refinement-context.json> <fact-ref> [fact-ref...] --output <selection.json> [--selected-at <ISO timestamp>]",
    "  npm run cli -- show-composer-context <human-story-composer-context.json>",
    "  npm run cli -- validate-human-story <context.json> <draft.json> --output <validation.json>",
    "  npm run cli -- confirm-human-story <context.json> <draft.json> <validation.json> --output <decision.json> --confirmed [--confirmed-at <ISO timestamp>]",
  ].join("\n");
}

interface HumanComposerCommandArguments {
  readonly command:
    | "show-composer-context"
    | "validate-human-story"
    | "confirm-human-story";
  readonly contextPath: string;
  readonly draftPath: string | null;
  readonly validationPath: string | null;
  readonly outputPath: string | null;
  readonly confirmed: boolean;
  readonly confirmedAt: string | null;
}

function parseHumanComposerCommand(
  args: readonly string[],
): HumanComposerCommandArguments | null {
  const command = args[0];
  if (
    command !== "show-composer-context" &&
    command !== "validate-human-story" &&
    command !== "confirm-human-story"
  ) {
    return null;
  }
  if (args[1] === undefined) throw new Error(usage());
  if (command === "show-composer-context") {
    if (args.length !== 2) throw new Error(usage());
    return {
      command,
      contextPath: resolve(args[1]),
      draftPath: null,
      validationPath: null,
      outputPath: null,
      confirmed: false,
      confirmedAt: null,
    };
  }
  const draftPath = args[2];
  if (draftPath === undefined) throw new Error(usage());
  const validationPath = command === "confirm-human-story" ? args[3] : null;
  if (command === "confirm-human-story" && validationPath === undefined) {
    throw new Error(usage());
  }
  const optionStart = command === "confirm-human-story" ? 4 : 3;
  let outputPath: string | null = null;
  let confirmed = false;
  let confirmedAt: string | null = null;
  for (let index = optionStart; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--output" && value !== undefined) {
      outputPath = resolve(value);
      index += 1;
    } else if (option === "--confirmed" && command === "confirm-human-story") {
      confirmed = true;
    } else if (
      option === "--confirmed-at" &&
      command === "confirm-human-story" &&
      value !== undefined
    ) {
      confirmedAt = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete option: ${option ?? ""}\n${usage()}`);
    }
  }
  if (outputPath === null) throw new Error(`--output is required.\n${usage()}`);
  return {
    command,
    contextPath: resolve(args[1]),
    draftPath: resolve(draftPath),
    validationPath:
      validationPath === null || validationPath === undefined
        ? null
        : resolve(validationPath),
    outputPath,
    confirmed,
    confirmedAt,
  };
}

async function runHumanComposerCommand(
  parsed: HumanComposerCommandArguments,
  dependencies: CliDependencies,
  stdout: (message: string) => void,
): Promise<void> {
  const schemas = createSchemaRegistry(
    dependencies.schemaDirectory ?? resolve(process.cwd(), "schemas"),
  );
  const context = parseHumanStoryComposerContext(
    JSON.parse(await readFile(parsed.contextPath, "utf8")),
    schemas,
  );
  if (parsed.command === "show-composer-context") {
    stdout(renderHumanStoryComposerPreview(context).trimEnd());
    return;
  }
  if (parsed.draftPath === null || parsed.outputPath === null) {
    throw new Error("Human Composer command lost required paths.");
  }
  const draft = parseHumanEditorialCompositionDraft(
    JSON.parse(await readFile(parsed.draftPath, "utf8")),
    schemas,
  );
  if (parsed.command === "validate-human-story") {
    const validation = validateHumanEditorialComposition({
      context,
      draft,
      schemas,
    });
    schemas.assert("HumanCompositionValidation", validation);
    await mkdir(dirname(parsed.outputPath), { recursive: true });
    await writeFile(
      parsed.outputPath,
      serializeHumanCompositionArtifact(validation),
      { encoding: "utf8", flag: "wx" },
    );
    stdout(
      `${validation.composition_status}: ${validation.composition_id}\nArtifact: ${parsed.outputPath}\nTruth Status: ${validation.truth_status}\nScript Eligible: NO\nExplicit Human Confirmation Required: YES`,
    );
    return;
  }
  if (parsed.validationPath === null) {
    throw new Error("Human confirmation command lost its validation path.");
  }
  const validation = parseHumanCompositionValidation(
    JSON.parse(await readFile(parsed.validationPath, "utf8")),
    schemas,
  );
  const decision = confirmHumanEditorialComposition({
    context,
    draft,
    validation,
    explicit_confirmation: parsed.confirmed,
    confirmed_at: parsed.confirmedAt ?? new Date().toISOString(),
    decision_context: "USER_ACTION",
  });
  schemas.assert("HumanCompositionDecision", decision);
  await mkdir(dirname(parsed.outputPath), { recursive: true });
  await writeFile(
    parsed.outputPath,
    serializeHumanCompositionArtifact(decision),
    { encoding: "utf8", flag: "wx" },
  );
  stdout(
    `${decision.composition_status}: ${decision.composition_id}\nArtifact: ${parsed.outputPath}\nScript Contract Eligible: YES\nScript Execution Authorized: NO\nExplicit Script Generation Action Required: YES`,
  );
}

interface RefinementCommandArguments {
  readonly command:
    | "list-angle-related-facts"
    | "create-refinement-selection";
  readonly contextPath: string;
  readonly selectedFactRefs: readonly string[];
  readonly outputPath: string | null;
  readonly selectedAt: string | null;
}

function parseRefinementCommand(
  args: readonly string[],
): RefinementCommandArguments | null {
  const command = args[0];
  if (
    command !== "list-angle-related-facts" &&
    command !== "create-refinement-selection"
  ) {
    return null;
  }
  if (args[1] === undefined) throw new Error(usage());
  if (command === "list-angle-related-facts") {
    if (args.length !== 2) throw new Error(usage());
    return {
      command,
      contextPath: resolve(args[1]),
      selectedFactRefs: [],
      outputPath: null,
      selectedAt: null,
    };
  }
  const selectedFactRefs: string[] = [];
  let outputPath: string | null = null;
  let selectedAt: string | null = null;
  for (let index = 2; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--output" && value !== undefined) {
      outputPath = resolve(value);
      index += 1;
    } else if (option === "--selected-at" && value !== undefined) {
      selectedAt = value;
      index += 1;
    } else if (option !== undefined && !option.startsWith("--")) {
      selectedFactRefs.push(option);
    } else {
      throw new Error(`Unknown or incomplete option: ${option ?? ""}\n${usage()}`);
    }
  }
  if (selectedFactRefs.length === 0 || outputPath === null) {
    throw new Error(`At least one Fact Ref and --output are required.\n${usage()}`);
  }
  return {
    command,
    contextPath: resolve(args[1]),
    selectedFactRefs,
    outputPath,
    selectedAt,
  };
}

async function runRefinementCommand(
  parsed: RefinementCommandArguments,
  dependencies: CliDependencies,
  stdout: (message: string) => void,
): Promise<void> {
  const schemas = createSchemaRegistry(
    dependencies.schemaDirectory ?? resolve(process.cwd(), "schemas"),
  );
  const contextText = await readFile(parsed.contextPath, "utf8");
  const context = parseAngleRefinementContext(JSON.parse(contextText), schemas);
  if (parsed.command === "list-angle-related-facts") {
    stdout(renderAngleRefinementPreview(context).trimEnd());
    return;
  }
  if (parsed.outputPath === null) {
    throw new Error("Refinement selection command lost its output path.");
  }
  const selection = createHumanRefinementSelection({
    context,
    selected_additional_fact_refs: parsed.selectedFactRefs,
    selected_at: parsed.selectedAt ?? new Date().toISOString(),
    decision_context: "USER_ACTION",
    source: {
      artifact_path: parsed.contextPath,
      sha256: createHash("sha256").update(contextText).digest("hex"),
    },
  });
  schemas.assert("HumanRefinementSelection", selection);
  await mkdir(dirname(parsed.outputPath), { recursive: true });
  await writeFile(
    parsed.outputPath,
    serializeHumanRefinementSelection(selection),
    { encoding: "utf8", flag: "wx" },
  );
  stdout(
    `VALID: ${selection.selection_id}\nArtifact: ${parsed.outputPath}\nSelected Facts: ${selection.selected_additional_fact_refs.join(", ")}\nReal Model Authorized: NO\nExplicit Refined Angle Generation Action Required: YES`,
  );
}

interface EditorialCommandArguments {
  readonly command: "angles" | "approve-angle" | "reject-angle";
  readonly selectionPath: string;
  readonly candidateId: string | null;
  readonly outputPath: string | null;
  readonly decidedAt: string | null;
}

function parseEditorialCommand(
  args: readonly string[],
): EditorialCommandArguments | null {
  const command = args[0];
  if (
    command !== "angles" &&
    command !== "approve-angle" &&
    command !== "reject-angle"
  ) {
    return null;
  }
  if (args[1] === undefined) {
    throw new Error(usage());
  }
  if (command === "angles") {
    if (args.length !== 2) {
      throw new Error(usage());
    }
    return {
      command,
      selectionPath: resolve(args[1]),
      candidateId: null,
      outputPath: null,
      decidedAt: null,
    };
  }
  const candidateId = args[2];
  if (candidateId === undefined) {
    throw new Error(usage());
  }
  let outputPath: string | null = null;
  let decidedAt: string | null = null;
  const timestampOption =
    command === "approve-angle" ? "--approved-at" : "--rejected-at";
  for (let index = 3; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--output" && value !== undefined) {
      outputPath = resolve(value);
      index += 1;
    } else if (option === timestampOption && value !== undefined) {
      decidedAt = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete option: ${option ?? ""}\n${usage()}`);
    }
  }
  if (outputPath === null) {
    throw new Error(`--output is required.\n${usage()}`);
  }
  return {
    command,
    selectionPath: resolve(args[1]),
    candidateId,
    outputPath,
    decidedAt,
  };
}

async function runEditorialCommand(
  parsed: EditorialCommandArguments,
  dependencies: CliDependencies,
  stdout: (message: string) => void,
): Promise<void> {
  const schemas = createSchemaRegistry(
    dependencies.schemaDirectory ?? resolve(process.cwd(), "schemas"),
  );
  const value = JSON.parse(await readFile(parsed.selectionPath, "utf8"));
  const selection = parseHumanSelectionArtifact(value, schemas);
  if (parsed.command === "angles") {
    stdout(renderHumanSelectionPreview(selection).trimEnd());
    return;
  }
  if (parsed.candidateId === null || parsed.outputPath === null) {
    throw new Error("Editorial decision command lost required arguments.");
  }
  const decision = createHumanEditorialDecision({
    selection,
    candidate_id: parsed.candidateId,
    decision: parsed.command === "approve-angle" ? "APPROVE" : "REJECT",
    decided_at: parsed.decidedAt ?? new Date().toISOString(),
    context: "USER_ACTION",
  });
  schemas.assert("EditorialAngleDecision", decision);
  await mkdir(dirname(parsed.outputPath), { recursive: true });
  await writeFile(parsed.outputPath, serializeEditorialDecision(decision), {
    encoding: "utf8",
    flag: "wx",
  });
  stdout(
    `${decision.status}: ${decision.candidate_id}\nArtifact: ${parsed.outputPath}\nScript Eligible: ${decision.script_eligibility.eligible ? "YES" : "NO"}\nExplicit Script Generation Action Required: YES`,
  );
}

function parseArguments(args: readonly string[]): AnalyzeArguments {
  if (args[0] !== "analyze" || args[1] === undefined) {
    throw new Error(usage());
  }
  let outputRoot = resolve(process.cwd(), "output");
  let provider: "deterministic" | "ollama" | "deepseek" = "deterministic";
  let model: string | null = null;
  for (let index = 2; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--output" && value !== undefined) {
      outputRoot = resolve(value);
      index += 1;
    } else if (
      option === "--provider" &&
      (value === "deterministic" || value === "ollama" || value === "deepseek")
    ) {
      provider = value;
      index += 1;
    } else if (option === "--model" && value !== undefined && value.length > 0) {
      model = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete option: ${option ?? ""}\n${usage()}`);
    }
  }
  if (provider === "ollama" && model === null) {
    throw new Error(`--provider ollama requires --model.\n${usage()}`);
  }
  if (provider !== "ollama" && model !== null) {
    throw new Error(`--model is valid only with --provider ollama.\n${usage()}`);
  }
  return { url: args[1], outputRoot, provider, model };
}

function modelProvider(
  parsed: AnalyzeArguments,
  dependencies: CliDependencies,
): ModelProvider {
  if (parsed.provider === "deterministic") {
    return new DeterministicModelProvider();
  }
  if (parsed.provider === "ollama") {
    return new OllamaProvider({
      model: parsed.model ?? "",
      fetch: dependencies.ollamaFetch,
    });
  }
  return createDeepSeekV4ProProvider({
    environment: dependencies.modelEnvironment,
    fetch: dependencies.deepseekFetch,
    sleep: dependencies.modelSleep,
  });
}

export async function runCli(
  args: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? console.log;
  const stderr = dependencies.stderr ?? console.error;
  try {
    const humanComposerCommand = parseHumanComposerCommand(args);
    if (humanComposerCommand !== null) {
      await runHumanComposerCommand(humanComposerCommand, dependencies, stdout);
      return 0;
    }
    const refinementCommand = parseRefinementCommand(args);
    if (refinementCommand !== null) {
      await runRefinementCommand(refinementCommand, dependencies, stdout);
      return 0;
    }
    if (args[0] === "script-review") {
      if (args.length !== 2 || args[1] === undefined) {
        throw new Error(usage());
      }
      const schemas = createSchemaRegistry(
        dependencies.schemaDirectory ?? resolve(process.cwd(), "schemas"),
      );
      const value = JSON.parse(await readFile(resolve(args[1]), "utf8"));
      const review = parseGroundedScriptReviewArtifact(value, schemas);
      stdout(renderGroundedScriptReviewPreview(review).trimEnd());
      return 0;
    }
    const editorialCommand = parseEditorialCommand(args);
    if (editorialCommand !== null) {
      await runEditorialCommand(editorialCommand, dependencies, stdout);
      return 0;
    }
    const parsed = parseArguments(args);
    const source = dependencies.source ?? new GitHubRepositorySource();
    const result = await analyzeRepository({
      url: parsed.url,
      source,
      provider: modelProvider(parsed, dependencies),
      schemaDirectory: dependencies.schemaDirectory ?? resolve(process.cwd(), "schemas"),
      outputRoot: parsed.outputRoot,
      generatedAt: dependencies.generatedAt,
      networkHosts:
        dependencies.networkHosts ?? [
          ...(dependencies.source === undefined
            ? [
                "api.github.com",
                "github.com",
                "codeload.github.com",
                "raw.githubusercontent.com",
              ]
            : []),
          ...(parsed.provider === "ollama" ? ["127.0.0.1:11434"] : []),
          ...(parsed.provider === "deepseek" ? ["api.deepseek.com"] : []),
        ],
      includeQualityReview: parsed.provider !== "deterministic",
    });
    stdout(
      parsed.provider !== "deterministic"
        ? "ENGINEERING PASS — Vertical Slice 02 model run completed."
        : "PASS — Vertical Slice 01 completed.",
    );
    stdout(`Commit: ${result.bundle.brief.repository.commit_sha}`);
    stdout(`Artifacts: ${result.outputDirectory}`);
    if (result.qualityReview !== undefined) {
      stdout(`Content quality: ${result.qualityReview.evaluation.release_status}`);
      stdout(`Shareability: ${result.qualityReview.evaluation.shareability}`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(
      error instanceof OpenAICompatibleProviderError &&
        error.code === "API_KEY_NOT_CONFIGURED"
        ? message
        : `FAIL — ${message}`,
    );
    return 1;
  }
}
