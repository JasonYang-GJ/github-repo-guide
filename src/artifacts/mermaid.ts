import type { CodebaseBrief } from "../analysis/domain.js";

function escapeLabel(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/[\[\]{}|<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildMermaid(brief: CodebaseBrief): string {
  const moduleIds = new Set(brief.core_modules.map((module) => module.id));
  for (const relationship of brief.relationships) {
    if (
      !moduleIds.has(relationship.from_module_id) ||
      !moduleIds.has(relationship.to_module_id)
    ) {
      throw new Error(`Relationship ${relationship.id} references an unknown module`);
    }
  }

  const lines = ["flowchart LR"];
  for (const module of [...brief.core_modules].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    lines.push(`    ${module.id}["${escapeLabel(module.name)}"]`);
  }
  for (const relationship of [...brief.relationships].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    lines.push(`    %% relationship:${relationship.id}`);
    lines.push(
      `    ${relationship.from_module_id} -->|${escapeLabel(relationship.relationship_type)}| ${relationship.to_module_id}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
