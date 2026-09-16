export type ModelStage = "brief" | "angles" | "content";

export interface RepositoryChunk {
  readonly path: string;
  readonly content: string;
  readonly trust: "untrusted_repository_data";
}

export interface StructuredGenerationRequest {
  readonly stage: ModelStage;
  readonly schemaId: string;
  readonly systemInstructions: string;
  readonly untrustedRepositoryContext: readonly RepositoryChunk[];
  readonly untrustedRepositorySignals: Readonly<Record<string, unknown>>;
  readonly signalSerialization?: "pretty" | "compact";
  readonly repositoryReadReceipt: {
    readonly highestScope: number;
    readonly filesConsidered: readonly string[];
    readonly filesRead: readonly string[];
  };
  readonly maxOutputTokens: number;
  readonly cacheKey: string;
}

export interface ModelContextReceipt {
  readonly promptStage: ModelStage;
  readonly highestReadScope: number;
  readonly filesConsidered: readonly string[];
  readonly filesRead: readonly string[];
  readonly filesPassed: readonly string[];
  readonly repositoryCharactersPassed: number;
  readonly promptCharacters: number;
  readonly repairActions: readonly string[];
  readonly schemaValidated: boolean;
  readonly endpoint: "none" | "local_loopback" | "remote_https";
}

export interface ModelRequestConfiguration {
  readonly thinking: "enabled" | "disabled" | "unspecified";
  readonly reasoningEffort: "low" | "high" | "max" | null;
}

export interface ModelReasoningReceipt {
  readonly tokens: number | null;
  readonly contentCharacters: number;
  readonly visibleContentTokens: number | null;
}

export interface ModelResult<T> {
  readonly value: T;
  readonly provider: string;
  readonly model: string;
  readonly rawOutput?: string;
  readonly finishReason?: string;
  readonly requestConfiguration?: ModelRequestConfiguration;
  readonly reasoning?: ModelReasoningReceipt;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheHitInputTokens?: number;
    readonly cacheMissInputTokens?: number;
  };
  readonly networkCalls: number;
  readonly paid: boolean;
  readonly context: ModelContextReceipt;
}

export interface ModelProvider {
  readonly id: string;
  generateStructured<T>(request: StructuredGenerationRequest): Promise<ModelResult<T>>;
}
