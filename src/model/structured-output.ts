import { Ajv2020, type AnySchema, type ErrorObject } from "ajv/dist/2020.js";

export interface StructuredOutputContract {
  readonly schema: AnySchema;
  readonly fieldAliases: Readonly<Record<string, string>>;
}

export interface StructuredOutputResult {
  readonly value: unknown;
  readonly repairActions: readonly string[];
}

export class StructuredOutputError extends Error {
  constructor(
    readonly code:
      | "JSON_SYNTAX_INVALID"
      | "AMBIGUOUS_FIELD"
      | "SCHEMA_VALIDATION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

const BRIEF_SCHEMA: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: ["oneSentence", "summary", "problem", "targetUsers", "moduleInterpretations"],
  properties: {
    oneSentence: { type: "string", minLength: 1, maxLength: 500 },
    summary: { type: "string", minLength: 1, maxLength: 2_000 },
    problem: { type: "string", maxLength: 1_000 },
    targetUsers: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 120 },
    },
    moduleInterpretations: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourcePath", "semanticName", "responsibility", "whyImportant"],
        properties: {
          sourcePath: { type: "string", minLength: 1, maxLength: 500 },
          semanticName: { type: "string", minLength: 1, maxLength: 160 },
          responsibility: { type: "string", minLength: 1, maxLength: 500 },
          whyImportant: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
  },
};

const ANGLE_SCHEMA: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "hook", "whyInteresting", "candidates"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 300 },
    hook: { type: "string", minLength: 1, maxLength: 600 },
    whyInteresting: { type: "string", minLength: 1, maxLength: 1_200 },
    candidates: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "hook",
          "whyInteresting",
          "claimIds",
          "decision",
          "rank",
          "rejectionReason",
        ],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 300 },
          hook: { type: "string", minLength: 1, maxLength: 600 },
          whyInteresting: { type: "string", minLength: 1, maxLength: 1_200 },
          claimIds: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 128 },
          },
          decision: { enum: ["select", "reject"] },
          rank: { type: ["integer", "null"], minimum: 1, maximum: 3 },
          rejectionReason: { type: "string", maxLength: 500 },
        },
      },
    },
  },
};

const CONTENT_SCHEMA: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: ["opening", "closing", "claimOrder", "transitions"],
  properties: {
    opening: { type: "string", minLength: 1, maxLength: 800 },
    closing: { type: "string", minLength: 1, maxLength: 800 },
    claimOrder: {
      type: "array",
      maxItems: 3,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 128 },
    },
    transitions: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 300 },
    },
  },
};

const GROUNDED_BRIEF_SURFACE_DRAFT_SCHEMA: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: ["draft_version", "statements"],
  properties: {
    draft_version: { const: 1 },
    statements: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "section_id",
          "kind",
          "text",
          "fact_ids",
          "unknown_ids",
        ],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 128 },
          section_id: { type: "string", minLength: 1, maxLength: 128 },
          kind: {
            enum: [
              "TECHNICAL_FACT",
              "DOCUMENTATION",
              "TRANSITION",
              "UNKNOWN",
            ],
          },
          text: { type: "string", minLength: 10, maxLength: 360 },
          fact_ids: {
            type: "array",
            uniqueItems: true,
            maxItems: 1,
            items: { type: "string", minLength: 1, maxLength: 160 },
          },
          unknown_ids: {
            type: "array",
            uniqueItems: true,
            maxItems: 1,
            items: { type: "string", minLength: 1, maxLength: 160 },
          },
        },
        allOf: [
          {
            if: {
              properties: {
                kind: { enum: ["TECHNICAL_FACT", "DOCUMENTATION"] },
              },
              required: ["kind"],
            },
            then: {
              properties: {
                fact_ids: { type: "array", minItems: 1, maxItems: 1 },
                unknown_ids: { type: "array", maxItems: 0 },
              },
            },
          },
          {
            if: {
              properties: { kind: { const: "UNKNOWN" } },
              required: ["kind"],
            },
            then: {
              properties: {
                fact_ids: { type: "array", maxItems: 0 },
                unknown_ids: { type: "array", minItems: 1, maxItems: 1 },
              },
            },
          },
          {
            if: {
              properties: { kind: { const: "TRANSITION" } },
              required: ["kind"],
            },
            then: {
              properties: {
                fact_ids: { type: "array", maxItems: 0 },
                unknown_ids: { type: "array", maxItems: 0 },
              },
            },
          },
        ],
      },
    },
  },
};

