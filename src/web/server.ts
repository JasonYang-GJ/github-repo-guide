import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { basename, extname, join, relative, resolve } from "node:path";

import { analyzeRepository } from "../application/analyze-repository.js";
import { AnalysisQualityError } from "../analysis/pipeline.js";
import { qualityFailureDetails } from "../quality/failure-details.js";
import { WEB_MODEL_PROFILES, isWebModelProvider, webModelName, createWebModelProvider, type WebModelProvider } from "../model/web-profiles.js";
import { DeterministicModelProvider } from "../model/deterministic-provider.js";
import { OpenAICompatibleProviderError } from "../model/openai-compatible-provider.js";
import { ConnectionConfigurationError, parseCustomConnection, resolvePublicModelHost, pinnedModelFetch, customModelEndpoint, createCustomModelProvider, type ModelHostResolver } from "../model/custom-connection.js";
import type { ModelProvider } from "../model/provider.js";
import type { RepositorySource } from "../repo/contracts.js";
import { RepositoryReadError } from "../repo/progressive-reader.js";
import {
  GitHubApiError,
  GitHubRepositorySource,
  MemoryGitHubResponseCache,
  type GitHubResponseCache,
} from "../repo/github-source.js";
import { parseGitHubRepositoryUrl } from "../repo/url-guard.js";
import {
  zhAngleCategory,
  zhGateName,
  zhRelationshipType,
  zhSourceKind,
  zhStatus,
  zhText,
} from "../presentation/zh-cn.js";
import {
  isAnalysisLocale,
  type AnalysisLocale,
} from "../presentation/locale.js";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_VISIBLE_EVIDENCE = 120;
const MAX_VISIBLE_RELATIONSHIPS = 60;
const MAX_RUN_DOWNLOADS = 20;

const STATIC_ASSETS = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.css", "app.css"],
  ["/app.js", "app.js"],
  ["/provider-manager.js", "provider-manager.js"],
]);

const DOWNLOADABLE_ARTIFACTS = new Set([
  "architecture.mmd",
  "codebase-brief.json",
  "content-angles.json",
  "evidence.json",
  "report.md",
  "run-receipt.json",
  "project-guide.json",
  "fallback-receipt.json",
]);

export interface WebServerOptions {
  readonly assetRoot?: string;
  readonly outputRoot?: string;
  readonly schemaDirectory?: string;
  readonly source?: RepositorySource;
  readonly githubFetch?: typeof fetch;
  readonly deepseekFetch?: typeof fetch;
  readonly modelFetch?: typeof fetch;
  readonly customModelFetch?: typeof fetch;
  readonly modelHostResolver?: ModelHostResolver;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly allowEnvironmentCredentials?: boolean;
  readonly githubCache?: GitHubResponseCache;
  readonly modelProviderFactory?: (
    provider: WebProvider,
    deepseekApiKey?: string,
    model?: string,
  ) => ModelProvider;
  readonly generatedAt?: string;
  readonly networkHosts?: readonly string[];
}

type WebProvider = "deterministic" | "custom" | WebModelProvider;
type GitHubAuthMode = "anonymous" | "token";

interface ResolvedCredential {
  readonly value: string;
  readonly source: "request" | "environment" | "none";
}

interface RequestFailure extends Error {
  readonly status: number;
  readonly code: string;
}

interface RunDownload {
  readonly directory: string;
  readonly files: ReadonlySet<string>;
}

function requestFailure(status: number, code: string, message: string): RequestFailure {
  return Object.assign(new Error(message), { status, code });
}

function validatedModel(provider: WebModelProvider, value: unknown): string {
  try { return webModelName(provider, value); }
  catch { throw requestFailure(400, "INVALID_MODEL_NAME", "模型名称无效，请填写服务商提供的模型 ID，不要填写网址或密钥。"); }
}

async function testModelConnection(provider: WebModelProvider, model: string, credential: ResolvedCredential, fetchImpl: typeof fetch): Promise<object> {
  if (!credential.value) throw requestFailure(400, "MODEL_API_KEY_REQUIRED", "请填写所选服务商的 API Key，或在本机配置对应环境变量。");
  if (provider !== "openai") {
    return { status: "CONFIGURATION_ONLY", kind: provider, model, credential_source: credential.source, authentication_verified: false, inference_calls: 0 };
  }
  let response: Response;
  let metadata: Record<string, unknown> | null;
  try {
    response = await fetchImpl(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(20_000), headers: fixedHeaders(credential.value, false),
    });
    metadata = response.ok ? objectRecord(await response.json()) : null;
  } catch {
    throw requestFailure(502, "MODEL_CONNECTION_FAILED", "无法连接 OpenAI。请检查网络后重试；未发起内容生成。");
  }
  if (!response.ok) {
    const code = response.status === 401 ? "MODEL_API_KEY_INVALID" : response.status === 404 ? "MODEL_NOT_AVAILABLE" : response.status === 429 ? "MODEL_RATE_LIMIT" : "MODEL_CONNECTION_FAILED";
    throw requestFailure(400, code, "OpenAI 未通过密钥/模型访问检查，请检查密钥权限、模型名称和账户状态。未发起内容生成。");
  }
  if (metadata?.id !== model) throw requestFailure(502, "MODEL_CONNECTION_FAILED", "OpenAI 返回了无法确认的模型信息；未发起内容生成。");
  return { status: "PASS", kind: provider, model, credential_source: credential.source, authentication_verified: true, balance_verified: false, inference_calls: 0 };
}

