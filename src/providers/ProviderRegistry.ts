import { BrowserLlmError } from "../errors.js";
import type { RuntimeConfig } from "../config.js";
import type { ProviderId, ProviderInfo } from "../types.js";
import { providerIds } from "../types.js";
import type { ProviderAdapter } from "./ProviderAdapter.js";
import { PlannedProviderAdapter } from "./PlannedProviderAdapter.js";
import { ChatGptAdapter } from "./chatgpt/ChatGptAdapter.js";

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, ProviderAdapter>();

  constructor(config: RuntimeConfig) {
    this.providers.set("chatgpt", new ChatGptAdapter(config));
    this.providers.set("kimi", new PlannedProviderAdapter("kimi", config));
    this.providers.set("deepseek", new PlannedProviderAdapter("deepseek", config));
    this.providers.set("claude", new PlannedProviderAdapter("claude", config));
    this.providers.set("gemini", new PlannedProviderAdapter("gemini", config));
  }

  listProviders(): ProviderInfo[] {
    return providerIds.map((id) => this.get(id).getInfo());
  }

  get(id: ProviderId): ProviderAdapter {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new BrowserLlmError("PROVIDER_UNSUPPORTED", `Unsupported provider: ${id}`, { provider: id });
    }

    return provider;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.providers.values()].map((provider) => provider.close()));
  }
}

export function createProviderRegistry(config: RuntimeConfig): ProviderRegistry {
  return new ProviderRegistry(config);
}