const CONTENT_ANGLE_CANDIDATE_DRAFT_SCHEMA: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: ["draft_version", "candidates"],
  properties: {
    draft_version: { const: 1 },
    candidates: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "candidate_id",
          "title",
          "angle_type",
          "editorial_thesis",
          "editorial_reason",
          "technical_basis",
          "supporting_fact_ids",
          "supporting_statement_ids",
          "why_interesting",
          "target_audience",
          "confidence",
          "novelty_assessment",
          "educational_value",
          "caveats",
          "unknown_dependencies",
          "external_claims",
          "technical_entities",
          "claimed_scope",
          "editorial_scores",
        ],
        properties: {
          candidate_id: { type: "string", minLength: 1, maxLength: 128 },
          title: { type: "string", minLength: 1, maxLength: 200 },
          angle_type: {
            enum: [
              "ENGINEERING_BOUNDARY",
              "ARCHITECTURE_PATTERN",
              "LOCAL_BEHAVIOR",
              "DESIGN_TRADEOFF",
              "TYPE_SURFACE",
              "PACKAGE_SURFACE",
              "EVIDENCE_METHOD",
              "EDUCATIONAL_INSIGHT",
              "UNUSUAL_IMPLEMENTATION",
            ],
          },
          editorial_thesis: { type: "string", minLength: 1, maxLength: 600 },
          editorial_reason: { type: "string", minLength: 1, maxLength: 600 },
          technical_basis: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fact_id", "canonical_statement_id"],
              properties: {
                fact_id: { type: "string", minLength: 1, maxLength: 160 },
                canonical_statement_id: {
                  oneOf: [
                    { type: "string", minLength: 1, maxLength: 160 },
                    { type: "null" },
                  ],
                },
              },
            },
          },
          supporting_fact_ids: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 160 },
          },
          supporting_statement_ids: {
            type: "array",
            maxItems: 4,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 160 },
          },
          why_interesting: { type: "string", minLength: 1, maxLength: 600 },
          target_audience: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: {
              enum: [
                "DEVELOPER",
                "AI_ENGINEER",
                "OPEN_SOURCE_MAINTAINER",
                "TECH_CREATOR",
                "GENERAL_TECH",
              ],
            },
          },
          confidence: {
            type: "object",
            additionalProperties: false,
            required: ["level", "rationale"],
            properties: {
              level: { enum: ["LOW", "MEDIUM", "HIGH"] },
              rationale: { type: "string", minLength: 1, maxLength: 400 },
            },
          },
          novelty_assessment: {
            type: "object",
            additionalProperties: false,
            required: ["status", "rationale"],
            properties: {
              status: { enum: ["NOT_RESEARCHED", "REPOSITORY_LOCAL_ONLY"] },
              rationale: { type: "string", minLength: 1, maxLength: 400 },
            },
          },
          educational_value: { type: "string", minLength: 1, maxLength: 500 },
          caveats: {
            type: "array",
            maxItems: 4,
            items: { type: "string", minLength: 1, maxLength: 300 },
          },
          unknown_dependencies: {
            type: "array",
            maxItems: 6,
            uniqueItems: true,
            description:
              "unknown_id strings copied exactly from supplied known_unknowns; never repeat or paraphrase canonical_text.",
            items: { type: "string", minLength: 1, maxLength: 160 },
          },
          external_claims: {
            type: "array",
            maxItems: 3,
            items: { type: "string", minLength: 1, maxLength: 300 },
          },
          technical_entities: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["entity_ref", "label"],
              properties: {
                entity_ref: { type: "string", minLength: 1, maxLength: 160 },
                label: { type: "string", minLength: 1, maxLength: 200 },
              },
            },
          },
          claimed_scope: { enum: ["LOCAL", "MODULE", "PACKAGE", "PROJECT"] },
          editorial_scores: {
            type: "object",
            additionalProperties: false,
            required: [
              "technical_significance",
              "educational_value",
              "clarity",
              "evidence_strength",
              "distinctiveness",
              "content_potential",
            ],
            properties: Object.fromEntries(
              [
                "technical_significance",
                "educational_value",
                "clarity",
                "evidence_strength",
                "distinctiveness",
                "content_potential",
              ].map((name) => [
                name,
                { type: "integer", minimum: 0, maximum: 3 },
              ]),
            ),
          },
        },
      },
    },
  },
};

