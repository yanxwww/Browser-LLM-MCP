# Browser LLM MCP Memory

This file is the project memory log. Keep it updated after each implementation round so a future human or agent can understand what changed, why it changed, and what should happen next.

## Logging Rules

- Add one entry per work round, newest first.
- Record intent, important behavior changes, files or subsystems touched, verification commands, and follow-ups.
- Do not store credentials, cookies, profile contents, tokens, or private prompt/response text.
- Prefer behavior-level notes over long file inventories, unless a file path is needed to disambiguate a change.
- If a command fails and affects the next step, record the failure and the resolution.

## 2026-04-18 - Prepare Repository For Cross-Platform GitHub Publishing

Intent:

- Clarify Linux and Windows runtime expectations and get the project ready for an initial GitHub push.
- Align the project description with its actual purpose: helping small-model agents borrow the capabilities of stronger browser-based LLMs.

Changes:

- Added README guidance for Linux and Windows, including the recommended `persistent` launch mode and the conditions under which CDP autostart works cross-platform.
- Reframed README, architecture, and package metadata so the project clearly presents itself as a capability bridge from small-model agents to stronger web LLMs.
- Added a standard MIT `LICENSE` file to match the package metadata before publishing the repository.
- Prepared the workspace for Git initialization and first-push setup.

Verification:

- Reviewed platform-specific launch logic in `src/config.ts`, `src/browser/BrowserController.ts`, and `src/browser/cdpAutostart.ts`.

Result:

- README now explains macOS vs Linux/Windows behavior more clearly.
- Repository now includes an explicit MIT license file for GitHub publication.

## 2026-04-16 - Add Progress Heartbeats For Long-Running MCP Ask Requests

Intent:

- Prevent MCP clients from timing out long ChatGPT web requests just because the model is still thinking and the server has not returned a final tool result yet.

Changes:

- Added periodic MCP `notifications/progress` heartbeats to `browser_llm_ask` when the client requests progress support.
- Added retry-phase progress messaging when a stored conversation is missing and Browser LLM MCP automatically replays the ask in a fresh conversation.
- Increased the default Browser LLM ask timeout from `180000` ms to `600000` ms.
- Added `BROWSER_LLM_PROGRESS_HEARTBEAT_MS` to control the heartbeat interval for long-running asks.
- Documented that SDK-based clients should use `onprogress` plus `resetTimeoutOnProgress: true` or otherwise increase their client-side request timeout.
- Added a tools-level regression that proves progress heartbeats keep a short client timeout alive for a deliberately slow provider.

Verification:

- `npm run typecheck`
- `npm test -- --run tests/tools.robustness.test.ts tests/config.test.ts`
- `npm test -- --run`
- `npm run build`

Result:

- Typecheck passed.
- Focused progress/config tests passed: 2 test files, 17 tests.
- Full tests passed: 8 test files, 37 tests.
- Build passed.

## 2026-04-16 - Tighten ChatGPT Submission Detection And Faster Missing-Session Recovery

Intent:

- Fix two real-world ChatGPT issues: long hangs after the composer cleared without a visible answer ever starting, and failed continuation when a stored conversation had been deleted from the ChatGPT web UI.

Changes:

- Tightened prompt-submission detection so Browser LLM MCP no longer treats a cleared composer alone as proof that ChatGPT accepted the turn.
- Added a separate "submission pending" state so the adapter avoids duplicate clicks after the composer clears, but still requires a real signal before moving on to answer-waiting.
- Reduced conservative stability waits for idle conversation detection and finished-answer detection to trim end-to-end latency.
- Changed new-conversation URL waiting to spend its 8-second budget from the moment the prompt is submitted, instead of starting a fresh wait after the answer is already complete.
- Expanded unavailable-conversation detection to include Chinese ChatGPT copy such as `无法加载到会话`, and now fail continued sessions as `SESSION_NOT_FOUND` when a stored conversation page never becomes usable.
- Added mock regressions for Chinese unavailable-conversation text and for the "composer cleared but no turn ever started" path.

Verification:

- `npm run typecheck`
- `npm test -- --run tests/chatgptAdapter.mock.test.ts tests/tools.robustness.test.ts`
- `npm run build`

Result:

- Typecheck passed.
- Focused ChatGPT/session tests passed: 2 test files, 22 tests.
- Build passed.

## 2026-04-16 - Retry ChatGPT Send Button Submission Across DOM Re-renders

Intent:

- Fix real ChatGPT ask failures where the send button detached or re-rendered during click, causing long delays and eventual raw Playwright click timeouts even though the prompt was already present in the composer.

Changes:

- Reworked prompt submission so Browser LLM MCP no longer trusts a single send-button click attempt.
- Added retry logic for transient detached-element and click-timeout errors while re-acquiring the send button.
- After each apparently successful click, Browser LLM MCP now confirms that prompt submission actually started; if not, it retries instead of assuming success.
- Added a mock ChatGPT regression test where the first send button re-renders during click and only a retry reaches the replacement button.

Verification:

- `npm run typecheck`
- `npm test -- --run`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 8 test files, 33 tests.
- Build passed.

## 2026-04-16 - Relax ChatGPT Composer Write Verification For Normalized Prompts

Intent:

- Fix real ChatGPT ask failures where the prompt visibly appeared in the composer, but Browser LLM MCP still raised `SELECTOR_CHANGED` because the page normalized whitespace or rich-text content differently from the original submitted text.

Changes:

- Replaced the strict `composerText.includes(prompt)` check with a normalized comparison that tolerates whitespace normalization and long-prompt rich-text differences.
- Updated prompt-submission waiting logic to use the same normalized composer comparison.
- Improved composer text reading so it considers `value`, `innerText`, and `textContent`, then chooses the richest available representation.
- Added a mock ChatGPT regression test where the composer rewrites whitespace before submit, and verified that ask still succeeds.

Verification:

- `npm run typecheck`
- `npm test -- --run`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 8 test files, 32 tests.
- Build passed.

## 2026-04-16 - Rename Workspace Directory To Browser-LLM-MCP

Intent:

- Remove spaces from the workspace directory name so tools like MCP Inspector do not split the server path incorrectly when launching `node dist/server.js`.

Changes:

- Renamed the project directory from `/Users/yy/project/Browser LLM MCP` to `/Users/yy/project/Browser-LLM-MCP`.
- Updated repo documentation examples that referenced the old absolute path.

Verification:

- Confirmed the project now exists at `/Users/yy/project/Browser-LLM-MCP`.
- Searched the repo for the old absolute path and updated the remaining documentation hits.

Follow-ups:

- Prefer `cd "/Users/yy/project/Browser-LLM-MCP"` and then `npx @modelcontextprotocol/inspector -- node dist/server.js` for Inspector runs.

## 2026-04-16 - Inline Local Text Files Into browser_llm_ask

Intent:

- Let agents pass local file paths for `.json`, `.md`, `.markdown`, `.txt`, and `.log` so Browser LLM MCP can read the files itself and submit their contents to the web LLM without first spending the agent's own context window on raw file text.

Changes:

- Added optional `filePaths` to the public `browser_llm_ask` input schema.
- Added local prompt preparation logic that reads supported text files, enforces file count and size limits, and inlines their contents into the final submitted prompt.
- Added structured file-related error codes: `FILE_UNSUPPORTED`, `FILE_TOO_LARGE`, and `FILE_READ_FAILED`.
- Added tool-level warnings so the response makes it explicit when Browser LLM MCP inlined local files.
- Documented the feature in README, architecture notes, and manual testing steps, including the important caveat that it saves agent-side context tokens but still consumes provider-side tokens.

Verification:

- `npm run typecheck`
- `npm test -- --run`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 8 test files, 31 tests.
- Build passed.

Follow-ups:

- Consider exposing file metadata in the tool response later if agents need to know exactly which files were inlined after normalization.
- Consider a future true browser attachment flow separately; do not conflate it with prompt inlining.

## 2026-04-15 - Default To System Chrome CDP On macOS

Intent:

- Make ChatGPT usable with fewer MCP client env parameters by defaulting to the local system Chrome CDP path on macOS, where Playwright-style login is more likely to trigger verification loops.

Changes:

- Added `BROWSER_LLM_LAUNCH_MODE` with `cdp` and `persistent` modes; unresolved or omitted values stay on an auto mode internally.
- Auto mode now defaults to local Chrome CDP on macOS when `/Applications/Google Chrome.app` exists, otherwise it keeps the Playwright persistent path.
- In `cdp` mode, the default endpoint is now `http://127.0.0.1:9222`, and local endpoints default `cdpAutoStart` to `true`.
- Non-local CDP endpoints now default `cdpAutoStart` to `false` so remote attach setups are not broken by local autostart logic.
- Local Chrome CDP autostart now forwards `BROWSER_LLM_PROXY_SERVER` into Chrome startup arguments.
- Updated README, architecture notes, and manual test guidance to document the new default launch behavior and the persistent-mode override.

