import { performance } from "node:perf_hooks";

import { AnalysisQualityError, analyzeSnapshot, type AnalysisBundle, type ReportBundle } from "../analysis/pipeline.js";
import { writeArtifacts, writeFailureReceipt } from "../artifacts/writer.js";
import type { ModelProvider, ModelStage } from "../model/provider.js";
import { OllamaProviderError } from "../model/ollama-provider.js";
import { OpenAICompatibleProviderError } from "../model/openai-compatible-provider.js";
import { WEB_MODEL_PROFILES, isWebModelProvider } from "../model/web-profiles.js";
import {
  buildQualityReviewArtifacts,
  type QualityReviewArtifacts,
} from "../quality/content-evaluation.js";
import type { RepositorySnapshot, RepositorySource } from "../repo/contracts.js";
import { readRepository, RepositoryReadError } from "../repo/progressive-reader.js";
import { createSchemaRegistry } from "../schemas/registry.js";
import { localized, type AnalysisLocale } from "../presentation/locale.js";
import { qualityFailureDetails } from "../quality/failure-details.js";

export interface AnalyzeRepositoryInput {
  readonly includeSpokenScript?: boolean;
  readonly url: string;
  readonly source: RepositorySource;
  readonly provider: ModelProvider;
  readonly fallbackProvider?: ModelProvider;
  readonly locale?: AnalysisLocale;
  readonly schemaDirectory: string;
  readonly outputRoot: string;
  readonly generatedAt?: string;
  readonly networkHosts?: readonly string[];
  readonly approvedModelHost?: string;
  readonly includeQualityReview?: boolean;
}

export interface AnalyzeRepositoryResult<Bundle = AnalysisBundle> {
  readonly bundle: Bundle;
  readonly outputDirectory: string;
  readonly durationMs: number;
  readonly qualityReview?: QualityReviewArtifacts;
  readonly fallback?: AnalysisFallbackReceipt;
}

export interface AnalysisFallbackReceipt {
  readonly used: true;
  readonly from_provider: string;
  readonly from_model: string;
  readonly to_provider: string;
  readonly failed_stage: ModelStage | "unknown";
  readonly failure_code: string;
  readonly finish_reason: string | null;
  readonly paid_request_attempted: boolean;
  readonly network_calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly normal_report_generated: true;
}

function fallbackReceipt(
  error: unknown,
  fallbackProvider: ModelProvider | undefined,
  sourceProvider: string,
): AnalysisFallbackReceipt | null {
  if (!(error instanceof OpenAICompatibleProviderError) || fallbackProvider === undefined) {
    return null;
  }
  if (error.code === "API_KEY_NOT_CONFIGURED" || error.code === "INVALID_CONFIGURATION") {
    return null;
  }
  const telemetry = error.telemetry;
  const stageFromMessage = /stage (brief|angles|content)\b/.exec(error.message)?.[1];
  const failedStage = telemetry?.stage ?? stageFromMessage ?? "unknown";
  return {
    used: true,
    from_provider: telemetry?.provider ?? sourceProvider,
    from_model: telemetry?.model ?? "unknown",
    to_provider: fallbackProvider.id === "deterministic" ? "deterministic-v1" : fallbackProvider.id,
    failed_stage: failedStage as ModelStage | "unknown",
    failure_code: error.code,
    finish_reason: telemetry?.finishReason ?? null,
    paid_request_attempted: telemetry?.paid ?? error.attempts > 0,
    network_calls: telemetry?.networkCalls ?? error.attempts,
    input_tokens: telemetry?.usage.inputTokens ?? 0,
    output_tokens: telemetry?.usage.outputTokens ?? 0,
    normal_report_generated: true,
  };
}

function fallbackReportNotice(
  receipt: AnalysisFallbackReceipt,
  locale: AnalysisLocale,
): string {
  const providerId = receipt.from_provider.replace(/-api$/, "");
  const providerLabel = isWebModelProvider(providerId) ? WEB_MODEL_PROFILES[providerId].label : receipt.from_provider;
  const stage = locale === "zh-CN"
    ? {
        brief: "项目说明",
        angles: "选题角度",
        content: "成稿内容",
        unknown: "模型生成",
      }[receipt.failed_stage]
    : {
        brief: "project overview",
        angles: "content angles",
        content: "spoken explainer",
        unknown: "model generation",
      }[receipt.failed_stage];
  return localized(
    locale,
    `${providerLabel} 智能增强未完成（${stage}阶段：${receipt.failure_code}）。本报告已安全改用免费确定性分析，未采用模型返回的半截内容；失败前的模型请求可能已经计费。`,
    `${providerLabel} enhancement did not complete (${stage}: ${receipt.failure_code}). This report safely uses the free deterministic analysis. Partial model output was discarded; model requests made before the failure may still have been billed.`,
  );
}

