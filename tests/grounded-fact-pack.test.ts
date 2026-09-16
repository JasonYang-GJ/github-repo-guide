import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import type { CodebaseBrief, EvidenceRecord } from "../src/analysis/domain.js";
import { analyzeSnapshot } from "../src/analysis/pipeline.js";
import { FACT_EVIDENCE_COMPATIBILITY } from "../src/facts/compatibility.js";
import { buildGroundedFactPack } from "../src/facts/grounded-fact-pack.js";
import { validateGroundedFactPackIntegrity } from "../src/facts/integrity.js";
import {
  evaluateFactUtility,
  renderGroundedFactReport,
} from "../src/facts/report.js";
import { DeterministicModelProvider } from "../src/model/deterministic-provider.js";
import { readRepository } from "../src/repo/progressive-reader.js";
import {
  INTERNAL_SCHEMA_IDS,
  createSchemaRegistry,
} from "../src/schemas/registry.js";
import { FixtureRepositorySource } from "./support/fixture-repository-source.js";

const root = process.cwd();
const schemas = createSchemaRegistry(resolve(root, "schemas"));

async function fixtureBundle(name: string) {
  const source = new FixtureRepositorySource(
    resolve(root, "tests", "fixtures", name),
    name,
  );
  const snapshot = await readRepository(source, source.url);
  const bundle = await analyzeSnapshot(snapshot, {
    provider: new DeterministicModelProvider(),
    schemas,
    generatedAt: "2026-09-01T00:00:00.000Z",
    networkHosts: [],
  });
  return bundle;
}

async function fixturePack(name: string) {
  const bundle = await fixtureBundle(name);
  return buildGroundedFactPack({ brief: bundle.brief, evidence: bundle.evidence });
}

function defuBriefForEvidence(
  seed: CodebaseBrief,
  evidence: readonly EvidenceRecord[],
  sourcePath: string,
): CodebaseBrief {
  return {
    ...seed,
    repository: {
      ...seed.repository,
      url: "https://github.com/unjs/defu",
      owner: "unjs",
      name: "defu",
      commit_sha: "82632b66f5914e9946edce300e10633a3d5c0cb7",
    },
    overview: { ...seed.overview, project_name: "defu" },
    core_modules: [
      {
        id: `module_${sourcePath.replace(/[^A-Za-z0-9]+/g, "_")}`,
        name: sourcePath,
        responsibility: `Contains ${sourcePath}.`,
        source_paths: [sourcePath],
        status: "verified",
        confidence: 1,
        evidence_ids: evidence.map((record) => record.id),
      },
    ],
    relationships: [],
    important_symbols: [],
    claims: [],
    evidence,
  };
}

test("Golden A: verified function evidence becomes a declaration fact", async () => {
  const pack = await fixturePack("small-typescript-repo");
  const fact = pack.facts.find(
    (candidate) =>
      candidate.fact_type === "DECLARATION" &&
      candidate.predicate === "DECLARES" &&
      pack.entities.find((entity) => entity.id === candidate.object_ref)?.display_label ===
        "run",
  );

  assert.ok(fact !== undefined);
  assert.equal(fact.verification.status, "verified");
  assert.equal(fact.verification.confidence, 1);
  assert.deepEqual(fact.evidence_ids, ["evidence_symbol_src_index_ts_run_3"]);
  assert.equal(fact.provenance.repository.commit_sha, pack.commit);
  const evidence = pack.evidence_refs.find(
    (record) => record.id === "evidence_symbol_src_index_ts_run_3",
  );
  assert.match(evidence?.blob_sha ?? "", /^[0-9a-f]{40}$/);
  assert.match(evidence?.excerpt_sha256 ?? "", /^[0-9a-f]{64}$/);
  assert.equal(evidence?.source_path, "src/index.ts");
  assert.equal(evidence?.line_start, 3);
});

