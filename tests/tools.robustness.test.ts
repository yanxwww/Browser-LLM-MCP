import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserLlmError } from "../src/errors.js";
import type { ProviderAdapter } from "../src/providers/ProviderAdapter.js";
import { SessionStore } from "../src/sessions/SessionStore.js";
import { createMcpServer, type ProviderRegistryLike } from "../src/tools.js";
import type { AskOptions, AskResult, LoginState, ProviderId, ProviderInfo, ProviderStatus } from "../src/types.js";

describe("MCP tool robustness", () => {
  let client: Client;
  let server: McpServer;

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  });

  beforeEach(() => {
    client = undefined as unknown as Client;
    server = undefined as unknown as McpServer;
  });

  it("returns provider-disabled as a structured tool error without crashing the server", async () => {
    const registry = new FakeRegistry([
      new FakeProvider("chatgpt", "enabled"),
      new DisabledProvider("kimi")
    ]);
    await connect(registry);

    const result = await client.callTool({
      name: "browser_llm_ask",
      arguments: {
        provider: "kimi",
        prompt: "hello",
        sessionId: "agent-session-a"
      }
    });

    expect(result.isError).toBe(true);
    expect(readJson(result)).toMatchObject({
      ok: false,
      error: {
        code: "PROVIDER_DISABLED"
      }
    });

    const status = await client.callTool({
      name: "browser_llm_status",
      arguments: {
        provider: "chatgpt"
      }
    });
    expect(readJson(status)).toMatchObject({
      ok: true,
      status: {
        id: "chatgpt"
      }
    });
  });

  it("uses sessionId to continue the stored provider conversation URL", async () => {
    const provider = new FakeProvider("chatgpt", "enabled");
    const store = await createTempSessionStore();
    await store.upsert("chatgpt", "agent-session-b", "https://chatgpt.example/c/existing");
    await connect(new FakeRegistry([provider]), store);

    const result = await client.callTool({
      name: "browser_llm_ask",
      arguments: {
        provider: "chatgpt",
        prompt: "follow up",
        sessionId: "agent-session-b"
      }
    });

    expect(readJson(result)).toMatchObject({
      ok: true,
      answer: {
        answer: "fake answer for follow up",
        providerConversationUrl: "https://chatgpt.example/c/continued-1",
        sessionId: "agent-session-b",
        conversationMode: "continue"
      }
    });
    expect(provider.calls[0]).toMatchObject({
      prompt: "follow up",
      options: {
        conversation: "continue",
        conversationUrl: "https://chatgpt.example/c/existing",
        sessionId: "agent-session-b"
      }
    });
    await expect(store.get("chatgpt", "agent-session-b")).resolves.toMatchObject({
      url: "https://chatgpt.example/c/continued-1"
    });
  });

  it("replaces a stored session mapping when the provider says the old URL is unavailable", async () => {
    const provider = new MissingStoredSessionProvider("chatgpt");
    const store = await createTempSessionStore();
    await store.upsert("chatgpt", "swapped-account-session", "https://chatgpt.example/c/old-account");
    await connect(new FakeRegistry([provider]), store);

    const result = await client.callTool({
      name: "browser_llm_ask",
      arguments: {
        provider: "chatgpt",
        prompt: "continue after account switch",
        sessionId: "swapped-account-session"
      }
    });

    expect(readJson(result)).toMatchObject({
      ok: true,
      answer: {
        answer: "recovered answer for continue after account switch",
        providerConversationUrl: "https://chatgpt.example/c/recovered-1",
        sessionId: "swapped-account-session",
        conversationMode: "new",
        warnings: [
          "Stored provider conversation URL was unavailable, so a new provider conversation was started and this sessionId mapping was refreshed."
        ]
      }
    });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]).toMatchObject({
      prompt: "continue after account switch",
      options: {
        conversation: "continue",
        conversationUrl: "https://chatgpt.example/c/old-account",
        sessionId: "swapped-account-session"
      }
    });
    expect(provider.calls[1]).toMatchObject({
      prompt: "continue after account switch",
      options: {
        conversation: "new",
        sessionId: "swapped-account-session"
      }
    });
    await expect(store.get("chatgpt", "swapped-account-session")).resolves.toMatchObject({
      url: "https://chatgpt.example/c/recovered-1"
    });
  });

  it("uses sessionId alone to create first and continue later conversations", async () => {
    const provider = new FakeProvider("chatgpt", "enabled");
    const store = await createTempSessionStore();
    await connect(new FakeRegistry([provider]), store);

    await client.callTool({
      name: "browser_llm_ask",
      arguments: {
        provider: "chatgpt",
        prompt: "first",
        sessionId: "session-driven"
      }
    });

    await client.callTool({
      name: "browser_llm_ask",
      arguments: {
        provider: "chatgpt",
        prompt: "second",
        sessionId: "session-driven"
      }
    });

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]).toMatchObject({
      prompt: "first",
      options: {
        conversation: "new",
        sessionId: "session-driven"
      }
    });
    expect(provider.calls[1]).toMatchObject({
      prompt: "second",
      options: {
        conversation: "continue",
        conversationUrl: "https://chatgpt.example/c/continued-1",
        sessionId: "session-driven"
      }
    });
  });

  it("inlines local markdown and json files into the submitted provider prompt", async () => {
    const provider = new FakeProvider("chatgpt", "enabled");
    const store = await createTempSessionStore();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-llm-inline-"));
    const jsonPath = path.join(tmpDir, "report.json");
    const mdPath = path.join(tmpDir, "notes.md");
    await fs.writeFile(jsonPath, '{\n  "level": "error",\n  "count": 3\n}\n', "utf8");
    await fs.writeFile(mdPath, "# Incident\n\nService restart required.\n", "utf8");
    await connect(new FakeRegistry([provider]), store);

    const result = await client.callTool({
      name: "browser_llm_ask",
      arguments: {
        provider: "chatgpt",
        prompt: "Analyze these files and summarize the issue.",
        sessionId: "inline-files-session",
        filePaths: [jsonPath, mdPath]
      }
    });

    const payload = readJson(result);
    expect(payload).toMatchObject({
      ok: true,
      answer: {
        warnings: expect.arrayContaining(["Browser LLM MCP inlined 2 local file(s) into the submitted prompt."])
      }
    });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.prompt).toContain("Analyze these files and summarize the issue.");
    expect(provider.calls[0]?.prompt).toContain(`===== BEGIN LOCAL FILE 1: ${jsonPath} (json) =====`);
    expect(provider.calls[0]?.prompt).toContain('"count": 3');
    expect(provider.calls[0]?.prompt).toContain(`===== BEGIN LOCAL FILE 2: ${mdPath} (markdown) =====`);
    expect(provider.calls[0]?.prompt).toContain("Service restart required.");
  });

  it("defaults blank provider values to ChatGPT for provider-required tools", async () => {
    const provider = new FakeProvider("chatgpt", "enabled");
    await connect(new FakeRegistry([provider]));

    const login = await client.callTool({
      name: "browser_llm_open_login",
      arguments: {
        provider: ""
      }
    });
    expect(readJson(login)).toMatchObject({
      ok: true,
      status: {
        id: "chatgpt"
      }
    });

    const ask = await client.callTool({
      name: "browser_llm_ask",
      arguments: {
        provider: "",
        prompt: "blank provider",
        sessionId: "blank-provider-session"
      }
    });
    expect(readJson(ask)).toMatchObject({
      ok: true,
      answer: {
        provider: "chatgpt",
        answer: "fake answer for blank provider"
      }
    });
    expect(provider.calls[0]).toMatchObject({
      prompt: "blank provider",
      options: {
        conversation: "new"
      }
    });
  });

  it("starts a new provider conversation when a sessionId has no stored URL", async () => {
    const provider = new FakeProvider("chatgpt", "enabled");
    const store = await createTempSessionStore();
    await connect(new FakeRegistry([provider]), store);

    const result = await client.callTool({
      name: "browser_llm_ask",
      arguments: {
        provider: "chatgpt",
        prompt: "first question",
        sessionId: "new-agent-session"
      }
    });

    expect(readJson(result)).toMatchObject({
      ok: true,
      answer: {
        answer: "fake answer for first question",
        conversationMode: "new",
        warnings: ["No stored browser conversation existed for this sessionId, so a new one was started."]
      }
    });
    expect(provider.calls[0]).toMatchObject({
      options: {
        conversation: "new",
        sessionId: "new-agent-session"
      }
    });
    await expect(store.get("chatgpt", "new-agent-session")).resolves.toMatchObject({
      url: "https://chatgpt.example/c/continued-1"
    });
  });

  it("emits progress heartbeats for long-running asks so clients can reset request timeouts", async () => {
    const provider = new SlowProvider("chatgpt", 220);
    await connect(new FakeRegistry([provider]), undefined, {
      defaultTimeoutMs: 1_000,
      progressHeartbeatMs: 25
    });

    const progressMessages: string[] = [];
    const result = await client.callTool(
      {
        name: "browser_llm_ask",
        arguments: {
          provider: "chatgpt",
          prompt: "slow prompt",
          sessionId: "slow-session",
          timeoutMs: 1_000
        }
      },
      undefined,
      {
        timeout: 70,
        resetTimeoutOnProgress: true,
        maxTotalTimeout: 1_000,
        onprogress: (progress) => {
          progressMessages.push(progress.message ?? "");
        }
      }
    );

    expect(readJson(result)).toMatchObject({
      ok: true,
      answer: {
        answer: "fake answer for slow prompt"
      }
    });
    expect(progressMessages.length).toBeGreaterThanOrEqual(2);
    expect(progressMessages[0]).toContain("waiting for chatgpt");
    expect(progressMessages.some((message) => message.includes("Still waiting for chatgpt"))).toBe(true);
  });

  it("does not store unstable provider URLs as session mappings", async () => {
    const provider = new UnstableUrlProvider("chatgpt");
    const store = await createTempSessionStore();
    await connect(new FakeRegistry([provider]), store);

    const result = await client.callTool({
      name: "browser_llm_ask",
      arguments: {
        provider: "chatgpt",
        prompt: "first question",
        sessionId: "unstable-session"
      }
    });

    expect(readJson(result)).toMatchObject({
      ok: true,
      answer: {
        warnings: [
          "Provider did not expose a stable conversation URL, so this sessionId mapping was not updated.",
          "No stored browser conversation existed for this sessionId, so a new one was started."
        ]
      }
    });
    await expect(store.get("chatgpt", "unstable-session")).resolves.toBeUndefined();
  });

  it("requires sessionId before provider execution", async () => {
    const provider = new FakeProvider("chatgpt", "enabled");
    await connect(new FakeRegistry([provider]));

    const result = await client.callTool({
      name: "browser_llm_ask",
      arguments: {
        provider: "chatgpt",
        prompt: "must not submit"
      }
    });

    expect(result.isError).toBe(true);
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects malformed ask input before provider execution", async () => {
    const provider = new FakeProvider("chatgpt", "enabled");
    await connect(new FakeRegistry([provider]));

    const result = await client.callTool({
      name: "browser_llm_ask",
      arguments: {
        provider: "chatgpt",
        prompt: "",
        sessionId: "malformed-session"
      }
    });

    expect(result.isError).toBe(true);
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects unsupported file extensions before provider execution", async () => {
    const provider = new FakeProvider("chatgpt", "enabled");
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-llm-inline-bad-"));
    const csvPath = path.join(tmpDir, "report.csv");
    await fs.writeFile(csvPath, "a,b\n1,2\n", "utf8");
    await connect(new FakeRegistry([provider]));

    const result = await client.callTool({
      name: "browser_llm_ask",
      arguments: {
        provider: "chatgpt",
        prompt: "Analyze this file",
        sessionId: "bad-inline-file",
        filePaths: [csvPath]
      }
    });

    expect(result.isError).toBe(true);
    expect(readJson(result)).toMatchObject({
      ok: false,
      error: {
        code: "FILE_UNSUPPORTED"
      }
    });
    expect(provider.calls).toHaveLength(0);
  });

  async function connect(
    registry: ProviderRegistryLike,
    store?: SessionStore,
    options?: { defaultTimeoutMs?: number; progressHeartbeatMs?: number }
  ): Promise<void> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createMcpServer(
      registry,
      options?.defaultTimeoutMs ?? 1_000,
      store ?? (await createTempSessionStore()),
      options?.progressHeartbeatMs ?? 10_000
    );
    client = new Client({
      name: "browser-llm-mcp-test-client",
      version: "0.1.0"
    });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }
});

