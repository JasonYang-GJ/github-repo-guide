export interface CanonicalGitHubRepository {
  readonly url: string;
  readonly owner: string;
  readonly name: string;
}

const REPOSITORY_PART = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubRepositoryUrl(input: string): CanonicalGitHubRepository {
  if (input.length === 0 || input.length > 300 || input.includes("%")) {
    throw new Error("Repository URL is not canonical");
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Repository URL is invalid");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "github.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("Only public https://github.com repository URLs are supported");
  }

  const parts = parsed.pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 2) {
    throw new Error("Repository URL must contain only owner and repository name");
  }

  const owner = parts[0];
  const rawName = parts[1];
  if (owner === undefined || rawName === undefined) {
    throw new Error("Repository URL is missing owner or repository name");
  }
  const name = rawName.toLowerCase().endsWith(".git") ? rawName.slice(0, -4) : rawName;

  if (
    !REPOSITORY_PART.test(owner) ||
    !REPOSITORY_PART.test(name) ||
    owner === "." ||
    owner === ".." ||
    name === "." ||
    name === ".."
  ) {
    throw new Error("Repository owner or name is invalid");
  }

  return {
    url: `https://github.com/${owner}/${name}`,
    owner,
    name,
  };
}