test("Golden B: verified package export evidence becomes an export fact", async () => {
  const pack = await fixturePack("small-typescript-repo");
  const fact = pack.facts.find(
    (candidate) =>
      candidate.fact_type === "EXPORT" && candidate.predicate === "EXPORTS",
  );
  assert.ok(fact !== undefined);

  const subject = pack.entities.find((entity) => entity.id === fact.subject_ref);
  const object = pack.entities.find((entity) => entity.id === fact.object_ref);
  assert.equal(subject?.kind, "package");
  assert.equal(subject?.display_label, "tiny-greeter");
  assert.equal(object?.kind, "manifest_field");
  assert.equal(object?.field_pointer, "/exports/.");
  assert.equal(object?.value, ".");
  assert.deepEqual(fact.evidence_ids, ["evidence_package_export_item"]);
});

test("Golden C: verified import evidence becomes an import relation fact", async () => {
  const pack = await fixturePack("small-typescript-repo");
  const fact = pack.facts.find(
    (candidate) =>
      candidate.fact_type === "IMPORT_RELATION" &&
      candidate.predicate === "IMPORTS",
  );
  assert.ok(fact !== undefined);

  const subject = pack.entities.find((entity) => entity.id === fact.subject_ref);
  const object = pack.entities.find((entity) => entity.id === fact.object_ref);
  assert.equal(subject?.kind, "module");
  assert.equal(subject?.source_path, "src/index.ts");
  assert.equal(object?.kind, "module");
  assert.equal(object?.source_path, "src/greet.ts");
  assert.equal(fact.evidence_ids.length, 1);
  const evidence = pack.evidence_refs.find((record) => record.id === fact.evidence_ids[0]);
  assert.equal(evidence?.evidence_type, "source_range");
});

test("Golden D: exact branch condition and continue action become bounded behavior", async () => {
  const seed = await fixtureBundle("small-typescript-repo");
  const replay = JSON.parse(
    readFileSync(
      resolve(root, "tests", "fixtures", "deepseek-v4-pro-defu-vs02-c.json"),
      "utf8",
    ),
  ) as { readonly evidenceSnapshot: readonly EvidenceRecord[] };
  const branch = replay.evidenceSnapshot.find(
    (record) => record.id === "vs02_c_defu_branch",
  );
  assert.ok(branch !== undefined);
  const brief: CodebaseBrief = {
    ...seed.brief,
    repository: {
      ...seed.brief.repository,
      url: "https://github.com/unjs/defu",
      owner: "unjs",
      name: "defu",
      commit_sha: "82632b66f5914e9946edce300e10633a3d5c0cb7",
    },
    overview: { ...seed.brief.overview, project_name: "defu" },
    core_modules: [
      {
        id: "module_src_defu_ts",
        name: "src/defu",
        responsibility: "Contains the selected source file src/defu.ts.",
        source_paths: ["src/defu.ts"],
        status: "verified",
        confidence: 1,
        evidence_ids: [branch.id],
      },
    ],
    relationships: [],
    important_symbols: [],
    claims: [],
    evidence: [branch],
  };

  const pack = buildGroundedFactPack({ brief, evidence: [branch] });
  const fact = pack.facts.find(
    (candidate) =>
      candidate.fact_type === "BRANCH_BEHAVIOR" &&
      candidate.predicate === "SKIPS_WHEN",
  );
  assert.ok(fact !== undefined);
  const subject = pack.entities.find((entity) => entity.id === fact.subject_ref);
  const condition = pack.entities.find((entity) => entity.id === fact.object_ref);
  assert.equal(subject?.source_path, "src/defu.ts");
  assert.deepEqual(condition?.value, {
    operator: "OR",
    terms: [
      { left: "value", operator: "EQUALS", right: null },
      { left: "value", operator: "EQUALS", right: "undefined" },
    ],
  });
  assert.deepEqual(fact.qualifiers, [{ key: "ACTION", value: "CONTINUE" }]);
  assert.deepEqual(fact.evidence_ids, ["vs02_c_defu_branch"]);
});

