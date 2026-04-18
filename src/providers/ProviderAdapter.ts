import type { AskOptions, AskResult, LoginState, ProviderId, ProviderInfo, ProviderStatus } from "../types.js";

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly homepage: string;

  getInfo(): ProviderInfo;
  openLogin(): Promise<ProviderStatus>;
  getStatus(): Promise<ProviderStatus>;
  ask(prompt: string, options: AskOptions): Promise<AskResult>;
  close(): Promise<ProviderStatus>;
  detectLoginState(): Promise<LoginState>;
}
