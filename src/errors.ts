import type { BrowserLlmErrorCode, SerializedBrowserLlmError } from "./types.js";

export class BrowserLlmError extends Error {
  readonly code: BrowserLlmErrorCode;
  readonly details?: unknown;

  constructor(code: BrowserLlmErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "BrowserLlmError";
    this.code = code;
    this.details = details;
  }
}

export function serializeError(error: unknown): SerializedBrowserLlmError {
  if (error instanceof BrowserLlmError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details })
    };
  }

  if (error instanceof Error) {
    return {
      code: "UNKNOWN",
      message: error.message
    };
  }

  return {
    code: "UNKNOWN",
    message: String(error)
  };
}

export function isPlaywrightTimeout(error: unknown): boolean {
  return error instanceof Error && /Timeout|timed out/i.test(error.message);
}

export function mapLaunchError(error: unknown): BrowserLlmError {
  const message = error instanceof Error ? error.message : String(error);
  if (/ProcessSingleton|profile.*in use|user data directory.*already/i.test(message)) {
    return new BrowserLlmError(
      "BROWSER_PROFILE_LOCKED",
      "The browser profile is already in use. Close other Browser LLM MCP windows for this provider and retry.",
      { cause: message }
    );
  }

  return new BrowserLlmError("BROWSER_LAUNCH_FAILED", "Failed to launch the browser.", {
    cause: message
  });
}