test("Golden E: type evidence produces type facts but never runtime equivalence", async () => {
  const seed = await fixtureBundle("small-typescript-repo");
  const replay = JSON.parse(
    readFileSync(
      resolve(root, "tests", "fixtures", "deepseek-v4-pro-defu-vs02-c.json"),
      "utf8",
    ),
  ) as { readonly evidenceSnapshot: readonly EvidenceRecord[] };
  const typeEvidence = replay.evidenceSnapshot.find(
    (record) => record.id === "vs02_c_nullish_type",
  );
  assert.ok(typeEvidence !== undefined);
  const brief = defuBriefForEvidence(seed.brief, [typeEvidence], "src/types.ts");

  const pack = buildGroundedFactPack({ brief, evidence: [typeEvidence] });
  const typeFact = pack.facts.find(
    (candidate) =>
      candidate.fact_type === "TYPE_DECLARATION" &&
      candidate.predicate === "DECLARES_TYPE",
  );
  assert.ok(typeFact !== undefined);
  assert.deepEqual(typeFact.evidence_ids, ["vs02_c_nullish_type"]);
  assert.equal(
    pack.facts.some(
      (candidate) =>
        candidate.evidence_ids.includes("vs02_c_nullish_type") &&
        candidate.category === "BEHAVIORAL",
    ),
    false,
  );
});

test("Golden F: absence of dangerous code never becomes a safety guarantee", async () => {
  const pack = await fixturePack("small-typescript-repo");

  assert.equal(
    pack.facts.some((candidate) =>
      [candidate.fact_type, candidate.predicate].some((value) =>
        /safe|secure|prototype[_ -]?pollution/i.test(value),
      ),
    ),
    false,
  );
  assert.equal(
    pack.unsupported_areas.some((area) => area.id === "safety_guarantees"),
    true,
  );
});

test("Golden G: a function signature never proves input immutability", async () => {
  const pack = await fixturePack("small-typescript-repo");
  const declaration = pack.facts.find(
    (candidate) => candidate.fact_type === "DECLARATION",
  );
  assert.ok(declaration !== undefined);
  assert.equal(
    pack.facts.some((candidate) =>
      [candidate.fact_type, candidate.predicate].some((value) =>
        /immutab|nonmutat|no[_ -]?mutation/i.test(value),
      ),
    ),
    false,
  );
  assert.equal(
    pack.unsupported_areas.some((area) => area.id === "input_immutability"),
    true,
  );
});

test("Golden H: a README lightweight claim never becomes a performance fact", async () => {
  const seed = await fixtureBundle("small-typescript-repo");
  const documentation: EvidenceRecord = {
    evidence_record_version: 1,
    id: "evidence_readme_lightweight",
    claim_id: "claim_readme_lightweight",
    claim: "README.md describes the package as lightweight and fast.",
    evidence_type: "documentation_statement",
    source_kind: "documentation",
    repository: {
      url: seed.brief.repository.url,
      commit_sha: seed.brief.repository.commit_sha,
    },
    locator: {
      source_path: "README.md",
      line_start: 3,
      line_end: 3,
      excerpt: "Lightweight and fast.",
    },
    supports_evidence_ids: [],
    confidence: 1,
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
    notes: "A documentation statement, not a benchmark.",
    limitations: ["Does not measure runtime performance."],
  };
  const brief = {
    ...defuBriefForEvidence(seed.brief, [documentation], "README.md"),
    repository: seed.brief.repository,
    overview: seed.brief.overview,
  };

  const pack = buildGroundedFactPack({ brief, evidence: [documentation] });
  assert.equal(pack.facts.length, 0);
  assert.equal(
    pack.unsupported_areas.some((area) => area.id === "performance_outcomes"),
    true,
  );
});

test("Fact IR uses a fixed evidence compatibility matrix and closed references", async () => {
  assert.deepEqual(FACT_EVIDENCE_COMPATIBILITY, {
    DECLARATION: ["symbol_declaration"],
    TYPE_DECLARATION: ["symbol_declaration", "config_field"],
    EXPORT: ["manifest_field", "symbol_declaration"],
    IMPORT_RELATION: ["source_range"],
    CALL_RELATION: ["direct_call"],
    BRANCH_BEHAVIOR: ["source_range", "symbol_declaration"],
    CONFIGURATION: ["manifest_field", "config_field"],
    MODULE_CONTAINS: ["symbol_declaration"],
  });

  const pack = await fixturePack("small-typescript-repo");
  assert.deepEqual(validateGroundedFactPackIntegrity(pack), {
    valid: true,
    errors: [],
  });
});