function requestCredential(value: unknown, fieldName: string): string {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string") {
    throw requestFailure(400, "INVALID_REQUEST", `${fieldName} 必须是字符串。`);
  }
  const credential = value.trim();
  if (credential.length > 1_024) {
    throw requestFailure(400, "CREDENTIAL_TOO_LONG", `${fieldName} 长度超过限制。`);
  }
  if (/[\u0000-\u001f\u007f]/.test(credential)) {
    throw requestFailure(400, "CREDENTIAL_INVALID", `${fieldName} 包含无效控制字符。`);
  }
  return credential;
}

function resolveCredential(
  requestValue: unknown,
  fieldName: string,
  environmentName: string,
  environment: Readonly<Record<string, string | undefined>>,
  allowEnvironmentCredentials: boolean,
): ResolvedCredential {
  const supplied = requestCredential(requestValue, fieldName);
  if (supplied.length > 0) return { value: supplied, source: "request" };
  const configured = allowEnvironmentCredentials
    ? requestCredential(environment[environmentName], environmentName)
    : "";
  return configured.length > 0
    ? { value: configured, source: "environment" }
    : { value: "", source: "none" };
}

function resolveGitHubCredential(
  requestValue: unknown,
  mode: GitHubAuthMode | undefined,
  environment: Readonly<Record<string, string | undefined>>,
  allowEnvironmentCredentials: boolean,
): ResolvedCredential {
  if (mode === "anonymous") return { value: "", source: "none" };
  const credential = resolveCredential(
    requestValue,
    "GitHub Token",
    "GITHUB_TOKEN",
    environment,
    allowEnvironmentCredentials,
  );
  if (mode === "token" && credential.value.length === 0) {
    throw requestFailure(
      400,
      "GITHUB_TOKEN_REQUIRED",
      "已选择使用 GitHub Token，请填写 Token，或改回匿名访问。",
    );
  }
  return credential;
}

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fixedHeaders(token: string, github: boolean): Record<string, string> {
  const headers: Record<string, string> = github
    ? {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "repo-artifact-core/0.2.0",
      }
    : { Accept: "application/json" };
  if (token.length > 0) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function testGitHubConnection(
  fetchImpl: typeof fetch,
  credential: ResolvedCredential,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl("https://api.github.com/rate_limit", {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: fixedHeaders(credential.value, true),
    });
  } catch {
    throw requestFailure(422, "GITHUB_CONNECTION_FAILED", "无法连接 GitHub API。");
  }
  if (!response.ok) {
    const code = response.status === 401 ? "GITHUB_TOKEN_INVALID" : "GITHUB_CONNECTION_FAILED";
    throw requestFailure(
      422,
      code,
      response.status === 401
        ? "GitHub Token 无效或已失效。"
        : `GitHub API 连接测试返回 HTTP ${response.status}。`,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw requestFailure(422, "GITHUB_CONNECTION_FAILED", "GitHub 返回了无法识别的响应。");
  }
  const core = objectRecord(objectRecord(objectRecord(payload)?.resources)?.core);
  const resetSeconds = finiteInteger(core?.reset);
  const remaining = finiteInteger(core?.remaining);
  return {
    status: remaining === 0 ? "LIMITED" : "PASS",
    kind: "github",
    authentication: credential.value.length > 0 ? "authenticated" : "anonymous",
    credential_source: credential.source,
    limit: finiteInteger(core?.limit),
    remaining,
    reset_at:
      resetSeconds === null ? null : new Date(resetSeconds * 1_000).toISOString(),
  };
}

async function testDeepSeekConnection(
  fetchImpl: typeof fetch,
  credential: ResolvedCredential,
): Promise<Record<string, unknown>> {
  if (credential.value.length === 0) {
    throw requestFailure(
      400,
      "DEEPSEEK_API_KEY_REQUIRED",
      "请输入 DeepSeek API Key，或在本机环境中配置 DEEPSEEK_API_KEY。",
    );
  }
  let response: Response;
  try {
    response = await fetchImpl("https://api.deepseek.com/user/balance", {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: fixedHeaders(credential.value, false),
    });
  } catch {
    throw requestFailure(422, "DEEPSEEK_CONNECTION_FAILED", "无法连接 DeepSeek API。");
  }
  if (!response.ok) {
    const code =
      response.status === 401
        ? "DEEPSEEK_API_KEY_INVALID"
        : response.status === 402
          ? "DEEPSEEK_BALANCE_EMPTY"
          : "DEEPSEEK_CONNECTION_FAILED";
    const message =
      response.status === 401
        ? "DeepSeek API Key 无效或已失效。"
        : response.status === 402
          ? "DeepSeek 账户余额不足。"
          : `DeepSeek API 连接测试返回 HTTP ${response.status}。`;
    throw requestFailure(422, code, message);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw requestFailure(422, "DEEPSEEK_CONNECTION_FAILED", "DeepSeek 返回了无法识别的响应。");
  }
  const record = objectRecord(payload);
  const rawBalances = Array.isArray(record?.balance_infos) ? record.balance_infos : [];
  const balances = rawBalances.flatMap((item) => {
    const balance = objectRecord(item);
    return typeof balance?.currency === "string" &&
      typeof balance.total_balance === "string"
      ? [{ currency: balance.currency, total_balance: balance.total_balance }]
      : [];
  });
  return {
    status: "PASS",
    kind: "deepseek",
    credential_source: credential.source,
    balance_available: record?.is_available === true,
    balances,
    inference_calls: 0,
  };
}

function securityHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    ...securityHeaders("application/json; charset=utf-8"),
    "Content-Length": Buffer.byteLength(body).toString(),
  });
  response.end(body);
}

