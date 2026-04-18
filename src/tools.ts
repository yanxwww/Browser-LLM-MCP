import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BrowserLlmError, serializeError } from "./errors.js";
import { inlineLocalFilesIntoPrompt, maxInlinePromptFiles } from "./prompt/inlineLocalFiles.js";
import type { ProviderAdapter } from "./providers/ProviderAdapter.js";
import { SessionStore } from "./sessions/SessionStore.js";
import { providerIds } from "./types.js";

const providerSchema = z.enum(providerIds);
const defaultProviderSchema = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) {
    return "chatgpt";
  }

  return value;
}, providerSchema);

const optionalProviderValueSchema = z.preprocess((value) => {
  if (value === "" || value === null) {
    return undefined;
  }

  return value;
}, providerSchema.optional());

const askSchema = z.object({
  provider: defaultProviderSchema,
  sessionId: z.string().min(1).max(256),
  prompt: z.string().min(1),
  filePaths: z.array(z.string().min(1)).max(maxInlinePromptFiles).optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional()
});

const providerOnlySchema = z.object({
  provider: defaultProviderSchema
});

const optionalProviderSchema = z.object({
  provider: optionalProviderValueSchema
});

export interface ProviderRegistryLike {
  listProviders(): ReturnType<ProviderAdapter["getInfo"]>[];
  get(provider: (typeof providerIds)[number]): ProviderAdapter;
  closeAll(): Promise<void>;
}

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export function createMcpServer(
  registry: ProviderRegistryLike,
  defaultTimeoutMs: number,
  sessionStore: SessionStore,
  progressHeartbeatMs = 10_000
): McpServer {
  const server = new McpServer({
    name: "browser-llm-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "browser_llm_list_providers",
    {
      title: "List Browser LLM Providers",
      description: "List enabled and planned browser LLM providers.",
      inputSchema: {}
    },
    async () => jsonResult({ providers: registry.listProviders() })
  );

  server.registerTool(
    "browser_llm_open_login",
    {
      title: "Open Browser Login",
      description: "Open the provider web app in a dedicated browser profile so the user can log in manually.",
      inputSchema: providerOnlySchema.shape
    },
    async (input) =>
      safeTool(async () => {
        const parsed = providerOnlySchema.parse(input);
        const status = await registry.get(parsed.provider).openLogin();
        return {
          status,
          message: "Complete login in the opened browser window, then call browser_llm_status."
        };
      })
  );

  server.registerTool(
    "browser_llm_status",
    {
      title: "Browser LLM Status",
      description: "Get browser, login, queue, and last-error status for one provider or all providers.",
      inputSchema: optionalProviderSchema.shape
    },
    async (input) =>
      safeTool(async () => {
        const parsed = optionalProviderSchema.parse(input);
        if (parsed.provider) {
          return { status: await registry.get(parsed.provider).getStatus() };
        }

        const statuses = await Promise.all(registry.listProviders().map((provider) => registry.get(provider.id).getStatus()));
        return { statuses };
      })
  );

  server.registerTool(
    "browser_llm_ask",
    {
      title: "Ask Browser LLM",
      description:
        "Ask a logged-in browser LLM web app and return the assistant answer. Pass a stable sessionId; existing sessions continue automatically, missing sessions start new conversations. Optional filePaths let Browser LLM MCP read local text files and inline them into the submitted prompt. Long-running asks emit MCP progress heartbeats when the client requests them.",
      inputSchema: askSchema.shape
    },
    async (input, extra) =>
      safeTool(async () => {
        const parsed = askSchema.parse(input);
        const preparedPrompt = await inlineLocalFilesIntoPrompt(parsed.prompt, parsed.filePaths);
        const adapter = registry.get(parsed.provider);
        const timeoutMs = parsed.timeoutMs ?? defaultTimeoutMs;
        let existingSession = await sessionStore.get(parsed.provider, parsed.sessionId);
        let recoveredMissingSession = false;

        let answer;
        try {
          answer = await withProgressHeartbeat(
            extra,
            {
              intervalMs: progressHeartbeatMs,
              initialMessage: `Browser LLM MCP is waiting for ${parsed.provider} to respond for session ${parsed.sessionId}.`,
              heartbeatMessage: (elapsedSeconds) =>
                `Still waiting for ${parsed.provider} to finish responding (${elapsedSeconds}s elapsed).`
            },
            () =>
              adapter.ask(preparedPrompt.prompt, {
                conversation: existingSession ? "continue" : "new",
                timeoutMs,
                sessionId: parsed.sessionId,
                ...(existingSession ? { conversationUrl: existingSession.url } : {})
              })
          );
        } catch (error) {
          if (!existingSession || !isSessionNotFoundError(error)) {
            throw error;
          }

          await sessionStore.remove(parsed.provider, parsed.sessionId);
          existingSession = undefined;
          recoveredMissingSession = true;
          await emitProgress(extra, 2, `Stored ${parsed.provider} conversation was unavailable; retrying with a new conversation.`);
          answer = await withProgressHeartbeat(
            extra,
            {
              intervalMs: progressHeartbeatMs,
              initialMessage: `Retrying ${parsed.provider} with a fresh conversation for session ${parsed.sessionId}.`,
              heartbeatMessage: (elapsedSeconds) =>
                `Retrying with a new ${parsed.provider} conversation (${elapsedSeconds}s elapsed).`,
              startingProgress: 3
            },
            () =>
              adapter.ask(preparedPrompt.prompt, {
                conversation: "new",
                timeoutMs,
                sessionId: parsed.sessionId
              })
          );
        }

        if (isProviderConversationUrl(parsed.provider, answer.providerConversationUrl)) {
          await sessionStore.upsert(parsed.provider, parsed.sessionId, answer.providerConversationUrl);
        } else {
          answer.warnings.push(
            "Provider did not expose a stable conversation URL, so this sessionId mapping was not updated."
          );
        }

        if (recoveredMissingSession) {
          answer.warnings.push(
            "Stored provider conversation URL was unavailable, so a new provider conversation was started and this sessionId mapping was refreshed."
          );
        } else if (!existingSession) {
          answer.warnings.push("No stored browser conversation existed for this sessionId, so a new one was started.");
        }

        if (preparedPrompt.files.length > 0) {
          answer.warnings.push(
            `Browser LLM MCP inlined ${preparedPrompt.files.length} local file(s) into the submitted prompt.`
          );
        }

        return { answer };
      })
  );

  server.registerTool(
    "browser_llm_close",
    {
      title: "Close Browser LLM",
      description: "Close browser contexts without deleting dedicated provider profiles.",
      inputSchema: optionalProviderSchema.shape
    },
    async (input) =>
      safeTool(async () => {
        const parsed = optionalProviderSchema.parse(input);
        if (parsed.provider) {
          return { status: await registry.get(parsed.provider).close() };
        }

        await registry.closeAll();
        return { closed: true };
      })
  );

  return server;
}

export function jsonResult(payload: unknown, isError = false) {
  const body = payload && typeof payload === "object" ? payload : { value: payload };

  return {
    ...(isError ? { isError: true } : {}),
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ ok: !isError, ...body }, null, 2)
      }
    ]
  };
}

