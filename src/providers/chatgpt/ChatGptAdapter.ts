import type { Locator, Page } from "playwright";
import { BrowserController } from "../../browser/BrowserController.js";
import { loadConfig, profilePathFor, type RuntimeConfig } from "../../config.js";
import { BrowserLlmError, isPlaywrightTimeout, serializeError } from "../../errors.js";
import type { AskOptions, AskResult, LoginState, ProviderInfo, ProviderStatus } from "../../types.js";
import type { ProviderAdapter } from "../ProviderAdapter.js";
import { chatGptSelectors } from "./selectors.js";

export interface ChatGptAdapterOptions {
  controller?: BrowserController;
  baseUrl?: string;
}

export class ChatGptAdapter implements ProviderAdapter {
  readonly id = "chatgpt" as const;
  readonly displayName = "ChatGPT";
  readonly homepage: string;

  private readonly controller: BrowserController;

  constructor(config: RuntimeConfig = loadConfig(), options: ChatGptAdapterOptions = {}) {
    this.homepage = normalizeBaseUrl(options.baseUrl ?? config.chatgptBaseUrl);
    this.controller =
      options.controller ??
      new BrowserController({
        provider: this.id,
        profilePath: profilePathFor(config, this.id),
        artifactsDir: config.artifactsDir,
        headless: config.headless,
        browserChannel: config.browserChannel,
        proxyServer: config.proxyServer,
        cdpEndpoint: config.cdpEndpoint,
        cdpAutoStart: config.cdpAutoStart,
        cdpUserDataDir: config.cdpUserDataDir,
        cdpStartupUrl: config.cdpStartupUrl ?? this.homepage,
        locale: config.locale,
        timezoneId: config.timezoneId
      });
  }

  getInfo(): ProviderInfo {
    return {
      id: this.id,
      displayName: this.displayName,
      availability: "enabled",
      implemented: true,
      profilePath: this.controller.profilePath,
      homepage: this.homepage
    };
  }

  async openLogin(): Promise<ProviderStatus> {
    const page = await this.controller.ensurePage();
    await page.goto(this.homepage, { waitUntil: "domcontentloaded" });
    return this.getStatus();
  }

  async getStatus(): Promise<ProviderStatus> {
    const runtime = this.controller.status();
    const loginState = runtime.browserRunning ? await this.detectLoginState() : "unknown";
    return {
      ...this.getInfo(),
      ...runtime,
      loginState
    };
  }

  async ask(prompt: string, options: AskOptions): Promise<AskResult> {
    const startedAt = Date.now();

    return this.controller.runExclusive(async () => {
      try {
        const page = await this.controller.ensurePage();
        await this.prepareConversation(page, options);

        const loginState = await this.detectLoginStateOnPage(page);
        if (loginState === "not_logged_in") {
          throw new BrowserLlmError(
            "NOT_LOGGED_IN",
            "ChatGPT is not logged in. Call browser_llm_open_login and complete login in the opened browser.",
            { provider: this.id, url: page.url() }
          );
        }

        const baseline = await this.waitForConversationStable(page, Math.min(options.timeoutMs, 15_000));
        await this.submitPrompt(page, prompt, options.timeoutMs, baseline.userCount);
        const conversationUrlBudgetStartedAt = Date.now();
        const answer = await this.waitForAnswer(page, options.timeoutMs, baseline.assistantCount, baseline.lastAssistantText);
        const warnings = await this.detectWarnings(page);
        const providerConversationUrl = await this.resolveConversationUrl(
          page,
          options,
          warnings,
          conversationUrlBudgetStartedAt
        );

        return {
          provider: this.id,
          ...(options.sessionId ? { sessionId: options.sessionId } : {}),
          answer,
          rawText: answer,
          url: page.url(),
          providerConversationUrl,
          elapsedMs: Date.now() - startedAt,
          conversationMode: options.conversation,
          warnings
        };
      } catch (error) {
        if (error instanceof BrowserLlmError) {
          const screenshotPath = await this.controller.captureFailureScreenshot(error.code.toLowerCase());
          if (screenshotPath) {
            throw new BrowserLlmError(error.code, error.message, {
              ...(typeof error.details === "object" && error.details !== null ? error.details : { details: error.details }),
              screenshotPath
            });
          }
        }

        throw error;
      }
    });
  }

  async close(): Promise<ProviderStatus> {
    await this.controller.close();
    return this.getStatus();
  }

  async detectLoginState(): Promise<LoginState> {
    const page = this.controller.getCurrentPage();
    if (!page) {
      return "unknown";
    }

    return this.detectLoginStateOnPage(page);
  }

