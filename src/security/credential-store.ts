import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PROVIDER_ID = /^[A-Za-z0-9-]{1,80}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_RECORDS = 20;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_CIPHERTEXT_LENGTH = 16 * 1024;
const ENTROPY = "github-repo-guide/credential-store/v1";

export interface CredentialBinding {
  readonly baseUrl: string;
  readonly apiFormat: "openai-chat" | "anthropic-messages";
}

export interface CredentialSummary {
  readonly providerId: string;
  readonly lastFour: string;
  readonly updatedAt: string;
}

export interface CredentialStore {
  readonly kind: "request_only" | "windows_dpapi_current_user";
  list(): Promise<readonly CredentialSummary[]>;
  put(providerId: string, binding: CredentialBinding, apiKey: string): Promise<CredentialSummary>;
  delete(providerId: string): Promise<boolean>;
  resolve(providerId: string, binding: CredentialBinding): Promise<string | undefined>;
}

export interface CredentialProtector {
  protect(value: string): Promise<string>;
  unprotect(value: string): Promise<string>;
}

interface StoredCredential extends CredentialSummary {
  readonly bindingDigest: string;
  readonly ciphertext: string;
}

interface StoreFile {
  readonly version: 1;
  readonly records: readonly StoredCredential[];
}

interface CredentialFileOperations {
  readonly rename: typeof rename;
  readonly copyFile: typeof copyFile;
  readonly unlink: typeof unlink;
}

const defaultFileOperations: CredentialFileOperations = { rename, copyFile, unlink };

export async function replaceCredentialFile(
  temporary: string,
  target: string,
  operations: CredentialFileOperations = defaultFileOperations,
): Promise<void> {
  try {
    await operations.rename(temporary, target);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EXDEV")) throw error;
    await operations.copyFile(temporary, target);
    await operations.unlink(temporary).catch(() => undefined);
  }
}

export class CredentialStoreError extends Error {
  public constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredentialStoreError";
  }
}

function validProviderId(value: string): string {
  if (!PROVIDER_ID.test(value)) throw new CredentialStoreError("CREDENTIAL_ID_INVALID", "密钥记录标识无效。");
  return value;
}

function bindingDigest(binding: CredentialBinding): string {
  return createHash("sha256").update(`${binding.apiFormat}\n${binding.baseUrl}`).digest("hex");
}

function credentialSummary(record: StoredCredential): CredentialSummary {
  return { providerId: record.providerId, lastFour: record.lastFour, updatedAt: record.updatedAt };
}

function parseRecord(value: unknown): StoredCredential {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CredentialStoreError("CREDENTIAL_STORE_INVALID", "本机密钥存储内容损坏，未作覆盖。");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.providerId !== "string" || !PROVIDER_ID.test(record.providerId) ||
    typeof record.bindingDigest !== "string" || !DIGEST.test(record.bindingDigest) ||
    typeof record.ciphertext !== "string" || record.ciphertext.length < 1 || record.ciphertext.length > MAX_CIPHERTEXT_LENGTH ||
    typeof record.lastFour !== "string" || record.lastFour.length > 4 || /[\u0000-\u001f\u007f]/.test(record.lastFour) ||
    typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))
  ) {
    throw new CredentialStoreError("CREDENTIAL_STORE_INVALID", "本机密钥存储内容损坏，未作覆盖。");
  }
  return {
    providerId: record.providerId,
    bindingDigest: record.bindingDigest,
    ciphertext: record.ciphertext,
    lastFour: record.lastFour,
    updatedAt: record.updatedAt,
  };
}

export class DisabledCredentialStore implements CredentialStore {
  public readonly kind = "request_only" as const;
  public async list(): Promise<readonly CredentialSummary[]> { return []; }
  public async put(): Promise<CredentialSummary> {
    throw new CredentialStoreError("CREDENTIAL_STORAGE_UNAVAILABLE", "当前系统不支持安全保存 API 密钥。");
  }
  public async delete(): Promise<boolean> { return false; }
  public async resolve(): Promise<string | undefined> { return undefined; }
}

export class FileCredentialStore implements CredentialStore {
  public readonly kind = "windows_dpapi_current_user" as const;

