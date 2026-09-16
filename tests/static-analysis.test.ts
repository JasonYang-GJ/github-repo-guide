import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { extractStaticFacts } from "../src/analysis/static-facts.js";
import { readRepository } from "../src/repo/progressive-reader.js";
import { FixtureRepositorySource } from "./support/fixture-repository-source.js";

const fixturesRoot = resolve(process.cwd(), "tests", "fixtures");

async function factsFor(name: string) {
  const source = new FixtureRepositorySource(resolve(fixturesRoot, name), name);
  const snapshot = await readRepository(source, source.url);
  return extractStaticFacts(snapshot);
}

test("TypeScript AST finds declarations with verifiable line ranges", async () => {
  const facts = await factsFor("small-typescript-repo");
  const run = facts.symbols.find((symbol) => symbol.name === "run");
  const greet = facts.symbols.find((symbol) => symbol.name === "greet");

  assert.equal(run?.path, "src/index.ts");
  assert.equal(run?.kind, "function");
  assert.ok((run?.lineStart ?? 0) >= 1);
  assert.ok((run?.lineEnd ?? 0) >= (run?.lineStart ?? 1));
  assert.equal(greet?.path, "src/greet.ts");
});

test("relative .js specifiers resolve to known TypeScript modules only", async () => {
  const facts = await factsFor("multi-module-typescript-repo");

  assert.deepEqual(
    facts.relationships.map((relationship) => [
      relationship.fromPath,
      relationship.toPath,
    ]),
    [
      ["src/api.ts", "src/service.ts"],
      ["src/index.ts", "src/api.ts"],
      ["src/service.ts", "src/repository.ts"],
    ],
  );
  assert.ok(
    facts.relationships.every(
      (relationship) => relationship.lineStart >= 1 && relationship.excerpt.length > 0,
    ),
  );
  assert.equal(
    new Set(
      facts.relationships.map(
        (relationship) => `${relationship.fromPath}->${relationship.toPath}`,
      ),
    ).size,
    facts.relationships.length,
  );
});

test("prompt text and comments are never interpreted as imports or instructions", async () => {
  const facts = await factsFor("malicious-prompt-repo");

  assert.equal(facts.relationships.length, 0);
  assert.equal(facts.symbols.some((symbol) => symbol.name === "safeValue"), true);
  assert.equal(
    facts.relationships.some((relationship) => relationship.specifier.includes("attacker")),
    false,
  );
});

test("AST resolves same-file and named relative-import direct calls without reversing direction", async () => {
  const facts = await factsFor("bounded-call-repo");

  assert.deepEqual(
    facts.directCalls
      .filter(
        (call) =>
          call.callerPath === "src/main.ts" &&
          call.callerSymbol === "run" &&
          ["prepare", "work"].includes(call.calleeSymbol),
      )
      .map((call) => ({
      caller: `${call.callerPath}#${call.callerSymbol}`,
      callee: `${call.calleePath}#${call.calleeSymbol}`,
      resolution: call.resolutionMethod,
      })),
    [
      {
        caller: "src/main.ts#run",
        callee: "src/main.ts#prepare",
        resolution: "SAME_FILE",
      },
      {
        caller: "src/main.ts#run",
        callee: "src/worker.ts#work",
        resolution: "RELATIVE_NAMED_IMPORT",
      },
    ],
  );
  assert.ok(
    facts.directCalls.every(
      (call) =>
        call.lineStart >= 1 &&
        call.excerpt.length > 0 &&
        call.runtimeExecutionGuaranteed === false,
    ),
  );
  assert.equal(
    facts.directCalls.some(
      (call) => call.callerSymbol === "work" && call.calleeSymbol === "run",
    ),
    false,
  );
});

test("AST resolves default, namespace-member, and bounded named re-export calls", async () => {
  const facts = await factsFor("bounded-call-repo");
  const calls = facts.directCalls.map((call) => ({
    caller: `${call.callerPath}#${call.callerSymbol}`,
    callee: `${call.calleePath}#${call.calleeSymbol}`,
    resolution: call.resolutionMethod,
    binding: call.importBinding?.kind ?? null,
  }));

  assert.ok(
    calls.some(
      (call) =>
        call.callee === "src/default-worker.ts#defaultWork" &&
        call.resolution === "RELATIVE_DEFAULT_IMPORT" &&
        call.binding === "default",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call.callee === "src/namespace-worker.ts#namespaceWork" &&
        call.resolution === "RELATIVE_NAMESPACE_IMPORT" &&
        call.binding === "namespace",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call.callee === "src/reexported-worker.ts#reexportedWork" &&
        call.resolution === "RELATIVE_NAMED_REEXPORT" &&
        call.binding === "reexport",
    ),
  );
});

test("unsupported syntax and non-call text never become resolved direct-call edges", async () => {
  const facts = await factsFor("bounded-call-repo");

  assert.equal(
    facts.directCalls.some((call) =>
      ["unsafeCandidates", "localShadow"].includes(call.callerSymbol),
    ),
    false,
  );
  assert.ok(
    facts.unresolvedCalls.some(
      (call) =>
        call.callerSymbol === "unsafeCandidates" &&
        call.reason === "CALLBACK_OR_SHADOWED_BINDING",
    ),
  );
  assert.ok(
    facts.unresolvedCalls.some(
      (call) =>
        call.callerSymbol === "unsafeCandidates" &&
        call.reason === "COMPUTED_PROPERTY_UNSUPPORTED",
    ),
  );
  assert.ok(
    facts.unresolvedCalls.some(
      (call) =>
        call.callerSymbol === "localShadow" &&
        call.reason === "CALLBACK_OR_SHADOWED_BINDING",
    ),
  );
  assert.equal(
    facts.directCalls.some(
      (call) =>
        call.callerPath === "src/negative.ts" &&
        call.calleeSymbol === "namespaceWork",
    ),
    false,
  );
  assert.equal(
    facts.directCalls.some(
      (call) => call.callerSymbol === "Callback" || call.calleeSymbol === "Callback",
    ),
    false,
  );
});

test("direct-call edges stay direct and branch or source order never imply runtime guarantees", async () => {
  const facts = await factsFor("bounded-call-repo");
  const edges = facts.directCalls.map(
    (call) => `${call.callerSymbol}->${call.calleeSymbol}`,
  );

  assert.ok(edges.includes("first->second"));
  assert.ok(edges.includes("second->third"));
  assert.equal(edges.includes("first->third"), false);
  assert.ok(edges.includes("branchCaller->work"));
  assert.ok(
    facts.directCalls
      .filter((call) => ["branchCaller", "orderedCaller"].includes(call.callerSymbol))
      .every((call) => call.runtimeExecutionGuaranteed === false),
  );
});
