#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createProviderRegistry } from "./providers/ProviderRegistry.js";
import { SessionStore } from "./sessions/SessionStore.js";
import { createMcpServer } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const registry = createProviderRegistry(config);
  const sessionStore = new SessionStore(config.sessionsPath);
  const server = createMcpServer(registry, config.defaultTimeoutMs, sessionStore, config.progressHeartbeatMs);

  const shutdown = async () => {
    await registry.closeAll().catch((error) => {
      console.error("[browser-llm-mcp] failed to close providers", error);
    });
  };

  process.on("SIGINT", () => {
    shutdown().finally(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    shutdown().finally(() => process.exit(0));
  });

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("[browser-llm-mcp] fatal", error);
  process.exit(1);
});