function failureInfo(error: unknown): {
  code: string;
  message: string;
  failedGates: readonly string[];
} {
  if (error instanceof RepositoryReadError) {
    return { code: error.code, message: error.message, failedGates: [] };
  }
  if (error instanceof AnalysisQualityError) {
    return {
      code: "QUALITY_GATE_FAILED",
      message: "One or more critical quality gates failed.",
      failedGates: error.receipt.gates.filter((gate) => !gate.passed).map((gate) => gate.id),
    };
  }
  if (error instanceof OllamaProviderError) {
    return {
      code: `MODEL_PROVIDER_${error.code}`,
      message: error.message,
      failedGates: [],
    };
  }
  if (error instanceof OpenAICompatibleProviderError) {
    return {
      code: `MODEL_PROVIDER_${error.code}`,
      message: error.message,
      failedGates: [],
    };
  }
  return {
    code: "UNEXPECTED_ANALYSIS_FAILURE",
    message: "Analysis failed before normal artifacts could be written.",
    failedGates: [],
  };
}

export function analyzeRepository(input: AnalyzeRepositoryInput & { includeSpokenScript?: true }): Promise<AnalyzeRepositoryResult>;
export function analyzeRepository(input: AnalyzeRepositoryInput): Promise<AnalyzeRepositoryResult<ReportBundle>>;
export async function analyzeRepository(
  input: AnalyzeRepositoryInput,
): Promise<AnalyzeRepositoryResult<ReportBundle>> {
  const started = performance.now();
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const locale = input.locale ?? "zh-CN";
  let snapshot: RepositorySnapshot | null = null;
  try {
    snapshot = await readRepository(input.source, input.url);
    const schemas = createSchemaRegistry(input.schemaDirectory);
    let fallback: AnalysisFallbackReceipt | undefined;
    let bundle: ReportBundle;
    try {
      bundle = await analyzeSnapshot(snapshot, {
        includeSpokenScript: input.includeSpokenScript,
        provider: input.provider,
        schemas,
        locale,
        generatedAt,
        networkHosts: input.networkHosts,
        approvedModelHost: input.approvedModelHost,
      });
    } catch (error) {
      const receipt = fallbackReceipt(error, input.fallbackProvider, input.provider.id);
      if (receipt === null || input.fallbackProvider === undefined) throw error;
      bundle = await analyzeSnapshot(snapshot, {
        includeSpokenScript: input.includeSpokenScript,
        provider: input.fallbackProvider,
        schemas,
        locale,
        generatedAt,
        networkHosts: input.networkHosts,
        approvedModelHost: input.approvedModelHost,
      });
      fallback = receipt;
    }
    const qualityReview = input.includeQualityReview && bundle.script !== null
      ? buildQualityReviewArtifacts({ ...bundle, script: bundle.script })
      : undefined;
    const durationMs = performance.now() - started;
    const artifacts = await writeArtifacts(bundle, {
      outputRoot: input.outputRoot,
      durationMs,
      licenseSpdx: snapshot.repository.licenseSpdx,
      verticalSlice: qualityReview === undefined ? "01" : "02",
      status: qualityReview?.evaluation.release_status ?? "PASS",
      additionalArtifacts: [
        ...(qualityReview?.files ?? []),
        ...(fallback === undefined
          ? []
          : [
              {
                name: "fallback-receipt.json",
                content: `${JSON.stringify(fallback, null, 2)}\n`,
              },
            ]),
      ],
      receiptExtension: {
        report_locale: locale,
        ...(qualityReview === undefined
          ? {}
          : {
              engineering_status: "PASS",
              content_quality_status: qualityReview.evaluation.release_status,
              shareability: qualityReview.evaluation.shareability,
            }),
        ...(fallback === undefined ? {} : { analysis_fallback: fallback }),
      },
      reportNotice:
        fallback === undefined ? undefined : fallbackReportNotice(fallback, locale),
      reportLocale: locale,
    });
    return {
      bundle,
      outputDirectory: artifacts.outputDirectory,
      durationMs,
      qualityReview,
      fallback,
    };
  } catch (error) {
    const failure = failureInfo(error);
    await writeFailureReceipt({
      outputRoot: input.outputRoot,
      generatedAt,
      failureCode: failure.code,
      message: failure.message,
      repositoryUrl: snapshot?.repository.url ?? null,
      commitSha: snapshot?.repository.commitSha ?? null,
      failedGates: failure.failedGates,
      ...(error instanceof AnalysisQualityError ? { validationDetails: qualityFailureDetails(error.receipt) } : {}),
      verticalSlice: input.includeQualityReview ? "02" : "01",
    });
    throw error;
  }
}
