import { posix } from "node:path";

import ts from "typescript";

import type { ReadRepositoryFile, RepositorySnapshot } from "../repo/contracts.js";

export type StaticSymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "module"
  | "variable"
  | "constant"
  | "other";

export interface StaticSymbol {
  readonly path: string;
  readonly name: string;
  readonly kind: StaticSymbolKind;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly excerpt: string;
}

export interface StaticRelationship {
  readonly fromPath: string;
  readonly toPath: string;
  readonly specifier: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly excerpt: string;
}

export interface StaticJsonSchema {
  readonly path: string;
  readonly schemaUri: string | null;
  readonly schemaId: string | null;
  readonly title: string | null;
  readonly rootType: string | null;
  readonly propertyNames: readonly string[];
  readonly requiredProperties: readonly string[];
}

export interface StaticBranchBehavior {
  readonly path: string;
  readonly ownerSymbol: string;
  readonly action: "throw";
  readonly condition: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly excerpt: string;
}

export type StaticCallResolutionMethod =
  | "SAME_FILE"
  | "RELATIVE_NAMED_IMPORT"
  | "RELATIVE_DEFAULT_IMPORT"
  | "RELATIVE_NAMESPACE_IMPORT"
  | "RELATIVE_NAMED_REEXPORT";

export interface StaticCallImportBinding {
  readonly kind: "named" | "default" | "namespace" | "reexport";
  readonly specifier: string;
  readonly localName: string;
  readonly importedName: string;
  readonly declarationPath: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly reexportHop?: {
    readonly declarationPath: string;
    readonly specifier: string;
    readonly exportedName: string;
    readonly importedName: string;
    readonly lineStart: number;
    readonly lineEnd: number;
  };
}

export interface StaticDirectCall {
  readonly callerPath: string;
  readonly callerSymbol: string;
  readonly calleePath: string;
  readonly calleeSymbol: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly excerpt: string;
  readonly sourceOrder: number;
  readonly resolutionMethod: StaticCallResolutionMethod;
  readonly importBinding?: StaticCallImportBinding;
  readonly runtimeExecutionGuaranteed: false;
}

export type StaticUnresolvedCallReason =
  | "CALLBACK_OR_SHADOWED_BINDING"
  | "COMPUTED_PROPERTY_UNSUPPORTED"
  | "UNRESOLVED_IDENTIFIER"
  | "UNRESOLVED_MEMBER";

export interface StaticUnresolvedCall {
  readonly callerPath: string;
  readonly callerSymbol: string;
  readonly expression: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly excerpt: string;
  readonly sourceOrder: number;
  readonly reason: StaticUnresolvedCallReason;
}

export interface StaticFacts {
  readonly sourcePaths: readonly string[];
  readonly symbols: readonly StaticSymbol[];
  readonly relationships: readonly StaticRelationship[];
  readonly schemas: readonly StaticJsonSchema[];
  readonly branchBehaviors: readonly StaticBranchBehavior[];
  readonly directCalls: readonly StaticDirectCall[];
  readonly unresolvedCalls: readonly StaticUnresolvedCall[];
}

interface ModuleReference {
  readonly specifier: string;
  readonly node: ts.Node;
}

const JAVASCRIPT_TYPESCRIPT_SOURCE = /\.(?:c|m)?(?:j|t)sx?$/i;

function scriptKind(path: string): ts.ScriptKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function lineRange(sourceFile: ts.SourceFile, node: ts.Node): {
  lineStart: number;
  lineEnd: number;
  excerpt: string;
} {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const endPosition = Math.max(node.getStart(sourceFile), node.getEnd() - 1);
  const end = sourceFile.getLineAndCharacterOfPosition(endPosition).line + 1;
  const lines = sourceFile.text.split(/\r?\n/);
  return {
    lineStart: start,
    lineEnd: end,
    excerpt: lines.slice(start - 1, end).join("\n").slice(0, 1200),
  };
}

function namedSymbol(
  path: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  kind: StaticSymbolKind,
): StaticSymbol {
  return { path, name, kind, ...lineRange(sourceFile, node) };
}

