# Browser LLM MCP

Browser LLM MCP is a local TypeScript MCP server that lets a small-model agent use stronger browser-based LLMs through a stable MCP tool interface. In practice, this means an agent built on a smaller or cheaper model can delegate hard reasoning or synthesis work to a logged-in web LLM such as ChatGPT today, and later Gemini, Claude, Kimi, or DeepSeek, without needing direct browser primitives.

## Why this shape

- Small agents call high-level MCP tools such as `browser_llm_ask`; they do not need browser click/type/read primitives.
- The main product goal is capability bridging: a small model or lightweight agent can borrow the strengths of a larger web LLM while staying in control of the workflow.
- Credentials are never accepted or stored by the server. Login state lives only in a dedicated Playwright browser profile.
- Each provider gets its own profile under `~/.browser-llm-mcp/profiles/<provider>`.
- Logs are written to stderr so stdout remains reserved for MCP protocol messages.
- The overall architecture, roadmap, completed work, and next plan are recorded in `ARCHITECTURE.md`.
- Project decisions and per-round implementation notes are recorded in `MEMORY.md`.
- Manual robustness and real ChatGPT acceptance steps are recorded in `MANUAL_TEST.md`.

## Install

```bash
npm install
npm run build
```

If Playwright does not install Chromium automatically in your environment, run:

```bash
npx playwright install chromium
```

## Run

```bash
npm run dev
```

For MCP clients, point the server command at the built binary:

```json
{
  "mcpServers": {
    "browser-llm-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/Browser-LLM-MCP/dist/server.js"]
    }
  }
}
```

On macOS with system Google Chrome installed, Browser LLM MCP now defaults to local Chrome CDP autostart, so the minimal config above is usually enough for ChatGPT. Set `BROWSER_LLM_LAUNCH_MODE=persistent` if you want to force the older Playwright persistent-profile path instead.

## Linux and Windows

Browser LLM MCP can also run on Linux and Windows.

- The core stack is cross-platform: Node.js, Playwright, and MCP stdio transport.
- On Linux and Windows, the safest default is `BROWSER_LLM_LAUNCH_MODE=persistent`.
- In `persistent` mode, Browser LLM MCP lets Playwright manage the browser profile directly, which avoids platform-specific Chrome discovery issues.
- `cdp` mode is also supported on Linux and Windows, but local CDP autostart expects a launchable Chrome executable on the system path:
  - Windows: `chrome.exe`
  - Linux: `google-chrome`
- If your machine does not expose those commands directly, prefer `persistent` mode or start Chrome with remote debugging yourself and pass `BROWSER_LLM_CDP_ENDPOINT`.

Example Linux or Windows MCP config:

```json
{
  "mcpServers": {
    "browser-llm-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/Browser-LLM-MCP/dist/server.js"],
      "env": {
        "BROWSER_LLM_LAUNCH_MODE": "persistent"
      }
    }
  }
}
```

## Tools

- `browser_llm_list_providers`
- `browser_llm_open_login`
- `browser_llm_status`
- `browser_llm_ask`
- `browser_llm_close`

`browser_llm_ask` accepts a `sessionId`. Prefer always passing a stable `sessionId`: if it does not exist yet, Browser LLM MCP starts a new provider conversation and stores the URL; if it already exists, Browser LLM MCP continues that saved provider conversation. If the saved URL becomes unavailable because the account changed, the conversation was deleted, or the provider denies access, Browser LLM MCP replaces the stale mapping with a new provider conversation for the same `sessionId` and returns a warning. The response includes the complete assistant text plus the updated provider conversation URL.

`browser_llm_ask` also accepts optional `filePaths` for local `.json`, `.md`, `.markdown`, `.txt`, and `.log` files. Browser LLM MCP reads those files on the server side and inlines their contents into the submitted prompt, so the calling agent does not need to spend its own context window on the raw file text. The provider still consumes tokens for the inlined file content.

Long-running `browser_llm_ask` calls now emit MCP `notifications/progress` heartbeats when the client requests progress. This helps SDK-based clients avoid mistaking slow ChatGPT "deep thinking" responses for dead requests. Clients that use the MCP SDK should pair `onprogress` with `resetTimeoutOnProgress: true` or otherwise raise their request timeout above the expected model runtime.

For provider-required tools, an omitted, null, or blank-string provider defaults to `chatgpt`. This helps MCP clients with form UIs that submit an empty string for an unselected provider.

## First ChatGPT flow

1. Start the MCP server from your MCP client.
2. Call `browser_llm_open_login` with `{ "provider": "chatgpt" }`.
3. Log into ChatGPT in the opened browser window.
4. Call `browser_llm_status` to confirm the provider sees a logged-in composer.
5. Call `browser_llm_ask` with a prompt.

For the full manual checklist, see `MANUAL_TEST.md`.

The first release intentionally runs a headed browser by default because it makes login, captcha, and selector-drift problems visible.

## Environment

- `BROWSER_LLM_HOME`: runtime home directory. Defaults to `~/.browser-llm-mcp`.
- `BROWSER_LLM_HEADLESS`: set to `1` or `true` to run headless.
- `BROWSER_LLM_LAUNCH_MODE`: `cdp` or `persistent`. When omitted, Browser LLM MCP auto-selects `cdp` on macOS with system Google Chrome installed, otherwise `persistent`.
- `BROWSER_LLM_CHATGPT_URL`: override the ChatGPT base URL. Useful for local integration tests.
- `BROWSER_LLM_TIMEOUT_MS`: default ask timeout in milliseconds. Defaults to `600000`.
- `BROWSER_LLM_PROGRESS_HEARTBEAT_MS`: progress heartbeat interval for long-running asks, in milliseconds. Defaults to `10000`.
- `BROWSER_LLM_BROWSER_CHANNEL`: Playwright browser channel, for example `chrome` or `chromium`. On macOS with Google Chrome installed, the default is `chrome`.
- `BROWSER_LLM_PROXY_SERVER`: optional browser proxy, for example `http://127.0.0.1:7890` or `socks5://127.0.0.1:7890`. This is applied to Playwright persistent launch and to local Chrome CDP autostart.
- `BROWSER_LLM_CDP_ENDPOINT`: optional Chrome DevTools Protocol endpoint, for example `http://127.0.0.1:9222`. In `cdp` mode, the default is `http://127.0.0.1:9222`.
- `BROWSER_LLM_CDP_AUTOSTART`: set to `1` or `true` to let Browser LLM MCP start the local debug Chrome when the CDP endpoint is not already running. In `cdp` mode, the default is `true` for local endpoints and `false` for remote ones.
- `BROWSER_LLM_CDP_USER_DATA_DIR`: profile directory used by CDP autostart. Defaults to `~/.browser-llm-mcp/cdp-chrome-profile`.
- `BROWSER_LLM_CDP_STARTUP_URL`: optional URL opened by CDP autostart. Defaults to the provider page where applicable.
- `BROWSER_LLM_LOCALE`: optional browser locale, for example `zh-CN`.
- `BROWSER_LLM_TIMEZONE_ID`: optional browser timezone, for example `Asia/Shanghai`.

Session mappings are stored in `~/.browser-llm-mcp/sessions.json` by default. They contain one active provider conversation URL per provider plus `sessionId`, not credentials or multiple account histories.

## Provider status

Implemented:

- `chatgpt`

Planned:

- `kimi`
- `deepseek`
- `claude`
- `gemini`
