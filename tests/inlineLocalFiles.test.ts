import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  inlineLocalFilesIntoPrompt,
  maxInlineFileBytes,
  maxInlineTotalBytes
} from "../src/prompt/inlineLocalFiles.js";

describe("inlineLocalFilesIntoPrompt", () => {
  it("returns the original prompt when no files are provided", async () => {
    await expect(inlineLocalFilesIntoPrompt("hello", undefined)).resolves.toEqual({
      prompt: "hello",
      files: []
    });
  });

  it("rejects files that exceed the per-file inline size limit", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-llm-large-file-"));
    const filePath = path.join(tmpDir, "huge.log");
    await fs.writeFile(filePath, "x".repeat(maxInlineFileBytes + 1), "utf8");

    await expect(inlineLocalFilesIntoPrompt("analyze", [filePath])).rejects.toMatchObject({
      code: "FILE_TOO_LARGE"
    });
  });

  it("rejects file sets that exceed the combined inline size limit", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-llm-large-total-"));
    const fileOne = path.join(tmpDir, "one.log");
    const fileTwo = path.join(tmpDir, "two.log");
    await fs.writeFile(fileOne, "a".repeat(Math.floor(maxInlineTotalBytes / 2)), "utf8");
    await fs.writeFile(fileTwo, "b".repeat(Math.floor(maxInlineTotalBytes / 2) + 1), "utf8");

    await expect(inlineLocalFilesIntoPrompt("analyze", [fileOne, fileTwo])).rejects.toMatchObject({
      code: "FILE_TOO_LARGE"
    });
  });
});