function topLevelSymbols(path: string, sourceFile: ts.SourceFile): StaticSymbol[] {
  const symbols: StaticSymbol[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      symbols.push(namedSymbol(path, sourceFile, statement, statement.name.text, "function"));
    } else if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      symbols.push(namedSymbol(path, sourceFile, statement, statement.name.text, "class"));
    } else if (ts.isInterfaceDeclaration(statement)) {
      symbols.push(namedSymbol(path, sourceFile, statement, statement.name.text, "interface"));
    } else if (ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      symbols.push(namedSymbol(path, sourceFile, statement, statement.name.text, "type"));
    } else if (ts.isModuleDeclaration(statement)) {
      symbols.push(namedSymbol(path, sourceFile, statement, statement.name.getText(), "module"));
    } else if (ts.isVariableStatement(statement)) {
      const kind =
        (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 ? "constant" : "variable";
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          symbols.push(
            namedSymbol(path, sourceFile, declaration, declaration.name.text, kind),
          );
        }
      }
    }
  }
  return symbols;
}

function moduleReferences(sourceFile: ts.SourceFile): ModuleReference[] {
  const references: ModuleReference[] = [];

  function add(node: ts.Node, expression: ts.Expression | undefined): void {
    if (expression !== undefined && ts.isStringLiteralLike(expression)) {
      references.push({ specifier: expression.text, node });
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      add(statement, statement.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      add(statement, statement.moduleReference.expression);
    }
  }

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ((ts.isIdentifier(node.expression) && node.expression.text === "require") ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      add(node, node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return references;
}

function resolveRelativeImport(
  fromPath: string,
  specifier: string,
  knownPaths: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return null;
  }

  const joined = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  if (joined.startsWith("../") || joined === ".." || posix.isAbsolute(joined)) {
    return null;
  }

  const extension = posix.extname(joined).toLowerCase();
  const base = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"].includes(
    extension,
  )
    ? joined.slice(0, -extension.length)
    : joined;
  const candidates = [
    joined,
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map(
      (candidateExtension) => `${base}${candidateExtension}`,
    ),
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map(
      (candidateExtension) => `${base}/index${candidateExtension}`,
    ),
  ];

  return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
}

function sourceFiles(snapshot: RepositorySnapshot): ReadRepositoryFile[] {
  return snapshot.files.filter((file) => file.kind === "source");
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").sort()
    : [];
}

function jsonSchemas(snapshot: RepositorySnapshot): StaticJsonSchema[] {
  return snapshot.files
    .filter((file) => file.kind === "schema")
    .flatMap((file): StaticJsonSchema[] => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(file.text) as unknown;
      } catch {
        return [];
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return [];
      }
      const schema = parsed as Readonly<Record<string, unknown>>;
      const properties = schema.properties;
      const propertyNames =
        properties !== null && typeof properties === "object" && !Array.isArray(properties)
          ? Object.keys(properties).sort()
          : [];
      return [
        {
          path: file.path,
          schemaUri: stringField(schema.$schema),
          schemaId: stringField(schema.$id),
          title: stringField(schema.title),
          rootType: stringField(schema.type),
          propertyNames,
          requiredProperties: stringArray(schema.required),
        },
      ];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function directThrow(statement: ts.Statement): boolean {
  return (
    ts.isThrowStatement(statement) ||
    (ts.isBlock(statement) && statement.statements.some((item) => ts.isThrowStatement(item)))
  );
}

function branchesFor(
  path: string,
  sourceFile: ts.SourceFile,
  ownerSymbol: string,
  body: ts.ConciseBody | undefined,
): StaticBranchBehavior[] {
  if (body === undefined || !ts.isBlock(body)) return [];
  const branches: StaticBranchBehavior[] = [];
  function visit(node: ts.Node): void {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isIfStatement(node) && directThrow(node.thenStatement)) {
      branches.push({
        path,
        ownerSymbol,
        action: "throw",
        condition: node.expression.getText(sourceFile).replace(/\s+/g, " ").trim().slice(0, 300),
        ...lineRange(sourceFile, node),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  return branches;
}

function branchBehaviorsFor(path: string, sourceFile: ts.SourceFile): StaticBranchBehavior[] {
  const branches: StaticBranchBehavior[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      branches.push(
        ...branchesFor(path, sourceFile, statement.name.text, statement.body),
      );
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer !== undefined &&
        (ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer))
      ) {
        branches.push(
          ...branchesFor(
            path,
            sourceFile,
            declaration.name.text,
            declaration.initializer.body,
          ),
        );
      }
    }
  }
  return branches;
}

interface CallableOwner {
  readonly name: string;
  readonly body: ts.ConciseBody;
  readonly parameters: readonly ts.ParameterDeclaration[];
}

function addBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) addBindingNames(element.name, names);
  }
}