function minimalAngleDecisionDraftSchema(
  version: 1 | 2,
  maximumSupportingFacts: 4 | 8,
): AnySchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["minimal_angle_draft_version", "candidates"],
    properties: {
      minimal_angle_draft_version: { const: version },
      candidates: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "candidate_id",
            "title",
            "angle_type",
            "editorial_thesis",
            "supporting_fact_ids",
            "why_interesting",
            "target_audience",
          ],
          properties: {
            candidate_id: { type: "string", minLength: 1, maxLength: 128 },
            title: { type: "string", minLength: 1, maxLength: 200 },
            angle_type: {
              enum: [
                "ENGINEERING_BOUNDARY",
                "ARCHITECTURE_PATTERN",
                "LOCAL_BEHAVIOR",
                "DESIGN_TRADEOFF",
                "TYPE_SURFACE",
                "PACKAGE_SURFACE",
                "EVIDENCE_METHOD",
                "EDUCATIONAL_INSIGHT",
                "UNUSUAL_IMPLEMENTATION",
              ],
            },
            editorial_thesis: { type: "string", minLength: 1, maxLength: 600 },
            supporting_fact_ids: {
              type: "array",
              minItems: 1,
              maxItems: maximumSupportingFacts,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 160 },
            },
            why_interesting: { type: "string", minLength: 1, maxLength: 600 },
            target_audience: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              uniqueItems: true,
              items: {
                enum: [
                  "DEVELOPER",
                  "AI_ENGINEER",
                  "OPEN_SOURCE_MAINTAINER",
                  "TECH_CREATOR",
                  "GENERAL_TECH",
                ],
              },
            },
            editorial_confidence: { enum: ["LOW", "MEDIUM", "HIGH"] },
          },
        },
      },
    },
  };
}

const MINIMAL_ANGLE_DECISION_DRAFT_SCHEMA =
  minimalAngleDecisionDraftSchema(1, 4);
const MINIMAL_ANGLE_DECISION_DRAFT_V2_SCHEMA =
  minimalAngleDecisionDraftSchema(2, 8);

const MINIMAL_ANGLE_DECISION_MODEL_REFS_SCHEMA: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: ["minimal_angle_draft_version", "candidates"],
  properties: {
    minimal_angle_draft_version: { const: 1 },
    candidates: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "candidate_id",
          "title",
          "angle_type",
          "editorial_thesis",
          "supporting_fact_refs",
          "why_interesting",
          "target_audience",
        ],
        properties: {
          candidate_id: { type: "string", minLength: 1, maxLength: 128 },
          title: { type: "string", minLength: 1, maxLength: 200 },
          angle_type: {
            enum: [
              "ENGINEERING_BOUNDARY",
              "ARCHITECTURE_PATTERN",
              "LOCAL_BEHAVIOR",
              "DESIGN_TRADEOFF",
              "TYPE_SURFACE",
              "PACKAGE_SURFACE",
              "EVIDENCE_METHOD",
              "EDUCATIONAL_INSIGHT",
              "UNUSUAL_IMPLEMENTATION",
            ],
          },
          editorial_thesis: { type: "string", minLength: 1, maxLength: 600 },
          supporting_fact_refs: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", pattern: "^fact_[0-9]{3}$" },
          },
          why_interesting: { type: "string", minLength: 1, maxLength: 600 },
          target_audience: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: {
              enum: [
                "DEVELOPER",
                "AI_ENGINEER",
                "OPEN_SOURCE_MAINTAINER",
                "TECH_CREATOR",
                "GENERAL_TECH",
              ],
            },
          },
          editorial_confidence: { enum: ["LOW", "MEDIUM", "HIGH"] },
        },
      },
    },
  },
};