Verification:

- `npm run typecheck`
- `npm test -- --run`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 7 test files, 26 tests.
- Build passed.

Follow-ups:

- Consider adding a small status field or tool note that explicitly says when launch mode was auto-selected versus user-forced.

## 2026-04-15 - Recover Stale Session URLs After Account Changes

Intent:

- Keep the public `sessionId` contract simple while handling account switches, deleted provider conversations, and inaccessible saved ChatGPT URLs.

Changes:

- Kept the storage model as one active provider conversation URL per provider plus `sessionId`.
- Added tool-layer recovery: when an existing session mapping fails with `SESSION_NOT_FOUND`, remove the stale mapping, retry the same prompt as a new provider conversation, and update the mapping if the provider returns a stable URL.
- Added a warning so MCP clients can tell the user/agent that continuity was reset.
- Added ChatGPT adapter detection for same-URL unavailable conversation pages, including "conversation not found" and access-denied text.
- Updated README, architecture notes, and manual tests to document stale-session recovery.

Verification:

- `npm run typecheck`
- `npm test -- --run`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 7 test files, 23 tests.
- Build passed.
- One sandboxed Vitest run failed with `listen EPERM` on `127.0.0.1` for local mock servers; rerunning `npm test -- --run` with escalation passed cleanly.

Follow-ups:

- Consider explicit session management tools later, especially `browser_llm_forget_session`, for users who want to reset a session before asking.

## 2026-04-15 - Document SessionId-Driven Conversation Flow

Intent:

- Simplify the user/agent contract so callers cannot pass `conversation`.
- Make `sessionId` the primary conversation-control mechanism.

Changes:

- Removed `conversation` from the public `browser_llm_ask` input schema.
- Made `sessionId` required in the public `browser_llm_ask` input schema.
- Updated tool description and docs to say stable `sessionId` must be passed on every ask.
- Clarified behavior: missing `sessionId` mapping creates a new provider conversation; existing mapping continues the saved provider conversation.
- Kept internal `new`/`continue` state only inside the service/provider layer.

Verification:

- `npm run typecheck`
- `npm test`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 7 test files, 21 tests.
- Build passed.

Follow-ups:

- Consider adding session management tools later: list sessions, forget session, rename session.

## 2026-04-15 - Prevent Continue From Falling Back To New Chat

Intent:

- Fix real testing behavior where `conversation: "continue"` with a same-looking session id created a new ChatGPT conversation and the MCP client did not receive the expected continued-session answer.

Root cause:

- If a `continue` request had no stored conversation URL, the adapter fell through to the homepage/new-chat path.
- Tool input only accepted `sessionId`, so MCP clients/users sending `sessionid`, `session_id`, or `sessionID` lost the session id silently.
- The tool layer blindly stored provider URLs even when ChatGPT had not exposed a stable `/c/...` conversation URL.

Changes:

- Added `SESSION_NOT_FOUND` error code.
- Provider-required `browser_llm_ask` now accepts `sessionId`, `sessionid`, `session_id`, and `sessionID`.
- Explicit `conversation: "continue"` now requires a stored session URL and fails before provider execution if missing.
- ChatGPT adapter now refuses `continue` without `conversationUrl`.
- Session mappings for ChatGPT are only updated when the returned URL has a stable `/c/...` path.
- ChatGPT adapter waits up to 8 seconds after a new answer for the `/c/...` conversation URL before returning.
- Added regression tests for alias session ids, missing-session continue, missing-session-id continue, unstable URL storage, and adapter-level continue without URL.

Verification:

- `npm run typecheck`
- `npm test`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 7 test files, 22 tests.
- Build passed.

Follow-ups:

- In manual tests, inspect `~/.browser-llm-mcp/sessions.json` after the first ask and confirm the session maps to a `https://chatgpt.com/c/...` URL before trying explicit continue.

## 2026-04-15 - Fix Continued Session Returning Old ChatGPT Reply

Intent:

- Fix real testing behavior where a repeated `sessionId` continued to a saved ChatGPT URL but returned the latest old assistant message without submitting the new prompt.

Root cause:

- On a continued conversation URL, old transcript messages can load after `domcontentloaded`.
- The adapter counted assistant messages too early, then treated delayed history hydration as a new response.
- Prompt submission was not explicitly confirmed before waiting for the assistant response.

Changes:

- Added user-message selectors.
- Before submitting, ChatGPT adapter now waits for the existing conversation transcript counts/text to become stable.
- After submitting, it confirms the prompt was accepted by checking user message count, composer clearing, or generation start.
- Assistant response waiting now requires a new assistant message after the stable baseline and ignores the previous latest assistant text.
- Added a mock regression test where old history loads late and must not be returned as the new answer.

Verification:

- `npm run typecheck`
- `npm test`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 7 test files, 17 tests.
- Build passed.

Follow-ups:

- Retry `browser_llm_ask` with the same `sessionId` in CDP mode and confirm the prompt appears in the ChatGPT conversation before the returned answer.

## 2026-04-15 - Add CDP Autostart Mode

Intent:

- Allow the CDP attach startup command to be folded into Browser LLM MCP so the user does not need to manually run the Chrome command every time.

Changes:

- Added `BROWSER_LLM_CDP_AUTOSTART`, `BROWSER_LLM_CDP_USER_DATA_DIR`, and `BROWSER_LLM_CDP_STARTUP_URL`.
- Added a CDP autostart helper that checks `/json/version`, starts local Chrome when needed, and waits for the endpoint to become ready.
- Browser controller now autostarts local CDP Chrome before `connectOverCDP` when configured.
- Added tests for already-running CDP endpoint detection and non-local endpoint rejection.
- Updated README, architecture notes, and manual testing docs.

Verification:

- `npm run typecheck`
- `npm test`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 7 test files, 16 tests.
- Build passed.

Follow-ups:

- Use CDP attach manually once to confirm the profile can log in, then switch to CDP autostart for convenience.

## 2026-04-15 - Add CDP Attach Mode For Login Verification Loops

Intent:

- Address persistent ChatGPT human-verification loops after system Chrome launch mode still failed.
- Provide a legitimate path where the user manually starts Chrome, completes verification/login, and Browser LLM MCP attaches to that browser.

Changes:

- Added `BROWSER_LLM_CDP_ENDPOINT`.
- Browser controller can connect to an existing Chromium browser over CDP instead of launching a persistent profile.
- Browser status now reports `launchMode: "persistent" | "cdp"` and the CDP endpoint when used.
- Added manual CDP attach steps to `MANUAL_TEST.md`.
- Updated README and architecture notes.

Verification:

- `npm run typecheck`
- `npm test`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 6 test files, 14 tests.
- Build passed.

Follow-ups:

- Start Chrome with `--remote-debugging-port=9222`, log into ChatGPT manually, then run MCP with `BROWSER_LLM_CDP_ENDPOINT=http://127.0.0.1:9222`.

## 2026-04-15 - Default Blank Provider To ChatGPT

Intent:

- Fix an MCP client validation failure where `browser_llm_open_login` received `provider: ""` and the SDK rejected the call with `-32602`.

Changes:

- Provider-required tools now treat omitted, null, or blank-string provider values as `chatgpt`.
- Optional provider tools treat blank provider as omitted.
- Added MCP in-memory regression coverage for blank provider values on `browser_llm_open_login` and `browser_llm_ask`.
- Updated README, architecture, and manual test docs.

Verification:

- `npm run typecheck`
- `npm test`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 6 test files, 14 tests.
- Build passed.

Follow-ups:

- Retry `browser_llm_open_login` from the MCP client; `provider: ""` should now open ChatGPT instead of returning `-32602`.

## 2026-04-15 - Improve ChatGPT Login Reliability Diagnostics

Intent:

- Respond to a real manual-test issue where ChatGPT opened `https://chatgpt.com/api/auth/error` and human verification repeated.
- Improve legitimate login reliability without attempting to bypass verification.

Changes:

- Added browser launch configuration for system Chrome channel, explicit proxy server, locale, and timezone.
- Default on macOS now prefers system Google Chrome when installed.
- Added current URL, browser channel, and proxy server details to browser runtime status.
- Documented verification-loop troubleshooting in `MANUAL_TEST.md`.
- Updated README environment variable documentation and architecture known gaps.

Verification:

- `npm run typecheck`
- `npm test`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 6 test files, 13 tests.
- Build passed.

Follow-ups:

- Re-run `browser_llm_open_login` with `BROWSER_LLM_BROWSER_CHANNEL=chrome`.
- Try direct network first; add `BROWSER_LLM_PROXY_SERVER=http://127.0.0.1:7890` only if normal Chrome also needs that proxy.
- If the dedicated ChatGPT profile is stuck in a bad auth state, move it aside and retry with a clean profile.

