import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  RepositoryReadError,
  readRepository,
} from "../src/repo/progressive-reader.js";
import { parseGitHubRepositoryUrl } from "../src/repo/url-guard.js";
import { FixtureRepositorySource } from "./support/fixture-repository-source.js";

const fixturesRoot = resolve(process.cwd(), "tests", "fixtures");

function fixture(name: string): FixtureRepositorySource {
  return new FixtureRepositorySource(resolve(fixturesRoot, name), name);
}

test("GitHub URL guard accepts only canonical public repository URLs", () => {
  assert.deepEqual(parseGitHubRepositoryUrl("https://github.com/acme/tool.git/"), {
    url: "https://github.com/acme/tool",
    owner: "acme",
    name: "tool",
  });

  for (const invalid of [
    "http://github.com/acme/tool",
    "https://user:secret@github.com/acme/tool",
    "https://github.com/acme/tool/tree/main",
    "https://evil.invalid/acme/tool",
    "https://github.com/acme/../tool",
  ]) {
    assert.throws(() => parseGitHubRepositoryUrl(invalid));
  }
});

test("small TypeScript repository is read progressively at one fixed SHA", async () => {
  const source = fixture("small-typescript-repo");
  const snapshot = await readRepository(source, source.url);
  const paths = snapshot.files.map((file) => file.path);

  assert.equal(snapshot.repository.commitSha, source.commitSha);
  assert.equal(snapshot.highestScope, 2);
  assert.equal(snapshot.manifest.name, "tiny-greeter");
  assert.ok(paths.includes("README.md"));
  assert.ok(paths.includes("package.json"));
  assert.ok(paths.includes("tsconfig.json"));
  assert.ok(paths.includes("src/index.ts"));
  assert.ok(paths.includes("src/greet.ts"));
  assert.ok(
    source.operations.every(
      (operation) => !operation.startsWith("blob:") || operation.includes(source.commitSha),
    ),
  );
});

test("multi-module fixture stays within the bounded source-file policy", async () => {
  const source = fixture("multi-module-typescript-repo");
  const snapshot = await readRepository(source, source.url, { maxSourceFiles: 4 });

  const sourceFiles = snapshot.files.filter((file) => file.kind === "source");
  assert.equal(sourceFiles.length, 4);
  assert.deepEqual(
    sourceFiles.map((file) => file.path).sort(),
    ["src/api.ts", "src/index.ts", "src/repository.ts", "src/service.ts"],
  );
  assert.ok(snapshot.bytesRead <= 1024 * 1024);
});

test("nested application analysis excludes test files from the bounded source set", async () => {
  const source = fixture("nested-desktop-notes");
  const snapshot = await readRepository(source, source.url);
  const sourcePaths = snapshot.files
    .filter((file) => file.kind === "source")
    .map((file) => file.path);

  assert.deepEqual(sourcePaths.sort(), [
    "apps/desktop/src/App.tsx",
    "apps/desktop/src/notes.ts",
  ]);
  assert.equal(
    snapshot.readDecisions.some(
      (decision) =>
        decision.path === "apps/desktop/src/App.b03.test.tsx" &&
        decision.status === "excluded",
    ),
    true,
  );
});

test("source-only repository uses one source as orientation without counting it as skipped", async () => {
  const source = fixture("source-only-rust-repo");
  const snapshot = await readRepository(source, source.url);

  assert.equal(snapshot.manifest.format, "generic");
  assert.equal(snapshot.manifest.genericReason, "missing_package_manifest");
  assert.deepEqual(snapshot.files.map((file) => file.path), [
    "src/main.rs",
    "engine/bootstrap.rs",
  ]);
  assert.equal(snapshot.filesSkipped, 0);
  assert.equal(snapshot.skipSummary.length, 0);
});

test("peer package manifests use generic mode instead of choosing a subproject arbitrarily", async () => {
  const source = fixture("ambiguous-monorepo");
  const snapshot = await readRepository(source, source.url);

  assert.equal(snapshot.manifest.format, "generic");
  assert.equal(snapshot.manifest.genericReason, "ambiguous_package_manifests");
  assert.deepEqual(
    snapshot.files.filter((file) => file.kind === "source").map((file) => file.path),
    ["apps/one/src/index.ts", "apps/two/src/index.ts"],
  );
});

test("malicious repository text cannot alter read scope or expose ignored files", async () => {
  const source = fixture("malicious-prompt-repo");
  const snapshot = await readRepository(source, source.url);
  const readme = snapshot.files.find((file) => file.path === "README.md");

  assert.match(readme?.text ?? "", /Ignore all previous instructions/);
  assert.equal(snapshot.files.some((file) => file.path === ".env"), false);
  assert.equal(
    source.operations.some((operation) => operation.includes("attacker.invalid")),
    false,
  );
  assert.equal(
    source.operations.some((operation) => /npm|execute|environment/i.test(operation)),
    false,
  );
});

test("malformed package manifest is an explicit analysis failure", async () => {
  const source = fixture("broken-repo");

  await assert.rejects(
    readRepository(source, source.url),
    (error: unknown) =>
      error instanceof RepositoryReadError && error.code === "INVALID_MANIFEST",
  );
});