class FakeRegistry implements ProviderRegistryLike {
  private readonly providers = new Map<ProviderId, ProviderAdapter>();

  constructor(providers: ProviderAdapter[]) {
    for (const provider of providers) {
      this.providers.set(provider.id, provider);
    }
  }

  listProviders(): ProviderInfo[] {
    return [...this.providers.values()].map((provider) => provider.getInfo());
  }

  get(provider: ProviderId): ProviderAdapter {
    const adapter = this.providers.get(provider);
    if (!adapter) {
      throw new BrowserLlmError("PROVIDER_UNSUPPORTED", `Unsupported provider: ${provider}`);
    }

    return adapter;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.providers.values()].map((provider) => provider.close()));
  }
}

class FakeProvider implements ProviderAdapter {
  readonly displayName = "Fake ChatGPT";
  readonly homepage = "https://chatgpt.example/";
  readonly calls: Array<{ prompt: string; options: AskOptions }> = [];
  private count = 0;

  constructor(
    readonly id: ProviderId,
    private readonly availability: ProviderInfo["availability"]
  ) {}

  getInfo(): ProviderInfo {
    return {
      id: this.id,
      displayName: this.displayName,
      availability: this.availability,
      implemented: this.availability === "enabled",
      profilePath: `/tmp/browser-llm/${this.id}`,
      homepage: this.homepage
    };
  }

