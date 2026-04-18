import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ProviderRegistry } from "../src/providers/ProviderRegistry.js";

describe("ProviderRegistry", () => {
  const registry = new ProviderRegistry(
    loadConfig({
      BROWSER_LLM_HOME: "/tmp/browser-llm-registry-test",
      BROWSER_LLM_HEADLESS: "true"
    } as NodeJS.ProcessEnv)
  );

  it("enables ChatGPT and reserves planned providers", () => {
    const providers = registry.listProviders();
    expect(providers.find((provider) => provider.id === "chatgpt")).toMatchObject({
      availability: "enabled",
      implemented: true
    });
    expect(providers.find((provider) => provider.id === "kimi")).toMatchObject({
      availability: "planned",
      implemented: false
    });
    expect(providers.find((provider) => provider.id === "deepseek")).toMatchObject({
      availability: "planned",
      implemented: false
    });
  });

  it("planned providers return PROVIDER_DISABLED for ask", async () => {
    await expect(
      registry.get("kimi").ask("hello", {
        conversation: "new",
        timeoutMs: 1000
      })
    ).rejects.toMatchObject({ code: "PROVIDER_DISABLED" });
  });
});
