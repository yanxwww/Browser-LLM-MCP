export const providerIds = ["chatgpt", "kimi", "deepseek", "claude", "gemini"] as const;

export type ProviderId = (typeof providerIds)[number];

export type ProviderAvailability = "enabled" | "planned";

export type LoginState = "logged_in" | "not_logged_in" | "unknown";

export const errorCodes = [
  "NOT_LOGGED_IN",
  "TIMEOUT",
  "SELECTOR_CHANGED",
  "FILE_UNSUPPORTED",
  "FILE_TOO_LARGE",
  "FILE_READ_FAILED",
  "BROWSER_PROFILE_LOCKED",
  "RATE_LIMIT_OR_CAPTCHA",
  "PROVIDER_DISABLED",
  "PROVIDER_UNSUPPORTED",
  "SESSION_NOT_FOUND",
  "BROWSER_LAUNCH_FAILED",
  "UNKNOWN"
] as const;

export type BrowserLlmErrorCode = (typeof errorCodes)[number];

export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  availability: ProviderAvailability;
  implemented: boolean;
  profilePath: string;
  homepage: string;
  notes?: string;
}

export interface ProviderStatus extends ProviderInfo {
  browserRunning: boolean;
  loginState: LoginState;
  queueDepth: number;
  busy: boolean;
  lastError?: SerializedBrowserLlmError;
}

export interface AskOptions {
  conversation: "new" | "continue";
  timeoutMs: number;
  sessionId?: string;
  conversationUrl?: string;
}

export interface AskResult {
  provider: ProviderId;
  sessionId?: string;
  answer: string;
  url: string;
  providerConversationUrl: string;
  elapsedMs: number;
  conversationMode: AskOptions["conversation"];
  warnings: string[];
  rawText?: string;
}

export interface SerializedBrowserLlmError {
  code: BrowserLlmErrorCode;
  message: string;
  details?: unknown;
}