test("a verified symbol declaration also creates a module containment fact", async () => {
  const pack = await fixturePack("small-typescript-repo");
  const fact = pack.facts.find(
    (candidate) =>
      candidate.fact_type === "MODULE_CONTAINS" && candidate.predicate === "CONTAINS",
  );
  assert.ok(fact !== undefined);
  const subject = pack.entities.find((entity) => entity.id === fact.subject_ref);
  const object = pack.entities.find((entity) => entity.id === fact.object_ref);
  assert.equal(subject?.kind, "module");
  assert.equal(object?.kind, "symbol");
  assert.ok(fact.evidence_ids.every((id) => object?.evidence_ids.includes(id)));
  assert.ok(
    fact.evidence_ids.every(
      (id) => pack.evidence_refs.find((record) => record.id === id)?.evidence_type === "symbol_declaration",
    ),
  );
});

test("an explicit exported source declaration creates a source export fact", async () => {
  const pack = await fixturePack("small-typescript-repo");
  const fact = pack.facts.find(
    (candidate) =>
      candidate.fact_type === "EXPORT" &&
      candidate.qualifiers.some(
        (qualifier) => qualifier.key === "EXPORT_SURFACE" && qualifier.value === "SOURCE",
      ),
  );
  assert.ok(fact !== undefined);
  const subject = pack.entities.find((entity) => entity.id === fact.subject_ref);
  const object = pack.entities.find((entity) => entity.id === fact.object_ref);
  assert.equal(subject?.kind, "module");
  assert.equal(object?.kind, "symbol");
  assert.match(object?.display_label ?? "", /greet|run/);
});

test("a verified manifest entry creates a literal configuration fact", async () => {
  const pack = await fixturePack("small-typescript-repo");
  const fact = pack.facts.find(
    (candidate) =>
      candidate.fact_type === "CONFIGURATION" &&
      candidate.predicate === "DECLARES_CONFIGURATION" &&
      candidate.qualifiers.some(
        (qualifier) =>
          qualifier.key === "CONFIGURATION_FIELD" && qualifier.value === "/module",
      ),
  );
  assert.ok(fact !== undefined);
  const object = pack.entities.find((entity) => entity.id === fact.object_ref);
  assert.equal(object?.kind, "manifest_field");
  assert.equal(object?.field_pointer, "/module");
  assert.equal(object?.value, "dist/index.js");
});

test("same canonical inputs produce byte-stable facts regardless of evidence order", async () => {
  const bundle = await fixtureBundle("small-typescript-repo");
  const forward = buildGroundedFactPack({
    brief: bundle.brief,
    evidence: bundle.evidence,
  });
  const reversed = buildGroundedFactPack({
    brief: bundle.brief,
    evidence: [...bundle.evidence].reverse(),
  });

  assert.deepEqual(reversed, forward);
  assert.equal(JSON.stringify(reversed), JSON.stringify(forward));
});

test("GroundedFactPack is a separate versioned internal schema", async () => {
  const pack = await fixturePack("small-typescript-repo");

  assert.deepEqual(schemas.internalSchemaIds(), INTERNAL_SCHEMA_IDS);
  assert.deepEqual(schemas.validate("GroundedFactPack", pack), {
    valid: true,
    errors: [],
  });
  assert.equal(pack.fact_ir_version, 2);
  assert.equal(pack.commit.length, 40);
});