const NEIGHBORHOOD_ANGLE_DECISION_SCHEMA: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: ["neighborhood_angle_draft_version", "candidates"],
  properties: {
    neighborhood_angle_draft_version: { const: 1 },
    candidates: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "candidate_id",
          "title",
          "angle_type",
          "editorial_thesis",
          "supporting_fact_refs",
          "why_interesting",
          "target_audience",
        ],
        properties: {
          candidate_id: { type: "string", minLength: 1, maxLength: 128 },
          title: { type: "string", minLength: 1, maxLength: 200 },
          angle_type: {
            enum: [
              "ENGINEERING_BOUNDARY",
              "ARCHITECTURE_PATTERN",
              "LOCAL_BEHAVIOR",
              "DESIGN_TRADEOFF",
              "TYPE_SURFACE",
              "PACKAGE_SURFACE",
              "EVIDENCE_METHOD",
              "EDUCATIONAL_INSIGHT",
              "UNUSUAL_IMPLEMENTATION",
            ],
          },
          editorial_thesis: { type: "string", minLength: 1, maxLength: 600 },
          supporting_fact_refs: {
            type: "array",
            minItems: 1,
            maxItems: 7,
            uniqueItems: true,
            items: { type: "string", pattern: "^fact_[0-9]{3}$" },
          },
          why_interesting: { type: "string", minLength: 1, maxLength: 600 },
          target_audience: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: {
              enum: [
                "DEVELOPER",
                "AI_ENGINEER",
                "OPEN_SOURCE_MAINTAINER",
                "TECH_CREATOR",
                "GENERAL_TECH",
              ],
            },
          },
          editorial_confidence: { enum: ["LOW", "MEDIUM", "HIGH"] },
        },
      },
    },
  },
};

const CONTENT_ANGLE_AUDIENCE_ENUM = [
  "DEVELOPER",
  "AI_ENGINEER",
  "OPEN_SOURCE_MAINTAINER",
  "TECH_CREATOR",
  "GENERAL_TECH",
] as const;

const CONTENT_ANGLE_TYPE_ENUM = [
  "ENGINEERING_BOUNDARY",
  "ARCHITECTURE_PATTERN",
  "LOCAL_BEHAVIOR",
  "DESIGN_TRADEOFF",
  "TYPE_SURFACE",
  "PACKAGE_SURFACE",
  "EVIDENCE_METHOD",
  "EDUCATIONAL_INSIGHT",
  "UNUSUAL_IMPLEMENTATION",
] as const;

const GROUNDED_SCRIPT_MODEL_DRAFT_SCHEMA: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "script_version",
    "status",
    "repository",
    "commit",
    "fact_ir_version",
    "approved_angle_ref",
    "language",
    "target_duration_seconds",
    "segments",
  ],
  properties: {
    script_version: { const: 1 },
    status: { const: "GENERATED" },
    repository: {
      type: "object",
      additionalProperties: false,
      required: ["url", "owner", "name"],
      properties: {
        url: { type: "string", minLength: 1, maxLength: 500 },
        owner: { type: "string", minLength: 1, maxLength: 200 },
        name: { type: "string", minLength: 1, maxLength: 200 },
      },
    },
    commit: { type: "string", pattern: "^[0-9a-f]{40}$" },
    fact_ir_version: { const: 2 },
    approved_angle_ref: { type: "string", minLength: 1, maxLength: 128 },
    language: { const: "zh-CN" },
    target_duration_seconds: {
      type: "object",
      additionalProperties: false,
      required: ["min", "max"],
      properties: { min: { const: 60 }, max: { const: 90 } },
    },
    segments: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "segment_id",
          "role",
          "text",
          "statement_kind",
          "supporting_fact_refs",
          "context_fact_refs",
          "known_unknown_refs",
          "approved_angle_ref",
        ],
        properties: {
          segment_id: { type: "string", pattern: "^segment_[0-9]{2,}$" },
          role: {
            enum: [
              "HOOK",
              "SETUP",
              "TECHNICAL_EXPLANATION",
              "TRANSITION",
              "CAVEAT",
              "CLOSE",
            ],
          },
          text: { type: "string", minLength: 1, maxLength: 420 },
          statement_kind: {
            enum: [
              "TECHNICAL_FACT",
              "EDITORIAL_FRAMING",
              "TRANSITION",
              "DOCUMENTATION",
              "CAVEAT",
              "UNKNOWN",
              "QUESTION",
            ],
          },
          supporting_fact_refs: {
            type: "array",
            maxItems: 5,
            uniqueItems: true,
            items: { type: "string", pattern: "^fact_[0-9]{3}$" },
          },
          context_fact_refs: {
            type: "array",
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", pattern: "^fact_[0-9]{3}$" },
          },
          known_unknown_refs: {
            type: "array",
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", pattern: "^gap_[a-z0-9_]+$" },
          },
          approved_angle_ref: { type: "string", minLength: 1, maxLength: 128 },
        },
      },
    },
  },
};

