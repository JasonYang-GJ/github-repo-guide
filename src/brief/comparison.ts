import type { GroundedBriefOfflineAssessment } from "./assessment.js";

export interface Vs02EOfflineComparison {
  readonly comparison_version: 1;
  readonly repository: "https://github.com/unjs/defu";
  readonly commit: "82632b66f5914e9946edce300e10633a3d5c0cb7";
  readonly baseline: {
    readonly name: "VS02-E_NATURAL_LANGUAGE_FIRST";
    readonly status: "NEW_SEMANTIC_GAP_NOT_ACCEPTED";
    readonly raw_atomic_statements: 24;
    readonly trace_valid_decisions: 24;
    readonly accepted_factual_statements: 0;
    readonly selected_evidence_traces: 0;
    readonly safely_expressed_known_unknowns: 0;
    readonly utility: "FAIL";
    readonly source_artifacts: readonly string[];
  };
  readonly candidate: {
    readonly name: "VS03_B_DETERMINISTIC_FACT_FIRST";
    readonly status: GroundedBriefOfflineAssessment["status"];
    readonly accepted_factual_statements: number;
    readonly selected_fact_traces: number;
    readonly selected_evidence_traces: number;
    readonly unsupported_claims_accepted: 0;
    readonly known_unknowns_preserved: number;
    readonly utility: GroundedBriefOfflineAssessment["verdicts"]["technical_utility"];
  };
  readonly dimensions: readonly {
    readonly name:
      | "TECHNICAL_COVERAGE"
      | "UNSUPPORTED_CLAIMS"
      | "TRACEABILITY"
      | "READABILITY"
      | "TECHNICAL_UTILITY"
      | "UNKNOWN_HANDLING";
    readonly result: "IMPROVED" | "TRADEOFF";
    readonly basis: string;
  }[];
  readonly caveat: string;
}

export function buildVs02EOfflineComparison(
  assessment: GroundedBriefOfflineAssessment,
): Vs02EOfflineComparison {
  return {
    comparison_version: 1,
    repository: "https://github.com/unjs/defu",
    commit: "82632b66f5914e9946edce300e10633a3d5c0cb7",
    baseline: {
      name: "VS02-E_NATURAL_LANGUAGE_FIRST",
      status: "NEW_SEMANTIC_GAP_NOT_ACCEPTED",
      raw_atomic_statements: 24,
      trace_valid_decisions: 24,
      accepted_factual_statements: 0,
      selected_evidence_traces: 0,
      safely_expressed_known_unknowns: 0,
      utility: "FAIL",
      source_artifacts: [
        "output/vs02-e-real-accepted-brief-canary/canary-result.json",
        "output/vs02-e-real-accepted-brief-canary/vs02-e-real-accepted-brief-human-review.md",
      ],
    },
    candidate: {
      name: "VS03_B_DETERMINISTIC_FACT_FIRST",
      status: assessment.status,
      accepted_factual_statements:
        assessment.factual_statements_with_valid_fact_trace,
      selected_fact_traces:
        assessment.factual_statements_with_valid_fact_trace,
      selected_evidence_traces: assessment.facts_with_valid_evidence_trace,
      unsupported_claims_accepted: 0,
      known_unknowns_preserved: assessment.known_unknowns_preserved,
      utility: assessment.verdicts.technical_utility,
    },
    dimensions: [
      {
        name: "TECHNICAL_COVERAGE",
        result: "IMPROVED",
        basis:
          "VS02-E retained zero accepted factual statements; VS03-B realizes the selected structural, relation, behavior, configuration, export, and type facts.",
      },
      {
        name: "UNSUPPORTED_CLAIMS",
        result: "IMPROVED",
        basis:
          "VS02-E's 24 raw atomic decisions all required downgrade or rejection; the accepted VS03-B Brief has zero gate findings.",
      },
      {
        name: "TRACEABILITY",
        result: "IMPROVED",
        basis:
          "VS02-E had trace-valid review decisions but selected zero final Evidence; VS03-B preserves Statement -> Fact -> Evidence for every factual statement.",
      },
      {
        name: "READABILITY",
        result: "TRADEOFF",
        basis:
          "VS02-E raw prose is more fluent but unaccepted. VS03-B is readable and accepted, but intentionally more mechanical and repetitive.",
      },
      {
        name: "TECHNICAL_UTILITY",
        result: "IMPROVED",
        basis:
          "VS02-E utility was FAIL after filtering. VS03-B retains usable public-surface, structure, relation, local behavior, and type statements.",
      },
      {
        name: "UNKNOWN_HANDLING",
        result: "IMPROVED",
        basis:
          "VS02-E raw prose did not safely express the host unknown boundary. VS03-B renders each Fact IR unsupported area as a formal evidence gap.",
      },
    ],
    caveat:
      "This offline comparison does not re-score the VS02-E model output and does not overturn its NOT ACCEPTED verdict. It compares accepted downstream utility under different contracts.",
  };
}