function lexicalBindings(body: ts.ConciseBody): ReadonlySet<string> {
  const names = new Set<string>();
  function visit(node: ts.Node): void {
    if (node !== body && ts.isFunctionLike(node)) {
      if (ts.isFunctionDeclaration(node) && node.name !== undefined) names.add(node.name.text);
      return;
    }
    if (ts.isVariableDeclaration(node)) addBindingNames(node.name, names);
    if (ts.isClassDeclaration(node) && node.name !== undefined) names.add(node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(body);
  return names;
}

interface ImportBinding {
  readonly kind: "named" | "default" | "namespace";
  readonly specifier: string;
  readonly localName: string;
  readonly importedName: string;
  readonly declaration: ts.ImportDeclaration;
}

function callableOwners(sourceFile: ts.SourceFile): CallableOwner[] {
  const owners: CallableOwner[] = [];
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      statement.body !== undefined
    ) {
      owners.push({
        name: statement.name.text,
        body: statement.body,
        parameters: statement.parameters,
      });
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer !== undefined &&
        (ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer))
      ) {
        owners.push({
          name: declaration.name.text,
          body: declaration.initializer.body,
          parameters: declaration.initializer.parameters,
        });
      }
    }
  }
  return owners;
}

function importBindings(sourceFile: ts.SourceFile): ReadonlyMap<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    if (clause.name !== undefined) {
      bindings.set(clause.name.text, {
        kind: "default",
        specifier: statement.moduleSpecifier.text,
        localName: clause.name.text,
        importedName: "default",
        declaration: statement,
      });
    }
    const named = clause.namedBindings;
    if (named !== undefined && ts.isNamespaceImport(named)) {
      bindings.set(named.name.text, {
        kind: "namespace",
        specifier: statement.moduleSpecifier.text,
        localName: named.name.text,
        importedName: "*",
        declaration: statement,
      });
    } else if (named !== undefined && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (element.isTypeOnly) continue;
        bindings.set(element.name.text, {
          kind: "named",
          specifier: statement.moduleSpecifier.text,
          localName: element.name.text,
          importedName: element.propertyName?.text ?? element.name.text,
          declaration: statement,
        });
      }
    }
  }
  return bindings;
}

interface ResolvedCallableExport {
  readonly path: string;
  readonly symbol: string;
  readonly throughReexport: boolean;
  readonly reexportHop?: NonNullable<StaticCallImportBinding["reexportHop"]>;
}

function resolveCallableExport(
  path: string,
  exportName: string,
  parsedByPath: ReadonlyMap<string, ts.SourceFile>,
  knownPaths: ReadonlySet<string>,
  reexportDepth = 0,
): ResolvedCallableExport | null {
  const sourceFile = parsedByPath.get(path);
  if (sourceFile === undefined) return null;
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body !== undefined) {
      const isDefault = statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      );
      const isExported = statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (isExported === true && statement.name !== undefined) {
        if (statement.name.text === exportName || (isDefault === true && exportName === "default")) {
          return { path, symbol: statement.name.text, throughReexport: reexportDepth > 0 };
        }
      }
    }
    if (ts.isVariableStatement(statement)) {
      const isExported = statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (isExported === true) {
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === exportName &&
            declaration.initializer !== undefined &&
            (ts.isArrowFunction(declaration.initializer) ||
              ts.isFunctionExpression(declaration.initializer))
          ) {
            return { path, symbol: declaration.name.text, throughReexport: reexportDepth > 0 };
          }
        }
      }
    }
    if (
      reexportDepth === 0 &&
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const element = statement.exportClause.elements.find(
        (candidate) => candidate.name.text === exportName,
      );
      if (element === undefined || element.isTypeOnly) continue;
      const targetPath = resolveRelativeImport(path, statement.moduleSpecifier.text, knownPaths);
      if (targetPath === null) continue;
      const resolved = resolveCallableExport(
        targetPath,
        element.propertyName?.text ?? element.name.text,
        parsedByPath,
        knownPaths,
        reexportDepth + 1,
      );
      if (resolved !== null) {
        const range = lineRange(sourceFile, statement);
        return {
          ...resolved,
          throughReexport: true,
          reexportHop: {
            declarationPath: path,
            specifier: statement.moduleSpecifier.text,
            exportedName: element.name.text,
            importedName: element.propertyName?.text ?? element.name.text,
            lineStart: range.lineStart,
            lineEnd: range.lineEnd,
          },
        };
      }
    }
  }
  return null;
}

