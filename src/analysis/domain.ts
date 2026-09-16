export type FactStatus = "verified" | "inferred" | "documentation" | "unknown";
export type EvidenceStatus = FactStatus | "analogy";

export interface EvidenceVerification {
  readonly method:
    | "exact_text"
    | "ast_symbol"
    | "manifest_parse"
    | "config_parse"
    | "tree_lookup"
    | "ast_call_expression"
    | "documentation_read"
    | "model_inference"
    | "analogy_only"
    | "not_checked";
  readonly checked_at: string;
  readonly commit_resolved: boolean;
  readonly path_exists: boolean | null;
  readonly symbol_exists: boolean | null;
  readonly line_range_valid: boolean | null;
  readonly excerpt_matches: boolean | null;
}

export interface EvidenceLocator {
  readonly source_path: string;
  readonly blob_sha?: string;
  readonly symbol?: {
    readonly name: string;
    readonly qualified_name?: string;
    readonly kind?:
      | "function"
      | "method"
      | "class"
      | "interface"
      | "type"
      | "module"
      | "variable"
      | "constant"
      | "other";
  };
  readonly line_start?: number;
  readonly line_end?: number;
  readonly field_pointer?: string;
  readonly excerpt?: string;
  readonly excerpt_sha256?: string;
}

export interface DirectCallEvidenceRelation {
  readonly relation: "CALLS";
  readonly direct: true;
  readonly runtime_execution_guaranteed: false;
  readonly caller: {
    readonly source_path: string;
    readonly symbol: NonNullable<EvidenceLocator["symbol"]>;
  };
  readonly callee: {
    readonly source_path: string;
    readonly symbol: NonNullable<EvidenceLocator["symbol"]>;
  };
  readonly call_site: {
    readonly source_path: string;
    readonly line_start: number;
    readonly line_end: number;
    readonly source_order: number;
  };
  readonly resolution_method:
    | "SAME_FILE"
    | "RELATIVE_NAMED_IMPORT"
    | "RELATIVE_DEFAULT_IMPORT"
    | "RELATIVE_NAMESPACE_IMPORT"
    | "RELATIVE_NAMED_REEXPORT";
  readonly import_binding?: {
    readonly kind: "named" | "default" | "namespace" | "reexport";
    readonly specifier: string;
    readonly local_name: string;
    readonly imported_name: string;
    readonly declaration_path: string;
    readonly line_start: number;
    readonly line_end: number;
    readonly reexport_hop?: {
      readonly declaration_path: string;
      readonly specifier: string;
      readonly exported_name: string;
      readonly imported_name: string;
      readonly line_start: number;
      readonly line_end: number;
    };
  };
}

export interface EvidenceRecord {
  readonly evidence_record_version: 1 | 2;
  readonly id: string;
  readonly claim_id: string;
  readonly claim: string;
  readonly evidence_type:
    | "source_range"
    | "symbol_declaration"
    | "manifest_field"
    | "config_field"
    | "documentation_statement"
    | "tree_entry"
    | "direct_call"
    | "reasoned_inference"
    | "explanatory_analogy"
    | "unresolved";
  readonly source_kind:
    | "source_code"
    | "manifest"
    | "configuration"
    | "documentation"
    | "repository_tree"
    | "analysis_reasoning";
  readonly repository?: { readonly url: string; readonly commit_sha: string };
  readonly locator?: EvidenceLocator;
  readonly call_relation?: DirectCallEvidenceRelation;
  readonly supports_evidence_ids: readonly string[];
  readonly confidence: number;
  readonly verification_status: EvidenceStatus;
  readonly verification: EvidenceVerification;
  readonly notes: string;
  readonly limitations: readonly string[];
}

