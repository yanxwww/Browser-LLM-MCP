import { BrowserLlmError } from "../errors.js";
import type { RuntimeConfig } from "../config.js";
import { profilePathFor } from "../config.js";
import type { AskOptions, AskResult, LoginState, ProviderId, ProviderInfo, ProviderStatus } from "../types.js";
import type { ProviderAdapter } from "./ProviderAdapter.js";

const plannedProviderMeta: Record<Exclude<ProviderId, "chatgpt">, { displayName: string; homepage: string }> = {
  kimi: {
    displayName: "Kimi",
    homepage: "https://kimi.moonshot.cn/"
  },
  deepseek: {
    displayName: "DeepSeek",
    homepage: "https://chat.deepseek.com/"
  },
  claude: {
    displayName: "Claude",
    homepage: "https://claude.ai/"
  },
  gemini: {
    displayName: "Gemini",
    homepage: "https://gemini.google.com/"
  }
};

export class PlannedProviderAdapter implements ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly homepage: string;
  private readonly profilePath: string;

  constructor(id: Exclude<ProviderId, "chatgpt">, config: RuntimeConfig) {
    const meta = plannedProviderMeta[id];
    this.id = id;
    this.displayName = meta.displayName;
    this.homepage = meta.homepage;
    this.profilePath = profilePathFor(config, id);
  }

  getInfo(): ProviderInfo {
    return {
      id: this.id,
      displayName: this.displayName,
      availability: "planned",
      implemented: false,
      profilePath: this.profilePath,
      homepage: this.homepage,
      notes: "Provider adapter is reserved in the architecture but not implemented in v1."
    };
  }

  async openLogin(): Promise<ProviderStatus> {
    throw this.disabledError();
  }

  async getStatus(): Promise<ProviderStatus> {
    return {
      ...this.getInfo(),
      browserRunning: false,
      loginState: "unknown",
      queueDepth: 0,
      busy: false
    };
  }

  async ask(_prompt: string, _options: AskOptions): Promise<AskResult> {
    throw this.disabledError();
  }

  async close(): Promise<ProviderStatus> {
    return this.getStatus();
  }

  async detectLoginState(): Promise<LoginState> {
    return "unknown";
  }

  private disabledError(): BrowserLlmError {
    return new BrowserLlmError(
      "PROVIDER_DISABLED",
      `${this.displayName} is planned but not implemented in this release.`,
      { provider: this.id }
    );
  }
}
