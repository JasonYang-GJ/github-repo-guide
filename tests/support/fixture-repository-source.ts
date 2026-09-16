import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type {
  RepositoryBlob,
  RepositorySource,
  RepositoryTree,
  ResolvedRepository,
  TreeEntry,
} from "../../src/repo/contracts.js";

export class FixtureRepositorySource implements RepositorySource {
  readonly operations: string[] = [];
  readonly commitSha: string;
  readonly url: string;

  constructor(
    private readonly fixtureRoot: string,
    private readonly fixtureName: string,
  ) {
    this.commitSha = createHash("sha1").update(`fixture:${fixtureName}`).digest("hex");
    this.url = `https://github.com/fixture/${fixtureName}`;
  }

  async resolve(url: string): Promise<ResolvedRepository> {
    this.operations.push(`resolve:${url}`);
    if (url !== this.url) {
      throw new Error(`Unexpected fixture URL: ${url}`);
    }

    return {
      url,
      owner: "fixture",
      name: this.fixtureName,
      defaultBranch: "main",
      commitSha: this.commitSha,
      resolvedAt: "2026-08-31T00:00:00.000Z",
      licenseSpdx: "MIT",
    };
  }

  async listTree(repository: ResolvedRepository): Promise<RepositoryTree> {
    this.operations.push(`tree:${repository.commitSha}`);
    const entries = await this.walk(this.fixtureRoot);
    return { entries, truncated: false };
  }

  async readBlob(
    repository: ResolvedRepository,
    entry: TreeEntry,
  ): Promise<RepositoryBlob> {
    this.operations.push(`blob:${repository.commitSha}:${entry.path}`);
    const root = resolve(this.fixtureRoot);
    const absolutePath = resolve(root, ...entry.path.split("/"));
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
      throw new Error(`Fixture path escaped its root: ${entry.path}`);
    }
    return { bytes: await readFile(absolutePath) };
  }

  private async walk(directory: string): Promise<TreeEntry[]> {
    const entries: TreeEntry[] = [];
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, item.name);
      const path = relative(this.fixtureRoot, absolutePath).split(sep).join("/");
      if (item.isDirectory()) {
        entries.push({ path, type: "tree", size: 0, blobSha: null });
        entries.push(...(await this.walk(absolutePath)));
      } else if (item.isFile()) {
        const metadata = await stat(absolutePath);
        const bytes = await readFile(absolutePath);
        const blobSha = createHash("sha1")
          .update(`blob ${bytes.byteLength}\0`)
          .update(bytes)
          .digest("hex");
        entries.push({ path, type: "blob", size: metadata.size, blobSha });
      }
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }
}