## 2026-04-15 - Robustness Tests And Manual Test Checklist

Intent:

- Pause feature work and harden the existing v1 behavior with additional robustness tests.
- Provide a clear manual test procedure for real ChatGPT Web acceptance.

Changes:

- Added MCP tool-level robustness tests using the MCP SDK in-memory transport.
- Covered structured provider-disabled errors, malformed ask input, `sessionId` continuation, and new-session session storage behavior.
- Added `MANUAL_TEST.md` with preflight, MCP client config, provider listing, login, status, ask, continuation, planned-provider error, malformed-input error, close, and failure-artifact checks.
- Updated `README.md` and `ARCHITECTURE.md` to reference the manual checklist and current test coverage.

Verification:

- `npm run typecheck`
- `npm test`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 6 test files, 13 tests.
- Build passed.

Follow-ups:

- Execute `MANUAL_TEST.md` against a real MCP client and logged-in ChatGPT account.
- Record real ChatGPT selector or flow issues here before changing the adapter.

## 2026-04-15 - Add Architecture And Roadmap Document

Intent:

- Add a stable project overview separate from the chronological memory log.
- Record the overall architecture, MCP tool contract, runtime data model, current completion state, known gaps, and next plan.

Changes:

- Added `ARCHITECTURE.md`.
- Updated `README.md` to point to `ARCHITECTURE.md`.
- Updated this memory log with the documentation round.

Verification:

- Documentation-only change; no build or test run required for this round.

Follow-ups:

- Keep `ARCHITECTURE.md` updated whenever the provider interface, MCP tool contract, or roadmap changes.
- Keep `MEMORY.md` updated after each implementation round.

## 2026-04-15 - Add Project Memory Document

Intent:

- Create a durable Markdown memory document for per-round operation/change notes.
- Make the memory convention explicit so future provider work can continue without relying only on chat history.

Changes:

- Added `MEMORY.md` with logging rules and a first project history entry.
- Updated `README.md` to point contributors and future agents to this memory log.

Verification:

- Documentation-only change; no build or test run required for this round.

Follow-ups:

- Append a new entry after each future implementation round, especially when adding Kimi, DeepSeek, Claude, Gemini, or changing MCP tool contracts.

## 2026-04-15 - Scaffold Browser LLM MCP And ChatGPT V1

Intent:

- Build the first runnable TypeScript MCP server for Browser LLM MCP.
- Expose high-level MCP tools for small agents instead of low-level browser actions.
- Implement ChatGPT Web first while reserving architecture slots for Kimi, DeepSeek, Claude, and Gemini.

Changes:

- Created a TypeScript project with MCP SDK, Playwright, Zod, Vitest, and build/typecheck/test scripts.
- Implemented stdio MCP server with tools:
  - `browser_llm_list_providers`
  - `browser_llm_open_login`
  - `browser_llm_status`
  - `browser_llm_ask`
  - `browser_llm_close`
- Added provider registry with `chatgpt` enabled and `kimi`, `deepseek`, `claude`, `gemini` marked as planned providers.
- Added `BrowserController` to manage Playwright persistent contexts, provider-specific profiles, screenshots on failure, and single-provider request queueing.
- Added ChatGPT adapter for login detection, prompt submission, response waiting, latest assistant message extraction, captcha/rate-limit detection, and structured errors.
- Added `SessionStore` and `browser_llm_ask.sessionId` support so an agent can continue the same provider web conversation by session id.
- Added README usage notes, MCP client sample config, environment variables, and provider status.
- Added mock ChatGPT integration tests plus unit tests for config, registry, queueing, and session persistence.

Verification:

- `npm install`
- `HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 ALL_PROXY=socks5://127.0.0.1:7890 npx playwright install chromium`
- `npm run typecheck`
- `npm test`
- `npm run build`

Result:

- Typecheck passed.
- Tests passed: 5 test files, 9 tests.
- Build passed and produced `dist/server.js`.

Notes:

- Playwright browser download initially stalled without proxy; proxy `127.0.0.1:7890` resolved it.
- Real ChatGPT Web selectors may drift. The adapter returns `SELECTOR_CHANGED` and captures screenshots when possible.
- Session mappings are provider conversation URLs only; credentials remain in the dedicated browser profile.

Follow-ups:

- Run a real MCP client manual acceptance flow against ChatGPT Web.
- Add Kimi adapter next using the existing provider interface and session mechanism.
- Consider adding a dedicated provider-adapter template once the second provider reveals common patterns.