const GROUNDED_EXPRESSION_MODEL_DRAFT_SCHEMA: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "grounded_expression_model_draft_version",
    "segments",
    "source_segment_mapping",
    "semantic_operations",
  ],
  properties: {
    grounded_expression_model_draft_version: { const: 1 },
    segments: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["revision_segment_id", "role", "text", "clauses"],
        properties: {
          revision_segment_id: {
            type: "string",
            pattern: "^revision_segment_[0-9]{2,}$",
          },
          role: {
            enum: [
              "HOOK",
              "SETUP",
              "TECHNICAL_EXPLANATION",
              "TRANSITION",
              "CAVEAT",
              "CLOSE",
            ],
          },
          text: { type: "string", minLength: 1, maxLength: 600 },
          clauses: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "revision_clause_id",
                "text",
                "statement_kind",
                "source_clause_ids",
                "fact_refs",
                "known_unknown_refs",
                "rewrite_operation",
              ],
              properties: {
                revision_clause_id: {
                  type: "string",
                  pattern: "^revision_clause_[0-9]{2,}$",
                },
                text: { type: "string", minLength: 1, maxLength: 420 },
                statement_kind: {
                  enum: [
                    "TECHNICAL_FACT",
                    "EDITORIAL_FRAMING",
                    "TRANSITION",
                    "DOCUMENTATION",
                    "CAVEAT",
                    "UNKNOWN",
                    "QUESTION",
                  ],
                },
                source_clause_ids: {
                  type: "array",
                  minItems: 1,
                  maxItems: 9,
                  uniqueItems: true,
                  items: {
                    type: "string",
                    pattern: "^source_clause:[A-Za-z0-9_-]+:[0-9]+$",
                  },
                },
                fact_refs: {
                  type: "array",
                  maxItems: 5,
                  uniqueItems: true,
                  items: { type: "string", pattern: "^fact_[0-9]{3}$" },
                },
                known_unknown_refs: {
                  type: "array",
                  maxItems: 3,
                  uniqueItems: true,
                  items: {
                    type: "string",
                    pattern: "^gap_[a-z0-9_]+$",
                  },
                },
                rewrite_operation: {
                  enum: [
                    "PARAPHRASE",
                    "MERGE",
                    "COMPRESS",
                    "REORDER",
                    "EDITORIAL_POLISH",
                  ],
                },
              },
            },
          },
        },
      },
    },
    source_segment_mapping: {
      type: "array",
      minItems: 1,
      maxItems: 9,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "source_segment_id",
          "source_clause_ids",
          "revision_segment_ids",
          "disposition",
          "reason",
        ],
        properties: {
          source_segment_id: {
            type: "string",
            pattern: "^segment_[0-9]{2,}$",
          },
          source_clause_ids: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            uniqueItems: true,
            items: {
              type: "string",
              pattern: "^source_clause:[A-Za-z0-9_-]+:[0-9]+$",
            },
          },
          revision_segment_ids: {
            type: "array",
            maxItems: 12,
            uniqueItems: true,
            items: {
              type: "string",
              pattern: "^revision_segment_[0-9]{2,}$",
            },
          },
          disposition: {
            enum: ["REWRITTEN", "MERGED", "OMITTED_FOR_BREVITY"],
          },
          reason: { type: "string", minLength: 1, maxLength: 240 },
        },
      },
    },
    semantic_operations: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      uniqueItems: true,
      items: {
        enum: ["SIMPLIFY", "COMPRESS", "REORDER", "MERGE", "NATURALIZE"],
      },
    },
  },
};

