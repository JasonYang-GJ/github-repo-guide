import type {
  GroundedFactPack,
  GroundedFactType,
} from "./domain.js";

export type FactCapability =
  | "behavior"
  | "configuration"
  | "relation"
  | "structure"
  | "type";

export interface FactUtilityReceipt {
  readonly status: "PASS" | "PARTIAL" | "FAIL";
  readonly facts_available: number;
  readonly covered_capabilities: readonly FactCapability[];
  readonly missing_capabilities: readonly FactCapability[];
  readonly rationale: string;
}

const FACT_TYPE_ORDER: readonly GroundedFactType[] = [
  "DECLARATION",
  "MODULE_CONTAINS",
  "EXPORT",
  "IMPORT_RELATION",
  "BRANCH_BEHAVIOR",
  "CONFIGURATION",
  "TYPE_DECLARATION",
];

const CAPABILITIES: Readonly<
  Record<FactCapability, readonly GroundedFactType[]>
> = {
  behavior: ["BRANCH_BEHAVIOR"],
  configuration: ["CONFIGURATION", "EXPORT"],
  relation: ["IMPORT_RELATION"],
  structure: ["DECLARATION", "MODULE_CONTAINS"],
  type: ["TYPE_DECLARATION"],
};

function safeInline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/`/g, "'").trim();
}

export function evaluateFactUtility(pack: GroundedFactPack): FactUtilityReceipt {
  const factTypes = new Set(pack.facts.map((fact) => fact.fact_type));
  const capabilities = Object.keys(CAPABILITIES).sort() as FactCapability[];
  const covered = capabilities.filter((capability) =>
    CAPABILITIES[capability].some((factType) => factTypes.has(factType)),
  );
  const missing = capabilities.filter((capability) => !covered.includes(capability));
  const essential: readonly FactCapability[] = [
    "behavior",
    "configuration",
    "relation",
    "structure",
  ];
  const essentialCovered = essential.filter((capability) => covered.includes(capability));
  const status =
    essentialCovered.length === essential.length
      ? "PASS"
      : essentialCovered.length >= 2
        ? "PARTIAL"
        : "FAIL";
  return {
    status,
    facts_available: pack.facts.length,
    covered_capabilities: covered,
    missing_capabilities: missing,
    rationale:
      status === "PASS"
        ? "The pack contains grounded structure, relation, configuration, and bounded behavior facts."
        : status === "PARTIAL"
          ? `The pack is usable for ${covered.join(", ")}, but ${missing.join(", ") || "no additional capability"} remains unavailable.`
          : "The pack does not yet cover enough independent capabilities for content planning.",
  };
}

export function renderGroundedFactReport(pack: GroundedFactPack): string {
  const entities = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const utility = evaluateFactUtility(pack);
  const lines = [
    "# Grounded Facts",
    "",
    `Repository: ${safeInline(pack.repository.url)}`,
    `Commit: ${pack.commit}`,
    `Fact IR Version: ${pack.fact_ir_version}`,
    `Utility: ${utility.status}`,
    "",
    "## Fact counts",
    "",
  ];

  for (const factType of FACT_TYPE_ORDER) {
    lines.push(`- ${factType}: ${pack.facts.filter((fact) => fact.fact_type === factType).length}`);
  }

  lines.push("", "## Facts", "");
  if (pack.facts.length === 0) lines.push("- None.");
  for (const fact of pack.facts) {
    const subject = entities.get(fact.subject_ref)?.display_label ?? fact.subject_ref;
    const object = entities.get(fact.object_ref)?.display_label ?? fact.object_ref;
    lines.push(
      `- [${fact.fact_type}] \`${safeInline(subject)}\` ${fact.predicate} \`${safeInline(object)}\``,
      `  - Scope: ${fact.scope}; evidence: ${fact.evidence_ids.join(", ")}`,
    );
    for (const limitation of fact.limitations) {
      lines.push(`  - Limit: ${safeInline(limitation)}`);
    }
  }

  lines.push("", "## Not proven by this fact pack", "");
  for (const area of pack.unsupported_areas) {
    lines.push(
      `- ${safeInline(area.id)}: ${safeInline(area.reason)}`,
      `  - Evidence needed: ${safeInline(area.evidence_needed)}`,
    );
  }

  lines.push("", "## Pack limitations", "");
  if (pack.limitations.length === 0) {
    lines.push("- No additional pack-level limitation was recorded.");
  } else {
    for (const limitation of pack.limitations) lines.push(`- ${safeInline(limitation)}`);
  }

  return `${lines.join("\n")}\n`;
}
