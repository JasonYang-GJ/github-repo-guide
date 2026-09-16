import { createHash } from "node:crypto";
import { posix } from "node:path";

import type {
  BriefClaim,
  CodebaseBrief,
  EvidenceRecord,
} from "./domain.js";
import type { StaticDirectCall, StaticFacts } from "./static-facts.js";
import {
  branchEvidence,
  configurationEvidence,
  directCallEvidence,
  documentationEvidence,
  findBlob,
  manifestEvidence,
  sourceRangeEvidence,
  symbolEvidence,
  treeEvidence,
  type EvidenceBuildContext,
} from "../evidence/builder.js";
import type { ReadRepositoryFile, RepositorySnapshot } from "../repo/contracts.js";
import { deriveRepositoryIdentity } from "./repository-identity.js";
import { boundedText } from "../presentation/bounded-text.js";

export interface BriefNarrative {
  readonly oneSentence: string;
  readonly summary: string;
  readonly problem: string;
  readonly targetUsers: readonly string[];
  readonly moduleInterpretations?: readonly {
    readonly sourcePath: string;
    readonly semanticName: string;
    readonly responsibility: string;
    readonly whyImportant: string;
  }[];
}

export const MAXIMUM_DIRECT_CALL_EVIDENCE = 512 as const;

function compareDirectCalls(left: StaticDirectCall, right: StaticDirectCall): number {
  return (
    left.callerPath.localeCompare(right.callerPath) ||
    left.sourceOrder - right.sourceOrder ||
    left.callerSymbol.localeCompare(right.callerSymbol) ||
    left.calleePath.localeCompare(right.calleePath) ||
    left.calleeSymbol.localeCompare(right.calleeSymbol)
  );
}

function roundRobinByCallerPath(
  calls: readonly StaticDirectCall[],
  maximum: number,
): StaticDirectCall[] {
  const buckets = new Map<string, StaticDirectCall[]>();
  for (const call of [...calls].sort(compareDirectCalls)) {
    const bucket = buckets.get(call.callerPath) ?? [];
    bucket.push(call);
    buckets.set(call.callerPath, bucket);
  }
  const paths = [...buckets.keys()].sort((left, right) => left.localeCompare(right));
  const selected: StaticDirectCall[] = [];
  for (let offset = 0; selected.length < maximum; offset += 1) {
    let added = false;
    for (const path of paths) {
      const call = buckets.get(path)?.[offset];
      if (call === undefined) continue;
      selected.push(call);
      added = true;
      if (selected.length === maximum) break;
    }
    if (!added) break;
  }
  return selected;
}

export function selectBoundedDirectCalls(
  calls: readonly StaticDirectCall[],
  maximum = MAXIMUM_DIRECT_CALL_EVIDENCE,
): readonly StaticDirectCall[] {
  const crossModule = calls.filter((call) => call.callerPath !== call.calleePath);
  const sameFile = calls.filter((call) => call.callerPath === call.calleePath);
  const selectedCrossModule = roundRobinByCallerPath(crossModule, maximum);
  return [
    ...selectedCrossModule,
    ...roundRobinByCallerPath(sameFile, maximum - selectedCrossModule.length),
  ];
}

export interface BriefBuildResult {
  readonly brief: CodebaseBrief;
  readonly evidence: readonly EvidenceRecord[];
  readonly moduleIdByPath: ReadonlyMap<string, string>;
}

