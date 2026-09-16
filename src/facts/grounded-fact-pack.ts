import { createHash } from "node:crypto";

import ts from "typescript";

import type { CodebaseBrief, EvidenceRecord } from "../analysis/domain.js";
import { validateGroundedFactPackIntegrity } from "./integrity.js";
import {
  FACT_IR_VERSION,
  type GroundedEntity,
  type GroundedEvidenceRef,
  type GroundedFact,
  type GroundedFactPack,
} from "./domain.js";

export interface GroundedFactPackInput {
  readonly brief: CodebaseBrief;
  readonly evidence: readonly EvidenceRecord[];
}

function stableId(prefix: string, ...parts: readonly string[]): string {
  const readable = parts
    .join("_")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 72);
  const hash = createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 12);
  return `${prefix}_${readable}_${hash}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isVerifiedAtCommit(record: EvidenceRecord, brief: CodebaseBrief): boolean {
  const repositoryMatch =
    record.verification_status === "verified" &&
    record.confidence === 1 &&
    record.verification.commit_resolved &&
    record.verification.path_exists === true &&
    record.repository?.url === brief.repository.url &&
    record.repository.commit_sha === brief.repository.commit_sha;
  if (!repositoryMatch || record.locator === undefined) return false;
  if (
    ["source_range", "symbol_declaration", "manifest_field", "config_field", "direct_call"].includes(
      record.evidence_type,
    ) &&
    record.verification.excerpt_matches !== true
  ) {
    return false;
  }
  if (
    ["source_range", "symbol_declaration", "direct_call"].includes(record.evidence_type) &&
    record.verification.line_range_valid !== true
  ) {
    return false;
  }
  if (
    record.evidence_type === "symbol_declaration" &&
    record.verification.symbol_exists !== true
  ) {
    return false;
  }
  if (record.evidence_type === "direct_call") {
    const relation = record.call_relation;
    if (
      record.evidence_record_version !== 2 ||
      record.source_kind !== "source_code" ||
      record.verification.method !== "ast_call_expression" ||
      record.verification.symbol_exists !== true ||
      relation === undefined ||
      relation.relation !== "CALLS" ||
      relation.direct !== true ||
      relation.runtime_execution_guaranteed !== false ||
      relation.caller.source_path !== record.locator.source_path ||
      relation.call_site.source_path !== record.locator.source_path ||
      relation.call_site.line_start !== record.locator.line_start ||
      relation.call_site.line_end !== record.locator.line_end ||
      relation.caller.symbol.name !== record.locator.symbol?.name
    ) {
      return false;
    }
  }
  return true;
}

function isRuntimeSymbol(record: EvidenceRecord): boolean {
  const kind = record.locator?.symbol?.kind;
  return (
    record.evidence_type === "symbol_declaration" &&
    record.source_kind === "source_code" &&
    !/\.d\.(?:cts|mts|ts)$/i.test(record.locator?.source_path ?? "") &&
    kind !== undefined &&
    !["type", "interface", "module"].includes(kind)
  );
}

function isTypeSymbol(record: EvidenceRecord): boolean {
  const kind = record.locator?.symbol?.kind;
  return (
    record.evidence_type === "symbol_declaration" &&
    record.source_kind === "source_code" &&
    kind !== undefined &&
    (["type", "interface", "module"].includes(kind) ||
      /\.d\.(?:cts|mts|ts)$/i.test(record.locator?.source_path ?? ""))
  );
}

function isExplicitSourceExport(record: EvidenceRecord): boolean {
  if (record.evidence_type !== "symbol_declaration") return false;
  const source = parseEvidenceSource(record);
  const symbolName = record.locator?.symbol?.name;
  if (source === null || symbolName === undefined) return false;
  return source.statements.some((statement) => {
    const exported =
      ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
    if (!exported) return false;
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) && declaration.name.text === symbolName,
      );
    }
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      return statement.name !== undefined && statement.name.text === symbolName;
    }
    return false;
  });
}

function packageExportKey(record: EvidenceRecord): string | null {
  if (record.evidence_type !== "manifest_field" || record.source_kind !== "manifest") {
    return null;
  }
  const pointer = record.locator?.field_pointer;
  if (pointer === "/bin") return "CLI command";
  if (pointer !== undefined && pointer.startsWith("/bin/")) {
    const encoded = pointer.slice("/bin/".length);
    if (encoded.length === 0) return null;
    const command = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    return `CLI command ${JSON.stringify(command)}`;
  }
  if (pointer === "/exports") return ".";
  if (pointer === undefined || !pointer.startsWith("/exports/")) return null;
  const encoded = pointer.slice("/exports/".length).split("/")[0];
  if (encoded === undefined || encoded.length === 0) return null;
  return encoded.replace(/~1/g, "/").replace(/~0/g, "~");
}

const CONFIGURATION_POINTERS = new Set([
  "/description",
  "/main",
  "/module",
  "/type",
  "/types",
  "/compilerOptions/module",
  "/compilerOptions/moduleResolution",
  "/compilerOptions/target",
]);

function configurationField(
  record: EvidenceRecord,
): { readonly pointer: string; readonly value: string | number | boolean | null } | null {
  if (!["manifest_field", "config_field"].includes(record.evidence_type)) return null;
  const pointer = record.locator?.field_pointer;
  if (
    pointer === undefined ||
    (!CONFIGURATION_POINTERS.has(pointer) && !pointer.startsWith("/bin/"))
  ) {
    return null;
  }
  try {
    const value = JSON.parse(record.locator?.excerpt ?? "") as unknown;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return { pointer, value };
    }
  } catch {
    return null;
  }
  return null;
}

function isJsonSchemaDeclaration(record: EvidenceRecord): boolean {
  return (
    record.evidence_type === "config_field" &&
    record.source_kind === "configuration" &&
    /\.schema\.json$/i.test(record.locator?.source_path ?? "") &&
    ["/$schema", "/type"].includes(record.locator?.field_pointer ?? "")
  );
}

function parseEvidenceSource(record: EvidenceRecord): ts.SourceFile | null {
  if (
    record.source_kind !== "source_code" ||
    !["source_range", "symbol_declaration"].includes(record.evidence_type) ||
    record.locator?.excerpt === undefined
  ) {
    return null;
  }
  return ts.createSourceFile(
    record.locator.source_path,
    record.locator.excerpt,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function isIdentifierExpression(expression: ts.Expression, name: string): boolean {
  const current = unwrapExpression(expression);
  return ts.isIdentifier(current) && current.text === name;
}

function isObjectKeyExpression(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  return (
    ts.isElementAccessExpression(current) &&
    isIdentifierExpression(current.expression, "object") &&
    current.argumentExpression !== undefined &&
    isIdentifierExpression(current.argumentExpression, "key")
  );
}

function isStrictEquality(
  expression: ts.Expression,
  leftName: string,
  right: string | null,
): boolean {
  const current = unwrapExpression(expression);
  if (
    !ts.isBinaryExpression(current) ||
    current.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
    !isIdentifierExpression(current.left, leftName)
  ) {
    return false;
  }
  const rightExpression = unwrapExpression(current.right);
  return right === null
    ? rightExpression.kind === ts.SyntaxKind.NullKeyword
    : right === "undefined"
      ? isIdentifierExpression(rightExpression, "undefined")
      : ts.isStringLiteralLike(rightExpression) && rightExpression.text === right;
}

function isBinaryPair(
  expression: ts.Expression,
  operator: ts.SyntaxKind.BarBarToken | ts.SyntaxKind.AmpersandAmpersandToken,
  left: (expression: ts.Expression) => boolean,
  right: (expression: ts.Expression) => boolean,
): boolean {
  const current = unwrapExpression(expression);
  return (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === operator &&
    left(current.left) &&
    right(current.right)
  );
}

function isSingleContinue(statement: ts.Statement): boolean {
  if (!ts.isBlock(statement) || statement.statements.length !== 1) return false;
  const onlyStatement = statement.statements[0];
  return onlyStatement !== undefined && ts.isContinueStatement(onlyStatement);
}

function isArrayCheck(
  expression: ts.Expression,
  operand: "value" | "object_key",
): boolean {
  const current = unwrapExpression(expression);
  if (
    !ts.isCallExpression(current) ||
    current.arguments.length !== 1 ||
    !ts.isPropertyAccessExpression(current.expression) ||
    !isIdentifierExpression(current.expression.expression, "Array") ||
    current.expression.name.text !== "isArray"
  ) {
    return false;
  }
  const argument = current.arguments[0];
  return (
    argument !== undefined &&
    (operand === "value"
      ? isIdentifierExpression(argument, "value")
      : isObjectKeyExpression(argument))
  );
}

function isArrayConcatenationAction(statement: ts.Statement): boolean {
  if (!ts.isBlock(statement) || statement.statements.length !== 1) return false;
  const onlyStatement = statement.statements[0];
  if (onlyStatement === undefined || !ts.isExpressionStatement(onlyStatement)) return false;
  const assignment = unwrapExpression(onlyStatement.expression);
  if (
    !ts.isBinaryExpression(assignment) ||
    assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
    !isObjectKeyExpression(assignment.left)
  ) {
    return false;
  }
  const value = unwrapExpression(assignment.right);
  if (!ts.isArrayLiteralExpression(value) || value.elements.length !== 2) return false;
  const first = value.elements[0];
  const second = value.elements[1];
  return (
    first !== undefined &&
    second !== undefined &&
    ts.isSpreadElement(first) &&
    ts.isSpreadElement(second) &&
    isIdentifierExpression(first.expression, "value") &&
    isObjectKeyExpression(second.expression)
  );
}

interface BehaviorMatches {
  readonly nullishContinue: boolean;
  readonly protectedKeyContinue: boolean;
  readonly arrayConcatenation: boolean;
  readonly throwConditions: readonly string[];
}

function hasDirectThrow(statement: ts.Statement): boolean {
  return (
    ts.isThrowStatement(statement) ||
    (ts.isBlock(statement) && statement.statements.some((item) => ts.isThrowStatement(item)))
  );
}

function detectBehavior(record: EvidenceRecord): BehaviorMatches {
  const source = parseEvidenceSource(record);
  if (source === null) {
    return {
      nullishContinue: false,
      protectedKeyContinue: false,
      arrayConcatenation: false,
      throwConditions: [],
    };
  }
  const sourceFile = source;
  let nullishContinue = false;
  let protectedKeyContinue = false;
  let arrayConcatenation = false;
  const throwConditions = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isIfStatement(node)) {
      nullishContinue ||=
        isSingleContinue(node.thenStatement) &&
        isBinaryPair(
          node.expression,
          ts.SyntaxKind.BarBarToken,
          (part) => isStrictEquality(part, "value", null),
          (part) => isStrictEquality(part, "value", "undefined"),
        );
      protectedKeyContinue ||=
        isSingleContinue(node.thenStatement) &&
        isBinaryPair(
          node.expression,
          ts.SyntaxKind.BarBarToken,
          (part) => isStrictEquality(part, "key", "__proto__"),
          (part) => isStrictEquality(part, "key", "constructor"),
        );
      arrayConcatenation ||=
        isArrayConcatenationAction(node.thenStatement) &&
        isBinaryPair(
          node.expression,
          ts.SyntaxKind.AmpersandAmpersandToken,
          (part) => isArrayCheck(part, "value"),
          (part) => isArrayCheck(part, "object_key"),
        );
      if (
        record.evidence_type === "source_range" &&
        record.locator?.symbol !== undefined &&
        hasDirectThrow(node.thenStatement)
      ) {
        const condition = node.expression
          .getText(sourceFile)
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300);
        if (condition.length > 0) throwConditions.add(condition);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return {
    nullishContinue,
    protectedKeyContinue,
    arrayConcatenation,
    throwConditions: [...throwConditions].sort(compareStrings),
  };
}

function evidenceRef(record: EvidenceRecord): GroundedEvidenceRef {
  return {
    id: record.id,
    evidence_type: record.evidence_type,
    source_kind: record.source_kind,
    verification_status: record.verification_status,
    ...(record.locator === undefined
      ? {}
      : {
          source_path: record.locator.source_path,
          ...(record.locator.blob_sha === undefined
            ? {}
            : { blob_sha: record.locator.blob_sha }),
          ...(record.locator.symbol === undefined ? {} : { symbol: record.locator.symbol }),
          ...(record.locator.field_pointer === undefined
            ? {}
            : { field_pointer: record.locator.field_pointer }),
          ...(record.locator.line_start === undefined
            ? {}
            : { line_start: record.locator.line_start }),
          ...(record.locator.line_end === undefined
            ? {}
            : { line_end: record.locator.line_end }),
          ...(record.locator.excerpt_sha256 === undefined
            ? {}
            : { excerpt_sha256: record.locator.excerpt_sha256 }),
        }),
    ...(record.call_relation === undefined ? {} : { call_relation: record.call_relation }),
  };
}

export function buildGroundedFactPack(input: GroundedFactPackInput): GroundedFactPack {
  const { brief } = input;
  const entities = new Map<string, GroundedEntity>();
  const facts: GroundedFact[] = [];
  const usedEvidence = new Map<string, EvidenceRecord>();
  const evidenceById = new Map(input.evidence.map((record) => [record.id, record]));

  function upsertEntity(id: string, entity: GroundedEntity): void {
    if (id !== entity.id) throw new Error(`Entity key ${id} does not match ${entity.id}`);
    const existing = entities.get(id);
    if (existing === undefined) {
      entities.set(id, {
        ...entity,
        evidence_ids: [...new Set(entity.evidence_ids)].sort(),
      });
      return;
    }
    const { evidence_ids: existingEvidence, ...existingShape } = existing;
    const { evidence_ids: nextEvidence, ...nextShape } = entity;
    if (JSON.stringify(existingShape) !== JSON.stringify(nextShape)) {
      throw new Error(`Conflicting entity definitions for ${id}`);
    }
    entities.set(id, {
      ...existing,
      evidence_ids: [...new Set([...existingEvidence, ...nextEvidence])].sort(),
    });
  }

  for (const record of input.evidence) {
    if (!isVerifiedAtCommit(record, brief)) continue;
    if (record.evidence_type === "direct_call" && record.call_relation !== undefined) {
      const relation = record.call_relation;
      const callerId = stableId(
        "entity_symbol",
        relation.caller.source_path,
        relation.caller.symbol.name,
        relation.caller.symbol.kind ?? "other",
      );
      const calleeId = stableId(
        "entity_symbol",
        relation.callee.source_path,
        relation.callee.symbol.name,
        relation.callee.symbol.kind ?? "other",
      );
      upsertEntity(callerId, {
        id: callerId,
        kind: "symbol",
        display_label: relation.caller.symbol.name,
        source_path: relation.caller.source_path,
        symbol: relation.caller.symbol,
        evidence_ids: [record.id],
      });
      upsertEntity(calleeId, {
        id: calleeId,
        kind: "symbol",
        display_label: relation.callee.symbol.name,
        source_path: relation.callee.source_path,
        symbol: relation.callee.symbol,
        evidence_ids: [record.id],
      });
      facts.push({
        id: stableId(
          "fact_call",
          relation.caller.source_path,
          relation.caller.symbol.name,
          relation.callee.source_path,
          relation.callee.symbol.name,
          record.id,
        ),
        fact_type: "CALL_RELATION",
        category: "RELATION",
        subject_ref: callerId,
        predicate: "CALLS",
        object_ref: calleeId,
        scope:
          relation.caller.source_path === relation.callee.source_path ? "LOCAL" : "MODULE",
        evidence_ids: [record.id],
        source_kind: "source_code",
        verification: { status: "verified", confidence: 1 },
        qualifiers: [
          { key: "RELATIONSHIP_TYPE", value: relation.resolution_method },
        ],
        limitations: [
          "This fact proves one direct static call expression only; it does not prove runtime execution, frequency, ordering, outcome, data flow, or transitive calls.",
        ],
        provenance: {
          repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
          extractor: "deterministic-evidence-to-fact-v2",
          evidence_ids: [record.id],
        },
      });
      usedEvidence.set(record.id, record);
    }
    const behavior = detectBehavior(record);
    const exportKey = packageExportKey(record);
    if (exportKey !== null) {
      const packageId = stableId("entity_package", brief.repository.owner, brief.repository.name);
      const exportId = stableId("entity_manifest_field", record.locator?.field_pointer ?? "");
      upsertEntity(packageId, {
        id: packageId,
        kind: "package",
        display_label: brief.overview.project_name,
        evidence_ids: [record.id],
      });
      upsertEntity(exportId, {
        id: exportId,
        kind: "manifest_field",
        display_label: `package export ${JSON.stringify(exportKey)}`,
        source_path: record.locator?.source_path,
        field_pointer: record.locator?.field_pointer,
        value: exportKey,
        evidence_ids: [record.id],
      });
      facts.push({
        id: stableId("fact_export", exportKey, record.id),
        fact_type: "EXPORT",
        category: "CONFIGURATION",
        subject_ref: packageId,
        predicate: "EXPORTS",
        object_ref: exportId,
        scope: "PACKAGE",
        evidence_ids: [record.id],
        source_kind: record.source_kind,
        verification: { status: "verified", confidence: 1 },
        qualifiers: [{ key: "EXPORT_SURFACE", value: "PACKAGE" }],
        limitations: [
          "A package export declaration does not prove successful runtime loading.",
        ],
        provenance: {
          repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
          extractor: "deterministic-evidence-to-fact-v1",
          evidence_ids: [record.id],
        },
      });
      usedEvidence.set(record.id, record);
    }

    const configuration = configurationField(record);
    if (configuration !== null) {
      const packageId = stableId("entity_package", brief.repository.owner, brief.repository.name);
      const fieldId = stableId(
        record.evidence_type === "manifest_field"
          ? "entity_manifest_field"
          : "entity_config_field",
        record.locator?.source_path ?? "",
        configuration.pointer,
      );
      upsertEntity(packageId, {
        id: packageId,
        kind: "package",
        display_label: brief.overview.project_name,
        evidence_ids: [record.id],
      });
      upsertEntity(fieldId, {
        id: fieldId,
        kind: record.evidence_type === "manifest_field" ? "manifest_field" : "config_field",
        display_label: `${record.locator?.source_path ?? "configuration"}${configuration.pointer}`,
        source_path: record.locator?.source_path,
        field_pointer: configuration.pointer,
        value: configuration.value,
        evidence_ids: [record.id],
      });
      facts.push({
        id: stableId(
          "fact_configuration",
          record.locator?.source_path ?? "",
          configuration.pointer,
          record.id,
        ),
        fact_type: "CONFIGURATION",
        category: "CONFIGURATION",
        subject_ref: packageId,
        predicate: "DECLARES_CONFIGURATION",
        object_ref: fieldId,
        scope: "PACKAGE",
        evidence_ids: [record.id],
        source_kind: record.source_kind,
        verification: { status: "verified", confidence: 1 },
        qualifiers: [{ key: "CONFIGURATION_FIELD", value: configuration.pointer }],
        limitations:
          configuration.pointer === "/description"
            ? [
                "This fact preserves literal manifest text; descriptive adjectives are not measured outcomes.",
              ]
            : ["A declared field does not prove that every consumer uses it at runtime."],
        provenance: {
          repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
          extractor: "deterministic-evidence-to-fact-v1",
          evidence_ids: [record.id],
        },
      });
      usedEvidence.set(record.id, record);
    }

    if (isJsonSchemaDeclaration(record)) {
      const locator = record.locator;
      if (locator !== undefined) {
        const moduleId = stableId("entity_module", locator.source_path);
        const schemaId = stableId("entity_config_field", locator.source_path, "json_schema");
        const schemaLabel = locator.source_path.split("/").at(-1) ?? locator.source_path;
        upsertEntity(moduleId, {
          id: moduleId,
          kind: "module",
          display_label: locator.source_path,
          source_path: locator.source_path,
          evidence_ids: [record.id],
        });
        upsertEntity(schemaId, {
          id: schemaId,
          kind: "config_field",
          display_label: `JSON Schema ${schemaLabel}`,
          source_path: locator.source_path,
          field_pointer: locator.field_pointer,
          evidence_ids: [record.id],
        });
        facts.push({
          id: stableId("fact_json_schema", locator.source_path, record.id),
          fact_type: "TYPE_DECLARATION",
          category: "TYPE",
          subject_ref: moduleId,
          predicate: "DECLARES_TYPE",
          object_ref: schemaId,
          scope: "MODULE",
          evidence_ids: [record.id],
          source_kind: record.source_kind,
          verification: { status: "verified", confidence: 1 },
          qualifiers: [{ key: "SYMBOL_KIND", value: "JSON_SCHEMA" }],
          limitations: [
            "The schema document is statically present and parseable; this fact does not prove runtime invocation.",
          ],
          provenance: {
            repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
            extractor: "deterministic-evidence-to-fact-v1",
            evidence_ids: [record.id],
          },
        });
        usedEvidence.set(record.id, record);
      }
    }

    for (const condition of behavior.throwConditions) {
      const locator = record.locator;
      const symbol = locator?.symbol;
      if (locator === undefined || symbol === undefined) continue;
      const subjectId = stableId(
        "entity_symbol",
        locator.source_path,
        symbol.name,
        symbol.kind ?? "other",
      );
      const conditionId = stableId(
        "entity_condition",
        locator.source_path,
        symbol.name,
        condition,
      );
      upsertEntity(subjectId, {
        id: subjectId,
        kind: "symbol",
        display_label: symbol.name,
        source_path: locator.source_path,
        symbol,
        evidence_ids: [record.id],
      });
      upsertEntity(conditionId, {
        id: conditionId,
        kind: "condition",
        display_label: condition,
        source_path: locator.source_path,
        value: condition,
        evidence_ids: [record.id],
      });
      facts.push({
        id: stableId(
          "fact_branch",
          locator.source_path,
          symbol.name,
          "throw",
          condition,
          record.id,
        ),
        fact_type: "BRANCH_BEHAVIOR",
        category: "BEHAVIORAL",
        subject_ref: subjectId,
        predicate: "THROWS_WHEN",
        object_ref: conditionId,
        scope: "LOCAL",
        evidence_ids: [record.id],
        source_kind: record.source_kind,
        verification: { status: "verified", confidence: 1 },
        qualifiers: [{ key: "ACTION", value: "THROW" }],
        limitations: [
          "The fact describes one authored local throw branch and does not prove that the condition occurs at runtime.",
        ],
        provenance: {
          repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
          extractor: "deterministic-evidence-to-fact-v1",
          evidence_ids: [record.id],
        },
      });
      usedEvidence.set(record.id, record);
    }

    if (behavior.nullishContinue) {
      const locator = record.locator;
      if (locator !== undefined) {
        const symbol = locator.symbol;
        const subjectId =
          symbol === undefined
            ? stableId("entity_module", locator.source_path)
            : stableId(
                "entity_symbol",
                locator.source_path,
                symbol.name,
                symbol.kind ?? "other",
              );
        upsertEntity(subjectId, {
          id: subjectId,
          kind: symbol === undefined ? "module" : "symbol",
          display_label: symbol?.name ?? locator.source_path,
          source_path: locator.source_path,
          ...(symbol === undefined ? {} : { symbol }),
          evidence_ids: [record.id],
        });
        const conditionId = stableId(
          "entity_condition",
          locator.source_path,
          symbol?.name ?? "module_scope",
          "value_null_or_undefined",
        );
        upsertEntity(conditionId, {
          id: conditionId,
          kind: "condition",
          display_label: "value === null || value === undefined",
          source_path: locator.source_path,
          value: {
            operator: "OR",
            terms: [
              { left: "value", operator: "EQUALS", right: null },
              { left: "value", operator: "EQUALS", right: "undefined" },
            ],
          },
          evidence_ids: [record.id],
        });
        facts.push({
          id: stableId("fact_branch", locator.source_path, "nullish_continue", record.id),
          fact_type: "BRANCH_BEHAVIOR",
          category: "BEHAVIORAL",
          subject_ref: subjectId,
          predicate: "SKIPS_WHEN",
          object_ref: conditionId,
          scope: "LOCAL",
          evidence_ids: [record.id],
          source_kind: record.source_kind,
          verification: { status: "verified", confidence: 1 },
          qualifiers: [{ key: "ACTION", value: "CONTINUE" }],
          limitations: [
            "The fact describes only the shown branch and does not establish project-wide nullish behavior.",
          ],
          provenance: {
            repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
            extractor: "deterministic-evidence-to-fact-v1",
            evidence_ids: [record.id],
          },
        });
        usedEvidence.set(record.id, record);
      }
    }

    if (behavior.protectedKeyContinue) {
      const locator = record.locator;
      if (locator !== undefined) {
        const symbol = locator.symbol;
        const subjectId =
          symbol === undefined
            ? stableId("entity_module", locator.source_path)
            : stableId(
                "entity_symbol",
                locator.source_path,
                symbol.name,
                symbol.kind ?? "other",
              );
        upsertEntity(subjectId, {
          id: subjectId,
          kind: symbol === undefined ? "module" : "symbol",
          display_label: symbol?.name ?? locator.source_path,
          source_path: locator.source_path,
          ...(symbol === undefined ? {} : { symbol }),
          evidence_ids: [record.id],
        });
        const conditionId = stableId(
          "entity_condition",
          locator.source_path,
          symbol?.name ?? "module_scope",
          "protected_key_names",
        );
        upsertEntity(conditionId, {
          id: conditionId,
          kind: "condition",
          display_label: 'key === "__proto__" || key === "constructor"',
          source_path: locator.source_path,
          value: {
            operator: "OR",
            terms: [
              { left: "key", operator: "EQUALS", right: "__proto__" },
              { left: "key", operator: "EQUALS", right: "constructor" },
            ],
          },
          evidence_ids: [record.id],
        });
        facts.push({
          id: stableId("fact_branch", locator.source_path, "protected_key_continue", record.id),
          fact_type: "BRANCH_BEHAVIOR",
          category: "BEHAVIORAL",
          subject_ref: subjectId,
          predicate: "SKIPS_WHEN",
          object_ref: conditionId,
          scope: "LOCAL",
          evidence_ids: [record.id],
          source_kind: record.source_kind,
          verification: { status: "verified", confidence: 1 },
          qualifiers: [{ key: "ACTION", value: "CONTINUE" }],
          limitations: [
            "This local key branch does not establish a general security guarantee or complete prototype-pollution protection.",
          ],
          provenance: {
            repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
            extractor: "deterministic-evidence-to-fact-v1",
            evidence_ids: [record.id],
          },
        });
        usedEvidence.set(record.id, record);
      }
    }

    if (behavior.arrayConcatenation) {
      const locator = record.locator;
      if (locator !== undefined) {
        const symbol = locator.symbol;
        const subjectId =
          symbol === undefined
            ? stableId("entity_module", locator.source_path)
            : stableId(
                "entity_symbol",
                locator.source_path,
                symbol.name,
                symbol.kind ?? "other",
              );
        upsertEntity(subjectId, {
          id: subjectId,
          kind: symbol === undefined ? "module" : "symbol",
          display_label: symbol?.name ?? locator.source_path,
          source_path: locator.source_path,
          ...(symbol === undefined ? {} : { symbol }),
          evidence_ids: [record.id],
        });
        const conditionId = stableId(
          "entity_condition",
          locator.source_path,
          symbol?.name ?? "module_scope",
          "both_values_are_arrays",
        );
        upsertEntity(conditionId, {
          id: conditionId,
          kind: "condition",
          display_label: "Array.isArray(value) && Array.isArray(object[key])",
          source_path: locator.source_path,
          value: {
            operator: "AND",
            terms: [
              { operand: "value", predicate: "IS_ARRAY" },
              { operand: "object[key]", predicate: "IS_ARRAY" },
            ],
          },
          evidence_ids: [record.id],
        });
        facts.push({
          id: stableId("fact_branch", locator.source_path, "array_concatenation", record.id),
          fact_type: "BRANCH_BEHAVIOR",
          category: "BEHAVIORAL",
          subject_ref: subjectId,
          predicate: "CONCATENATES_WHEN",
          object_ref: conditionId,
          scope: "LOCAL",
          evidence_ids: [record.id],
          source_kind: record.source_kind,
          verification: { status: "verified", confidence: 1 },
          qualifiers: [
            { key: "ACTION", value: "ASSIGN_CONCAT_VALUE_BEFORE_EXISTING" },
          ],
          limitations: [
            "The fact describes only the shown array branch and preserves its value-before-existing order.",
          ],
          provenance: {
            repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
            extractor: "deterministic-evidence-to-fact-v1",
            evidence_ids: [record.id],
          },
        });
        usedEvidence.set(record.id, record);
      }
    }

    if (isTypeSymbol(record)) {
      const locator = record.locator;
      const symbol = locator?.symbol;
      if (locator !== undefined && symbol !== undefined) {
        const moduleId = stableId("entity_module", locator.source_path);
        const symbolId = stableId(
          "entity_symbol",
          locator.source_path,
          symbol.name,
          symbol.kind ?? "other",
        );
        upsertEntity(moduleId, {
          id: moduleId,
          kind: "module",
          display_label: locator.source_path,
          source_path: locator.source_path,
          evidence_ids: [record.id],
        });
        upsertEntity(symbolId, {
          id: symbolId,
          kind: "symbol",
          display_label: symbol.name,
          source_path: locator.source_path,
          symbol,
          evidence_ids: [record.id],
        });
        facts.push({
          id: stableId("fact_type_declaration", locator.source_path, symbol.name, record.id),
          fact_type: "TYPE_DECLARATION",
          category: "TYPE",
          subject_ref: moduleId,
          predicate: "DECLARES_TYPE",
          object_ref: symbolId,
          scope: "LOCAL",
          evidence_ids: [record.id],
          source_kind: record.source_kind,
          verification: { status: "verified", confidence: 1 },
          qualifiers: [{ key: "SYMBOL_KIND", value: symbol.kind ?? "type" }],
          limitations: [
            "A type declaration does not prove runtime behavior or runtime equivalence.",
          ],
          provenance: {
            repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
            extractor: "deterministic-evidence-to-fact-v1",
            evidence_ids: [record.id],
          },
        });
        facts.push({
          id: stableId("fact_contains", locator.source_path, symbol.name, record.id),
          fact_type: "MODULE_CONTAINS",
          category: "STRUCTURAL",
          subject_ref: moduleId,
          predicate: "CONTAINS",
          object_ref: symbolId,
          scope: "MODULE",
          evidence_ids: [record.id],
          source_kind: record.source_kind,
          verification: { status: "verified", confidence: 1 },
          qualifiers: [{ key: "CONTAINER_RELATION", value: "DIRECT_DECLARATION" }],
          limitations: ["Containment is limited to the declaration location in this module."],
          provenance: {
            repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
            extractor: "deterministic-evidence-to-fact-v1",
            evidence_ids: [record.id],
          },
        });
        if (isExplicitSourceExport(record)) {
          facts.push({
            id: stableId("fact_source_export", locator.source_path, symbol.name, record.id),
            fact_type: "EXPORT",
            category: "CONFIGURATION",
            subject_ref: moduleId,
            predicate: "EXPORTS",
            object_ref: symbolId,
            scope: "MODULE",
            evidence_ids: [record.id],
            source_kind: record.source_kind,
            verification: { status: "verified", confidence: 1 },
            qualifiers: [{ key: "EXPORT_SURFACE", value: "SOURCE" }],
            limitations: [
              "A source export does not by itself establish the public package export surface.",
            ],
            provenance: {
              repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
              extractor: "deterministic-evidence-to-fact-v1",
              evidence_ids: [record.id],
            },
          });
        }
        usedEvidence.set(record.id, record);
      }
    }

    if (!isRuntimeSymbol(record)) continue;
    const locator = record.locator;
    const symbol = locator?.symbol;
    if (locator === undefined || symbol === undefined) continue;

    const moduleId = stableId("entity_module", locator.source_path);
    const symbolId = stableId("entity_symbol", locator.source_path, symbol.name, symbol.kind ?? "other");
    upsertEntity(moduleId, {
      id: moduleId,
      kind: "module",
      display_label: locator.source_path,
      source_path: locator.source_path,
      evidence_ids: [record.id],
    });
    upsertEntity(symbolId, {
      id: symbolId,
      kind: "symbol",
      display_label: symbol.name,
      source_path: locator.source_path,
      symbol,
      evidence_ids: [record.id],
    });
    facts.push({
      id: stableId("fact_declaration", locator.source_path, symbol.name, record.id),
      fact_type: "DECLARATION",
      category: "STRUCTURAL",
      subject_ref: moduleId,
      predicate: "DECLARES",
      object_ref: symbolId,
      scope: "LOCAL",
      evidence_ids: [record.id],
      source_kind: record.source_kind,
      verification: { status: "verified", confidence: 1 },
      qualifiers: [{ key: "SYMBOL_KIND", value: symbol.kind ?? "other" }],
      limitations: [],
      provenance: {
        repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
        extractor: "deterministic-evidence-to-fact-v1",
        evidence_ids: [record.id],
      },
    });
    facts.push({
      id: stableId("fact_contains", locator.source_path, symbol.name, record.id),
      fact_type: "MODULE_CONTAINS",
      category: "STRUCTURAL",
      subject_ref: moduleId,
      predicate: "CONTAINS",
      object_ref: symbolId,
      scope: "MODULE",
      evidence_ids: [record.id],
      source_kind: record.source_kind,
      verification: { status: "verified", confidence: 1 },
      qualifiers: [{ key: "CONTAINER_RELATION", value: "DIRECT_DECLARATION" }],
      limitations: ["Containment is limited to the declaration location in this module."],
      provenance: {
        repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
        extractor: "deterministic-evidence-to-fact-v1",
        evidence_ids: [record.id],
      },
    });
    if (isExplicitSourceExport(record)) {
      facts.push({
        id: stableId("fact_source_export", locator.source_path, symbol.name, record.id),
        fact_type: "EXPORT",
        category: "CONFIGURATION",
        subject_ref: moduleId,
        predicate: "EXPORTS",
        object_ref: symbolId,
        scope: "MODULE",
        evidence_ids: [record.id],
        source_kind: record.source_kind,
        verification: { status: "verified", confidence: 1 },
        qualifiers: [{ key: "EXPORT_SURFACE", value: "SOURCE" }],
        limitations: [
          "A source export does not by itself establish the public package export surface.",
        ],
        provenance: {
          repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
          extractor: "deterministic-evidence-to-fact-v1",
          evidence_ids: [record.id],
        },
      });
    }
    usedEvidence.set(record.id, record);
  }

  const modulesById = new Map(brief.core_modules.map((module) => [module.id, module]));
  for (const relationship of brief.relationships) {
    if (relationship.status !== "verified" || relationship.relationship_type !== "imports") {
      continue;
    }
    const from = modulesById.get(relationship.from_module_id);
    const to = modulesById.get(relationship.to_module_id);
    const fromPath = from?.source_paths[0];
    const toPath = to?.source_paths[0];
    if (fromPath === undefined || toPath === undefined) continue;
    const compatibleEvidence = relationship.evidence_ids
      .map((id) => evidenceById.get(id))
      .filter((record): record is EvidenceRecord => record !== undefined)
      .filter(
        (record) =>
          isVerifiedAtCommit(record, brief) &&
          record.evidence_type === "source_range" &&
          record.source_kind === "source_code" &&
          record.locator?.source_path === fromPath &&
          /^\s*(?:import|export)\b/m.test(record.locator.excerpt ?? ""),
      );
    if (compatibleEvidence.length === 0) continue;

    const fromEntityId = stableId("entity_module", fromPath);
    const toEntityId = stableId("entity_module", toPath);
    const evidenceIds = compatibleEvidence.map((record) => record.id).sort();
    upsertEntity(fromEntityId, {
      id: fromEntityId,
      kind: "module",
      display_label: fromPath,
      source_path: fromPath,
      evidence_ids: evidenceIds,
    });
    upsertEntity(toEntityId, {
      id: toEntityId,
      kind: "module",
      display_label: toPath,
      source_path: toPath,
      evidence_ids: evidenceIds,
    });
    facts.push({
      id: stableId("fact_import", fromPath, toPath, ...evidenceIds),
      fact_type: "IMPORT_RELATION",
      category: "RELATION",
      subject_ref: fromEntityId,
      predicate: "IMPORTS",
      object_ref: toEntityId,
      scope: "MODULE",
      evidence_ids: evidenceIds,
      source_kind: "source_code",
      verification: { status: "verified", confidence: 1 },
      qualifiers: [{ key: "RELATIONSHIP_TYPE", value: "STATIC_IMPORT" }],
      limitations: ["A static import does not prove runtime call frequency or control flow."],
      provenance: {
        repository: { url: brief.repository.url, commit_sha: brief.repository.commit_sha },
        extractor: "deterministic-evidence-to-fact-v1",
        evidence_ids: evidenceIds,
      },
    });
    for (const record of compatibleEvidence) usedEvidence.set(record.id, record);
  }

  const pack: GroundedFactPack = {
    fact_ir_version: FACT_IR_VERSION,
    repository: {
      url: brief.repository.url,
      owner: brief.repository.owner,
      name: brief.repository.name,
    },
    commit: brief.repository.commit_sha,
    entities: [...entities.values()].sort((left, right) => compareStrings(left.id, right.id)),
    facts: facts.sort((left, right) => compareStrings(left.id, right.id)),
    evidence_refs: [...usedEvidence.values()]
      .map(evidenceRef)
      .sort((left, right) => compareStrings(left.id, right.id)),
    unsupported_areas: [
      {
        id: "call_relation_coverage_gap_alias",
        reason:
          "The bounded call resolver does not resolve tsconfig path aliases, package aliases, or non-relative module specifiers.",
        evidence_needed:
          "An explicitly scoped alias resolver bound to the repository configuration and current commit.",
      },
      {
        id: "call_relation_dynamic_and_indirect",
        reason:
          "CALL_RELATION Facts cover only direct static same-file calls, relative ESM imports, and one explicit named re-export hop; dynamic, computed, injected, reflective, callback, and higher-order targets remain unresolved.",
        evidence_needed:
          "A separately reviewed resolver or runtime trace for the specific unsupported binding form.",
      },
      {
        id: "general_branch_behavior",
        reason:
          "Branch facts are limited to exact extractor patterns whose condition and action are both present in one verified excerpt.",
        evidence_needed:
          "Control-flow analysis with a larger reviewed pattern set and explicit path boundaries.",
      },
      {
        id: "safety_guarantees",
        reason:
          "The deterministic extractor does not infer safety from the absence of a dangerous pattern.",
        evidence_needed:
          "A dedicated security analysis proving the relevant inputs, writes, guards, and bypass paths.",
      },
      {
        id: "input_immutability",
        reason:
          "A declaration or type signature does not establish whether runtime inputs are mutated.",
        evidence_needed:
          "Mutation-aware control-flow and alias analysis covering every reachable write path.",
      },
      {
        id: "performance_outcomes",
        reason:
          "Documentation adjectives such as lightweight or fast are not runtime measurements.",
        evidence_needed:
          "A reproducible benchmark with workload, environment, baseline, and measured results.",
      },
    ].sort((left, right) => compareStrings(left.id, right.id)),
    limitations: [
      "Facts describe only the supplied canonical evidence at the pinned repository commit.",
      "Literal configuration and export declarations do not prove consumer runtime behavior.",
      "The extractor does not turn documentation, inference, analogy, or unresolved records into verified facts.",
    ].sort(compareStrings),
  };

  const integrity = validateGroundedFactPackIntegrity(pack);
  if (!integrity.valid) {
    throw new Error(`GroundedFactPack integrity failed: ${integrity.errors.join("; ")}`);
  }
  return pack;
}