  public constructor(
    private readonly filePath: string,
    private readonly protector: CredentialProtector,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async read(): Promise<StoreFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return { version: 1, records: [] };
      throw new CredentialStoreError("CREDENTIAL_STORE_READ_FAILED", "无法读取本机密钥记录。", { cause: error });
    }
    if (Buffer.byteLength(raw) > MAX_FILE_BYTES) {
      throw new CredentialStoreError("CREDENTIAL_STORE_INVALID", "本机密钥存储内容异常，未作覆盖。");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new CredentialStoreError("CREDENTIAL_STORE_INVALID", "本机密钥存储内容损坏，未作覆盖。"); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new CredentialStoreError("CREDENTIAL_STORE_INVALID", "本机密钥存储内容损坏，未作覆盖。");
    }
    const file = parsed as Record<string, unknown>;
    if (file.version !== 1 || !Array.isArray(file.records) || file.records.length > MAX_RECORDS) {
      throw new CredentialStoreError("CREDENTIAL_STORE_INVALID", "本机密钥存储内容损坏，未作覆盖。");
    }
    const records = file.records.map(parseRecord);
    if (new Set(records.map(record => record.providerId)).size !== records.length) {
      throw new CredentialStoreError("CREDENTIAL_STORE_INVALID", "本机密钥存储包含重复记录，未作覆盖。");
    }
    return { version: 1, records };
  }

  private async write(value: StoreFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await replaceCredentialFile(temporary, this.filePath);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw new CredentialStoreError("CREDENTIAL_STORE_WRITE_FAILED", "无法安全写入本机密钥记录。", { cause: error });
    }
  }

  public async list(): Promise<readonly CredentialSummary[]> {
    return (await this.read()).records.map(credentialSummary);
  }

  public async put(providerId: string, binding: CredentialBinding, apiKey: string): Promise<CredentialSummary> {
    validProviderId(providerId);
    if (!apiKey || apiKey.length > 1_024 || /[\u0000-\u001f\u007f]/.test(apiKey)) {
      throw new CredentialStoreError("CREDENTIAL_INVALID", "API Key 为空、过长或包含无效字符。");
    }
    const file = await this.read();
    const index = file.records.findIndex(record => record.providerId === providerId);
    if (index < 0 && file.records.length >= MAX_RECORDS) {
      throw new CredentialStoreError("CREDENTIAL_LIMIT", "最多保存 20 条 API 密钥记录。");
    }
    let ciphertext: string;
    try { ciphertext = await this.protector.protect(apiKey); }
    catch (error) { throw new CredentialStoreError("CREDENTIAL_ENCRYPTION_FAILED", "Windows 未能加密 API Key，密钥没有保存。", { cause: error }); }
    const record: StoredCredential = {
      providerId,
      bindingDigest: bindingDigest(binding),
      ciphertext,
      lastFour: apiKey.slice(-4),
      updatedAt: this.now().toISOString(),
    };
    const records = [...file.records];
    if (index < 0) records.push(record); else records[index] = record;
    await this.write({ version: 1, records });
    return credentialSummary(record);
  }

  public async delete(providerId: string): Promise<boolean> {
    validProviderId(providerId);
    const file = await this.read();
    const records = file.records.filter(record => record.providerId !== providerId);
    if (records.length === file.records.length) return false;
    await this.write({ version: 1, records });
    return true;
  }

  public async resolve(providerId: string, binding: CredentialBinding): Promise<string | undefined> {
    validProviderId(providerId);
    const record = (await this.read()).records.find(item => item.providerId === providerId);
    if (record === undefined) return undefined;
    if (record.bindingDigest !== bindingDigest(binding)) {
      throw new CredentialStoreError("CREDENTIAL_DESTINATION_MISMATCH", "供应商地址或接口格式已变化，请重新填写并保存对应的 API Key。");
    }
    try { return await this.protector.unprotect(record.ciphertext); }
    catch (error) { throw new CredentialStoreError("CREDENTIAL_DECRYPTION_FAILED", "Windows 无法解密这条 API Key，请删除记录后重新保存。", { cause: error }); }
  }
}

const protectScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Console]::In.ReadToEnd()
$bytes = [Convert]::FromBase64String($raw)
$entropy = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}')
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;

const unprotectScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Console]::In.ReadToEnd()
$bytes = [Convert]::FromBase64String($raw)
$entropy = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}')
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($plain))
`;

function runPowerShell(script: string, input: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("PowerShell timed out"));
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { if (stdout.length < 64 * 1024) stdout += String(chunk); });
    child.stderr.on("data", chunk => { if (stderr.length < 64 * 1024) stderr += String(chunk); });
    child.once("error", error => { clearTimeout(timer); rejectPromise(error); });
    child.once("close", code => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) resolvePromise(stdout.trim());
      else rejectPromise(new Error(stderr.trim() || `PowerShell exited with ${String(code)}`));
    });
    child.stdin.end(input);
  });
}

export class WindowsDpapiProtector implements CredentialProtector {
  public async protect(value: string): Promise<string> {
    const encoded = Buffer.from(value, "utf8").toString("base64");
    return runPowerShell(protectScript, encoded);
  }

  public async unprotect(value: string): Promise<string> {
    const encoded = await runPowerShell(unprotectScript, value);
    return Buffer.from(encoded, "base64").toString("utf8");
  }
}

export function createPlatformCredentialStore(environment: Readonly<Record<string, string | undefined>> = process.env): CredentialStore {
  if (process.platform !== "win32") return new DisabledCredentialStore();
  const localAppData = environment.LOCALAPPDATA?.trim() || join(homedir(), "AppData", "Local");
  return new FileCredentialStore(join(localAppData, "GitHubRepoGuide", "credentials.v1.json"), new WindowsDpapiProtector());
}