  async openLogin(): Promise<ProviderStatus> {
    return this.getStatus();
  }

  async getStatus(): Promise<ProviderStatus> {
    return {
      ...this.getInfo(),
      browserRunning: false,
      loginState: "unknown",
      queueDepth: 0,
      busy: false
    };
  }

  async ask(prompt: string, options: AskOptions): Promise<AskResult> {
    this.calls.push({ prompt, options });
    this.count += 1;
    return {
      provider: this.id,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      answer: `fake answer for ${prompt}`,
      rawText: `fake answer for ${prompt}`,
      url: `https://chatgpt.example/c/continued-${this.count}`,
      providerConversationUrl: `https://chatgpt.example/c/continued-${this.count}`,
      elapsedMs: 1,
      conversationMode: options.conversation,
      warnings: []
    };
  }

  async close(): Promise<ProviderStatus> {
    return this.getStatus();
  }

  async detectLoginState(): Promise<LoginState> {
    return "unknown";
  }
}

class DisabledProvider extends FakeProvider {
  constructor(id: ProviderId) {
    super(id, "planned");
  }

  override async ask(_prompt: string, _options: AskOptions): Promise<AskResult> {
    throw new BrowserLlmError("PROVIDER_DISABLED", `${this.id} is planned but not implemented.`);
  }
}