  private async prepareConversation(page: Page, options: AskOptions): Promise<void> {
    if (options.conversation === "continue" && options.conversationUrl) {
      await page.goto(options.conversationUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      if (!sameConversationUrl(page.url(), options.conversationUrl)) {
        throw new BrowserLlmError("SESSION_NOT_FOUND", "Stored ChatGPT conversation URL did not load.", {
          expectedUrl: options.conversationUrl,
          actualUrl: page.url()
        });
      }
      await this.throwIfConversationUnavailable(page, options.conversationUrl);
      return;
    }

    if (options.conversation === "continue") {
      throw new BrowserLlmError("SESSION_NOT_FOUND", "Cannot continue ChatGPT session without a stored conversation URL.", {
        provider: this.id,
        sessionId: options.sessionId
      });
    }

    if (options.conversation === "new" || page.url() === "about:blank" || options.sessionId) {
      await page.goto(this.homepage, { waitUntil: "domcontentloaded" });
    }
  }

  private async detectLoginStateOnPage(page: Page): Promise<LoginState> {
    if (/\/auth\/login|\/login|\/auth\/callback/i.test(page.url())) {
      return "not_logged_in";
    }

    if (await firstVisible(page, chatGptSelectors.composer, 1_500)) {
      return "logged_in";
    }

    if (await firstVisible(page, chatGptSelectors.loginIndicators, 1_000)) {
      return "not_logged_in";
    }

    const bodyText = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
    if (/log in|sign up|登录|注册/i.test(bodyText) && !/message chatgpt|ask anything|有什么可以帮/i.test(bodyText)) {
      return "not_logged_in";
    }

    return "unknown";
  }

  private async waitForConversationStable(
    page: Page,
    timeoutMs: number
  ): Promise<{ assistantCount: number; userCount: number; lastAssistantText: string }> {
    const composer = await firstVisible(page, chatGptSelectors.composer, Math.min(timeoutMs, 15_000));
    if (!composer) {
      throw new BrowserLlmError("SELECTOR_CHANGED", "Could not find the ChatGPT prompt composer.", {
        selectors: chatGptSelectors.composer,
        url: page.url()
      });
    }

    const deadline = Date.now() + timeoutMs;
    let lastSignature = "";
    let stableSince = Date.now();
    let lastCounts = { assistantCount: 0, userCount: 0, lastAssistantText: "" };

    while (Date.now() < deadline) {
      const assistantMessages = assistantMessageLocator(page);
      const userMessages = userMessageLocator(page);
      const assistantCount = await assistantMessages.count().catch(() => 0);
      const userCount = await userMessages.count().catch(() => 0);
      const lastAssistantText = assistantCount
        ? (await assistantMessages.last().innerText({ timeout: 300 }).catch(() => "")).trim()
        : "";
      const signature = `${assistantCount}:${userCount}:${lastAssistantText}`;

      lastCounts = { assistantCount, userCount, lastAssistantText };

      if (signature === lastSignature) {
        if (Date.now() - stableSince >= 500) {
          return lastCounts;
        }
      } else {
        lastSignature = signature;
        stableSince = Date.now();
      }

      await page.waitForTimeout(200);
    }

    return lastCounts;
  }

  private async submitPrompt(page: Page, prompt: string, timeoutMs: number, beforeUserCount: number): Promise<void> {
    await this.throwIfBlocked(page);

    const composer = await firstVisible(page, chatGptSelectors.composer, Math.min(timeoutMs, 15_000));
    if (!composer) {
      throw new BrowserLlmError("SELECTOR_CHANGED", "Could not find the ChatGPT prompt composer.", {
        selectors: chatGptSelectors.composer,
        url: page.url()
      });
    }

    await fillComposer(page, composer, prompt);
    const composerText = await readComposerText(composer);
    if (!composerLikelyContainsPrompt(composerText, prompt)) {
      throw new BrowserLlmError("SELECTOR_CHANGED", "Prompt text was not written into the ChatGPT composer.", {
        url: page.url()
      });
    }

    await this.triggerPromptSubmission(page, prompt, timeoutMs, beforeUserCount, composer);

    await this.waitForPromptSubmitted(page, prompt, timeoutMs, beforeUserCount, composer);
  }

  private async triggerPromptSubmission(
    page: Page,
    prompt: string,
    timeoutMs: number,
    beforeUserCount: number,
    composer: Locator
  ): Promise<void> {
    const deadline = Date.now() + Math.min(timeoutMs, 5_000);

    while (Date.now() < deadline) {
      await this.throwIfBlocked(page);

      const remainingMs = deadline - Date.now();
      const sendButton = await firstEnabled(page, chatGptSelectors.sendButton, Math.min(500, Math.max(150, remainingMs)));
      if (sendButton) {
        try {
          await sendButton.click({ timeout: Math.min(1_500, Math.max(250, remainingMs)) });
          if (await this.promptSubmissionStarted(page, beforeUserCount)) {
            return;
          }

          if (await this.promptSubmissionPending(page, prompt, composer)) {
            return;
          }

          await page.waitForTimeout(150);
          if (await this.promptSubmissionStarted(page, beforeUserCount)) {
            return;
          }

          if (await this.promptSubmissionPending(page, prompt, composer)) {
            return;
          }

          continue;
        } catch (error) {
          if (await this.promptSubmissionStarted(page, beforeUserCount)) {
            return;
          }

          if (isTransientSendButtonError(error)) {
            await page.waitForTimeout(150);
            continue;
          }

          throw error;
        }
      }

      await page.waitForTimeout(150);
    }

    await page.keyboard.press("Enter").catch(() => undefined);
  }

  private async waitForPromptSubmitted(
    page: Page,
    prompt: string,
    timeoutMs: number,
    beforeUserCount: number,
    composer: Locator
  ): Promise<void> {
    const deadline = Date.now() + Math.min(timeoutMs, 15_000);

    while (Date.now() < deadline) {
      await this.throwIfBlocked(page);

      if (await this.promptSubmissionStarted(page, beforeUserCount)) {
        return;
      }

      await page.waitForTimeout(250);
    }

    throw new BrowserLlmError("TIMEOUT", "Timed out waiting for ChatGPT to accept the submitted prompt.", {
      url: page.url()
    });
  }

  private async waitForAnswer(page: Page, timeoutMs: number, beforeCount: number, previousLastAssistantText: string): Promise<string> {
    const assistantMessages = assistantMessageLocator(page);

    try {
      await page.waitForFunction(
        ({ selectors, before, previous }) => {
          return selectors.some((selector) => {
            const messages = Array.from(document.querySelectorAll(selector));
            if (messages.length <= before) {
              return false;
            }

            const latest = messages[messages.length - 1]?.textContent?.trim() ?? "";
            return Boolean(latest) && latest !== previous;
          });
        },
        { selectors: [...chatGptSelectors.assistantMessage], before: beforeCount, previous: previousLastAssistantText },
        { timeout: timeoutMs }
      );
    } catch (error) {
      await this.throwIfBlocked(page);
      throw new BrowserLlmError(
        isPlaywrightTimeout(error) ? "TIMEOUT" : "SELECTOR_CHANGED",
        "Timed out waiting for ChatGPT to start an assistant response.",
        { url: page.url(), cause: serializeError(error) }
      );
    }

    const deadline = Date.now() + timeoutMs;
    let lastText = "";
    let stableSince = Date.now();

    while (Date.now() < deadline) {
      await this.throwIfBlocked(page);
      const latestText = (await assistantMessages.last().innerText({ timeout: 1_000 }).catch(() => "")).trim();
      const generating = Boolean(await firstVisible(page, chatGptSelectors.stopButton, 300));

      if (latestText && latestText === lastText) {
        if (!generating && Date.now() - stableSince >= 700) {
          return latestText;
        }
      } else {
        lastText = latestText;
        stableSince = Date.now();
      }

      await page.waitForTimeout(400);
    }

    throw new BrowserLlmError("TIMEOUT", "Timed out waiting for ChatGPT to finish responding.", {
      url: page.url()
    });
  }

  private async throwIfBlocked(page: Page): Promise<void> {
    const bodyText = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
    if (/verify you are human|captcha|unusual activity|rate limit|too many requests|verify your identity/i.test(bodyText)) {
      throw new BrowserLlmError(
        "RATE_LIMIT_OR_CAPTCHA",
        "ChatGPT appears to be showing a captcha, verification, or rate-limit page.",
        { url: page.url() }
      );
    }
  }

  private async throwIfConversationUnavailable(page: Page, expectedUrl: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    let lastBodyText = "";

    while (Date.now() < deadline) {
      const bodyText = await page.locator("body").innerText({ timeout: 500 }).catch(() => "");
      lastBodyText = bodyText;
      if (isConversationUnavailableText(bodyText)) {
        throw new BrowserLlmError("SESSION_NOT_FOUND", "Stored ChatGPT conversation URL is unavailable.", {
          expectedUrl,
          actualUrl: page.url(),
          bodyExcerpt: summarizeBodyText(bodyText)
        });
      }

      if (await firstVisible(page, chatGptSelectors.composer, 200)) {
        return;
      }

      await page.waitForTimeout(250);
    }

    throw new BrowserLlmError("SESSION_NOT_FOUND", "Stored ChatGPT conversation page did not become ready.", {
      expectedUrl,
      actualUrl: page.url(),
      bodyExcerpt: summarizeBodyText(lastBodyText)
    });
  }

  private async detectWarnings(page: Page): Promise<string[]> {
    const bodyText = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
    const warnings: string[] = [];

    if (/network error|something went wrong/i.test(bodyText)) {
      warnings.push("ChatGPT page contains a visible network or generic error message.");
    }

    return warnings;
  }

  private async resolveConversationUrl(
    page: Page,
    options: AskOptions,
    warnings: string[],
    startedAt: number
  ): Promise<string> {
    if (options.conversation === "continue" && options.conversationUrl) {
      return options.conversationUrl;
    }

    const remainingBudgetMs = Math.max(0, 8_000 - (Date.now() - startedAt));
    const deadline = Date.now() + remainingBudgetMs;
    while (Date.now() < deadline) {
      if (isChatGptConversationUrl(page.url())) {
        return page.url();
      }

      await page.waitForTimeout(250);
    }

    warnings.push("ChatGPT did not expose a stable /c/... conversation URL before the response returned.");
    return page.url();
  }

  private async promptSubmissionStarted(page: Page, beforeUserCount: number): Promise<boolean> {
    const userCount = await userMessageLocator(page).count().catch(() => 0);
    if (userCount > beforeUserCount) {
      return true;
    }

    return Boolean(await firstVisible(page, chatGptSelectors.stopButton, 200));
  }

  private async promptSubmissionPending(page: Page, prompt: string, composer: Locator): Promise<boolean> {
    const composerText = await readComposerText(composer);
    return !composerLikelyContainsPrompt(composerText, prompt);
  }
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function isChatGptConversationUrl(url: string): boolean {
  try {
    return /^\/c\/[^/]+\/?$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function sameConversationUrl(actual: string, expected: string): boolean {
  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);
    return actualUrl.origin === expectedUrl.origin && normalizePath(actualUrl.pathname) === normalizePath(expectedUrl.pathname);
  } catch {
    return false;
  }
}

function normalizePath(path: string): string {
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}

async function firstVisible(page: Page, selectors: readonly string[], timeoutMs: number): Promise<Locator | undefined> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 150 }).catch(() => false)) {
        return locator;
      }
    }

    await page.waitForTimeout(100);
  }

  return undefined;
}

