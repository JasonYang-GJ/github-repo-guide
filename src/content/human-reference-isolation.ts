import { createHash } from "node:crypto";

export interface HumanReferenceIsolationAuditInput {
  readonly artifactFileName: string;
  readonly artifactText: string;
  readonly actualRequestPayload: string;
  readonly requiredMarkers: readonly string[];
}

export interface HumanReferenceIsolationReceipt {
  readonly audit: "HUMAN_REFERENCE_PROMPT_CONTAMINATION_AUDIT";
  readonly status: "PASS";
  readonly artifact_sha256: string;
  readonly request_payload_sha256: string;
  readonly required_markers_checked: number;
  readonly full_human_judgment_lines_checked: number;
  readonly artifact_filename_absent: true;
  readonly required_markers_absent: true;
  readonly full_human_judgment_lines_absent: true;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function auditHumanReferenceIsolation(
  input: HumanReferenceIsolationAuditInput,
): HumanReferenceIsolationReceipt {
  if (
    input.artifactFileName.trim().length === 0 ||
    input.artifactText.trim().length === 0 ||
    input.actualRequestPayload.trim().length === 0 ||
    input.requiredMarkers.length === 0 ||
    input.requiredMarkers.some((marker) => marker.trim().length === 0)
  ) {
    throw new Error("PROMPT_CONTAMINATION_AUDIT_INPUT_INVALID");
  }
  for (const marker of input.requiredMarkers) {
    if (!input.artifactText.includes(marker)) {
      throw new Error("PROMPT_CONTAMINATION_AUDIT_REFERENCE_INVALID");
    }
  }
  const judgmentLines = input.artifactText
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("- ") && line.length >= 60)
    .map((line) => line.slice(2));
  if (judgmentLines.length === 0) {
    throw new Error("PROMPT_CONTAMINATION_AUDIT_REFERENCE_INVALID");
  }
  const forbidden = [
    input.artifactFileName,
    ...input.requiredMarkers,
    ...judgmentLines,
  ];
  if (forbidden.some((value) => input.actualRequestPayload.includes(value))) {
    throw new Error("PROMPT_CONTAMINATION_DETECTED");
  }
  return {
    audit: "HUMAN_REFERENCE_PROMPT_CONTAMINATION_AUDIT",
    status: "PASS",
    artifact_sha256: sha256(input.artifactText),
    request_payload_sha256: sha256(input.actualRequestPayload),
    required_markers_checked: input.requiredMarkers.length,
    full_human_judgment_lines_checked: judgmentLines.length,
    artifact_filename_absent: true,
    required_markers_absent: true,
    full_human_judgment_lines_absent: true,
  };
}
