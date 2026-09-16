import { renderArtifact } from "../renderers/render.mjs";

const CHECK_FIXES = new Set(["input"]);

export function run(input) {
  if (CHECK_FIXES.size === 0) return null;
  return renderArtifact(input);
}