async function safeTool<T>(operation: () => Promise<T>) {
  try {
    return jsonResult(await operation());
  } catch (error) {
    return jsonResult({ error: serializeError(error) }, true);
  }
}

function isProviderConversationUrl(provider: (typeof providerIds)[number], url: string): boolean {
  try {
    const parsed = new URL(url);
    if (provider === "chatgpt") {
      return /^\/c\/[^/]+\/?$/.test(parsed.pathname);
    }

    return true;
  } catch {
    return false;
  }
}

function isSessionNotFoundError(error: unknown): boolean {
  return error instanceof BrowserLlmError && error.code === "SESSION_NOT_FOUND";
}

async function withProgressHeartbeat<T>(
  extra: ToolExtra,
  options: {
    intervalMs: number;
    initialMessage: string;
    heartbeatMessage: (elapsedSeconds: number) => string;
    startingProgress?: number;
  },
  operation: () => Promise<T>
): Promise<T> {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) {
    return operation();
  }

  const startedAt = Date.now();
  let progress = options.startingProgress ?? 1;
  await emitProgress(extra, progress, options.initialMessage);

  const interval = setInterval(() => {
    if (extra.signal.aborted) {
      return;
    }

    progress += 1;
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    void emitProgress(extra, progress, options.heartbeatMessage(elapsedSeconds));
  }, options.intervalMs);

  interval.unref?.();

  try {
    return await operation();
  } finally {
    clearInterval(interval);
  }
}

async function emitProgress(extra: ToolExtra, progress: number, message: string): Promise<void> {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) {
    return;
  }

  await extra
    .sendNotification({
      method: "notifications/progress",
      params: {
        progressToken,
        progress,
        message
      }
    })
    .catch(() => undefined);
}