function assistantMessageLocator(page: Page): Locator {
  return page.locator(chatGptSelectors.assistantMessage.join(", "));
}

function userMessageLocator(page: Page): Locator {
  return page.locator(chatGptSelectors.userMessage.join(", "));
}

async function firstEnabled(page: Page, selectors: readonly string[], timeoutMs: number): Promise<Locator | undefined> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const visible = await locator.isVisible({ timeout: 150 }).catch(() => false);
      const enabled = visible ? await locator.isEnabled({ timeout: 150 }).catch(() => false) : false;
      if (enabled) {
        return locator;
      }
    }

    await page.waitForTimeout(100);
  }

  return undefined;
}

async function fillComposer(page: Page, composer: Locator, prompt: string): Promise<void> {
  await composer.click({ timeout: 5_000 });
  await composer.fill(prompt).catch(async () => {
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.insertText(prompt);
  });
}

async function readComposerText(composer: Locator): Promise<string> {
  return composer
    .evaluate((element) => {
      const candidates = new Set<string>();

      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        candidates.add(element.value);
      }

      if (element instanceof HTMLElement) {
        candidates.add(element.innerText);
      }

      candidates.add(element.textContent ?? "");

      return [...candidates]
        .map((value) => value ?? "")
        .sort((left, right) => right.length - left.length)[0] ?? "";
    })
    .catch(() => "");
}

