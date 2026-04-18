import fs from "node:fs/promises";
import path from "node:path";
import { BrowserLlmError } from "../errors.js";

export const maxInlinePromptFiles = 5;
export const maxInlineFileBytes = 256_000;
export const maxInlineTotalBytes = 512_000;

const supportedInlineFileExtensions = new Map<string, string>([
  [".json", "json"],
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".txt", "text"],
  [".log", "text"]
]);

export interface InlinedPromptFile {
  path: string;
  format: string;
  sizeBytes: number;
}

export interface PreparedPrompt {
  prompt: string;
  files: InlinedPromptFile[];
}

export async function inlineLocalFilesIntoPrompt(userPrompt: string, filePaths: string[] | undefined): Promise<PreparedPrompt> {
  if (!filePaths || filePaths.length === 0) {
    return { prompt: userPrompt, files: [] };
  }

  const files: InlinedPromptFile[] = [];
  const sections = [
    userPrompt,
    "",
    "The following local file contents were loaded by Browser LLM MCP before this prompt was submitted."
  ];

  let totalBytes = 0;
  for (const [index, inputPath] of filePaths.entries()) {
    const resolvedPath = path.resolve(inputPath);
    const extension = path.extname(resolvedPath).toLowerCase();
    const format = supportedInlineFileExtensions.get(extension);
    if (!format) {
      throw new BrowserLlmError("FILE_UNSUPPORTED", "Only .json, .md, .markdown, .txt, and .log files can be inlined.", {
        path: resolvedPath,
        allowedExtensions: [...supportedInlineFileExtensions.keys()]
      });
    }

    const stat = await fs.stat(resolvedPath).catch((error) => {
      throw new BrowserLlmError("FILE_READ_FAILED", "Could not read the local file for Browser LLM prompt inlining.", {
        path: resolvedPath,
        cause: error instanceof Error ? error.message : String(error)
      });
    });

    if (!stat.isFile()) {
      throw new BrowserLlmError("FILE_READ_FAILED", "The supplied local path is not a regular file.", {
        path: resolvedPath
      });
    }

    if (stat.size > maxInlineFileBytes) {
      throw new BrowserLlmError("FILE_TOO_LARGE", "A local file exceeds the Browser LLM inline size limit.", {
        path: resolvedPath,
        sizeBytes: stat.size,
        maxBytes: maxInlineFileBytes
      });
    }

    totalBytes += stat.size;
    if (totalBytes > maxInlineTotalBytes) {
      throw new BrowserLlmError("FILE_TOO_LARGE", "Combined local files exceed the Browser LLM inline size limit.", {
        totalBytes,
        maxBytes: maxInlineTotalBytes
      });
    }

    const content = await fs.readFile(resolvedPath, "utf8").catch((error) => {
      throw new BrowserLlmError("FILE_READ_FAILED", "Could not decode the local file as UTF-8 text.", {
        path: resolvedPath,
        cause: error instanceof Error ? error.message : String(error)
      });
    });

    if (content.includes("\u0000")) {
      throw new BrowserLlmError("FILE_UNSUPPORTED", "The supplied local file appears to be binary, not text.", {
        path: resolvedPath
      });
    }

    files.push({
      path: resolvedPath,
      format,
      sizeBytes: stat.size
    });
    sections.push(
      "",
      `===== BEGIN LOCAL FILE ${index + 1}: ${resolvedPath} (${format}) =====`,
      content,
      `===== END LOCAL FILE ${index + 1} =====`
    );
  }

  return {
    prompt: `${sections.join("\n")}\n`,
    files
  };
}