export interface BriefClaim {
  readonly id: string;
  readonly statement: string;
  readonly category:
    | "purpose"
    | "technology"
    | "entry_point"
    | "module"
    | "relationship"
    | "data_flow"
    | "external_service"
    | "storage"
    | "design_choice"
    | "limitation"
    | "other";
  readonly status: FactStatus;
  readonly confidence: number;
  readonly evidence_ids: readonly string[];
  readonly limitations: readonly string[];
}

export interface BriefModule {
  readonly id: string;
  readonly name: string;
  readonly responsibility: string;
  readonly source_paths: readonly string[];
  readonly status: FactStatus;
  readonly confidence: number;
  readonly evidence_ids: readonly string[];
}

export interface BriefRelationship {
  readonly id: string;
  readonly from_module_id: string;
  readonly to_module_id: string;
  readonly relationship_type:
    | "imports"
    | "calls"
    | "reads"
    | "writes"
    | "configures"
    | "publishes"
    | "consumes"
    | "persists"
    | "returns"
    | "contains"
    | "other"
    | "unknown";
  readonly description: string;
  readonly status: FactStatus;
  readonly confidence: number;
  readonly evidence_ids: readonly string[];
}

export interface ImportantSymbol {
  readonly id: string;
  readonly name: string;
  readonly qualified_name?: string;
  readonly kind:
    | "function"
    | "method"
    | "class"
    | "interface"
    | "type"
    | "module"
    | "variable"
    | "constant"
    | "other";
  readonly source_path: string;
  readonly line_start?: number;
  readonly line_end?: number;
  readonly role: string;
  readonly status: FactStatus;
  readonly evidence_ids: readonly string[];
}

export interface CodebaseBrief {
  readonly codebase_brief_version: 1;
  readonly brief_id: string;
  readonly generated_at: string;
  readonly repository: {
    readonly url: string;
    readonly owner: string;
    readonly name: string;
    readonly default_branch: string;
    readonly commit_sha: string;
    readonly visibility: "public";
    readonly resolved_at: string;
  };
  readonly analysis_scope: {
    readonly read_scope_ladder_version: 1;
    readonly highest_scope: number;
    readonly scope_events: readonly {
      readonly scope: number;
      readonly reason: string;
      readonly selected_paths: readonly string[];
    }[];
    readonly files_seen: number;
    readonly files_read: number;
    readonly files_skipped: number;
    readonly bytes_read: number;
    readonly context_tokens_budgeted: number;
    readonly context_tokens_used: number;
    readonly truncated: boolean;
    readonly skip_summary: readonly { readonly reason: string; readonly count: number }[];
  };
  readonly overview: {
    readonly project_name: string;
    readonly one_sentence: string;
    readonly summary: string;
    readonly problem: string;
    readonly target_users: readonly string[];
    readonly status: FactStatus;
    readonly evidence_ids: readonly string[];
  };
  readonly technologies: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: "language" | "runtime" | "framework" | "library" | "tool" | "protocol";
    readonly declared_version?: string;
    readonly purpose?: string;
    readonly status: FactStatus;
    readonly evidence_ids: readonly string[];
  }[];
  readonly entry_points: readonly {
    readonly id: string;
    readonly label: string;
    readonly source_path: string;
    readonly symbol?: string;
    readonly role: string;
    readonly status: FactStatus;
    readonly evidence_ids: readonly string[];
  }[];
  readonly core_modules: readonly BriefModule[];
  readonly relationships: readonly BriefRelationship[];
  readonly data_flows: readonly unknown[];
  readonly external_services: readonly unknown[];
  readonly storage: readonly unknown[];
  readonly important_symbols: readonly ImportantSymbol[];
  readonly claims: readonly BriefClaim[];
  readonly evidence: readonly EvidenceRecord[];
  readonly limitations: readonly {
    readonly id: string;
    readonly description: string;
    readonly impact: string;
  }[];
  readonly unknowns: readonly {
    readonly id: string;
    readonly question: string;
    readonly reason: string;
    readonly next_evidence_needed: string;
  }[];
  readonly overall_confidence: { readonly score: number; readonly rationale: string };
  readonly quality: {
    readonly schema_valid: boolean;
    readonly reference_integrity_valid: boolean;
    readonly evidence_valid: boolean;
    readonly confidence_escalation_checked: boolean;
    readonly warnings: readonly string[];
  };
}

