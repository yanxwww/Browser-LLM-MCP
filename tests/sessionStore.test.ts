import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/sessions/SessionStore.js";

describe("SessionStore", () => {
  it("persists provider conversation URLs by agent session id", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-llm-sessions-"));
    const store = new SessionStore(path.join(tmpDir, "sessions.json"));

    await expect(store.get("chatgpt", "agent-session-1")).resolves.toBeUndefined();

    const created = await store.upsert("chatgpt", "agent-session-1", "https://chatgpt.com/c/abc");
    expect(created.url).toBe("https://chatgpt.com/c/abc");

    const updated = await store.upsert("chatgpt", "agent-session-1", "https://chatgpt.com/c/def");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt >= created.updatedAt).toBe(true);

    await expect(store.get("chatgpt", "agent-session-1")).resolves.toMatchObject({
      provider: "chatgpt",
      sessionId: "agent-session-1",
      url: "https://chatgpt.com/c/def"
    });
  });
});
