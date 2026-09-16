import type { GroundedBrief } from "./domain.js";

function safeInline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function renderGroundedBriefMarkdown(brief: GroundedBrief): string {
  const provenanceNotice =
    brief.generation_metadata.mode === "model_surface"
      ? "> This is an accepted model surface realization of host-selected Grounded Facts. Model prose does not change Fact status."
      : "> This is a deterministic realization of selected Grounded Facts. Documentation and unknowns retain their own status.";
  const lines = [
    "# Grounded Brief",
    "",
    `Repository: ${safeInline(brief.repository.url)}`,
    `Commit: ${brief.commit}`,
    `Fact IR Version: ${brief.fact_ir_version}`,
    `Brief Version: ${brief.brief_version}`,
    "",
    provenanceNotice,
  ];

  for (const section of brief.sections) {
    lines.push("", `## ${safeInline(section.title)}`, "");
    if (section.statements.length === 0) lines.push("- No statement was generated.");
    for (const statement of section.statements) {
      lines.push(`- ${safeInline(statement.text)}`);
      lines.push(`  - Kind: ${statement.kind}; Scope: ${statement.scope}`);
      if (statement.fact_ids.length > 0) {
        lines.push(
          `  - Fact: ${statement.fact_ids.map((id) => `\`${id}\``).join(", ")}`,
        );
      }
      if (statement.unknown_ids.length > 0) {
        lines.push(
          `  - Known gap: ${statement.unknown_ids.map((id) => `\`${id}\``).join(", ")}`,
        );
      }
    }
  }

  lines.push("", "## Statement to Fact trace", "");
  for (const reference of brief.fact_references) {
    lines.push(
      `- \`${reference.statement_id}\` -> ${reference.fact_ids.map((id) => `\`${id}\``).join(", ")}`,
    );
  }

  lines.push("", "## Known unknowns", "");
  if (brief.unknowns.length === 0) lines.push("- None recorded by the supplied plan.");
  for (const unknown of brief.unknowns) {
    lines.push(
      `- \`${unknown.id}\`: ${safeInline(unknown.statement)}`,
      `  - Evidence needed: ${safeInline(unknown.evidence_needed)}`,
    );
  }

  lines.push("", "## Limitations", "");
  for (const limitation of brief.limitations) {
    lines.push(`- ${safeInline(limitation)}`);
  }

  lines.push(
    "",
    "## Generation metadata",
    "",
    `- Mode: ${brief.generation_metadata.mode}`,
    `- Generator: ${safeInline(brief.generation_metadata.generator)}`,
    ...(brief.generation_metadata.provider === null
      ? []
      : [`- Provider: ${safeInline(brief.generation_metadata.provider)}`]),
    ...(brief.generation_metadata.model === null
      ? []
      : [`- Model: ${safeInline(brief.generation_metadata.model)}`]),
    `- Paid API requests: ${brief.generation_metadata.paid_api_requests}`,
    `- Real model requests: ${brief.generation_metadata.real_model_requests}`,
    `- Repository executions: ${brief.generation_metadata.repository_executions}`,
  );

  return `${lines.join("\n")}\n`;
}