const FACT_COMPOSITION_PROPOSAL_DRAFT_SCHEMA: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: ["fact_composition_proposal_draft_version", "proposals"],
  properties: {
    fact_composition_proposal_draft_version: { const: 1 },
    proposals: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "proposal_id",
          "fact_refs",
          "composition_type",
          "editorial_reason_short",
          "target_audience",
        ],
        properties: {
          proposal_id: { type: "string", minLength: 1, maxLength: 128 },
          fact_refs: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", pattern: "^fact_[0-9]{3}$" },
          },
          composition_type: {
            enum: [
              "MULTI_STAGE_MECHANISM",
              "CROSS_MODULE_RELATION",
              "RESPONSIBILITY_BOUNDARY",
              "REPRESENTATION_FLOW",
              "LOCAL_BEHAVIOR",
              "API_SURFACE_PATTERN",
              "TYPE_AND_RUNTIME_BOUNDARY",
              "OTHER",
            ],
          },
          editorial_reason_short: {
            type: "string",
            minLength: 8,
            maxLength: 180,
            pattern: "^[^\\r\\n]+$",
          },
          target_audience: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { enum: CONTENT_ANGLE_AUDIENCE_ENUM },
          },
        },
      },
    },
  },
};

const EDITORIAL_FRAMING_DRAFT_SCHEMA: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: ["editorial_framing_draft_version", "candidates"],
  properties: {
    editorial_framing_draft_version: { const: 1 },
    candidates: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "candidate_id",
          "proposal_id",
          "title",
          "angle_type",
          "editorial_thesis",
          "why_interesting",
          "target_audience",
          "supporting_fact_refs",
        ],
        properties: {
          candidate_id: { type: "string", minLength: 1, maxLength: 128 },
          proposal_id: { type: "string", minLength: 1, maxLength: 128 },
          title: { type: "string", minLength: 1, maxLength: 200 },
          angle_type: { enum: CONTENT_ANGLE_TYPE_ENUM },
          editorial_thesis: { type: "string", minLength: 1, maxLength: 600 },
          why_interesting: { type: "string", minLength: 1, maxLength: 600 },
          target_audience: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { enum: CONTENT_ANGLE_AUDIENCE_ENUM },
          },
          editorial_confidence: { enum: ["LOW", "MEDIUM", "HIGH"] },
          supporting_fact_refs: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", pattern: "^fact_[0-9]{3}$" },
          },
        },
      },
    },
  },
};

const CONTRACTS: Readonly<Record<string, StructuredOutputContract>> = {
  "internal:brief-narrative:1": {
    schema: BRIEF_SCHEMA,
    fieldAliases: { one_sentence: "oneSentence", target_users: "targetUsers" },
  },
  "internal:angle-narrative:1": {
    schema: ANGLE_SCHEMA,
    fieldAliases: { why_interesting: "whyInteresting" },
  },
  "internal:content-narrative:1": {
    schema: CONTENT_SCHEMA,
    fieldAliases: {},
  },
  "internal:grounded-brief-surface-draft:1": {
    schema: GROUNDED_BRIEF_SURFACE_DRAFT_SCHEMA,
    fieldAliases: {},
  },
  "internal:content-angle-candidate-draft:1": {
    schema: CONTENT_ANGLE_CANDIDATE_DRAFT_SCHEMA,
    fieldAliases: {},
  },
  "internal:minimal-angle-decision-draft:1": {
    schema: MINIMAL_ANGLE_DECISION_DRAFT_SCHEMA,
    fieldAliases: {},
  },
  "internal:minimal-angle-decision-draft:2": {
    schema: MINIMAL_ANGLE_DECISION_DRAFT_V2_SCHEMA,
    fieldAliases: {},
  },
  "internal:minimal-angle-decision-model-refs:1": {
    schema: MINIMAL_ANGLE_DECISION_MODEL_REFS_SCHEMA,
    fieldAliases: {},
  },
  "internal:neighborhood-angle-decision:1": {
    schema: NEIGHBORHOOD_ANGLE_DECISION_SCHEMA,
    fieldAliases: {},
  },
  "internal:fact-composition-proposal-draft:1": {
    schema: FACT_COMPOSITION_PROPOSAL_DRAFT_SCHEMA,
    fieldAliases: {},
  },
  "internal:editorial-framing-draft:1": {
    schema: EDITORIAL_FRAMING_DRAFT_SCHEMA,
    fieldAliases: {},
  },
  "internal:grounded-script-model-draft:1": {
    schema: GROUNDED_SCRIPT_MODEL_DRAFT_SCHEMA,
    fieldAliases: {},
  },
  "internal:grounded-expression-model-draft:1": {
    schema: GROUNDED_EXPRESSION_MODEL_DRAFT_SCHEMA,
    fieldAliases: {},
  },
};