function directCallsFor(
  path: string,
  sourceFile: ts.SourceFile,
  parsedByPath: ReadonlyMap<string, ts.SourceFile>,
  knownPaths: ReadonlySet<string>,
): { readonly resolved: StaticDirectCall[]; readonly unresolved: StaticUnresolvedCall[] } {
  const directCalls: StaticDirectCall[] = [];
  const unresolvedCalls: StaticUnresolvedCall[] = [];
  const localCallables = new Set(callableOwners(sourceFile).map((owner) => owner.name));
  const imports = importBindings(sourceFile);

  for (const owner of callableOwners(sourceFile)) {
    const shadowedNames = new Set(
      owner.parameters.flatMap((parameter) =>
        ts.isIdentifier(parameter.name) ? [parameter.name.text] : [],
      ),
    );
    lexicalBindings(owner.body).forEach((name) => shadowedNames.add(name));
    function unresolved(node: ts.CallExpression, reason: StaticUnresolvedCallReason): void {
      unresolvedCalls.push({
        callerPath: path,
        callerSymbol: owner.name,
        expression: node.expression.getText(sourceFile).replace(/\s+/g, " ").slice(0, 300),
        ...lineRange(sourceFile, node),
        sourceOrder: node.getStart(sourceFile),
        reason,
      });
    }
    function visit(node: ts.Node): void {
      if (node !== owner.body && ts.isFunctionLike(node)) return;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const calleeName = node.expression.text;
        const range = lineRange(sourceFile, node);
        if (shadowedNames.has(calleeName)) {
          unresolved(node, "CALLBACK_OR_SHADOWED_BINDING");
        } else if (localCallables.has(calleeName)) {
          directCalls.push({
            callerPath: path,
            callerSymbol: owner.name,
            calleePath: path,
            calleeSymbol: calleeName,
            ...range,
            sourceOrder: node.getStart(sourceFile),
            resolutionMethod: "SAME_FILE",
            runtimeExecutionGuaranteed: false,
          });
        } else {
          const binding = imports.get(calleeName);
          const calleePath =
            binding === undefined
              ? null
              : resolveRelativeImport(path, binding.specifier, knownPaths);
          const resolved =
            binding === undefined || calleePath === null || binding.kind === "namespace"
              ? null
              : resolveCallableExport(
                  calleePath,
                  binding.importedName,
                  parsedByPath,
                  knownPaths,
                );
          if (
            binding !== undefined &&
            calleePath !== null &&
            resolved !== null
          ) {
            const declarationRange = lineRange(sourceFile, binding.declaration);
            directCalls.push({
              callerPath: path,
              callerSymbol: owner.name,
              calleePath: resolved.path,
              calleeSymbol: resolved.symbol,
              ...range,
              sourceOrder: node.getStart(sourceFile),
              resolutionMethod: resolved.throughReexport
                ? "RELATIVE_NAMED_REEXPORT"
                : binding.kind === "default"
                  ? "RELATIVE_DEFAULT_IMPORT"
                  : "RELATIVE_NAMED_IMPORT",
              importBinding: {
                kind: resolved.throughReexport ? "reexport" : binding.kind,
                specifier: binding.specifier,
                localName: binding.localName,
                importedName: binding.importedName,
                declarationPath: path,
                lineStart: declarationRange.lineStart,
                lineEnd: declarationRange.lineEnd,
                ...(resolved.reexportHop === undefined
                  ? {}
                  : { reexportHop: resolved.reexportHop }),
              },
              runtimeExecutionGuaranteed: false,
            });
          } else {
            unresolved(node, "UNRESOLVED_IDENTIFIER");
          }
        }
      } else if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression)
      ) {
        const namespaceName = node.expression.expression.text;
        const binding = imports.get(namespaceName);
        if (binding?.kind === "namespace") {
          const importedPath = resolveRelativeImport(path, binding.specifier, knownPaths);
          const resolved =
            importedPath === null
              ? null
              : resolveCallableExport(
                  importedPath,
                  node.expression.name.text,
                  parsedByPath,
                  knownPaths,
                );
          if (resolved !== null && !resolved.throughReexport) {
            const range = lineRange(sourceFile, node);
            const declarationRange = lineRange(sourceFile, binding.declaration);
            directCalls.push({
              callerPath: path,
              callerSymbol: owner.name,
              calleePath: resolved.path,
              calleeSymbol: resolved.symbol,
              ...range,
              sourceOrder: node.getStart(sourceFile),
              resolutionMethod: "RELATIVE_NAMESPACE_IMPORT",
              importBinding: {
                kind: "namespace",
                specifier: binding.specifier,
                localName: binding.localName,
                importedName: node.expression.name.text,
                declarationPath: path,
                lineStart: declarationRange.lineStart,
                lineEnd: declarationRange.lineEnd,
              },
              runtimeExecutionGuaranteed: false,
            });
          } else {
            unresolved(node, "UNRESOLVED_MEMBER");
          }
        } else {
          unresolved(node, "UNRESOLVED_MEMBER");
        }
      } else if (ts.isCallExpression(node) && ts.isElementAccessExpression(node.expression)) {
        unresolved(node, "COMPUTED_PROPERTY_UNSUPPORTED");
      }
      ts.forEachChild(node, visit);
    }
    visit(owner.body);
  }
  return { resolved: directCalls, unresolved: unresolvedCalls };
}