function sendText(
  response: ServerResponse,
  status: number,
  body: string | Buffer,
  contentType: string,
  headOnly = false,
): void {
  response.writeHead(status, {
    ...securityHeaders(contentType),
    "Content-Length": Buffer.byteLength(body).toString(),
  });
  response.end(headOnly ? undefined : body);
}

function assetContentType(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".md":
    case ".mmd":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host;
  if (host === undefined) return false;
  return origin === `http://${host}` || origin === `https://${host}`;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw requestFailure(415, "CONTENT_TYPE_REQUIRED", "请使用 application/json 提交分析请求。");
  }
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    request.resume();
    throw requestFailure(413, "REQUEST_TOO_LARGE", "请求内容超过 8 KiB 限制。");
  }

  const chunks: Buffer[] = [];
  let received = 0;
  let tooLarge = false;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    received += chunk.byteLength;
    if (received > MAX_REQUEST_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) {
    throw requestFailure(413, "REQUEST_TOO_LARGE", "请求内容超过 8 KiB 限制。");
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw requestFailure(400, "INVALID_JSON", "请求不是有效的 JSON。");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw requestFailure(400, "INVALID_REQUEST", "请求必须是一个 JSON 对象。");
  }
  return value as Record<string, unknown>;
}

function safeRelativePath(path: string): string {
  const local = relative(process.cwd(), path).split("\\").join("/");
  return local.startsWith("..") ? basename(path) : local;
}