class MissingStoredSessionProvider extends FakeProvider {
  private recoveredCount = 0;

  constructor(id: ProviderId) {
    super(id, "enabled");
  }

  override async ask(prompt: string, options: AskOptions): Promise<AskResult> {
    this.calls.push({ prompt, options });
    if (options.conversation === "continue") {
      throw new BrowserLlmError("SESSION_NOT_FOUND", "Stored provider conversation URL did not load.");
    }

    this.recoveredCount += 1;
    return {
      provider: this.id,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      answer: `recovered answer for ${prompt}`,
      rawText: `recovered answer for ${prompt}`,
      url: `https://chatgpt.example/c/recovered-${this.recoveredCount}`,
      providerConversationUrl: `https://chatgpt.example/c/recovered-${this.recoveredCount}`,
      elapsedMs: 1,
      conversationMode: options.conversation,
      warnings: []
    };
  }
}

class UnstableUrlProvider extends FakeProvider {
  constructor(id: ProviderId) {
    super(id, "enabled");
  }

  override async ask(prompt: string, options: AskOptions): Promise<AskResult> {
    this.calls.push({ prompt, options });
    return {
      provider: this.id,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      answer: `fake answer for ${prompt}`,
      rawText: `fake answer for ${prompt}`,
      url: "https://chatgpt.example/",
      providerConversationUrl: "https://chatgpt.example/",
      elapsedMs: 1,
      conversationMode: options.conversation,
      warnings: []
    };
  }
}

class SlowProvider extends FakeProvider {
  constructor(id: ProviderId, private readonly delayMs: number) {
    super(id, "enabled");
  }

  override async ask(prompt: string, options: AskOptions): Promise<AskResult> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return super.ask(prompt, options);
  }
}

async function createTempSessionStore(): Promise<SessionStore> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-llm-tool-"));
  return new SessionStore(path.join(tmpDir, "sessions.json"));
}

function readJson(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("Tool result did not contain text content.");
  }

  return JSON.parse(text) as Record<string, unknown>;
}
