import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type { ProviderId } from "./types.js";

export type BrowserChannel =
  | "chromium"
  | "chrome"
  | "chrome-beta"
  | "chrome-dev"
  | "chrome-canary"
  | "msedge"
  | "msedge-beta"
  | "msedge-dev"
  | "msedge-canary";

export type LaunchMode = "persistent" | "cdp";

export interface RuntimeConfig {
  homeDir: string;
  profilesDir: string;
  artifactsDir: string;
  sessionsPath: string;
  headless: boolean;
  launchMode: LaunchMode;
  browserChannel?: BrowserChannel;
  proxyServer?: string;
  cdpEndpoint?: string;
  cdpAutoStart: boolean;
  cdpUserDataDir: string;
  cdpStartupUrl?: string;
  locale?: string;
  timezoneId?: string;
  defaultTimeoutMs: number;
  progressHeartbeatMs: number;
  chatgptBaseUrl: string;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLaunchModePreference(value: string | undefined): "auto" | LaunchMode {
  if (value === "persistent" || value === "cdp") {
    return value;
  }

  return "auto";
}

function parseBrowserChannel(value: string | undefined): BrowserChannel | undefined {
  const allowed = new Set<BrowserChannel>([
    "chromium",
    "chrome",
    "chrome-beta",
    "chrome-dev",
    "chrome-canary",
    "msedge",
    "msedge-beta",
    "msedge-dev",
    "msedge-canary"
  ]);

  if (value && allowed.has(value as BrowserChannel)) {
    return value as BrowserChannel;
  }

  return autoDetectBrowserChannel();
}

function autoDetectBrowserChannel(): BrowserChannel | undefined {
  if (process.platform === "darwin" && fs.existsSync("/Applications/Google Chrome.app")) {
    return "chrome";
  }

  return undefined;
}

function shouldUseCdpByDefault(): boolean {
  return process.platform === "darwin" && fs.existsSync("/Applications/Google Chrome.app");
}

function isLocalEndpoint(endpoint: string): boolean {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

function resolveLaunchMode(env: NodeJS.ProcessEnv): LaunchMode {
  const preference = parseLaunchModePreference(env.BROWSER_LLM_LAUNCH_MODE);
  if (preference !== "auto") {
    return preference;
  }

  if (
    env.BROWSER_LLM_CDP_ENDPOINT ||
    env.BROWSER_LLM_CDP_AUTOSTART ||
    env.BROWSER_LLM_CDP_USER_DATA_DIR ||
    env.BROWSER_LLM_CDP_STARTUP_URL
  ) {
    return "cdp";
  }

  return shouldUseCdpByDefault() ? "cdp" : "persistent";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const homeDir = env.BROWSER_LLM_HOME ?? path.join(os.homedir(), ".browser-llm-mcp");
  const launchMode = resolveLaunchMode(env);
  const cdpEndpoint = launchMode === "cdp" ? env.BROWSER_LLM_CDP_ENDPOINT ?? "http://127.0.0.1:9222" : undefined;

  return {
    homeDir,
    profilesDir: path.join(homeDir, "profiles"),
    artifactsDir: path.join(homeDir, "artifacts"),
    sessionsPath: path.join(homeDir, "sessions.json"),
    headless: parseBoolean(env.BROWSER_LLM_HEADLESS, false),
    launchMode,
    browserChannel: parseBrowserChannel(env.BROWSER_LLM_BROWSER_CHANNEL),
    proxyServer: env.BROWSER_LLM_PROXY_SERVER || undefined,
    cdpEndpoint,
    cdpAutoStart: launchMode === "cdp" && cdpEndpoint ? parseBoolean(env.BROWSER_LLM_CDP_AUTOSTART, isLocalEndpoint(cdpEndpoint)) : false,
    cdpUserDataDir: env.BROWSER_LLM_CDP_USER_DATA_DIR ?? path.join(homeDir, "cdp-chrome-profile"),
    cdpStartupUrl: launchMode === "cdp" ? env.BROWSER_LLM_CDP_STARTUP_URL || undefined : undefined,
    locale: env.BROWSER_LLM_LOCALE || undefined,
    timezoneId: env.BROWSER_LLM_TIMEZONE_ID || undefined,
    defaultTimeoutMs: parsePositiveInteger(env.BROWSER_LLM_TIMEOUT_MS, 600_000),
    progressHeartbeatMs: parsePositiveInteger(env.BROWSER_LLM_PROGRESS_HEARTBEAT_MS, 10_000),
    chatgptBaseUrl: env.BROWSER_LLM_CHATGPT_URL ?? "https://chatgpt.com/"
  };
}

export function profilePathFor(config: RuntimeConfig, provider: ProviderId): string {
  return path.join(config.profilesDir, provider);
}
