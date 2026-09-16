import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import type { EvidenceRecord, FactStatus } from "../src/analysis/domain.js";
import { evaluateClaimSemantics } from "../src/quality/claim-semantics.js";

function verifiedSourceEvidence(input: {
  readonly id?: string;
  readonly claim: string;
  readonly evidenceType: "source_range" | "symbol_declaration";
  readonly path: string;
  readonly excerpt: string;
  readonly symbol?: {
    readonly name: string;
    readonly kind: "function" | "interface" | "type" | "constant";
  };
}): EvidenceRecord {
  return {
    evidence_record_version: 1,
    id: input.id ?? "evidence_test",
    claim_id: "claim_test",
    claim: input.claim,
    evidence_type: input.evidenceType,
    source_kind: "source_code",
    repository: {
      url: "https://github.com/fixture/claim-semantics",
      commit_sha: "a".repeat(40),
    },
    locator: {
      source_path: input.path,
      line_start: 10,
      line_end: 12,
      excerpt: input.excerpt,
      ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
    },
    supports_evidence_ids: [],
    confidence: 1,
    verification_status: "verified",
    verification: {
      method: input.evidenceType === "symbol_declaration" ? "ast_symbol" : "exact_text",
      checked_at: "2026-09-01T00:00:00.000Z",
      commit_resolved: true,
      path_exists: true,
      symbol_exists: input.evidenceType === "symbol_declaration" ? true : null,
      line_range_valid: true,
      excerpt_matches: true,
    },
    notes: "",
    limitations: [],
  };
}

function verifiedManifestEvidence(input: {
  readonly id?: string;
  readonly claim: string;
  readonly pointer: string;
  readonly value: unknown;
  readonly path?: string;
}): EvidenceRecord {
  return {
    evidence_record_version: 1,
    id: input.id ?? "evidence_manifest",
    claim_id: "claim_manifest",
    claim: input.claim,
    evidence_type: "manifest_field",
    source_kind: "manifest",
    repository: {
      url: "https://github.com/fixture/claim-semantics",
      commit_sha: "a".repeat(40),
    },
    locator: {
      source_path: input.path ?? "package.json",
      field_pointer: input.pointer,
      excerpt: JSON.stringify(input.value),
    },
    supports_evidence_ids: [],
    confidence: 1,
    verification_status: "verified",
    verification: {
      method: "manifest_parse",
      checked_at: "2026-09-01T00:00:00.000Z",
      commit_resolved: true,
      path_exists: true,
      symbol_exists: null,
      line_range_valid: null,
      excerpt_matches: true,
    },
    notes: "",
    limitations: [],
  };
}

function documentationEvidence(claim: string, excerpt: string): EvidenceRecord {
  return {
    evidence_record_version: 1,
    id: "evidence_documentation",
    claim_id: "claim_test",
    claim,
    evidence_type: "documentation_statement",
    source_kind: "documentation",
    repository: {
      url: "https://github.com/fixture/claim-semantics",
      commit_sha: "a".repeat(40),
    },
    locator: { source_path: "README.md", line_start: 1, line_end: 1, excerpt },
    supports_evidence_ids: [],
    confidence: 0.8,
    verification_status: "documentation",
    verification: {
      method: "documentation_read",
      checked_at: "2026-09-01T00:00:00.000Z",
      commit_resolved: true,
      path_exists: true,
      symbol_exists: null,
      line_range_valid: true,
      excerpt_matches: true,
    },
    notes: "",
    limitations: ["Project-authored marketing language is not a comparative benchmark."],
  };
}

function assess(
  statement: string,
  evidence: readonly EvidenceRecord[],
  requestedStatus: FactStatus = "verified",
) {
  return evaluateClaimSemantics({ statement, requestedStatus }, evidence);
}

test("F: an exact declaration claim remains verified", () => {
  const statement = "function mergeDefaults is declared in src/merge.ts.";
  const evidence = verifiedSourceEvidence({
    claim: statement,
    evidenceType: "symbol_declaration",
    path: "src/merge.ts",
    excerpt: "export function mergeDefaults() {}",
    symbol: { name: "mergeDefaults", kind: "function" },
  });

  const result = assess(statement, [evidence]);

  assert.equal(result.scope, "LOCAL");
  assert.equal(result.strength, "DESCRIPTIVE");
  assert.equal(result.semanticStatus, "SUPPORTED");
  assert.equal(result.verifiedAllowed, true);
  assert.equal(result.recommendedAction, "ALLOW");
  assert.deepEqual(result.supportingEvidenceIds, ["evidence_test"]);
});