function publicAnalysisError(error: unknown, providerSelection: WebProvider = "deepseek"): {
  code: string;
  message: string;
  retry_at?: string | null;
} {
  if (error instanceof ConnectionConfigurationError) return { code: error.code, message: error.message };
  const message = error instanceof Error ? error.message : "分析未完成。";
  if (error instanceof GitHubApiError && error.rateLimit !== undefined) {
    const mode = error.rateLimit.authenticated ? "已认证" : "匿名";
    const resetText =
      error.rateLimit.resetAt === null
        ? "请稍后再试。"
        : `预计恢复时间：${error.rateLimit.resetAt}。`;
    return {
      code: "GITHUB_RATE_LIMIT",
      message: `GitHub ${mode}读取额度已用完。${resetText}`,
      retry_at: error.rateLimit.resetAt,
    };
  }
  if (
    error instanceof GitHubApiError &&
    (error.status === 404 || /private/i.test(message))
  ) {
    return {
      code: "REPOSITORY_NOT_AVAILABLE",
      message: "仓库不存在、不是公开仓库，或当前无法访问。",
    };
  }
  if (error instanceof GitHubApiError) {
    if (error.status === 401) {
      return {
        code: "GITHUB_TOKEN_INVALID",
        message: "GitHub Token 无效或已失效，请清空后改用匿名访问，或填写新的 Token。",
      };
    }
    if (error.status === 403) {
      return {
        code: "GITHUB_ACCESS_FORBIDDEN",
        message: "GitHub 拒绝了这次读取；请检查 Token 权限或仓库可见性。",
      };
    }
    return {
      code: "GITHUB_API_FAILED",
      message:
        error.status === null
          ? "GitHub 返回的数据无法完成仓库读取。"
          : `GitHub API 请求失败（HTTP ${error.status}）。`,
    };
  }
  if (error instanceof OpenAICompatibleProviderError) {
    const name = isWebModelProvider(providerSelection) ? WEB_MODEL_PROFILES[providerSelection].label : "模型服务";
    const prefix = providerSelection === "deepseek" ? "DEEPSEEK" : "MODEL";
    if (error.code === "API_KEY_NOT_CONFIGURED") {
      return {
        code: `${prefix}_API_KEY_REQUIRED`,
        message: `当前没有可用的 ${name} API Key。`,
      };
    }
    if (error.code === "HTTP_ERROR") {
      const status = /HTTP (\d{3})/.exec(error.message)?.[1];
      if (status === "401") {
        return { code: `${prefix}_API_KEY_INVALID`, message: `${name} API Key 无效或已失效。` };
      }
      if (status === "402") {
        return { code: `${prefix}_BALANCE_EMPTY`, message: `${name} 账户余额不足。` };
      }
      if (status === "429") {
        return { code: `${prefix}_RATE_LIMIT`, message: `${name} 请求过快，请稍后再试。` };
      }
    }
    return {
      code: `${prefix}_${error.code}`,
      message: `${name} 没有返回可通过完整门禁的结果；没有生成正常报告。`,
    };
  }
  if (error instanceof RepositoryReadError) {
    if (error.code === "MISSING_MANIFEST") {
      return {
        code: "REPOSITORY_TEXT_NOT_FOUND",
        message: "仓库里没有找到可安全读取的说明、常见项目配置或文本源码。",
      };
    }
    return {
      code: `REPOSITORY_${error.code}`,
      message: `仓库读取未完成：${error.message}`,
    };
  }
  if (/canonical|Repository URL|public https:\/\/github\.com/i.test(message)) {
    return { code: "REPOSITORY_URL_INVALID", message };
  }
  if (/rate limit|returned 403/i.test(message)) {
    return {
      code: "GITHUB_RATE_LIMIT",
      message: "GitHub 读取额度暂时用完，请稍后再试或填写 GitHub Token。",
    };
  }
  if (/Artifact directory already exists/i.test(message)) {
    return {
      code: "ARTIFACT_CONFLICT",
      message: "本次分析产物目录发生冲突，请重新运行。",
    };
  }
  if (error instanceof AnalysisQualityError) {
    const details = qualityFailureDetails(error.receipt);
    const gates = details.failed_gates.map(zhGateName).join("、") || "报告完整性";
    const limits = details.field_limits.map(item => `${item.field} 最多 ${item.character_limit} 个字符`).join("；");
    return {
      code: "REPORT_VALIDATION_FAILED",
      message: `报告内部校验未通过：${gates}${limits ? `（${limits}）` : ""}。这不是仓库地址或 API Key 错误；未交付未通过校验的内容。请保留此错误信息用于排查，无需反复付费重试。`,
    };
  }
  return {
    code: "ANALYSIS_FAILED",
    message: "分析没有通过完整门禁。系统已保留具体失败记录，请检查仓库可访问性和页面提示后重试。",
  };
}

