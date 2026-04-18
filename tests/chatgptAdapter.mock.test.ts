import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserController } from "../src/browser/BrowserController.js";
import { ChatGptAdapter } from "../src/providers/chatgpt/ChatGptAdapter.js";
import { loadConfig } from "../src/config.js";

describe("ChatGptAdapter against a mock chat page", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");

      if (request.url?.startsWith("/login")) {
        response.end("<main><button>Log in</button><button>Sign up</button></main>");
        return;
      }

      if (request.url?.startsWith("/selector-drift")) {
        response.end("<main><h1>Chat ready</h1><div id='renamed-composer'></div></main>");
        return;
      }

      if (request.url?.startsWith("/timeout")) {
        response.end(`
          <main>
            <textarea id="prompt-textarea"></textarea>
            <button data-testid="send-button">Send</button>
            <section id="messages"></section>
            <script>
              document.querySelector("[data-testid='send-button']").addEventListener("click", () => {
                const textarea = document.querySelector("#prompt-textarea");
                const prompt = textarea.value;
                textarea.value = "";
                const user = document.createElement("div");
                user.setAttribute("data-message-author-role", "user");
                user.textContent = prompt;
                document.querySelector("#messages").appendChild(user);
              });
            </script>
          </main>
        `);
        return;
      }

      if (request.url?.startsWith("/normalized-composer")) {
        response.end(`
          <main>
            <textarea id="prompt-textarea"></textarea>
            <button data-testid="send-button">Send</button>
            <section id="messages"></section>
            <script>
              const textarea = document.querySelector("#prompt-textarea");
              const messages = document.querySelector("#messages");
              textarea.addEventListener("input", () => {
                textarea.value = textarea.value
                  .replace(/\\r\\n/g, "\\n")
                  .replace(/\\n{3,}/g, "\\n\\n")
                  .replace(/[ \\t]{2,}/g, " ");
              });

              document.querySelector("[data-testid='send-button']").addEventListener("click", () => {
                const prompt = textarea.value;
                textarea.value = "";
                history.pushState(null, "", "/c/normalized-composer");

                const user = document.createElement("div");
                user.setAttribute("data-message-author-role", "user");
                user.textContent = prompt;
                messages.appendChild(user);

                setTimeout(() => {
                  const message = document.createElement("div");
                  message.setAttribute("data-message-author-role", "assistant");
                  message.textContent = "Normalized answer: " + prompt;
                  messages.appendChild(message);
                }, 100);
              });
            </script>
          </main>
        `);
        return;
      }

      if (request.url?.startsWith("/detached-send-button")) {
        response.end(`
          <main>
            <textarea id="prompt-textarea"></textarea>
            <button data-testid="send-button" aria-label="Send prompt">Send</button>
            <section id="messages"></section>
            <script>
              const messages = document.querySelector("#messages");
              const textarea = document.querySelector("#prompt-textarea");
              let replacedOnce = false;

              const attachSubmit = (button) => {
                button.addEventListener("click", () => {
                  const prompt = textarea.value;
                  textarea.value = "";
                  history.pushState(null, "", "/c/detached-send-button");

                  const user = document.createElement("div");
                  user.setAttribute("data-message-author-role", "user");
                  user.textContent = prompt;
                  messages.appendChild(user);

                  setTimeout(() => {
                    const message = document.createElement("div");
                    message.setAttribute("data-message-author-role", "assistant");
                    message.textContent = "Detached button answer: " + prompt;
                    messages.appendChild(message);
                  }, 100);
                });
              };

              const originalButton = document.querySelector("[data-testid='send-button']");
              originalButton.addEventListener("pointerdown", (event) => {
                if (replacedOnce) {
                  return;
                }

                replacedOnce = true;
                const replacement = document.createElement("button");
                replacement.setAttribute("data-testid", "send-button");
                replacement.setAttribute("aria-label", "Send prompt");
                replacement.textContent = "Send";
                attachSubmit(replacement);
                originalButton.replaceWith(replacement);
                event.preventDefault();
              });
              attachSubmit(originalButton);
            </script>
          </main>
        `);
        return;
      }

      if (request.url?.startsWith("/delayed-history") || request.url?.startsWith("/c/delayed-history")) {
        response.end(`
          <main>
            <textarea id="prompt-textarea"></textarea>
            <button data-testid="send-button">Send</button>
            <section id="messages"></section>
            <script>
              const messages = document.querySelector("#messages");
              setTimeout(() => {
                const old = document.createElement("div");
                old.setAttribute("data-message-author-role", "assistant");
                old.textContent = "Old assistant answer";
                messages.appendChild(old);
              }, 700);

              document.querySelector("[data-testid='send-button']").addEventListener("click", () => {
                const textarea = document.querySelector("#prompt-textarea");
                const prompt = textarea.value;
                textarea.value = "";
                history.pushState(null, "", "/c/delayed-history");

                const user = document.createElement("div");
                user.setAttribute("data-message-author-role", "user");
                user.textContent = prompt;
                messages.appendChild(user);

                setTimeout(() => {
                  const message = document.createElement("div");
                  message.setAttribute("data-message-author-role", "assistant");
                  message.textContent = "New answer: " + prompt;
                  messages.appendChild(message);
                }, 100);
              });
            </script>
          </main>
        `);
        return;
      }

      if (request.url?.startsWith("/c/missing")) {
        response.end("<main><h1>Conversation not found</h1><p>You do not have access to this chat.</p></main>");
        return;
      }

      if (request.url?.startsWith("/c/missing-zh")) {
        response.end("<main><h1>无法加载到会话</h1><p>你无权访问此聊天。</p></main>");
        return;
      }

      if (request.url?.startsWith("/clear-without-submit")) {
        response.end(`
          <main>
            <textarea id="prompt-textarea"></textarea>
            <button data-testid="send-button">Send</button>
            <section id="messages"></section>
            <script>
              document.querySelector("[data-testid='send-button']").addEventListener("click", () => {
                const textarea = document.querySelector("#prompt-textarea");
                textarea.value = "";
              });
            </script>
          </main>
        `);
        return;
      }

      response.end(`
        <main>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button">Send</button>
          <section id="messages"></section>
          <script>
            document.querySelector("[data-testid='send-button']").addEventListener("click", () => {
              const textarea = document.querySelector("#prompt-textarea");
              const prompt = textarea.value;
              textarea.value = "";
              history.pushState(null, "", "/c/mock-new");
              const user = document.createElement("div");
              user.setAttribute("data-message-author-role", "user");
              user.textContent = prompt;
              document.querySelector("#messages").appendChild(user);
              setTimeout(() => {
                const message = document.createElement("div");
                message.setAttribute("data-message-author-role", "assistant");
                message.textContent = "Echo: " + prompt;
                document.querySelector("#messages").appendChild(message);
              }, 100);
            });
          </script>
        </main>
      `);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("submits a prompt and reads the latest assistant message", async () => {
    const adapter = await createAdapter(baseUrl);
    await adapter.openLogin();

    const result = await adapter.ask("hello", {
      conversation: "new",
      timeoutMs: 5_000
    });

    expect(result.answer).toBe("Echo: hello");
    expect(result.provider).toBe("chatgpt");
    await adapter.close();
  });

  it("does not mistake delayed old history for a new continued-session answer", async () => {
    const adapter = await createAdapter(baseUrl);

    const result = await adapter.ask("second prompt", {
      conversation: "continue",
      conversationUrl: `${baseUrl}c/delayed-history`,
      timeoutMs: 5_000
    });

    expect(result.answer).toBe("New answer: second prompt");
    expect(result.answer).not.toBe("Old assistant answer");
    await adapter.close();
  });

  it("refuses to continue when no stored conversation URL is supplied", async () => {
    const adapter = await createAdapter(baseUrl);

    await expect(
      adapter.ask("second prompt", {
        conversation: "continue",
        timeoutMs: 1_000
      })
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    await adapter.close();
  });

  it("accepts prompts when the composer normalizes whitespace differently from the original input", async () => {
    const adapter = await createAdapter(`${baseUrl}normalized-composer`);

    const result = await adapter.ask("Line 1\n\n\nLine 2    with    spacing", {
      conversation: "new",
      timeoutMs: 5_000
    });

    expect(result.answer).toContain("Normalized answer:");
    expect(result.answer).toContain("Line 1");
    expect(result.answer).toContain("Line 2 with spacing");
    await adapter.close();
  });

  it("retries prompt submission when the send button detaches during click", async () => {
    const adapter = await createAdapter(`${baseUrl}detached-send-button`);

    const result = await adapter.ask("hello after rerender", {
      conversation: "new",
      timeoutMs: 5_000
    });

    expect(result.answer).toBe("Detached button answer: hello after rerender");
    await adapter.close();
  });

  it("reports SESSION_NOT_FOUND when the stored conversation page says it is unavailable", async () => {
    const adapter = await createAdapter(baseUrl);

    await expect(
      adapter.ask("second prompt", {
        conversation: "continue",
        conversationUrl: `${baseUrl}c/missing`,
        timeoutMs: 1_000
      })
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    await adapter.close();
  });

  it("reports SESSION_NOT_FOUND when the stored conversation page shows a Chinese unavailable message", async () => {
    const adapter = await createAdapter(baseUrl);

    await expect(
      adapter.ask("second prompt", {
        conversation: "continue",
        conversationUrl: `${baseUrl}c/missing-zh`,
        timeoutMs: 1_000
      })
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    await adapter.close();
  });

  it("reports NOT_LOGGED_IN when the page is a login screen", async () => {
    const adapter = await createAdapter(`${baseUrl}login`);
    await expect(
      adapter.ask("hello", {
        conversation: "new",
        timeoutMs: 2_000
      })
    ).rejects.toMatchObject({ code: "NOT_LOGGED_IN" });
    await adapter.close();
  });

  it("reports TIMEOUT when no assistant response appears", async () => {
    const adapter = await createAdapter(`${baseUrl}timeout`);
    await expect(
      adapter.ask("hello", {
        conversation: "new",
        timeoutMs: 1_000
      })
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    await adapter.close();
  });

  it("reports TIMEOUT when the prompt clears but ChatGPT never starts a turn", async () => {
    const adapter = await createAdapter(`${baseUrl}clear-without-submit`);
    await expect(
      adapter.ask("hello", {
        conversation: "new",
        timeoutMs: 1_000
      })
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    await adapter.close();
  });

  it("reports SELECTOR_CHANGED when the composer cannot be found", async () => {
    const adapter = await createAdapter(`${baseUrl}selector-drift`);
    await expect(
      adapter.ask("hello", {
        conversation: "new",
        timeoutMs: 1_000
      })
    ).rejects.toMatchObject({ code: "SELECTOR_CHANGED" });
    await adapter.close();
  });
});

async function createAdapter(baseUrl: string): Promise<ChatGptAdapter> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-llm-chatgpt-"));
  const config = loadConfig({
    BROWSER_LLM_HOME: tmpDir,
    BROWSER_LLM_HEADLESS: "true"
  } as NodeJS.ProcessEnv);
  const controller = new BrowserController({
    provider: "chatgpt",
    profilePath: path.join(tmpDir, "profile"),
    artifactsDir: path.join(tmpDir, "artifacts"),
    headless: true
  });

  return new ChatGptAdapter(config, { controller, baseUrl });
}
