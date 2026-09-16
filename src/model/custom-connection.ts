import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";

export interface CustomConnection {
  readonly name: string;
  readonly baseUrl: string;
  readonly apiFormat: "openai-chat" | "anthropic-messages";
  readonly model: string;
  readonly tokenParameter: "max_tokens" | "max_completion_tokens";
  readonly jsonMode: boolean;
}

export class ConnectionConfigurationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["192.88.99.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

export function isPublicModelAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

export function parseCustomConnection(value: unknown): CustomConnection {
  const fail = () => new ConnectionConfigurationError("INVALID_MODEL_CONNECTION", "请填写供应商名称、HTTPS Base URL、接口格式和模型 ID；地址不能包含密钥、查询参数或完整生成接口路径。");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail();
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some(k => !["name", "baseUrl", "apiFormat", "model", "tokenParameter", "jsonMode"].includes(k))) throw fail();
  if (typeof obj.name !== "string" || !obj.name.trim() || obj.name.length > 80 || /[\u0000-\u001f\u007f]/.test(obj.name)) throw fail();
  if (typeof obj.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(obj.model) || /^sk-/i.test(obj.model) || obj.model.includes("://")) throw fail();
  if (obj.apiFormat !== "openai-chat" && obj.apiFormat !== "anthropic-messages") throw fail();
  if (obj.tokenParameter !== undefined && obj.tokenParameter !== "max_tokens" && obj.tokenParameter !== "max_completion_tokens") throw fail();
  if (obj.jsonMode !== undefined && typeof obj.jsonMode !== "boolean") throw fail();
  if (typeof obj.baseUrl !== "string" || obj.baseUrl.length > 500 || /[\s\\%]/.test(obj.baseUrl)) throw fail();
  let url: URL;
  try { url = new URL(obj.baseUrl); } catch { throw fail(); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || /\/(?:messages|chat\/completions|responses)\/?$/i.test(url.pathname)) throw fail();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host.endsWith(".") || (!isIP(host) && (!host.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host))) || (isIP(host) && !isPublicModelAddress(host))) {
    throw new ConnectionConfigurationError("MODEL_ENDPOINT_BLOCKED", "模型地址必须是公网 HTTPS 服务，不能使用本机、局域网或保留地址。");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return { name: obj.name.trim(), baseUrl: url.toString().replace(/\/$/, ""), apiFormat: obj.apiFormat, model: obj.model,
    tokenParameter: obj.tokenParameter ?? "max_tokens", jsonMode: obj.jsonMode ?? true };
}

export interface ModelAddress { readonly address: string; readonly family: number }
export type ModelHostResolver = (host: string) => Promise<readonly ModelAddress[]>;
const systemResolver: ModelHostResolver = host => lookup(host, { all: true, verbatim: true });

export async function resolvePublicModelHost(url: URL, resolver: ModelHostResolver = systemResolver): Promise<ModelAddress> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: readonly ModelAddress[];
  try {
    addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
      resolver(host), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS_TIMEOUT")), 5_000); }),
    ]);
  } catch {
    throw new ConnectionConfigurationError("MODEL_DNS_FAILED", "无法解析模型服务地址，请检查 Base URL 和网络。");
  } finally { if (timer) clearTimeout(timer); }
  if (!addresses.length || addresses.some(item => !isPublicModelAddress(item.address) || isIP(item.address) !== item.family)) {
    throw new ConnectionConfigurationError("MODEL_ENDPOINT_BLOCKED", "模型服务地址解析到了本机、局域网或保留地址，已阻止发送密钥。");
  }
  return addresses[0]!;
}

// Resolve once per analysis and pin the vetted address for every stage. HTTPS
// still verifies the original hostname; redirects and proxy environment variables
// cannot send this request/credential to a second destination.
export function pinnedModelFetch(endpoint: string, address: ModelAddress, requestImpl: typeof httpsRequest = httpsRequest): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== endpoint || init?.method !== "POST" || typeof init.body !== "string") throw new Error("MODEL_DESTINATION_CHANGED");
    const url = new URL(endpoint);
    return new Promise<Response>((resolve, reject) => {
      const req = requestImpl(url, {
        method: "POST", agent: false, family: address.family,
        lookup: (_host, _options, callback) => callback(null, address.address, address.family),
        headers: Object.fromEntries(new Headers(init.headers)),
        signal: init.signal ?? undefined,
      }, response => {
        const status = response.statusCode ?? 502;
        if (status < 200 || status >= 300) {
          response.destroy();
          resolve(new Response(null, { status }));
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) { req.destroy(new Error("MODEL_RESPONSE_TOO_LARGE")); return; }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status })));
      });
      req.on("error", reject);
      req.end(init.body);
    });
  }) as typeof fetch;
}

export function customModelEndpoint(config: CustomConnection): string {
  const base = config.baseUrl.replace(/\/$/, "");
  return config.apiFormat === "openai-chat" ? `${base}/chat/completions`
    : `${base}${new URL(base).pathname === "/" || new URL(base).pathname === "" ? "/v1" : ""}/messages`;
}

export function createCustomModelProvider(config: CustomConnection, apiKey: string, fetchImpl: typeof fetch): OpenAICompatibleProvider {
  const endpoint = customModelEndpoint(config);
  return new OpenAICompatibleProvider({
    baseUrl: endpoint.replace(/\/(?:chat\/completions|messages)$/, ""), model: config.model,
    apiFormat: config.apiFormat, jsonMode: config.jsonMode, tokenParameter: config.tokenParameter,
    apiKeyEnvName: "CUSTOM_MODEL_KEY", environment: { CUSTOM_MODEL_KEY: apiKey }, fetch: fetchImpl,
    providerMetadata: { id: `custom-${config.apiFormat}`, displayName: config.name, networkHost: new URL(config.baseUrl).host },
    responseFormat: "json_object", timeoutMs: 180_000,
    tokenLimits: { contextTokens: 128_000, maxOutputTokens: 8_192 }, maxRetries: 0,
  });
}