function buildViewModel(
  result: Awaited<ReturnType<typeof analyzeRepository>>,
  runId: string,
  locale: AnalysisLocale = "zh-CN",
) {
  const { brief, angles, evidence, mermaid, quality, project_guide } = result.bundle;
  const localText = locale === "zh-CN" ? zhText : (text: string) => text;
  const localStatus = locale === "zh-CN" ? zhStatus : (status: string) => status;
  const localSourceKind = locale === "zh-CN" ? zhSourceKind : (kind: string) => kind;
  const localRelationshipType = locale === "zh-CN"
    ? zhRelationshipType
    : (type: string) => type;
  const localAngleCategory = locale === "zh-CN"
    ? zhAngleCategory
    : (category: string) => category.replaceAll("_", " ");
  const localGateName = locale === "zh-CN"
    ? zhGateName
    : (id: string) => id.replaceAll("_", " ");
  const providerInvocations = result.bundle.provider_invocations;
  const providerId = result.bundle.security.provider_id;
  const paid = providerInvocations.some((invocation) => invocation.paid);
  const fallback =
    result.fallback === undefined
      ? null
      : {
          used: result.fallback.used,
          from_provider: result.fallback.from_provider,
          from_model: result.fallback.from_model,
          to_provider: result.fallback.to_provider,
          failed_stage: result.fallback.failed_stage,
          failure_code: result.fallback.failure_code,
          finish_reason: result.fallback.finish_reason,
          paid_request_attempted: result.fallback.paid_request_attempted,
          network_calls: result.fallback.network_calls,
          input_tokens: result.fallback.input_tokens,
          output_tokens: result.fallback.output_tokens,
        };
  const visibleEvidence = evidence.slice(0, MAX_VISIBLE_EVIDENCE).map((record) => ({
    id: record.id,
    claim: localText(record.claim),
    status: localStatus(record.verification_status),
    source_kind: localSourceKind(record.source_kind),
    location:
      record.locator === undefined
        ? "analysis reasoning"
        : `${record.locator.source_path}${
            record.locator.line_start === undefined ? "" : `:${record.locator.line_start}`
          }`,
    limitations: record.limitations.map(localText),
  }));
  const moduleInterpretations = new Map(
    result.bundle.model_insights.module_interpretations.map((item) => [item.source_path, item]),
  );
  const visibleModules = brief.core_modules.slice(0, 24).map((module) => {
    const sourcePath = module.source_paths[0] ?? "";
    const interpretation = moduleInterpretations.get(sourcePath);
    const sourceMarker = module.name.lastIndexOf("/src/");
    return {
      ...module,
      short_name:
        sourceMarker === -1 ? module.name : module.name.slice(sourceMarker + "/src/".length),
      responsibility: localText(module.responsibility),
      explanation:
        interpretation === undefined
          ? localText(module.responsibility)
          : interpretation.responsibility,
      explanation_source:
        interpretation === undefined ? "verified_structure" : "model_interpretation",
    };
  });
  const crossModuleRelationships = brief.relationships.filter(
    (relationship) => relationship.from_module_id !== relationship.to_module_id,
  );
  const visibleRelationships = crossModuleRelationships
    .slice(0, MAX_VISIBLE_RELATIONSHIPS)
    .map((relationship) => ({
      ...relationship,
      relationship_type: localRelationshipType(relationship.relationship_type),
      description: localText(relationship.description),
    }));

  return {
    status: fallback === null ? "PASS" : "PASS_WITH_FALLBACK",
    preview_version: "0.2.0",
    locale,
    repository: {
      name: project_guide?.name ?? brief.overview.project_name,
      url: brief.repository.url,
      owner: brief.repository.owner,
      repository_name: brief.repository.name,
      default_branch: brief.repository.default_branch,
      commit_sha: brief.repository.commit_sha,
      commit_short: brief.repository.commit_sha.slice(0, 12),
    },
    overview: brief.overview,
    project_guide,
    analysis: {
      repository_mode: brief.limitations.some(
        (limitation) => limitation.id === "limitation_generic_language_scope",
      )
        ? "generic_text"
        : "typescript_npm",
      files_seen: brief.analysis_scope.files_seen,
      files_read: brief.analysis_scope.files_read,
      bytes_read: brief.analysis_scope.bytes_read,
      highest_scope: brief.analysis_scope.highest_scope,
      truncated: brief.analysis_scope.truncated,
      confidence: brief.overall_confidence,
      duration_ms: Math.round(result.durationMs),
      provider: providerId === "deterministic" ? "deterministic-v1" : providerId,
      model: providerInvocations[0]?.model ?? "unknown",
      paid,
      model_requests: providerInvocations.reduce(
        (total, invocation) => total + invocation.network_calls,
        0,
      ),
      input_tokens: providerInvocations.reduce(
        (total, invocation) => total + invocation.input_tokens,
        0,
      ),
      output_tokens: providerInvocations.reduce(
        (total, invocation) => total + invocation.output_tokens,
        0,
      ),
      repository_code_executions: result.bundle.security.repository_code_executions,
      fallback,
    },
    modules: visibleModules,
    relationships: visibleRelationships,
    relationships_total: brief.relationships.length,
    relationship_summary: {
      cross_module: crossModuleRelationships.length,
      internal_calls: brief.relationships.length - crossModuleRelationships.length,
      imports: crossModuleRelationships.filter(
        (relationship) => relationship.relationship_type === "imports",
      ).length,
      calls: crossModuleRelationships.filter(
        (relationship) => relationship.relationship_type === "calls",
      ).length,
      displayed: visibleRelationships.length,
    },
    technologies: brief.technologies,
    evidence: visibleEvidence,
    evidence_total: evidence.length,
    evidence_shown: visibleEvidence.length,
    angles: angles.map((angle) => ({
      ...angle,
      category: localAngleCategory(angle.category),
      technical_basis: localText(angle.technical_basis),
      caveats: angle.caveats.map(localText),
    })),
    limitations: brief.limitations.map((item) => ({
      ...item,
      description: localText(item.description),
      impact: localText(item.impact),
    })),
    unknowns: brief.unknowns.map((item) => ({
      ...item,
      question: localText(item.question),
      reason: localText(item.reason),
      next_evidence_needed: localText(item.next_evidence_needed),
    })),
    architecture_mermaid: mermaid,
    quality_gates: quality.gates.map((gate) => ({
      ...gate,
      id: localGateName(gate.id),
    })),
    artifacts: {
      directory: safeRelativePath(result.outputDirectory),
      downloads: [
        "report.md",
        "codebase-brief.json",
        "evidence.json",
        "architecture.mmd",
        "content-angles.json",
        "project-guide.json",
        "run-receipt.json",
        ...(fallback === null ? [] : ["fallback-receipt.json"]),
      ].map((name) => ({
        name,
        url: `/api/runs/${runId}/artifacts/${name}`,
      })),
    },
  } as const;
}

