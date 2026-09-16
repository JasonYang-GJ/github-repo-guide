import type { RepositoryBlob, RepositoryTree, ResolvedRepository, TreeEntry } from "../../src/repo/contracts.js";
import { FixtureRepositorySource } from "./fixture-repository-source.js";

// Generated metadata only: no thousands of fixture files or network requests.
export class LargeRepositorySource extends FixtureRepositorySource {
  constructor(root: string, readonly entryCount = 12_944, readonly sourceBytes = 64) {
    super(root, "small-typescript-repo");
  }

  override async listTree(repository: ResolvedRepository): Promise<RepositoryTree> {
    const base = await super.listTree(repository);
    const entries: TreeEntry[] = [...base.entries];
    for (const directory of ["scripts", "apps/desktop/scripts", "packages/engine/src"]) {
      for (let i = 0; i < 80; i += 1) {
        entries.push({ path: `${directory}/large-fixture-${i}.ts`, type: "blob", size: this.sourceBytes, blobSha: "a".repeat(40) });
      }
    }
    while (entries.length < this.entryCount) {
      entries.push({ path: `vendor/entry-${entries.length}.ts`, type: "blob", size: 10, blobSha: "b".repeat(40) });
    }
    return { entries, truncated: false };
  }

  override async readBlob(repository: ResolvedRepository, entry: TreeEntry): Promise<RepositoryBlob> {
    if (entry.path.includes("large-fixture-")) {
      this.operations.push(`blob:${repository.commitSha}:${entry.path}`);
      return { bytes: Buffer.from("export const value = 1; //".padEnd(this.sourceBytes, " ")) };
    }
    return super.readBlob(repository, entry);
  }
}