function composerLikelyContainsPrompt(actual: string, expected: string): boolean {
  const normalizedActual = normalizePromptComparisonText(actual);
  const normalizedExpected = normalizePromptComparisonText(expected);
  if (!normalizedExpected) {
    return Boolean(normalizedActual);
  }

  if (normalizedActual.includes(normalizedExpected)) {
    return true;
  }

  const collapsedActual = collapseComparisonWhitespace(normalizedActual);
  const collapsedExpected = collapseComparisonWhitespace(normalizedExpected);
  if (collapsedActual.includes(collapsedExpected)) {
    return true;
  }

  if (collapsedExpected.length < 96) {
    return false;
  }

  const signatureLength = Math.min(96, Math.floor(collapsedExpected.length / 3));
  const startSignature = collapsedExpected.slice(0, signatureLength);
  const endSignature = collapsedExpected.slice(-signatureLength);
  return collapsedActual.includes(startSignature) && collapsedActual.includes(endSignature);
}

function normalizePromptComparisonText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

function collapseComparisonWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isConversationUnavailableText(bodyText: string): boolean {
  return /conversation not found|unable to load conversation|conversation unavailable|you do not have access|can't access this chat|could not load chat|无法加载到会话|找不到会话|会话不可用|无法访问此聊天|你无权访问此聊天/i.test(
    bodyText
  );
}

function summarizeBodyText(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.slice(0, 240);
}

function isTransientSendButtonError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    /detached from the dom|element is not attached|not attached to the dom/i.test(error.message) ||
    isPlaywrightTimeout(error)
  );
}