test("fact report and utility receipt are deterministic and evidence-visible", async () => {
  const pack = await fixturePack("small-typescript-repo");
  const first = renderGroundedFactReport(pack);
  const second = renderGroundedFactReport(pack);
  const utility = evaluateFactUtility(pack);

  assert.equal(second, first);
  assert.match(first, /^# Grounded Facts/m);
  assert.match(first, new RegExp(pack.commit));
  assert.match(first, /DECLARES/);
  assert.match(first, /evidence_symbol_src_index_ts_run_3/);
  assert.match(first, /Not proven by this fact pack/);
  assert.equal(utility.status, "PARTIAL");
  assert.ok(utility.covered_capabilities.includes("structure"));
  assert.ok(utility.covered_capabilities.includes("relation"));
  assert.ok(utility.missing_capabilities.includes("behavior"));
});

test("an ambient declaration-file signature is type structure, not runtime behavior", async () => {
  const bundle = await fixtureBundle("small-typescript-repo");
  const runtime = bundle.evidence.find(
    (record) => record.id === "evidence_symbol_src_index_ts_run_3",
  );
  assert.ok(runtime !== undefined);
  const ambient: EvidenceRecord = {
    ...runtime,
    id: "evidence_symbol_lib_defu_d_cts_defuProxy_6",
    claim_id: "claim_ambient_defu_proxy",
    claim: "defuProxy is declared in lib/defu.d.cts.",
    repository: {
      url: "https://github.com/unjs/defu",
      commit_sha: "82632b66f5914e9946edce300e10633a3d5c0cb7",
    },
    locator: {
      ...runtime.locator,
      source_path: "lib/defu.d.cts",
      symbol: { name: "defuProxy", kind: "function" },
      excerpt: "declare function defuProxy(...args: unknown[]): unknown;",
    },
  };
  const brief = defuBriefForEvidence(bundle.brief, [ambient], "lib/defu.d.cts");

  const pack = buildGroundedFactPack({ brief, evidence: [ambient] });
  assert.equal(
    pack.facts.some(
      (fact) => fact.fact_type === "TYPE_DECLARATION" && fact.evidence_ids.includes(ambient.id),
    ),
    true,
  );
  assert.equal(
    pack.facts.some(
      (fact) => fact.fact_type === "DECLARATION" && fact.evidence_ids.includes(ambient.id),
    ),
    false,
  );
});

test("verified status without exact locator verification fails closed", async () => {
  const bundle = await fixtureBundle("small-typescript-repo");
  const runtime = bundle.evidence.find(
    (record) => record.id === "evidence_symbol_src_index_ts_run_3",
  );
  assert.ok(runtime !== undefined);
  const unverifiedLocator: EvidenceRecord = {
    ...runtime,
    id: "evidence_symbol_unverified_locator",
    verification: {
      ...runtime.verification,
      excerpt_matches: false,
    },
  };

  const pack = buildGroundedFactPack({
    brief: bundle.brief,
    evidence: [unverifiedLocator],
  });
  assert.equal(pack.facts.length, 0);
  assert.equal(pack.evidence_refs.length, 0);
});

test("an exact array branch becomes bounded concatenation behavior", async () => {
  const seed = await fixtureBundle("small-typescript-repo");
  const replay = JSON.parse(
    readFileSync(
      resolve(root, "tests", "fixtures", "deepseek-v4-pro-defu-vs02-c.json"),
      "utf8",
    ),
  ) as { readonly evidenceSnapshot: readonly EvidenceRecord[] };
  const branch = replay.evidenceSnapshot.find(
    (record) => record.id === "vs02_c_defu_branch",
  );
  assert.ok(branch !== undefined);
  const arrayBranch: EvidenceRecord = {
    ...branch,
    id: "evidence_defu_array_concatenation_branch",
    claim_id: "claim_defu_array_concatenation_branch",
    claim:
      "The shown branch assigns value elements before existing object[key] elements when both are arrays.",
    locator: {
      ...branch.locator,
      source_path: "src/defu.ts",
      excerpt:
        "if (Array.isArray(value) && Array.isArray(object[key])) {\n  object[key] = [...value, ...object[key]];\n}",
    },
  };
  const brief = defuBriefForEvidence(seed.brief, [arrayBranch], "src/defu.ts");

  const pack = buildGroundedFactPack({ brief, evidence: [arrayBranch] });
  const fact = pack.facts.find(
    (candidate) =>
      candidate.fact_type === "BRANCH_BEHAVIOR" &&
      candidate.predicate === "CONCATENATES_WHEN",
  );
  assert.ok(fact !== undefined);
  const condition = pack.entities.find((entity) => entity.id === fact.object_ref);
  assert.deepEqual(condition?.value, {
    operator: "AND",
    terms: [
      { operand: "value", predicate: "IS_ARRAY" },
      { operand: "object[key]", predicate: "IS_ARRAY" },
    ],
  });
  assert.deepEqual(fact.qualifiers, [
    { key: "ACTION", value: "ASSIGN_CONCAT_VALUE_BEFORE_EXISTING" },
  ]);
});

test("an exact protected-key branch stays local and never becomes a safety claim", async () => {
  const seed = await fixtureBundle("small-typescript-repo");
  const replay = JSON.parse(
    readFileSync(
      resolve(root, "tests", "fixtures", "deepseek-v4-pro-defu-vs02-c.json"),
      "utf8",
    ),
  ) as { readonly evidenceSnapshot: readonly EvidenceRecord[] };
  const branch = replay.evidenceSnapshot.find(
    (record) => record.id === "vs02_c_defu_branch",
  );
  assert.ok(branch !== undefined);
  const protectedKeyBranch: EvidenceRecord = {
    ...branch,
    id: "evidence_defu_protected_key_branch",
    claim_id: "claim_defu_protected_key_branch",
    claim: "The shown branch continues for __proto__ or constructor keys.",
    locator: {
      ...branch.locator,
      source_path: "src/defu.ts",
      excerpt:
        'if (key === "__proto__" || key === "constructor") {\n  continue;\n}',
    },
  };
  const brief = defuBriefForEvidence(
    seed.brief,
    [protectedKeyBranch],
    "src/defu.ts",
  );

  const pack = buildGroundedFactPack({ brief, evidence: [protectedKeyBranch] });
  const fact = pack.facts.find(
    (candidate) =>
      candidate.fact_type === "BRANCH_BEHAVIOR" &&
      candidate.predicate === "SKIPS_WHEN",
  );
  assert.ok(fact !== undefined);
  const condition = pack.entities.find((entity) => entity.id === fact.object_ref);
  assert.deepEqual(condition?.value, {
    operator: "OR",
    terms: [
      { left: "key", operator: "EQUALS", right: "__proto__" },
      { left: "key", operator: "EQUALS", right: "constructor" },
    ],
  });
  assert.equal(fact.scope, "LOCAL");
  assert.match(fact.limitations.join(" "), /does not establish a general security guarantee/i);
});

test("branch-shaped text in comments never becomes behavior", async () => {
  const seed = await fixtureBundle("small-typescript-repo");
  const replay = JSON.parse(
    readFileSync(
      resolve(root, "tests", "fixtures", "deepseek-v4-pro-defu-vs02-c.json"),
      "utf8",
    ),
  ) as { readonly evidenceSnapshot: readonly EvidenceRecord[] };
  const branch = replay.evidenceSnapshot.find(
    (record) => record.id === "vs02_c_defu_branch",
  );
  assert.ok(branch !== undefined);
  const commentOnly: EvidenceRecord = {
    ...branch,
    id: "evidence_comment_only_branch_text",
    claim_id: "claim_comment_only_branch_text",
    claim: "The excerpt contains branch-shaped comment text only.",
    locator: {
      ...branch.locator,
      source_path: "src/defu.ts",
      excerpt: [
        "// if (value === null || value === undefined) { continue; }",
        "// if (key === \"__proto__\" || key === \"constructor\") { continue; }",
        "// if (Array.isArray(value) && Array.isArray(object[key])) {",
        "//   object[key] = [...value, ...object[key]];",
        "// }",
      ].join("\n"),
    },
  };
  const brief = defuBriefForEvidence(seed.brief, [commentOnly], "src/defu.ts");

  const pack = buildGroundedFactPack({ brief, evidence: [commentOnly] });
  assert.equal(
    pack.facts.some((fact) => fact.fact_type === "BRANCH_BEHAVIOR"),
    false,
  );
});