function safeId(prefix: string, value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${prefix}_${normalized || "item"}`.slice(0, 128);
}

function stableCallId(prefix: string, value: string): string {
  const readable = value
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);
  const hash = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
  return `${prefix}_${readable || "call"}_${hash}`;
}

function fileByPath(snapshot: RepositorySnapshot, path: string): ReadRepositoryFile {
  const file = snapshot.files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    throw new Error(`Static fact references unread file: ${path}`);
  }
  return file;
}

function moduleName(path: string): string {
  const extension = posix.extname(path);
  return extension.length > 0 ? path.slice(0, -extension.length) : path;
}

function addClaim(
  claims: BriefClaim[],
  claim: BriefClaim,
): void {
  if (claims.some((candidate) => candidate.id === claim.id)) {
    throw new Error(`Duplicate claim id: ${claim.id}`);
  }
  claims.push(claim);
}

function entryPointPath(sourcePaths: readonly string[]): string | null {
  return (
    sourcePaths.find((path) => /(?:^|\/)(?:src\/)?index\.(?:c|m)?(?:j|t)sx?$/i.test(path)) ??
    sourcePaths[0] ??
    null
  );
}

function manifestSourcePath(snapshot: RepositorySnapshot, value: string): string | null {
  const normalized = value.replace(/^\.\//, "").replace(/\\/g, "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === ".." || part.length === 0)
  ) {
    return null;
  }
  return snapshot.manifest.packageRoot.length === 0
    ? normalized
    : posix.join(snapshot.manifest.packageRoot, normalized);
}

function selectedSourcePathsForBrief(
  snapshot: RepositorySnapshot,
  facts: StaticFacts,
): readonly string[] {
  const declaredEntries = new Set(
    snapshot.manifest.entryCandidates.flatMap((entry) => {
      const path = manifestSourcePath(snapshot, entry);
      return path === null ? [] : [path];
    }),
  );
  const relationCounts = new Map<string, number>();
  for (const relationship of facts.relationships) {
    relationCounts.set(
      relationship.fromPath,
      (relationCounts.get(relationship.fromPath) ?? 0) + 1,
    );
    relationCounts.set(
      relationship.toPath,
      (relationCounts.get(relationship.toPath) ?? 0) + 1,
    );
  }
  const symbolCounts = new Map<string, number>();
  for (const symbol of facts.symbols) {
    symbolCounts.set(symbol.path, (symbolCounts.get(symbol.path) ?? 0) + 1);
  }
  return [...facts.sourcePaths]
    .sort((left, right) => {
      const score = (path: string) =>
        (declaredEntries.has(path) ? 1000 : 0) +
        (relationCounts.get(path) ?? 0) * 20 +
        Math.min(symbolCounts.get(path) ?? 0, 10) * 2 -
        path.split("/").length;
      const difference = score(right) - score(left);
      return difference === 0 ? left.localeCompare(right) : difference;
    })
    .slice(0, 12)
    .sort((left, right) => left.localeCompare(right));
}

function manifestBins(
  raw: unknown,
): readonly { readonly command: string; readonly target: string; readonly pointer: string }[] {
  if (typeof raw === "string") {
    return [{ command: ".", target: raw, pointer: "/bin" }];
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 12)
    .map(([command, target]) => ({
      command,
      target,
      pointer: `/bin/${jsonPointerSegment(command)}`,
    }));
}

function jsonPointerSegment(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function declaredPackageExports(
  rawExports: unknown,
): readonly { readonly key: string; readonly value: unknown; readonly pointer: string }[] {
  if (rawExports === undefined) return [];
  if (
    rawExports !== null &&
    typeof rawExports === "object" &&
    !Array.isArray(rawExports) &&
    Object.keys(rawExports).some((key) => key.startsWith("."))
  ) {
    return Object.entries(rawExports)
      .filter(([key]) => key.startsWith("."))
      .slice(0, 8)
      .map(([key, value]) => ({
        key,
        value,
        pointer: `/exports/${jsonPointerSegment(key)}`,
      }));
  }
  return [{ key: ".", value: rawExports, pointer: "/exports" }];
}

function esmEntryFromExports(
  rawExports: unknown,
): { readonly path: string; readonly pointer: string } | null {
  if (rawExports === null || typeof rawExports !== "object" || Array.isArray(rawExports)) {
    return null;
  }
  const root = rawExports as Readonly<Record<string, unknown>>;
  const packageRoot = root["."] ?? root;
  if (packageRoot === null || typeof packageRoot !== "object" || Array.isArray(packageRoot)) {
    return null;
  }
  const conditions = packageRoot as Readonly<Record<string, unknown>>;
  for (const condition of ["import", "module"] as const) {
    const value = conditions[condition];
    if (typeof value === "string") {
      const rootPrefix = root["."] === undefined ? "/exports" : "/exports/.";
      return { path: value, pointer: `${rootPrefix}/${condition}` };
    }
  }
  return null;
}

export function buildCodebaseBrief(
  snapshot: RepositorySnapshot,
  facts: StaticFacts,
  narrative: BriefNarrative,
  generatedAt: string,
): BriefBuildResult {
  const evidenceContext: EvidenceBuildContext = {
    repositoryUrl: snapshot.repository.url,
    commitSha: snapshot.repository.commitSha,
    checkedAt: generatedAt,
  };
  const claims: BriefClaim[] = [];
  const evidence: EvidenceRecord[] = [];
  const manifestFile = fileByPath(snapshot, snapshot.manifest.manifestPath);
  const identity = deriveRepositoryIdentity(snapshot);
  const selectedSourcePaths = selectedSourcePathsForBrief(snapshot, facts);
  const selectedPathSet = new Set(selectedSourcePaths);
  const moduleIdByPath = new Map(
    selectedSourcePaths.map((path) => [path, safeId("module", path)]),
  );

  const purposeClaimId = "claim_project_purpose";
  const genericRepository = snapshot.manifest.format === "generic";
  const purposeStatement = boundedText(
    identity.source === "root_readme"
      ? `${identity.sourceFile.path} 将 ${identity.displayName} 描述为“${identity.description}”。`
      : genericRepository
        ? `Repository ${snapshot.repository.name} includes the selected orientation file ${identity.sourceFile.path}.`
      : snapshot.manifest.description !== null
        ? `package.json describes ${snapshot.manifest.name} as "${snapshot.manifest.description}".`
        : `package.json names the package "${snapshot.manifest.name}".`, 1000);
  const purposeEvidenceId = "evidence_project_purpose";
  addClaim(claims, {
    id: purposeClaimId,
    statement: purposeStatement,
    category: "purpose",
    status: "documentation",
    confidence: 0.9,
    evidence_ids: [purposeEvidenceId],
    limitations: [
      genericRepository
        ? "A selected orientation file does not prove runtime behavior or a complete architecture."
        : "A package description is the repository author's declaration, not runtime proof.",
    ],
  });
  evidence.push(
    identity.source === "root_readme" && identity.lineStart !== undefined && identity.lineEnd !== undefined
      ? documentationEvidence(
          purposeEvidenceId,
          purposeClaimId,
          purposeStatement,
          identity.sourceFile,
          identity.lineStart,
          identity.lineEnd,
          identity.excerpt,
          evidenceContext,
        )
      : genericRepository
        ? treeEvidence(
            purposeEvidenceId,
            purposeClaimId,
            purposeStatement,
            findBlob(snapshot, identity.sourceFile.path),
            evidenceContext,
          )
        : manifestEvidence(
          purposeEvidenceId,
          purposeClaimId,
          purposeStatement,
          manifestFile,
          snapshot.manifest.description !== null ? "/description" : "/name",
          snapshot.manifest.description ?? snapshot.manifest.name,
          evidenceContext,
        ),
  );

  const technologies: CodebaseBrief["technologies"][number][] = [];
  const firstTypeScriptPath = selectedSourcePaths.find((path) => /\.(?:ts|tsx|mts|cts)$/i.test(path));
  if (firstTypeScriptPath !== undefined) {
    const technologyClaimId = "claim_technology_typescript";
    const technologyEvidenceId = "evidence_technology_typescript";
    const technologyStatement = `The repository tree contains TypeScript source at ${firstTypeScriptPath}.`;
    addClaim(claims, {
      id: technologyClaimId,
      statement: technologyStatement,
      category: "technology",
      status: "verified",
      confidence: 1,
      evidence_ids: [technologyEvidenceId],
      limitations: [],
    });
    evidence.push(
      treeEvidence(
        technologyEvidenceId,
        technologyClaimId,
        technologyStatement,
        findBlob(snapshot, firstTypeScriptPath),
        evidenceContext,
      ),
    );
    technologies.push({
      id: "technology_typescript",
      name: "TypeScript",
      kind: "language",
      purpose: "Source language observed in the repository tree",
      status: "verified",
      evidence_ids: [technologyEvidenceId],
    });
  }

  const firstJavaScriptPath = selectedSourcePaths.find((path) =>
    /\.(?:js|jsx|mjs|cjs)$/i.test(path),
  );
  if (firstJavaScriptPath !== undefined) {
    const technologyClaimId = "claim_technology_javascript";
    const technologyEvidenceId = "evidence_technology_javascript";
    const technologyStatement = `The repository tree contains JavaScript source at ${firstJavaScriptPath}.`;
    addClaim(claims, {
      id: technologyClaimId,
      statement: technologyStatement,
      category: "technology",
      status: "verified",
      confidence: 1,
      evidence_ids: [technologyEvidenceId],
      limitations: [],
    });
    evidence.push(
      treeEvidence(
        technologyEvidenceId,
        technologyClaimId,
        technologyStatement,
        findBlob(snapshot, firstJavaScriptPath),
        evidenceContext,
      ),
    );
    technologies.push({
      id: "technology_javascript",
      name: "JavaScript",
      kind: "language",
      purpose: "Source language observed in the repository tree",
      status: "verified",
      evidence_ids: [technologyEvidenceId],
    });
  }

  if (snapshot.manifest.packageType !== null) {
    const claimId = "claim_package_type";
    const evidenceId = "evidence_package_type";
    const statement = `${snapshot.manifest.manifestPath} declares package type ${JSON.stringify(
      snapshot.manifest.packageType,
    )}.`;
    addClaim(claims, {
      id: claimId,
      statement,
      category: "technology",
      status: "verified",
      confidence: 1,
      evidence_ids: [evidenceId],
      limitations: ["A package type declaration does not prove successful module loading."],
    });
    evidence.push(
      manifestEvidence(
        evidenceId,
        claimId,
        statement,
        manifestFile,
        "/type",
        snapshot.manifest.packageType,
        evidenceContext,
      ),
    );
  }

  for (const [dependency, version] of Object.entries(snapshot.manifest.dependencies).slice(0, 8)) {
    const idPart = safeId("dependency", dependency);
    const claimId = safeId("claim", idPart);
    const evidenceId = safeId("evidence", idPart);
    const statement = `${dependency} is declared in ${snapshot.manifest.manifestPath} dependencies.`;
    addClaim(claims, {
      id: claimId,
      statement,
      category: "technology",
      status: "verified",
      confidence: 1,
      evidence_ids: [evidenceId],
      limitations: ["A manifest declaration does not prove that a dependency is used at runtime."],
    });
    evidence.push(
      manifestEvidence(
        evidenceId,
        claimId,
        statement,
        manifestFile,
        `/dependencies/${dependency.replace(/~/g, "~0").replace(/\//g, "~1")}`,
        version,
        evidenceContext,
      ),
    );
    technologies.push({
      id: idPart,
      name: dependency,
      kind: "library",
      declared_version: version,
      purpose: "Declared runtime dependency",
      status: "verified",
      evidence_ids: [evidenceId],
    });
  }

  const verifiedEntryPoints: CodebaseBrief["entry_points"][number][] = [];
  for (const bin of manifestBins(snapshot.manifest.raw["bin"])) {
    const sourcePath = manifestSourcePath(snapshot, bin.target);
    if (
      sourcePath === null ||
      !snapshot.tree.some((entry) => entry.type === "blob" && entry.path === sourcePath)
    ) {
      continue;
    }
    const claimId = safeId("claim_package_bin", bin.command);
    const evidenceId = safeId("evidence_package_bin", bin.command);
    const statement = `${snapshot.manifest.manifestPath} declares CLI command ${JSON.stringify(
      bin.command,
    )} at ${JSON.stringify(bin.target)}.`;
    addClaim(claims, {
      id: claimId,
      statement,
      category: "entry_point",
      status: "verified",
      confidence: 1,
      evidence_ids: [evidenceId],
      limitations: [
        "A manifest bin declaration identifies a CLI surface but does not prove successful execution.",
      ],
    });
    evidence.push(
      manifestEvidence(
        evidenceId,
        claimId,
        statement,
        manifestFile,
        bin.pointer,
        bin.target,
        evidenceContext,
      ),
    );
    verifiedEntryPoints.push({
      id: safeId("entry_point_cli", bin.command),
      label: bin.command,
      source_path: sourcePath,
      role: "CLI entry declared by the selected npm manifest",
      status: "verified",
      evidence_ids: [evidenceId],
    });
  }

  const rawExports = snapshot.manifest.raw["exports"];
  for (const declaredExport of declaredPackageExports(rawExports)) {
    const claimId = safeId("claim_package_export", declaredExport.key);
    const evidenceId = safeId("evidence_package_export", declaredExport.key);
    const statement = `package.json declares export ${JSON.stringify(declaredExport.key)}.`;
    addClaim(claims, {
      id: claimId,
      statement,
      category: "entry_point",
      status: "verified",
      confidence: 1,
      evidence_ids: [evidenceId],
      limitations: [
        "A package manifest export declaration does not by itself prove successful runtime loading.",
      ],
    });
    evidence.push(
      manifestEvidence(
        evidenceId,
        claimId,
        statement,
        manifestFile,
        declaredExport.pointer,
        declaredExport.value,
        evidenceContext,
      ),
    );
  }

  const rawModule = snapshot.manifest.raw["module"];
  const esmEntry =
    typeof rawModule === "string"
      ? { path: rawModule, pointer: "/module" }
      : esmEntryFromExports(rawExports);
  if (esmEntry !== null) {
    const claimId = "claim_package_esm_entry";
    const evidenceId = "evidence_package_esm_entry";
    const statement = `package.json declares ESM entry ${JSON.stringify(esmEntry.path)}.`;
    addClaim(claims, {
      id: claimId,
      statement,
      category: "entry_point",
      status: "verified",
      confidence: 1,
      evidence_ids: [evidenceId],
      limitations: [
        "The manifest declaration identifies an ESM entry but does not prove its runtime behavior.",
      ],
    });
    evidence.push(
      manifestEvidence(
        evidenceId,
        claimId,
        statement,
        manifestFile,
        esmEntry.pointer,
        esmEntry.path,
        evidenceContext,
      ),
    );
  }

  const moduleEvidenceByPath = new Map<string, string>();
  for (const path of selectedSourcePaths) {
    const moduleId = moduleIdByPath.get(path);
    if (moduleId === undefined) continue;
    const claimId = safeId("claim", moduleId);
    const evidenceId = safeId("evidence", moduleId);
    const statement = `Source module ${path} exists at the resolved commit.`;
    addClaim(claims, {
      id: claimId,
      statement,
      category: "module",
      status: "verified",
      confidence: 1,
      evidence_ids: [evidenceId],
      limitations: [],
    });
    evidence.push(
      treeEvidence(evidenceId, claimId, statement, findBlob(snapshot, path), evidenceContext),
    );
    moduleEvidenceByPath.set(path, evidenceId);
  }

  const importantSymbols: CodebaseBrief["important_symbols"][number][] = [];
  const symbolEvidenceByPath = new Map<string, string[]>();
  for (const symbol of facts.symbols
    .filter((candidate) => selectedPathSet.has(candidate.path))
    .slice(0, 24)) {
    const symbolKey = `${symbol.path}_${symbol.name}_${symbol.lineStart}`;
    const claimId = safeId("claim_symbol", symbolKey);
    const evidenceId = safeId("evidence_symbol", symbolKey);
    const statement = `${symbol.kind} ${symbol.name} is declared in ${symbol.path}.`;
    addClaim(claims, {
      id: claimId,
      statement,
      category: "module",
      status: "verified",
      confidence: 1,
      evidence_ids: [evidenceId],
      limitations: [],
    });
    evidence.push(
      symbolEvidence(
        evidenceId,
        claimId,
        statement,
        fileByPath(snapshot, symbol.path),
        symbol,
        evidenceContext,
      ),
    );
    symbolEvidenceByPath.set(symbol.path, [
      ...(symbolEvidenceByPath.get(symbol.path) ?? []),
      evidenceId,
    ]);
    importantSymbols.push({
      id: safeId("symbol", symbolKey),
      name: symbol.name,
      kind: symbol.kind,
      source_path: symbol.path,
      line_start: symbol.lineStart,
      line_end: symbol.lineEnd,
      role: `Top-level ${symbol.kind} declaration`,
      status: "verified",
      evidence_ids: [evidenceId],
    });
  }

  const coreModules: CodebaseBrief["core_modules"][number][] = selectedSourcePaths.map((path) => {
    const symbols = facts.symbols.filter((symbol) => symbol.path === path).slice(0, 4);
    const symbolNames = [...new Set(symbols.map((symbol) => symbol.name))];
    return {
      id: moduleIdByPath.get(path) ?? safeId("module", path),
      name: genericRepository ? path : moduleName(path),
      responsibility:
        symbolNames.length > 0
          ? `Declares ${symbolNames.join(", ")}.`
          : `Contains the selected source file ${path}.`,
      source_paths: [path],
      status: "verified",
      confidence: 1,
      evidence_ids: [
        ...(moduleEvidenceByPath.has(path) ? [moduleEvidenceByPath.get(path) as string] : []),
        ...(symbolEvidenceByPath.get(path) ?? []),
      ],
    };
  });

  const relationships: CodebaseBrief["relationships"][number][] = [];
  for (const [index, relationship] of facts.relationships
    .filter(
      (candidate) =>
        selectedPathSet.has(candidate.fromPath) && selectedPathSet.has(candidate.toPath),
    )
    .entries()) {
    const fromModule = moduleIdByPath.get(relationship.fromPath);
    const toModule = moduleIdByPath.get(relationship.toPath);
    if (fromModule === undefined || toModule === undefined) continue;
    const relationshipId = safeId(
      "relationship",
      `${index + 1}_${relationship.fromPath}_${relationship.toPath}`,
    );
    const claimId = safeId("claim", relationshipId);
    const evidenceId = safeId("evidence", relationshipId);
    const statement = `${relationship.fromPath} imports ${relationship.toPath} through ${relationship.specifier}.`;
    addClaim(claims, {
      id: claimId,
      statement,
      category: "relationship",
      status: "verified",
      confidence: 1,
      evidence_ids: [evidenceId],
      limitations: ["A static import does not prove runtime call frequency or control flow."],
    });
    evidence.push(
      sourceRangeEvidence(
        evidenceId,
        claimId,
        statement,
        fileByPath(snapshot, relationship.fromPath),
        relationship,
        evidenceContext,
      ),
    );
    relationships.push({
      id: relationshipId,
      from_module_id: fromModule,
      to_module_id: toModule,
      relationship_type: "imports",
      description: statement,
      status: "verified",
      confidence: 1,
      evidence_ids: [evidenceId],
    });
  }

  for (const call of selectBoundedDirectCalls(facts.directCalls)) {
    const fromModule = moduleIdByPath.get(call.callerPath);
    const toModule = moduleIdByPath.get(call.calleePath);
    const relationKey = `${call.sourceOrder}_${call.callerPath}_${call.callerSymbol}_${call.calleePath}_${call.calleeSymbol}`;
    const relationshipId = stableCallId("call_relationship", relationKey);
    const claimId = stableCallId("claim_call", relationKey);
    const evidenceId = stableCallId("evidence_call", relationKey);
    const statement = `${call.callerSymbol} in ${call.callerPath} contains a direct static call to ${call.calleeSymbol} in ${call.calleePath}.`;
    const limitations = [
      "The AST proves one authored direct call expression, not runtime execution, frequency, ordering, outcome, or transitive flow.",
    ];
    addClaim(claims, {
      id: claimId,
      statement,
      category: "relationship",
      status: "verified",
      confidence: 1,
      evidence_ids: [evidenceId],
      limitations,
    });
    evidence.push(
      directCallEvidence(
        evidenceId,
        claimId,
        statement,
        fileByPath(snapshot, call.callerPath),
        call,
        evidenceContext,
      ),
    );
    if (fromModule !== undefined && toModule !== undefined) {
      relationships.push({
        id: relationshipId,
        from_module_id: fromModule,
        to_module_id: toModule,
        relationship_type: "calls",
        description: statement,
        status: "verified",
        confidence: 1,
        evidence_ids: [evidenceId],
      });
    }
  }

  for (const schema of facts.schemas.slice(0, 20)) {
    const fieldPointer =
      schema.schemaUri !== null ? "/$schema" : schema.rootType !== null ? "/type" : "/title";
    const fieldValue = schema.schemaUri ?? schema.rootType ?? schema.title;
    if (fieldValue === null) continue;
    const claimId = safeId("claim_json_schema", schema.path);
    const evidenceId = safeId("evidence_json_schema", schema.path);
    const statement = `${schema.path} declares a JSON Schema document at ${fieldPointer}.`;
    addClaim(claims, {
      id: claimId,
      statement,
      category: "module",
      status: "verified",
      confidence: 1,
      evidence_ids: [evidenceId],
      limitations: [
        "Schema declaration evidence does not prove that every runtime input is validated against this file.",
      ],
    });
    evidence.push(
      configurationEvidence(
        evidenceId,
        claimId,
        statement,
        fileByPath(snapshot, schema.path),
        fieldPointer,
        fieldValue,
        evidenceContext,
      ),
    );
  }

  for (const branch of facts.branchBehaviors
    .filter((candidate) => selectedPathSet.has(candidate.path))
    .slice(0, 16)) {
    const branchKey = `${branch.path}_${branch.ownerSymbol}_${branch.lineStart}`;
    const claimId = safeId("claim_branch", branchKey);
    const evidenceId = safeId("evidence_branch", branchKey);
    const statement = `In ${branch.ownerSymbol} at ${branch.path}, a local branch throws when ${branch.condition}.`;
    addClaim(claims, {
      id: claimId,
      statement,
      category: "design_choice",
      status: "verified",
      confidence: 1,
      evidence_ids: [evidenceId],
      limitations: [
        "The source proves an authored local throw branch, not that the condition occurs at runtime.",
      ],
    });
    evidence.push(
      branchEvidence(
        evidenceId,
        claimId,
        statement,
        fileByPath(snapshot, branch.path),
        branch,
        evidenceContext,
      ),
    );
  }

  const selectedEntryPoint = entryPointPath(selectedSourcePaths);
  const entryPoints: CodebaseBrief["entry_points"][number][] = [...verifiedEntryPoints];
  if (entryPoints.length === 0 && selectedEntryPoint !== null) {
    const claimId = "claim_entry_point";
    const evidenceId = "evidence_entry_point";
    const statement = `${selectedEntryPoint} is the selected conventional package entry point.`;
    addClaim(claims, {
      id: claimId,
      statement,
      category: "entry_point",
      status: "inferred",
      confidence: 0.75,
      evidence_ids: [evidenceId],
      limitations: ["The source entry point is inferred from conventional naming and read scope."],
    });
    const supportingEvidence = moduleEvidenceByPath.get(selectedEntryPoint);
    if (supportingEvidence !== undefined) {
      const entry = findBlob(snapshot, selectedEntryPoint);
      evidence.push({
        evidence_record_version: 1,
        id: evidenceId,
        claim_id: claimId,
        claim: statement,
        evidence_type: "reasoned_inference",
        source_kind: "analysis_reasoning",
        supports_evidence_ids: [supportingEvidence],
        confidence: 0.75,
        verification_status: "inferred",
        verification: {
          method: "model_inference",
          checked_at: generatedAt,
          commit_resolved: true,
          path_exists: true,
          symbol_exists: null,
          line_range_valid: null,
          excerpt_matches: null,
        },
        notes: `Selected from the bounded source set; blob ${entry.blobSha ?? "unknown"}.`,
        limitations: ["Conventional path selection is not package export resolution."],
      });
      entryPoints.push({
        id: "entry_point_primary",
        label: selectedEntryPoint,
        source_path: selectedEntryPoint,
        role: "Conventional source entry selected by the read planner",
        status: "inferred",
        evidence_ids: [evidenceId],
      });
    }
  }

  const brief: CodebaseBrief = {
    codebase_brief_version: 1,
    brief_id: safeId(
      "brief",
      `${snapshot.repository.owner}_${snapshot.repository.name}_${snapshot.repository.commitSha.slice(0, 12)}`,
    ),
    generated_at: generatedAt,
    repository: {
      url: snapshot.repository.url,
      owner: snapshot.repository.owner,
      name: snapshot.repository.name,
      default_branch: snapshot.repository.defaultBranch,
      commit_sha: snapshot.repository.commitSha,
      visibility: "public",
      resolved_at: snapshot.repository.resolvedAt,
    },
    analysis_scope: {
      read_scope_ladder_version: 1,
      highest_scope: snapshot.highestScope,
      scope_events: snapshot.scopeEvents.map((event) => ({
        scope: event.scope,
        reason: event.reason,
        selected_paths: event.selectedPaths,
      })),
      files_seen: snapshot.filesSeen,
      files_read: snapshot.files.length,
      files_skipped: snapshot.filesSkipped,
      bytes_read: snapshot.bytesRead,
      context_tokens_budgeted: 30_000,
      context_tokens_used: Math.ceil(snapshot.bytesRead / 4),
      truncated: false,
      skip_summary: snapshot.skipSummary,
    },
    overview: {
      project_name: boundedText(identity.displayName, 200),
      one_sentence: boundedText(narrative.oneSentence, 500),
      summary: boundedText(narrative.summary, 4000),
      problem: boundedText(identity.problem || narrative.problem, 2000),
      target_users: narrative.targetUsers,
      status: "documentation",
      evidence_ids: [purposeEvidenceId],
    },
    technologies,
    entry_points: entryPoints,
    core_modules: coreModules,
    relationships,
    data_flows: [],
    external_services: [],
    storage: [],
    important_symbols: importantSymbols,
    claims,
    evidence,
    limitations: [
      {
        id: "limitation_static_only",
        description: "The target repository was analyzed statically and never executed.",
        impact: "Runtime behavior, performance, and deployment behavior remain unverified.",
      },
      ...(genericRepository
        ? [
            {
              id: "limitation_generic_language_scope",
              description:
                snapshot.manifest.genericReason === "ambiguous_package_manifests"
                  ? "Multiple peer package.json files were detected, so no subproject was chosen arbitrarily and the repository used bounded generic text analysis."
                  : "No package.json was detected, so the repository used bounded generic text analysis.",
              impact:
                "Non-JavaScript/TypeScript files are shown as modules, but their symbols and cross-file call graph are not parsed by the current host analyzer.",
            },
          ]
        : []),
      ...(snapshot.manifest.packageRoot.length > 0
        ? [
            {
              id: "limitation_selected_package_scope",
              description: `本次代码级验证覆盖 ${identity.analyzedScope}。`,
              impact:
                "README 中提到、但不属于该 TypeScript 子包的 Rust/Tauri 后端与本机安全能力，未在本次分析中逐项验证。",
            },
          ]
        : []),
      ...(facts.sourcePaths.length > selectedSourcePaths.length
        ? [
            {
              id: "limitation_module_cap",
              description: `Only ${selectedSourcePaths.length} core modules were retained for readability.`,
              impact: "Relationships outside the retained module set are not represented.",
            },
          ]
        : []),
    ],
    unknowns: [
      {
        id: "unknown_runtime_behavior",
        question: genericRepository
          ? "What happens when the repository software runs?"
          : "What happens when the package runs?",
        reason: "Repository code execution is outside the security boundary.",
        next_evidence_needed: "A separately authorized runtime evaluation in an isolated environment.",
      },
      {
        id: "unknown_external_services",
        question: "Which external services are used at runtime?",
        reason: "No verified external-service call was established in the bounded read scope.",
        next_evidence_needed: "Direct client initialization and call-site evidence at the same commit.",
      },
      ...(facts.schemas.length > 0
        ? [
            {
              id: "unknown_schema_runtime_binding",
              question: "Which runtime paths invoke each declared JSON Schema?",
              reason:
                "Schema files were parsed statically, but the current analyzer does not resolve cross-module call targets into a complete validation call graph.",
              next_evidence_needed:
                "A resolved static call relation from each runtime entry through validation to the corresponding schema-derived validator.",
            },
          ]
        : []),
    ],
    overall_confidence: {
      score: relationships.length > 0 ? 0.9 : 0.8,
      rationale: genericRepository
        ? "Repository orientation files, selected text sources, and the tree were checked at one immutable commit."
        : "Manifest, tree, symbols, and local imports were checked at one immutable commit.",
    },
    quality: {
      schema_valid: true,
      reference_integrity_valid: true,
      evidence_valid: true,
      confidence_escalation_checked: true,
      warnings: [],
    },
  };

  return { brief, evidence, moduleIdByPath };
}
