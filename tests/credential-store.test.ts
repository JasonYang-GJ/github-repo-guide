import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CredentialStoreError,
  FileCredentialStore,
  WindowsDpapiProtector,
  replaceCredentialFile,
  type CredentialProtector,
} from "../src/security/credential-store.js";

class TestProtector implements CredentialProtector {
  public async protect(value: string): Promise<string> {
    return Buffer.from(`protected:${value}`, "utf8").toString("base64");
  }

  public async unprotect(value: string): Promise<string> {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (!decoded.startsWith("protected:")) throw new Error("invalid ciphertext");
    return decoded.slice("protected:".length);
  }
}

const binding = { baseUrl: "https://models.example.com/v1", apiFormat: "openai-chat" as const };

test("credential store persists only protected ciphertext and resolves it for the bound destination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "repo-credential-store-"));
  const file = join(directory, "credentials.v1.json");
  const now = () => new Date("2026-09-16T08:00:00.000Z");
  const store = new FileCredentialStore(file, new TestProtector(), now);

  const summary = await store.put("provider-one", binding, "sk-test-super-secret-1234");
  assert.deepEqual(summary, { providerId: "provider-one", lastFour: "1234", updatedAt: "2026-09-16T08:00:00.000Z" });
  const raw = await readFile(file, "utf8");
  assert.doesNotMatch(raw, /sk-test-super-secret-1234/);
  assert.doesNotMatch(raw, /models\.example\.com/);

  const reopened = new FileCredentialStore(file, new TestProtector(), now);
  assert.equal(await reopened.resolve("provider-one", binding), "sk-test-super-secret-1234");
  assert.deepEqual(await reopened.list(), [summary]);
});

test("credential store rejects a changed destination, replaces records and deletes them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "repo-credential-binding-"));
  const file = join(directory, "credentials.v1.json");
  const store = new FileCredentialStore(file, new TestProtector());
  await store.put("provider-one", binding, "first-key-1111");
  await assert.rejects(
    store.resolve("provider-one", { ...binding, baseUrl: "https://other.example.com/v1" }),
    (error: unknown) => error instanceof CredentialStoreError && error.code === "CREDENTIAL_DESTINATION_MISMATCH",
  );
  await store.put("provider-one", binding, "second-key-2222");
  assert.equal(await store.resolve("provider-one", binding), "second-key-2222");
  assert.equal((await store.list()).length, 1);
  assert.equal(await store.delete("provider-one"), true);
  assert.equal(await store.resolve("provider-one", binding), undefined);
  assert.equal(await store.delete("provider-one"), false);
});

test("credential store fails closed without overwriting corrupted data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "repo-credential-corrupt-"));
  const file = join(directory, "credentials.v1.json");
  const corrupt = "{not-json";
  await writeFile(file, corrupt, "utf8");
  const store = new FileCredentialStore(file, new TestProtector());
  await assert.rejects(
    store.put("provider-one", binding, "must-not-be-written"),
    (error: unknown) => error instanceof CredentialStoreError && error.code === "CREDENTIAL_STORE_INVALID",
  );
  assert.equal(await readFile(file, "utf8"), corrupt);
});

test("credential file replacement falls back safely when Windows reports EXDEV", async () => {
  const calls: string[] = [];
  const crossDevice = Object.assign(new Error("cross-device link"), { code: "EXDEV" });
  await replaceCredentialFile("temporary", "target", {
    rename: async () => { calls.push("rename"); throw crossDevice; },
    copyFile: async () => { calls.push("copy"); },
    unlink: async () => { calls.push("unlink"); },
  });
  assert.deepEqual(calls, ["rename", "copy", "unlink"]);

  await assert.rejects(replaceCredentialFile("temporary", "target", {
    rename: async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); },
    copyFile: async () => assert.fail("must not copy after a non-EXDEV failure"),
    unlink: async () => undefined,
  }), /denied/);
});

test("Windows DPAPI protector round-trips without returning plaintext ciphertext", { skip: process.platform !== "win32" }, async () => {
  const protector = new WindowsDpapiProtector();
  const secret = `dpapi-probe-${Date.now()}-secret`;
  const ciphertext = await protector.protect(secret);
  assert.notEqual(ciphertext, secret);
  assert.doesNotMatch(ciphertext, new RegExp(secret));
  assert.equal(await protector.unprotect(ciphertext), secret);
});
