import { validateInput } from "../shared/validator.mjs";

export function renderArtifact(input) {
  validateInput(input);
  return `<svg>${input.name}</svg>`;
}