test("G: an exact local undefined branch claim remains verified", () => {
  const statement = "In src/merge.ts, this branch skips a value when value is undefined.";
  const evidence = verifiedSourceEvidence({
    claim: statement,
    evidenceType: "source_range",
    path: "src/merge.ts",
    excerpt: "if (value === undefined) continue;",
  });

  const result = assess(statement, [evidence]);

  assert.equal(result.scope, "LOCAL");
  assert.equal(result.strength, "BEHAVIOR");
  assert.equal(result.semanticStatus, "SUPPORTED");
  assert.equal(result.verifiedAllowed, true);
});

test("Golden positives A-D keep exact declaration, package export, branch check, and import facts", () => {
  const declaration = "function mergeDefaults is declared in src/merge.ts.";
  const packageExport = 'package.json declares export ".".';
  const branchCheck = "In src/merge.ts, this branch checks `value === undefined`.";
  const importRelationship = "src/index.ts imports src/merge.ts through ./merge.";
  const cases = [
    [
      declaration,
      verifiedSourceEvidence({
        id: "evidence_declaration",
        claim: declaration,
        evidenceType: "symbol_declaration",
        path: "src/merge.ts",
        excerpt: "export function mergeDefaults() {}",
        symbol: { name: "mergeDefaults", kind: "function" },
      }),
      "DECLARATION",
    ],
    [
      packageExport,
      verifiedManifestEvidence({
        id: "evidence_export",
        claim: packageExport,
        pointer: "/exports/.",
        value: { import: "./dist/index.mjs" },
      }),
      "PACKAGE_EXPORT",
    ],
    [
      branchCheck,
      verifiedSourceEvidence({
        id: "evidence_branch",
        claim: branchCheck,
        evidenceType: "source_range",
        path: "src/merge.ts",
        excerpt: "if (value === undefined) { continue; }",
      }),
      "BRANCH_BEHAVIOR",
    ],
    [
      importRelationship,
      verifiedSourceEvidence({
        id: "evidence_import",
        claim: importRelationship,
        evidenceType: "source_range",
        path: "src/index.ts",
        excerpt: 'import { mergeDefaults } from "./merge";',
      }),
      "IMPORT_RELATIONSHIP",
    ],
  ] as const;

  for (const [statement, evidence, claimType] of cases) {
    const result = assess(statement, [evidence]);
    assert.equal(result.claimType, claimType, statement);
    assert.equal(result.semanticStatus, "SUPPORTED", statement);
    assert.equal(result.recommendedAction, "ALLOW", statement);
    assert.equal(result.verifiedAllowed, true, statement);
    assert.deepEqual(result.supportingEvidenceIds, [evidence.id], statement);
    assert.deepEqual(result.evidenceCompatibility.compatibleEvidenceIds, [evidence.id]);
  }
});

test("a source export remains distinct from a package export and requires its symbol declaration", () => {
  const statement = "src/index.ts exports `createTool`.";
  const evidence = verifiedSourceEvidence({
    id: "evidence_source_export",
    claim: statement,
    evidenceType: "symbol_declaration",
    path: "src/index.ts",
    excerpt: "export function createTool() {}",
    symbol: { name: "createTool", kind: "function" },
  });

  const result = assess(statement, [evidence]);
  assert.equal(result.claimType, "DECLARATION");
  assert.equal(result.semanticStatus, "SUPPORTED");
  assert.equal(result.recommendedAction, "ALLOW");
  assert.deepEqual(result.supportingEvidenceIds, ["evidence_source_export"]);
});