export function createWebServer(options: WebServerOptions = {}): Server {
  const assetRoot = resolve(options.assetRoot ?? resolve(process.cwd(), "web"));
  const outputRoot = resolve(options.outputRoot ?? resolve(process.cwd(), "output", "web"));
  const schemaDirectory = resolve(
    options.schemaDirectory ?? resolve(process.cwd(), "schemas"),
  );
  const environment = options.environment ?? process.env;
  const allowEnvironmentCredentials = options.allowEnvironmentCredentials ?? false;
  const githubCache = options.githubCache ?? new MemoryGitHubResponseCache();
  const githubFetch = options.githubFetch ?? fetch;
  const deepseekFetch = options.deepseekFetch ?? fetch;
  const modelFetch = options.modelFetch ?? fetch;
  const environmentGitHubToken =
    allowEnvironmentCredentials && (environment.GITHUB_TOKEN?.trim().length ?? 0) > 0;
  const runDownloads = new Map<string, RunDownload>();
  let analysisActive = false;

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const method = request.method ?? "GET";

      if (url.pathname === "/api/health") {
        if (method !== "GET" && method !== "HEAD") {
          response.setHeader("Allow", "GET, HEAD");
          sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "此接口只接受 GET。" } });
          return;
        }
        const payload = {
          status: "ok",
          preview_version: "0.2.0",
          default_provider: "deterministic-v1",
          providers: [
            { id: "deterministic", paid: false, credential_required: false },
            ...Object.entries(WEB_MODEL_PROFILES).map(([id, profile]) => ({
              id,
              label: profile.label,
              default_model: profile.model,
              endpoint: profile.baseUrl,
              environment_variable: profile.env,
              connection_check: profile.check,
              docs: profile.docs,
              paid: true,
              credential_required: true,
              environment_credential_available: allowEnvironmentCredentials && (environment[profile.env]?.trim().length ?? 0) > 0,
            })),
          ],
          github: {
            anonymous_supported: true,
            environment_credential_available: environmentGitHubToken,
          },
          credential_storage: "request_only",
          target_repository_execution: false,
        };
        if (method === "HEAD") {
          sendText(response, 200, `${JSON.stringify(payload)}\n`, "application/json; charset=utf-8", true);
        } else {
          sendJson(response, 200, payload);
        }
        return;
      }

      if (url.pathname === "/api/connections/test") {
        if (method !== "POST") {
          response.setHeader("Allow", "POST");
          sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "此接口只接受 POST。" } });
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: { code: "ORIGIN_REJECTED", message: "请求来源与本地应用不一致。" } });
          return;
        }
        const body = await readJsonBody(request);
        if (body.kind === "custom") {
          if (Object.keys(body).some(key => !["kind", "configuration"].includes(key))) throw requestFailure(400, "INVALID_REQUEST", "配置检查只接受供应商配置，不接收密钥。");
          const configuration = parseCustomConnection(body.configuration);
          sendJson(response, 200, { status: "CONFIGURATION_ONLY", kind: "custom", configuration,
            endpoint: customModelEndpoint(configuration), authentication_verified: false, inference_calls: 0 });
          return;
        }
        if (
          (body.kind !== "github" && !isWebModelProvider(body.kind)) ||
          (body.mode !== undefined &&
            (body.kind !== "github" ||
              (body.mode !== "anonymous" && body.mode !== "token"))) ||
          Object.keys(body).some(
            (key) => key !== "kind" && key !== "credential" && key !== "mode" && key !== "model",
          )
        ) {
          throw requestFailure(
            400,
            "INVALID_REQUEST",
            "连接测试只能包含 kind 和可选的 credential 字段。",
          );
        }
        if (body.kind === "github") {
          const credential = resolveGitHubCredential(
            body.credential,
            body.mode as GitHubAuthMode | undefined,
            environment,
            allowEnvironmentCredentials,
          );
          sendJson(response, 200, await testGitHubConnection(githubFetch, credential));
        } else if (isWebModelProvider(body.kind)) {
          const profile = WEB_MODEL_PROFILES[body.kind];
          const model = validatedModel(body.kind, body.model);
          const credential = resolveCredential(
            body.credential,
            `${profile.label} API Key`,
            profile.env,
            environment,
            allowEnvironmentCredentials,
          );
          if (body.kind === "deepseek") {
            sendJson(response, 200, await testDeepSeekConnection(deepseekFetch, credential));
          } else {
            sendJson(response, 200, await testModelConnection(body.kind, model, credential, modelFetch));
          }
        }
        return;
      }

      const artifactMatch = /^\/api\/runs\/([a-f0-9-]+)\/artifacts\/([A-Za-z0-9._-]+)$/.exec(
        url.pathname,
      );
      if (artifactMatch !== null) {
        if (method !== "GET" && method !== "HEAD") {
          response.setHeader("Allow", "GET, HEAD");
          sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "产物只支持下载。" } });
          return;
        }
        const runId = artifactMatch[1] ?? "";
        const fileName = artifactMatch[2] ?? "";
        const run = runDownloads.get(runId);
        if (
          run === undefined ||
          !DOWNLOADABLE_ARTIFACTS.has(fileName) ||
          !run.files.has(fileName) ||
          basename(fileName) !== fileName
        ) {
          sendJson(response, 404, { error: { code: "ARTIFACT_NOT_FOUND", message: "没有找到这个分析产物。" } });
          return;
        }
        const body = await readFile(join(run.directory, fileName));
        response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        sendText(response, 200, body, assetContentType(fileName), method === "HEAD");
        return;
      }

      if (url.pathname === "/api/analyze") {
        if (method !== "POST") {
          response.setHeader("Allow", "POST");
          sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "此接口只接受 POST。" } });
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: { code: "ORIGIN_REJECTED", message: "请求来源与本地应用不一致。" } });
          return;
        }
        if (analysisActive) {
          sendJson(response, 409, { error: { code: "ANALYSIS_BUSY", message: "已有一个仓库正在分析，请等待它完成。" } });
          return;
        }

        const body = await readJsonBody(request);
        const allowedAnalysisFields = new Set([
          "url",
          "provider",
          "githubAuthMode",
          "githubToken",
          "deepseekApiKey",
          "apiKey",
          "model",
          "customProvider",
          "paidModelConsent",
          "locale",
        ]);
        if (
          typeof body.url !== "string" ||
          (body.provider !== undefined &&
            body.provider !== "deterministic" &&
            body.provider !== "custom" &&
            !isWebModelProvider(body.provider)) ||
          (body.githubAuthMode !== undefined &&
            body.githubAuthMode !== "anonymous" &&
            body.githubAuthMode !== "token") ||
          (body.locale !== undefined && !isAnalysisLocale(body.locale)) ||
          Object.keys(body).some((key) => !allowedAnalysisFields.has(key))
        ) {
          throw requestFailure(400, "INVALID_REQUEST", "分析请求包含不支持的字段或类型。 ");
        }
        const providerSelection: WebProvider =
          body.provider === "custom" ? "custom" : isWebModelProvider(body.provider) ? body.provider : "deterministic";
        const custom = providerSelection === "custom" ? parseCustomConnection(body.customProvider) : undefined;
        const profile = isWebModelProvider(providerSelection) ? WEB_MODEL_PROFILES[providerSelection] : undefined;
        const selectedModel = custom?.model ?? (isWebModelProvider(providerSelection) ? validatedModel(providerSelection, body.model) : undefined);
        if (custom && (body.deepseekApiKey !== undefined || body.model !== undefined)) throw requestFailure(400, "INVALID_REQUEST", "自定义连接请使用独立配置与 apiKey，不可混入旧版密钥或模型字段。");
        if (profile && body.deepseekApiKey !== undefined && (providerSelection !== "deepseek" || body.apiKey !== undefined)) {
          throw requestFailure(400, "INVALID_REQUEST", "旧版 DeepSeek 密钥字段不可用于其他服务商，也不可与 apiKey 同时使用。");
        }
        const locale: AnalysisLocale = isAnalysisLocale(body.locale) ? body.locale : "zh-CN";
        const githubCredential = resolveGitHubCredential(
          body.githubToken,
          body.githubAuthMode as GitHubAuthMode | undefined,
          environment,
          allowEnvironmentCredentials,
        );
        const deepseekCredential =
          profile !== undefined
            ? resolveCredential(
                body.apiKey ?? body.deepseekApiKey,
                `${profile.label} API Key`,
                profile.env,
                environment,
                allowEnvironmentCredentials,
              )
            : custom ? { value: requestCredential(body.apiKey, "API Key"), source: "request" as const } : ({ value: "", source: "none" } as const);
        if (providerSelection !== "deterministic" && body.paidModelConsent !== true) {
          throw requestFailure(
            400,
            "PAID_MODEL_CONSENT_REQUIRED",
            `使用 ${custom?.name ?? profile?.label} 会发送仓库文本并消耗所选账户额度，请先确认本次付费调用。`,
          );
        }
        if (providerSelection !== "deterministic" && deepseekCredential.value.length === 0) {
          throw requestFailure(
            400,
            providerSelection === "deepseek" ? "DEEPSEEK_API_KEY_REQUIRED" : "MODEL_API_KEY_REQUIRED",
            custom ? "请填写这个自定义供应商自己的 API Key；不会自动读取任何本机环境密钥。" : `请输入 ${profile?.label} API Key，或在本机环境中配置 ${profile?.env}。`,
          );
        }
        let repository: ReturnType<typeof parseGitHubRepositoryUrl>;
        try {
          repository = parseGitHubRepositoryUrl(body.url.trim());
        } catch (error) {
          throw requestFailure(
            400,
            "REPOSITORY_URL_INVALID",
            error instanceof Error ? error.message : "Repository URL is invalid",
          );
        }
        const runId = randomUUID();
        const runOutputRoot = resolve(outputRoot, "runs", runId);
        const source =
          options.source ??
          new GitHubRepositorySource({
            ...(options.githubFetch === undefined ? {} : { fetch: githubFetch }),
            token: githubCredential.value,
            cache: githubCache,
          });
        if (analysisActive) throw requestFailure(409, "ANALYSIS_BUSY", "已有一个仓库正在分析，请等待它完成。");
        analysisActive = true;
        try {
          const approvedAddress = custom ? await resolvePublicModelHost(new URL(custom.baseUrl), options.modelHostResolver) : undefined;
          const provider =
            options.modelProviderFactory?.(
              providerSelection,
              deepseekCredential.value.length > 0 ? deepseekCredential.value : undefined,
              selectedModel,
            ) ??
            (custom && approvedAddress
              ? createCustomModelProvider(custom, deepseekCredential.value, options.customModelFetch ?? pinnedModelFetch(customModelEndpoint(custom), approvedAddress))
              : isWebModelProvider(providerSelection)
                ? createWebModelProvider(providerSelection, deepseekCredential.value, selectedModel!, providerSelection === "deepseek" ? deepseekFetch : modelFetch)
                : new DeterministicModelProvider());
          const result = await analyzeRepository({
            includeSpokenScript: false,
            url: repository.url,
            source,
            provider,
            locale,
            fallbackProvider:
              providerSelection !== "deterministic" ? new DeterministicModelProvider() : undefined,
            approvedModelHost: custom ? new URL(custom.baseUrl).host : undefined,
            schemaDirectory,
            outputRoot: runOutputRoot,
            generatedAt: options.generatedAt,
            networkHosts:
              options.networkHosts ??
              [
                "api.github.com",
                "github.com",
                "codeload.github.com",
                "raw.githubusercontent.com",
                ...(profile !== undefined ? [new URL(profile.baseUrl).host] : []),
                ...(custom ? [new URL(custom.baseUrl).host] : []),
              ],
            includeQualityReview: false,
          });
          runDownloads.set(runId, {
            directory: result.outputDirectory,
            files: new Set(DOWNLOADABLE_ARTIFACTS),
          });
          while (runDownloads.size > MAX_RUN_DOWNLOADS) {
            const oldest = runDownloads.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            runDownloads.delete(oldest);
          }
          sendJson(response, 200, buildViewModel(result, runId, locale));
        } catch (error) {
          sendJson(response, 422, { error: publicAnalysisError(error, providerSelection) });
        } finally {
          analysisActive = false;
        }
        return;
      }

      const asset = STATIC_ASSETS.get(url.pathname);
      if (asset !== undefined) {
        if (method !== "GET" && method !== "HEAD") {
          response.setHeader("Allow", "GET, HEAD");
          sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "静态页面只支持读取。" } });
          return;
        }
        const body = await readFile(join(assetRoot, asset));
        sendText(response, 200, body, assetContentType(asset), method === "HEAD");
        return;
      }

      sendJson(response, 404, { error: { code: "NOT_FOUND", message: "没有找到这个页面。" } });
    } catch (error) {
      if (error instanceof ConnectionConfigurationError) {
        sendJson(response, 400, { error: { code: error.code, message: error.message } });
        return;
      }
      if (
        error instanceof Error &&
        "status" in error &&
        "code" in error &&
        typeof error.status === "number" &&
        typeof error.code === "string"
      ) {
        sendJson(response, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      sendJson(response, 500, {
        error: { code: "INTERNAL_ERROR", message: "本地服务没有完成请求，请查看启动终端中的错误。" },
      });
    }
  });
}
