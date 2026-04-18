import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mapLaunchError, serializeError } from "../errors.js";
import type { SerializedBrowserLlmError } from "../types.js";
import { ensureCdpEndpoint } from "./cdpAutostart.js";

export interface BrowserControllerOptions {
  provider: string;
  profilePath: string;
  artifactsDir: string;
  headless: boolean;
  browserChannel?: string;
  proxyServer?: string;
  cdpEndpoint?: string;
  cdpAutoStart?: boolean;
  cdpUserDataDir?: string;
  cdpStartupUrl?: string;
  locale?: string;
  timezoneId?: string;
}

export interface BrowserRuntimeStatus {
  browserRunning: boolean;
  queueDepth: number;
  busy: boolean;
  profilePath: string;
  currentUrl?: string;
  browserChannel?: string;
  proxyServer?: string;
  cdpEndpoint?: string;
  cdpAutoStart?: boolean;
  cdpUserDataDir?: string;
  launchMode: "persistent" | "cdp";
  lastError?: SerializedBrowserLlmError;
}

export class BrowserController {
  readonly provider: string;
  readonly profilePath: string;

  private readonly artifactsDir: string;
  private readonly headless: boolean;
  private readonly browserChannel?: string;
  private readonly proxyServer?: string;
  private readonly cdpEndpoint?: string;
  private readonly cdpAutoStart: boolean;
  private readonly cdpUserDataDir?: string;
  private readonly cdpStartupUrl?: string;
  private readonly locale?: string;
  private readonly timezoneId?: string;
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private current: Promise<void> = Promise.resolve();
  private queued = 0;
  private busy = false;
  private lastError?: SerializedBrowserLlmError;

  constructor(options: BrowserControllerOptions) {
    this.provider = options.provider;
    this.profilePath = options.profilePath;
    this.artifactsDir = options.artifactsDir;
    this.headless = options.headless;
    this.browserChannel = options.browserChannel;
    this.proxyServer = options.proxyServer;
    this.cdpEndpoint = options.cdpEndpoint;
    this.cdpAutoStart = options.cdpAutoStart ?? false;
    this.cdpUserDataDir = options.cdpUserDataDir;
    this.cdpStartupUrl = options.cdpStartupUrl;
    this.locale = options.locale;
    this.timezoneId = options.timezoneId;
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    this.queued += 1;
    const previous = this.current;
    let unlock!: () => void;
    this.current = new Promise<void>((resolve) => {
      unlock = resolve;
    });

    await previous.catch(() => undefined);
    this.queued -= 1;
    this.busy = true;

    try {
      const result = await operation();
      this.lastError = undefined;
      return result;
    } catch (error) {
      this.lastError = serializeError(error);
      throw error;
    } finally {
      this.busy = false;
      unlock();
    }
  }

  async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    if (this.context) {
      const existingPage = this.context.pages().find((candidate) => !candidate.isClosed());
      if (existingPage) {
        this.page = existingPage;
        return existingPage;
      }
    }

    if (!this.context) {
      await fs.mkdir(this.profilePath, { recursive: true });
      await fs.mkdir(this.artifactsDir, { recursive: true });

      try {
        if (this.cdpEndpoint) {
          if (this.cdpAutoStart) {
            await ensureCdpEndpoint({
              endpoint: this.cdpEndpoint,
              userDataDir: this.cdpUserDataDir ?? this.profilePath,
              startupUrl: this.cdpStartupUrl,
              proxyServer: this.proxyServer
            });
          }

          this.browser = await chromium.connectOverCDP(this.cdpEndpoint);
          this.context =
            this.browser.contexts()[0] ??
            (await this.browser.newContext({
              ...(this.locale ? { locale: this.locale } : {}),
              ...(this.timezoneId ? { timezoneId: this.timezoneId } : {}),
              viewport: { width: 1440, height: 960 },
              acceptDownloads: false
            }));
        } else {
          this.context = await chromium.launchPersistentContext(this.profilePath, {
            headless: this.headless,
            ...(this.browserChannel ? { channel: this.browserChannel } : {}),
            ...(this.proxyServer ? { proxy: { server: this.proxyServer } } : {}),
            ...(this.locale ? { locale: this.locale } : {}),
            ...(this.timezoneId ? { timezoneId: this.timezoneId } : {}),
            viewport: { width: 1440, height: 960 },
            acceptDownloads: false,
            args: ["--no-first-run"]
          });
        }
      } catch (error) {
        throw mapLaunchError(error);
      }

      this.browser?.on("disconnected", () => {
        this.context = undefined;
        this.page = undefined;
        this.browser = undefined;
      });

      this.context.on("close", () => {
        this.context = undefined;
        this.page = undefined;
      });
    }

    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    return this.page;
  }

  async close(): Promise<void> {
    const context = this.context;
    const browser = this.browser;
    this.context = undefined;
    this.page = undefined;
    this.browser = undefined;

    if (browser) {
      await browser.close();
    } else if (context) {
      await context.close();
    }
  }

  status(): BrowserRuntimeStatus {
    return {
      browserRunning: Boolean(this.context),
      queueDepth: this.queued,
      busy: this.busy,
      profilePath: this.profilePath,
      launchMode: this.cdpEndpoint ? "cdp" : "persistent",
      ...(this.page && !this.page.isClosed() ? { currentUrl: this.page.url() } : {}),
      ...(this.browserChannel ? { browserChannel: this.browserChannel } : {}),
      ...(this.proxyServer ? { proxyServer: this.proxyServer } : {}),
      ...(this.cdpEndpoint ? { cdpEndpoint: this.cdpEndpoint } : {}),
      ...(this.cdpEndpoint ? { cdpAutoStart: this.cdpAutoStart } : {}),
      ...(this.cdpEndpoint && this.cdpUserDataDir ? { cdpUserDataDir: this.cdpUserDataDir } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {})
    };
  }

  getCurrentPage(): Page | undefined {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    return undefined;
  }

  async captureFailureScreenshot(label: string): Promise<string | undefined> {
    const page = this.getCurrentPage();
    if (!page) {
      return undefined;
    }

    await fs.mkdir(this.artifactsDir, { recursive: true });
    const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
    const filename = `${this.provider}-${safeLabel}-${Date.now()}.png`;
    const screenshotPath = path.join(this.artifactsDir, filename);

    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return screenshotPath;
    } catch {
      return undefined;
    }
  }
}