export function structuredOutputContract(schemaId: string): StructuredOutputContract | null {
  return CONTRACTS[schemaId] ?? null;
}

function removeTrailingCommas(input: string): { text: string; changed: boolean } {
  let output = "";
  let inString = false;
  let escaped = false;
  let changed = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? "";
    if (inString) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === ",") {
      let next = index + 1;
      while (/\s/.test(input[next] ?? "")) next += 1;
      if (input[next] === "}" || input[next] === "]") {
        changed = true;
        continue;
      }
    }
    output += character;
  }
  return { text: output, changed };
}

function extractObject(input: string): string | null {
  const start = input.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const character = input[index] ?? "";
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(start, index + 1);
    }
  }
  return null;
}

function parseJson(input: string, actions: string[]): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    let repaired = input.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(repaired);
    if (fenced?.[1] !== undefined) {
      repaired = fenced[1].trim();
      actions.push("removed_markdown_fence");
    } else if (!repaired.startsWith("{") || !repaired.endsWith("}")) {
      const extracted = extractObject(repaired);
      if (extracted !== null) {
        repaired = extracted;
        actions.push("extracted_json_object");
      }
    }
    const commaRepair = removeTrailingCommas(repaired);
    if (commaRepair.changed) actions.push("removed_trailing_comma");
    try {
      return JSON.parse(commaRepair.text) as unknown;
    } catch {
      throw new StructuredOutputError(
        "JSON_SYNTAX_INVALID",
        "Model output was not valid JSON after the bounded syntax repair pass.",
      );
    }
  }
}

function normalizeEnum(value: unknown, schema: unknown, path: string, actions: string[]): unknown {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return value;
  const schemaRecord = schema as Record<string, unknown>;
  if (typeof value === "string" && Array.isArray(schemaRecord.enum)) {
    const choices = schemaRecord.enum.filter((candidate): candidate is string => typeof candidate === "string");
    const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const match = choices.find(
      (choice) => choice.toLowerCase().replace(/[\s-]+/g, "_") === key,
    );
    if (match !== undefined && match !== value) {
      actions.push(`normalized_enum:${path}:${value}->${match}`);
      return match;
    }
    return value;
  }
  if (Array.isArray(value) && schemaRecord.items !== undefined) {
    return value.map((item, index) =>
      normalizeEnum(item, schemaRecord.items, `${path}/${index}`, actions),
    );
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties =
      schemaRecord.properties !== null && typeof schemaRecord.properties === "object"
        ? (schemaRecord.properties as Record<string, unknown>)
        : {};
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeEnum(item, properties[key], `${path}/${key}`, actions),
      ]),
    );
  }
  return value;
}

function renameFields(
  value: unknown,
  aliases: Readonly<Record<string, string>>,
  actions: string[],
): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const object = { ...(value as Record<string, unknown>) };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (!(alias in object)) continue;
    if (canonical in object) {
      throw new StructuredOutputError(
        "AMBIGUOUS_FIELD",
        `Model output contained both ${alias} and ${canonical}.`,
      );
    }
    object[canonical] = object[alias];
    delete object[alias];
    actions.push(`renamed_field:${alias}->${canonical}`);
  }
  return object;
}

function formatErrors(errors: readonly ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`)
    .join("; ");
}

export function parseStructuredOutput(
  raw: string,
  contract: StructuredOutputContract,
): StructuredOutputResult {
  const actions: string[] = [];
  const parsed = parseJson(raw, actions);
  const renamed = renameFields(parsed, contract.fieldAliases, actions);
  const normalized = normalizeEnum(renamed, contract.schema, "", actions);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(contract.schema);
  if (!validate(normalized)) {
    throw new StructuredOutputError(
      "SCHEMA_VALIDATION_FAILED",
      `Model output did not match the requested schema: ${formatErrors(validate.errors)}`,
    );
  }
  return { value: normalized, repairActions: actions };
}
