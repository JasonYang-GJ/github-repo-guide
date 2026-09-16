import { resolve } from "node:path";

import { createPlatformCredentialStore } from "../security/credential-store.js";
import { createWebServer } from "./server.js";

function parsePort(value: string | undefined): number {
  if (value === undefined) return 4173;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

const host = "127.0.0.1";
const port = parsePort(process.env.PORT);
const server = createWebServer({
  assetRoot: resolve(process.cwd(), "web"),
  outputRoot: resolve(process.cwd(), "output", "web"),
  schemaDirectory: resolve(process.cwd(), "schemas"),
  allowEnvironmentCredentials: true,
  credentialStore: createPlatformCredentialStore(),
});

server.listen(port, host, () => {
  console.log(`Repository Artifact Core V0.2: http://${host}:${port}`);
  console.log("Default provider: deterministic-v1 (paid model providers require explicit opt-in)");
  console.log("Credentials: API keys can be protected for the current Windows user with DPAPI");
});

function stop(): void {
  server.close((error) => {
    if (error !== undefined) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
