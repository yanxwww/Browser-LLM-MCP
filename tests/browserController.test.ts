import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserController } from "../src/browser/BrowserController.js";

describe("BrowserController", () => {
  it("runs provider work in a single queue", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-llm-queue-"));
    const controller = new BrowserController({
      provider: "test",
      profilePath: path.join(tmpDir, "profile"),
      artifactsDir: path.join(tmpDir, "artifacts"),
      headless: true
    });

    expect(controller.status()).toMatchObject({
      launchMode: "persistent"
    });

    const events: string[] = [];
    const first = controller.runExclusive(async () => {
      events.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 50));
      events.push("first:end");
      return 1;
    });
    const second = controller.runExclusive(async () => {
      events.push("second:start");
      events.push("second:end");
      return 2;
    });

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });
});
