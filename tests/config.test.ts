import { describe, expect, it } from "vitest";
import { loadConfig, profilePathFor } from "../src/config.js";

describe("config", () => {
  it("uses explicit runtime environment values", () => {
    const config = loadConfig({
      BROWSER_LLM_HOME: "/tmp/browser-llm-test",
      BROWSER_LLM_HEADLESS: "true",
      BROWSER_LLM_LAUNCH_MODE: "cdp",
      BROWSER_LLM_BROWSER_CHANNEL: "chromium",
      BROWSER_LLM_PROXY_SERVER: "http://127.0.0.1:7890",
      BROWSER_LLM_CDP_ENDPOINT: "http://127.0.0.1:9222",
      BROWSER_LLM_CDP_AUTOSTART: "true",
      BROWSER_LLM_CDP_USER_DATA_DIR: "/tmp/browser-llm-cdp-profile",
      BROWSER_LLM_CDP_STARTUP_URL: "https://chatgpt.com/",
      BROWSER_LLM_LOCALE: "zh-CN",
      BROWSER_LLM_TIMEZONE_ID: "Asia/Shanghai",
      BROWSER_LLM_TIMEOUT_MS: "1234",
      BROWSER_LLM_CHATGPT_URL: "http://localhost:3000"
    } as NodeJS.ProcessEnv);

    expect(config.homeDir).toBe("/tmp/browser-llm-test");
    expect(config.headless).toBe(true);
    expect(config.launchMode).toBe("cdp");
    expect(config.browserChannel).toBe("chromium");
    expect(config.proxyServer).toBe("http://127.0.0.1:7890");
    expect(config.cdpEndpoint).toBe("http://127.0.0.1:9222");
    expect(config.cdpAutoStart).toBe(true);
    expect(config.cdpUserDataDir).toBe("/tmp/browser-llm-cdp-profile");
    expect(config.cdpStartupUrl).toBe("https://chatgpt.com/");
    expect(config.locale).toBe("zh-CN");
    expect(config.timezoneId).toBe("Asia/Shanghai");
    expect(config.defaultTimeoutMs).toBe(1234);
    expect(config.chatgptBaseUrl).toBe("http://localhost:3000");
    expect(profilePathFor(config, "chatgpt")).toBe("/tmp/browser-llm-test/profiles/chatgpt");
  });

  it("defaults cdp mode to the local Chrome debugging endpoint", () => {
    const config = loadConfig({
      BROWSER_LLM_HOME: "/tmp/browser-llm-default-cdp",
      BROWSER_LLM_LAUNCH_MODE: "cdp"
    } as NodeJS.ProcessEnv);

    expect(config.launchMode).toBe("cdp");
    expect(config.cdpEndpoint).toBe("http://127.0.0.1:9222");
    expect(config.cdpAutoStart).toBe(true);
    expect(config.cdpUserDataDir).toBe("/tmp/browser-llm-default-cdp/cdp-chrome-profile");
  });

  it("allows forcing persistent mode even when cdp defaults exist", () => {
    const config = loadConfig({
      BROWSER_LLM_HOME: "/tmp/browser-llm-persistent",
      BROWSER_LLM_LAUNCH_MODE: "persistent",
      BROWSER_LLM_CDP_ENDPOINT: "http://127.0.0.1:9222",
      BROWSER_LLM_CDP_AUTOSTART: "true"
    } as NodeJS.ProcessEnv);

    expect(config.launchMode).toBe("persistent");
    expect(config.cdpEndpoint).toBeUndefined();
    expect(config.cdpAutoStart).toBe(false);
  });

  it("does not autostart non-local cdp endpoints by default", () => {
    const config = loadConfig({
      BROWSER_LLM_LAUNCH_MODE: "cdp",
      BROWSER_LLM_CDP_ENDPOINT: "http://example.com:9222"
    } as NodeJS.ProcessEnv);

    expect(config.launchMode).toBe("cdp");
    expect(config.cdpEndpoint).toBe("http://example.com:9222");
    expect(config.cdpAutoStart).toBe(false);
  });

  it("defaults long-running ask timeouts and progress heartbeat intervals for browser LLM responses", () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);

    expect(config.defaultTimeoutMs).toBe(600_000);
    expect(config.progressHeartbeatMs).toBe(10_000);
  });
});