test("an exact package type declaration requires the matching manifest path, pointer, and value", () => {
  const cases = [
    { path: "package.json", statement: 'package.json declares package type "module".' },
    {
      path: "archify/package.json",
      statement: 'archify/package.json declares package type "module".',
    },
  ];

  for (const entry of cases) {
    const accepted = assess(entry.statement, [
      verifiedManifestEvidence({
        claim: entry.statement,
        path: entry.path,
        pointer: "/type",
        value: "module",
      }),
    ]);
    assert.equal(accepted.semanticStatus, "SUPPORTED");
    assert.equal(accepted.verifiedAllowed, true);
    assert.deepEqual(accepted.supportingEvidenceIds, ["evidence_manifest"]);

    const wrongPointer = assess(entry.statement, [
      verifiedManifestEvidence({
        claim: entry.statement,
        path: entry.path,
        pointer: "/name",
        value: "module",
      }),
    ]);
    assert.equal(wrongPointer.verifiedAllowed, false);
  }
});

test("a dependency declaration binds to the selected root or nested package manifest", () => {
  const cases = [
    {
      path: "package.json",
      dependency: "typescript",
      statement: "typescript is declared in package.json dependencies.",
    },
    {
      path: "apps/desktop/package.json",
      dependency: "@tiptap/extension-bubble-menu",
      statement:
        "@tiptap/extension-bubble-menu is declared in apps/desktop/package.json dependencies.",
    },
  ];

  for (const entry of cases) {
    const pointer = `/dependencies/${entry.dependency.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    const accepted = assess(entry.statement, [
      verifiedManifestEvidence({
        claim: entry.statement,
        path: entry.path,
        pointer,
        value: "1.0.0",
      }),
    ]);
    assert.equal(accepted.semanticStatus, "SUPPORTED", entry.statement);
    assert.equal(accepted.verifiedAllowed, true, entry.statement);

    const wrongManifest = assess(entry.statement, [
      verifiedManifestEvidence({
        claim: entry.statement,
        path: "package.json",
        pointer,
        value: "1.0.0",
      }),
    ]);
    if (entry.path !== "package.json") assert.equal(wrongManifest.verifiedAllowed, false);
  }
});

test("an ESM entry requires the exact package manifest field", () => {
  const statement = 'package.json declares ESM entry "./dist/index.mjs".';
  const manifest = verifiedManifestEvidence({
    claim: statement,
    pointer: "/exports/./import",
    value: "./dist/index.mjs",
  });
  const unrelatedType = verifiedSourceEvidence({
    claim: statement,
    evidenceType: "symbol_declaration",
    path: "src/types.ts",
    excerpt: "export type Entry = string;",
    symbol: { name: "Entry", kind: "type" },
  });

  const accepted = assess(statement, [manifest]);
  assert.equal(accepted.claimType, "PACKAGE_EXPORT");
  assert.equal(accepted.recommendedAction, "ALLOW");
  assert.deepEqual(accepted.supportingEvidenceIds, ["evidence_manifest"]);

  const topLevelConditions = verifiedManifestEvidence({
    id: "evidence_top_level_import",
    claim: statement,
    pointer: "/exports/import",
    value: "./dist/index.mjs",
  });
  assert.equal(assess(statement, [topLevelConditions]).recommendedAction, "ALLOW");

  const rejected = assess(statement, [unrelatedType]);
  assert.equal(rejected.verifiedAllowed, false);
  assert.equal(rejected.recommendedAction, "DOWNGRADE");
  assert.deepEqual(rejected.supportingEvidenceIds, []);
  assert.ok(rejected.reasonCodes.includes("PACKAGE_EXPORT_REQUIRES_MANIFEST_EVIDENCE"));
});

test("A: a function declaration cannot verify an efficiency outcome", () => {
  const statement = "The mergeDefaults function improves developer efficiency.";
  const evidence = verifiedSourceEvidence({
    claim: statement,
    evidenceType: "symbol_declaration",
    path: "src/merge.ts",
    excerpt: "export function mergeDefaults() {}",
    symbol: { name: "mergeDefaults", kind: "function" },
  });

  const result = assess(statement, [evidence]);

  assert.equal(result.strength, "OUTCOME");
  assert.equal(result.semanticStatus, "OUTCOME_UNSUPPORTED");
  assert.equal(result.verifiedAllowed, false);
  assert.equal(result.recommendedAction, "DOWNGRADE");
  assert.equal(result.narrowedStatement, undefined);
  assert.deepEqual(result.supportingEvidenceIds, []);
  assert.ok(result.reasonCodes.includes("NARROWING_SEMANTIC_ALIGNMENT_FAILED"));
});

test("B: an interface declaration cannot verify error prevention", () => {
  const statement = "The Config interface prevents configuration errors.";
  const evidence = verifiedSourceEvidence({
    claim: statement,
    evidenceType: "symbol_declaration",
    path: "src/types.ts",
    excerpt: "export interface Config { mode: string }",
    symbol: { name: "Config", kind: "interface" },
  });

  const result = assess(statement, [evidence]);

  assert.equal(result.strength, "OUTCOME");
  assert.equal(result.semanticStatus, "OUTCOME_UNSUPPORTED");
  assert.equal(result.verifiedAllowed, false);
  assert.equal(result.recommendedAction, "DOWNGRADE");
  assert.equal(result.narrowedStatement, undefined);
});

test("D: absence of observed dangerous code cannot verify project safety", () => {
  const statement = "The library has no security risk.";
  const evidence = verifiedSourceEvidence({
    claim: statement,
    evidenceType: "source_range",
    path: "src/index.ts",
    excerpt: "export function identity(value: unknown) { return value; }",
  });

  const result = assess(statement, [evidence]);

  assert.equal(result.scope, "PROJECT");
  assert.equal(result.strength, "SAFETY");
  assert.equal(result.semanticStatus, "SAFETY_UNSUPPORTED");
  assert.equal(result.verifiedAllowed, false);
  assert.equal(result.allowedStatus, "unknown");
  assert.equal(result.recommendedAction, "REJECT");
});

test("C: one undefined branch cannot verify an always-all-nullish claim", () => {
  const statement = "All nullish values are always skipped.";
  const evidence = verifiedSourceEvidence({
    claim: statement,
    evidenceType: "source_range",
    path: "src/merge.ts",
    excerpt: "if (value === undefined) {\n  continue;\n}",
  });

  const result = assess(statement, [evidence]);

  assert.equal(result.scope, "UNIVERSAL");
  assert.equal(result.strength, "UNIVERSAL");
  assert.equal(result.semanticStatus, "UNIVERSAL_UNSUPPORTED");
  assert.equal(result.verifiedAllowed, false);
  assert.equal(result.recommendedAction, "NARROW");
  assert.equal(
    result.narrowedStatement,
    "In src/merge.ts, the shown branch skips a value when value is undefined.",
  );
  assert.deepEqual(result.narrowingProvenance, {
    originalClaim: statement,
    finalClaim: "In src/merge.ts, the shown branch skips a value when value is undefined.",
    removedModifiers: ["all", "always"],
    addedScopeQualifier: "In src/merge.ts, the shown branch",
    preservedSemanticAnchors: {
      entities: [],
      predicates: ["skip"],
      objects: ["nullish_value", "value"],
      outcomes: [],
    },
    evidenceIds: ["evidence_test"],
    reason: "The narrowed claim preserves the original predicate and object while adding only an evidence-bound local scope.",
  });
});

test("E: README speed marketing remains documentation, not a verified comparison", () => {
  const statement = "The project is faster than alternatives.";
  const evidence = documentationEvidence(statement, "A blazing fast merge utility.");

  const result = assess(statement, [evidence]);

  assert.equal(result.scope, "PROJECT");
  assert.equal(result.strength, "OUTCOME");
  assert.equal(result.semanticStatus, "DOCUMENTATION_ONLY");
  assert.equal(result.verifiedAllowed, false);
  assert.equal(result.allowedStatus, "documentation");
  assert.equal(result.recommendedAction, "DOWNGRADE");
});

test("project-wide behavior is narrowed to the exact source branch", () => {
  const statement = "The implementation skips nullish values.";
  const evidence = verifiedSourceEvidence({
    claim: statement,
    evidenceType: "source_range",
    path: "src/defu.ts",
    excerpt: "if (value === null || value === undefined) {\n  continue;\n}",
  });

  const result = assess(statement, [evidence]);

  assert.equal(result.scope, "PROJECT");
  assert.equal(result.strength, "BEHAVIOR");
  assert.equal(result.semanticStatus, "OVERBROAD");
  assert.equal(result.verifiedAllowed, false);
  assert.equal(result.recommendedAction, "NARROW");
  assert.equal(
    result.narrowedStatement,
    "In src/defu.ts, the shown branch skips a value when value is null or undefined.",
  );
});

test("a true but unrelated branch fact cannot replace a project merge claim", () => {
  const statement = "defu recursively merges objects.";
  const evidence = verifiedSourceEvidence({
    claim: statement,
    evidenceType: "source_range",
    path: "src/defu.ts",
    excerpt: "if (value === null || value === undefined) {\n  continue;\n}",
  });

  const result = assess(statement, [evidence]);

  assert.equal(result.semanticStatus, "OVERBROAD");
  assert.equal(result.recommendedAction, "DOWNGRADE");
  assert.equal(result.narrowedStatement, undefined);
  assert.ok(result.reasonCodes.includes("NARROWING_SEMANTIC_ALIGNMENT_FAILED"));
  assert.equal(result.narrowingAlignment?.aligned, false);
  assert.ok(result.narrowingAlignment?.reasonCodes.includes("PRIMARY_PREDICATE_NOT_PRESERVED"));
});

test("high-risk language cannot become verified without matching evidence strength", () => {
  const cases = [
    ["The library always returns a valid result.", "UNIVERSAL_UNSUPPORTED"],
    ["The library never fails.", "UNIVERSAL_UNSUPPORTED"],
    ["All inputs are handled.", "UNIVERSAL_UNSUPPORTED"],
    ["Every configuration works.", "UNIVERSAL_UNSUPPORTED"],
    ["The function guarantees correct output.", "UNIVERSAL_UNSUPPORTED"],
    ["The interface ensures correct configuration.", "UNIVERSAL_UNSUPPORTED"],
    ["The type prevents failures.", "OUTCOME_UNSUPPORTED"],
    ["The helper eliminates errors.", "OUTCOME_UNSUPPORTED"],
    ["The package is safe by design.", "SAFETY_UNSUPPORTED"],
    ["The package is secure by default.", "SAFETY_UNSUPPORTED"],
    ["The library has no security risk.", "SAFETY_UNSUPPORTED"],
    ["The operation cannot fail.", "UNIVERSAL_UNSUPPORTED"],
    ["The abstraction has zero overhead.", "UNIVERSAL_UNSUPPORTED"],
    ["The process is error-free.", "UNIVERSAL_UNSUPPORTED"],
    ["The parser fully handles inputs.", "UNIVERSAL_UNSUPPORTED"],
    ["The parser completely avoids invalid input.", "UNIVERSAL_UNSUPPORTED"],
    ["The parser automatically avoids invalid input.", "UNIVERSAL_UNSUPPORTED"],
    ["The helper improves performance.", "OUTCOME_UNSUPPORTED"],
    ["The helper improves developer efficiency.", "OUTCOME_UNSUPPORTED"],
    ["The interface reduces errors.", "OUTCOME_UNSUPPORTED"],
    ["The implementation is more reliable.", "OUTCOME_UNSUPPORTED"],
    ["The utility is lightweight.", "OUTCOME_UNSUPPORTED"],
    ["The helper is safer.", "OUTCOME_UNSUPPORTED"],
    ["The helper offers better performance.", "OUTCOME_UNSUPPORTED"],
    ["The helper is faster.", "OUTCOME_UNSUPPORTED"],
    ["The type enables safer configuration.", "OUTCOME_UNSUPPORTED"],
    ["The wrapper facilitates integration.", "OUTCOME_UNSUPPORTED"],
  ] as const;

  for (const [statement, expectedStatus] of cases) {
    const result = assess(statement, []);
    assert.equal(result.verifiedAllowed, false, statement);
    assert.equal(result.semanticStatus, expectedStatus, statement);
  }
});

test("behavior verbs remain behavior claims rather than descriptive facts", () => {
  for (const statement of [
    "The implementation preserves defaults.",
    "The helper overrides an existing value.",
    "The function handles arrays.",
  ]) {
    assert.equal(assess(statement, []).strength, "BEHAVIOR", statement);
  }
});

test("safety morphology detects outcome modifiers without substring false positives", () => {
  const safetyStatements = [
    "The helper safely merges configuration.",
    "The helper provides safety for configuration.",
    "The helper securely handles input.",
    "The helper provides security for configuration.",
    "The operation has risks.",
    "The operation is risk-free.",
    "The operation completes without risk.",
    "The operation has no risk.",
    "The parser is vulnerable.",
    "The parser has a vulnerability.",
    "The parser has vulnerabilities.",
    "The guard protects input.",
    "The input is protected.",
    "The guard provides protection.",
    "The guard prevents attacks.",
    "The helper cannot leak input.",
    "The helper prevents leakage.",
  ];

  for (const statement of safetyStatements) {
    assert.equal(assess(statement, []).strength, "SAFETY", statement);
  }
  assert.equal(assess("The helper uses a failsafe counter.", []).strength, "DESCRIPTIVE");
  assert.equal(assess("The module reads safetyParser.ts.", []).strength, "BEHAVIOR");
  assert.equal(assess("The module reads src/safety.ts.", []).strength, "BEHAVIOR");
  assert.equal(assess("The module reads src/performance.ts.", []).strength, "BEHAVIOR");
  assert.equal(assess("The helper calls `safe`.", []).strength, "BEHAVIOR");
});

test("high-risk words inside exact identifiers and paths do not create false positives", () => {
  const statement = "function all is declared in src/performance.ts.";
  const evidence = verifiedSourceEvidence({
    claim: statement,
    evidenceType: "symbol_declaration",
    path: "src/performance.ts",
    excerpt: "export function all() {}",
    symbol: { name: "all", kind: "function" },
  });

  const result = assess(statement, [evidence]);

  assert.equal(result.scope, "LOCAL");
  assert.equal(result.strength, "DESCRIPTIVE");
  assert.equal(result.semanticStatus, "SUPPORTED");
  assert.equal(result.verifiedAllowed, true);
});

test("outcome narrowing cannot substitute an unrelated declaration", () => {
  const statement = "The project is lightweight.";
  const evidence = verifiedSourceEvidence({
    claim: statement,
    evidenceType: "symbol_declaration",
    path: "src/index.ts",
    excerpt: "export function greet() {}",
    symbol: { name: "greet", kind: "function" },
  });

  const result = assess(statement, [evidence]);

  assert.equal(result.semanticStatus, "OUTCOME_UNSUPPORTED");
  assert.equal(result.recommendedAction, "DOWNGRADE");
  assert.equal(result.narrowedStatement, undefined);
});

test("Golden negatives E-H reject evidence-type substitution", () => {
  const functionEvidence = verifiedSourceEvidence({
    id: "evidence_function",
    claim: "function mergeDefaults is declared in src/merge.ts.",
    evidenceType: "symbol_declaration",
    path: "src/merge.ts",
    excerpt: "export function mergeDefaults() {}",
    symbol: { name: "mergeDefaults", kind: "function" },
  });
  const typeEvidence = verifiedSourceEvidence({
    id: "evidence_type",
    claim: "type Merge is declared in src/types.ts.",
    evidenceType: "symbol_declaration",
    path: "src/types.ts",
    excerpt: "export type Merge<T> = T;",
    symbol: { name: "Merge", kind: "type" },
  });
  const branchEvidence = verifiedSourceEvidence({
    id: "evidence_branch",
    claim: "In src/merge.ts, this branch skips a value when value is undefined.",
    evidenceType: "source_range",
    path: "src/merge.ts",
    excerpt: "if (value === undefined) continue;",
  });
  const readmeEvidence = documentationEvidence(
    "The package is benchmark-verified lightweight.",
    "Lightweight and fast.",
  );
  const cases = [
    ["The mergeDefaults function improves efficiency.", [functionEvidence]],
    ["Type `Merge` always matches runtime behavior.", [typeEvidence]],
    ["The library safely handles all nullish values.", [branchEvidence]],
    ["The package is benchmark-verified lightweight.", [readmeEvidence]],
  ] as const;

  for (const [statement, evidence] of cases) {
    const result = assess(statement, evidence);
    assert.equal(result.verifiedAllowed, false, statement);
    assert.notEqual(result.recommendedAction, "ALLOW", statement);
  }
});

test("type declarations cannot prove runtime correspondence and signatures cannot prove immutability", () => {
  const typeEvidence = verifiedSourceEvidence({
    id: "evidence_type",
    claim: "type Merge is declared in src/types.ts.",
    evidenceType: "symbol_declaration",
    path: "src/types.ts",
    excerpt: "export type Merge<T> = T;",
    symbol: { name: "Merge", kind: "type" },
  });
  const signatureEvidence = verifiedSourceEvidence({
    id: "evidence_signature",
    claim: "type DefuFn is declared in src/types.ts.",
    evidenceType: "symbol_declaration",
    path: "src/types.ts",
    excerpt: "export type DefuFn = (input: Input) => Output;",
    symbol: { name: "DefuFn", kind: "type" },
  });

  const typeRuntime = assess("Type `Merge` always matches runtime behavior.", [typeEvidence]);
  assert.equal(typeRuntime.claimType, "TYPE_RUNTIME");
  assert.equal(typeRuntime.semanticStatus, "TYPE_RUNTIME_UNSUPPORTED");
  assert.equal(typeRuntime.verifiedAllowed, false);
  assert.ok(typeRuntime.reasonCodes.includes("TYPE_DECLARATION_CANNOT_PROVE_RUNTIME"));
  assert.deepEqual(typeRuntime.supportingEvidenceIds, []);

  const immutability = assess("The merge function preserves its inputs.", [signatureEvidence]);
  assert.equal(immutability.claimType, "IMMUTABILITY");
  assert.equal(immutability.semanticStatus, "IMMUTABILITY_UNSUPPORTED");
  assert.equal(immutability.verifiedAllowed, false);
  assert.ok(immutability.reasonCodes.includes("TYPE_OR_SIGNATURE_CANNOT_PROVE_IMMUTABILITY"));
  assert.deepEqual(immutability.supportingEvidenceIds, []);
});

test("real DeepSeek defu Brief replay catches both known semantic overclaims", () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "tests", "fixtures", "deepseek-v4-pro-defu-brief-retry.json"),
      "utf8",
    ),
  ) as {
    readonly rawBriefNarrative: {
      readonly oneSentence: string;
      readonly summary: string;
      readonly problem: string;
    };
    readonly evidenceSnapshot: EvidenceRecord;
  };
  const behaviorBefore = fixture.rawBriefNarrative.summary
    .split(". ")
    .find((sentence) => sentence.includes("skips nullish values"));
  const safetyBefore = fixture.rawBriefNarrative.problem;
  assert.ok(behaviorBefore !== undefined);
  assert.match(safetyBefore, /without mutating inputs or introducing security risks/);

  const behavior = assess(`${behaviorBefore}.`, [fixture.evidenceSnapshot]);
  const safety = assess(safetyBefore, [fixture.evidenceSnapshot]);
  const lightweight = assess(fixture.rawBriefNarrative.oneSentence, [fixture.evidenceSnapshot]);

  assert.equal(behavior.semanticStatus, "OVERBROAD");
  assert.equal(behavior.recommendedAction, "NARROW");
  assert.equal(
    behavior.narrowedStatement,
    "In src/defu.ts, the shown branch skips a value when value is null or undefined.",
  );
  assert.deepEqual(behavior.supportingEvidenceIds, ["evidence_symbol_src_defu_ts__defu_5"]);
  assert.equal(safety.semanticStatus, "SAFETY_UNSUPPORTED");
  assert.equal(safety.verifiedAllowed, false);
  assert.equal(safety.recommendedAction, "REJECT");
  assert.equal(safety.narrowedStatement, undefined);
  assert.deepEqual(safety.supportingEvidenceIds, []);
  assert.ok(safety.reasonCodes.includes("NARROWING_SEMANTIC_ALIGNMENT_FAILED"));
  assert.equal(
    assess(behavior.narrowedStatement ?? "", [fixture.evidenceSnapshot]).semanticStatus,
    "SUPPORTED",
  );
  assert.equal(lightweight.semanticStatus, "OUTCOME_UNSUPPORTED");
  assert.equal(lightweight.verifiedAllowed, false);
});
