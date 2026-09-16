import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import {
  Ajv2020,
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";

export const CORE_SCHEMA_IDS = [
  "CodebaseBrief",
  "EvidenceRecord",
  "ContentAngle",
] as const;

export type CoreSchemaName = (typeof CORE_SCHEMA_IDS)[number];

export const INTERNAL_SCHEMA_IDS = [
  "GroundedFactPack",
  "GroundedBriefPlan",
  "GroundedBrief",
  "CanonicalGroundedBrief",
  "ContentAngleV2",
  "HumanSelection",
  "EditorialAngleDecision",
  "ScriptFactPack",
  "ScriptStyleProfile",
  "GroundedScriptInput",
  "GroundedScriptDraft",
  "GroundedScriptReview",
  "AngleRefinementContext",
  "HumanRefinementSelection",
  "RefinedAngleDraft",
  "RefinedAngleModelInput",
  "ConnectivityExploration",
  "HumanNeighborhoodSelection",
  "NeighborhoodEditorialContext",
  "HumanStoryComposerContext",
  "HumanEditorialCompositionDraft",
  "HumanCompositionValidation",
  "HumanCompositionValidationV2",
  "HumanCompositionDecision",
  "ApprovedEditorialStory",
  "ExpressionRewriteEligibility",
  "SpokenTechnicalStyleProfile",
  "GroundedExpressionRevision",
  "CaveatCoverage",
  "GroundedExpressionValidation",
  "ExpressionQualityReview",
] as const;

export type InternalSchemaName = (typeof INTERNAL_SCHEMA_IDS)[number];
export type SchemaName = CoreSchemaName | InternalSchemaName;

export interface SchemaValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface SchemaRegistry {
  schemaIds(): readonly CoreSchemaName[];
  internalSchemaIds(): readonly InternalSchemaName[];
  validate(name: SchemaName, value: unknown): SchemaValidationResult;
  assert(name: SchemaName, value: unknown): void;
}

const SCHEMA_FILES: Readonly<Record<SchemaName, string>> = {
  CodebaseBrief: "codebase-brief.schema.json",
  EvidenceRecord: "evidence-record.schema.json",
  ContentAngle: "content-angle.schema.json",
  GroundedFactPack: "grounded-fact-pack.schema.json",
  GroundedBriefPlan: "grounded-brief-plan.schema.json",
  GroundedBrief: "grounded-brief.schema.json",
  CanonicalGroundedBrief: "canonical-grounded-brief.schema.json",
  ContentAngleV2: "content-angle-v2.schema.json",
  HumanSelection: "human-selection.schema.json",
  EditorialAngleDecision: "editorial-angle-decision.schema.json",
  ScriptFactPack: "script-fact-pack.schema.json",
  ScriptStyleProfile: "script-style-profile.schema.json",
  GroundedScriptInput: "grounded-script-input.schema.json",
  GroundedScriptDraft: "grounded-script-draft.schema.json",
  GroundedScriptReview: "grounded-script-review.schema.json",
  AngleRefinementContext: "angle-refinement-context.schema.json",
  HumanRefinementSelection: "human-refinement-selection.schema.json",
  RefinedAngleDraft: "refined-angle-draft.schema.json",
  RefinedAngleModelInput: "refined-angle-model-input.schema.json",
  ConnectivityExploration: "connectivity-exploration.schema.json",
  HumanNeighborhoodSelection: "human-neighborhood-selection.schema.json",
  NeighborhoodEditorialContext: "neighborhood-editorial-context.schema.json",
  HumanStoryComposerContext: "human-story-composer-context.schema.json",
  HumanEditorialCompositionDraft: "human-editorial-composition-draft.schema.json",
  HumanCompositionValidation: "human-composition-validation.schema.json",
  HumanCompositionValidationV2: "human-composition-validation-v2.schema.json",
  HumanCompositionDecision: "human-composition-decision.schema.json",
  ApprovedEditorialStory: "approved-editorial-story.schema.json",
  ExpressionRewriteEligibility: "expression-rewrite-eligibility.schema.json",
  SpokenTechnicalStyleProfile: "spoken-technical-style-profile.schema.json",
  GroundedExpressionRevision: "grounded-expression-revision.schema.json",
  CaveatCoverage: "caveat-coverage.schema.json",
  GroundedExpressionValidation: "grounded-expression-validation.schema.json",
  ExpressionQualityReview: "expression-quality-review.schema.json",
};

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as FormatsPlugin;

function readSchema(schemaDirectory: string, name: SchemaName): AnySchema {
  const path = join(schemaDirectory, SCHEMA_FILES[name]);

  try {
    return JSON.parse(readFileSync(path, "utf8")) as AnySchema;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot load ${name} schema at ${path}: ${message}`);
  }
}

function formatErrors(errors: readonly ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const location = error.instancePath.length > 0 ? error.instancePath : "/";
    return `${location} ${error.message ?? error.keyword}`;
  });
}

export function createSchemaRegistry(schemaDirectory: string): SchemaRegistry {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    // Draft 2020-12 permits type constraints to arrive through $ref/allOf.
    // The committed schemas use that pattern in conditional branches.
    strictTypes: false,
    strictRequired: false,
    validateFormats: true,
  });
  addFormats(ajv);

  const allSchemaIds = [...CORE_SCHEMA_IDS, ...INTERNAL_SCHEMA_IDS] as const;
  const schemas = new Map<SchemaName, AnySchema>();
  for (const name of allSchemaIds) {
    schemas.set(name, readSchema(schemaDirectory, name));
  }

  // CodebaseBrief references EvidenceRecord by its canonical URN, so all
  // documents are registered before any validator is compiled.
  for (const name of allSchemaIds) {
    const schema = schemas.get(name);
    if (schema === undefined) {
      throw new Error(`Schema registry lost ${name}`);
    }
    ajv.addSchema(schema);
  }

  const validators = new Map<SchemaName, ValidateFunction>();
  for (const name of allSchemaIds) {
    const schema = schemas.get(name);
    if (schema === undefined) {
      throw new Error(`Schema registry lost ${name}`);
    }
    validators.set(name, ajv.compile(schema));
  }

  function validate(name: SchemaName, value: unknown): SchemaValidationResult {
    const validator = validators.get(name);
    if (validator === undefined) {
      throw new Error(`Unknown schema: ${name}`);
    }

    const valid = validator(value);
    return {
      valid: valid === true,
      errors: formatErrors(validator.errors),
    };
  }

  return {
    schemaIds: () => CORE_SCHEMA_IDS,
    internalSchemaIds: () => INTERNAL_SCHEMA_IDS,
    validate,
    assert(name, value) {
      const result = validate(name, value);
      if (!result.valid) {
        throw new Error(`${name} schema validation failed: ${result.errors.join("; ")}`);
      }
    },
  };
}