export function extractStaticFacts(snapshot: RepositorySnapshot): StaticFacts {
  const files = sourceFiles(snapshot);
  const syntaxFiles = files.filter((file) => JAVASCRIPT_TYPESCRIPT_SOURCE.test(file.path));
  const knownPaths = new Set(files.map((file) => file.path));
  const parsedByPath = new Map(
    syntaxFiles.map((file) => [
      file.path,
      ts.createSourceFile(
        file.path,
        file.text,
        ts.ScriptTarget.Latest,
        true,
        scriptKind(file.path),
      ),
    ]),
  );
  const symbols: StaticSymbol[] = [];
  const relationships: StaticRelationship[] = [];
  const branchBehaviors: StaticBranchBehavior[] = [];
  const relationshipKeys = new Set<string>();
  const directCalls: StaticDirectCall[] = [];
  const unresolvedCalls: StaticUnresolvedCall[] = [];

  for (const file of syntaxFiles) {
    const sourceFile = parsedByPath.get(file.path);
    if (sourceFile === undefined) continue;
    symbols.push(...topLevelSymbols(file.path, sourceFile));
    branchBehaviors.push(...branchBehaviorsFor(file.path, sourceFile));
    const calls = directCallsFor(file.path, sourceFile, parsedByPath, knownPaths);
    directCalls.push(...calls.resolved);
    unresolvedCalls.push(...calls.unresolved);

    for (const reference of moduleReferences(sourceFile)) {
      const toPath = resolveRelativeImport(file.path, reference.specifier, knownPaths);
      if (toPath === null || toPath === file.path) {
        continue;
      }
      const range = lineRange(sourceFile, reference.node);
      const key = `${file.path}:${toPath}`;
      if (relationshipKeys.has(key)) {
        continue;
      }
      relationshipKeys.add(key);
      relationships.push({
        fromPath: file.path,
        toPath,
        specifier: reference.specifier,
        ...range,
      });
    }
  }

  return {
    sourcePaths: [...knownPaths].sort(),
    symbols: symbols.sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.lineStart - right.lineStart ||
        left.name.localeCompare(right.name),
    ),
    relationships: relationships.sort(
      (left, right) =>
        left.fromPath.localeCompare(right.fromPath) ||
        left.toPath.localeCompare(right.toPath) ||
        left.lineStart - right.lineStart,
    ),
    schemas: jsonSchemas(snapshot),
    branchBehaviors: branchBehaviors.sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.lineStart - right.lineStart ||
        left.ownerSymbol.localeCompare(right.ownerSymbol),
    ),
    directCalls: directCalls.sort(
      (left, right) =>
        left.callerPath.localeCompare(right.callerPath) ||
        left.callerSymbol.localeCompare(right.callerSymbol) ||
        left.calleePath.localeCompare(right.calleePath) ||
        left.calleeSymbol.localeCompare(right.calleeSymbol) ||
        left.sourceOrder - right.sourceOrder,
    ),
    unresolvedCalls: unresolvedCalls.sort(
      (left, right) =>
        left.callerPath.localeCompare(right.callerPath) ||
        left.callerSymbol.localeCompare(right.callerSymbol) ||
        left.sourceOrder - right.sourceOrder ||
        left.reason.localeCompare(right.reason),
    ),
  };
}
