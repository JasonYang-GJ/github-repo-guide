// Directory metadata is not file content. Match GitHub's complete recursive-tree
// entry ceiling while keeping independent file-count and byte budgets.
// https://docs.github.com/en/rest/git/trees#get-a-tree
export const MAX_REPOSITORY_TREE_ENTRIES = 100_000;