export interface ContentAngle {
  readonly content_angle_version: 1;
  readonly id: string;
  readonly brief_id: string;
  readonly repository_commit_sha: string;
  readonly generated_at: string;
  readonly selection_status: "candidate" | "selected" | "weak" | "rejected";
  readonly rank: number | null;
  readonly category:
    | "engineering_insight"
    | "architecture_insight"
    | "ai_agent_pattern"
    | "performance"
    | "developer_experience"
    | "product_design"
    | "unusual_implementation"
    | "educational_value";
  readonly title: string;
  readonly hook: string;
  readonly why_interesting: string;
  readonly technical_basis: string;
  readonly target_audience: readonly (
    | "beginner_developer"
    | "experienced_developer"
    | "maintainer"
    | "technical_creator"
    | "engineering_manager"
    | "product_builder"
    | "open_source_contributor"
    | "general_technical_audience"
  )[];
  readonly claim_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly script_safe_claim_ids: readonly string[];
  readonly confidence: number;
  readonly novelty: {
    readonly level: "none" | "low" | "medium" | "high" | "unknown";
    readonly basis:
      | "repository_internal"
      | "official_documentation"
      | "external_comparison"
      | "insufficient_evidence";
    readonly assessment: string;
    readonly comparison_sources: readonly string[];
  };
  readonly scores: {
    readonly evidence_strength: number;
    readonly audience_relevance: number;
    readonly teachability: number;
    readonly differentiation: number;
  };
  readonly caveats: readonly string[];
  readonly selection_reason: string;
}

export interface ScriptSegment {
  readonly id: string;
  readonly kind: "claim" | "transition";
  readonly text: string;
  readonly claim_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly asserted_entities: readonly string[];
}

export interface GroundedScript {
  readonly script_version: 1;
  readonly repository_commit_sha: string;
  readonly title: string;
  readonly estimated_seconds: number;
  readonly segments: readonly ScriptSegment[];
  readonly text: string;
}

export interface GateResult {
  readonly id: string;
  readonly critical: true;
  readonly passed: boolean;
  readonly details: string;
}

export interface QualityReceipt {
  readonly passed: boolean;
  readonly gates: readonly GateResult[];
}

export interface SnapshotSummary {
  readonly repository_url: string;
  readonly commit_sha: string;
  readonly tree_paths: readonly string[];
  readonly tree_blobs: Readonly<Record<string, string>>;
  readonly files: readonly {
    readonly path: string;
    readonly blob_sha: string;
    readonly text: string;
    readonly kind: string;
  }[];
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly symbols: readonly {
    readonly path: string;
    readonly name: string;
    readonly line_start: number;
    readonly line_end: number;
    readonly excerpt: string;
  }[];
}

export interface ProviderInvocation {
  readonly stage: "brief" | "angles" | "content";
  readonly provider: string;
  readonly model: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly network_calls: number;
  readonly paid: boolean;
  readonly prompt_stage: "brief" | "angles" | "content";
  readonly highest_read_scope: number;
  readonly files_considered: readonly string[];
  readonly files_read: readonly string[];
  readonly files_passed: readonly string[];
  readonly repository_characters_passed: number;
  readonly prompt_characters: number;
  readonly repair_actions: readonly string[];
  readonly schema_validated: boolean;
  readonly endpoint: "none" | "local_loopback" | "remote_https";
}

export interface AnalysisSecurityReceipt {
  readonly repository_content_role: "untrusted_data";
  readonly repository_code_executions: 0;
  readonly network_hosts: readonly string[];
  readonly provider_id: string;
}
