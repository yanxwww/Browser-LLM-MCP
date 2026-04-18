# Browser LLM MCP Manual Test Steps

Use this checklist for manual robustness testing against the real ChatGPT Web UI. It assumes the project has already been installed and built.

## 1. Preflight

From the project root:

```bash
npm run typecheck
npm test
npm run build
```

If Chromium is missing:

```bash
HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 ALL_PROXY=socks5://127.0.0.1:7890 npx playwright install chromium
```

Expected:

- Typecheck passes.
- All tests pass.
- Build produces `dist/server.js`.

## 2. Configure MCP Client

Use the built server path in your MCP client:

```json
{
  "mcpServers": {
    "browser-llm-mcp": {
      "command": "node",
      "args": ["/Users/yy/project/Browser-LLM-MCP/dist/server.js"]
    }
  }
}
```

Expected:

- The MCP client starts the server without protocol errors.
- No normal log lines appear in stdout.
- On macOS with system Google Chrome installed, the default launch path is local Chrome CDP autostart, so no extra CDP env is required for the first ChatGPT run.

## 3. List Providers

Call:

```json
{
  "name": "browser_llm_list_providers",
  "arguments": {}
}
```

Expected:

- `chatgpt` is `enabled` and `implemented: true`.
- `kimi`, `deepseek`, `claude`, and `gemini` are `planned` and `implemented: false`.

## 4. Open ChatGPT Login

Call:

```json
{
  "name": "browser_llm_open_login",
  "arguments": {
    "provider": "chatgpt"
  }
}
```

Expected:

- A visible browser window opens.
- It navigates to ChatGPT.
- If not logged in, log in manually.
- The tool returns a JSON success payload.

## 5. Check Status

Call:

```json
{
  "name": "browser_llm_status",
  "arguments": {
    "provider": "chatgpt"
  }
}
```

Expected:

- `browserRunning: true`.
- `loginState` should become `logged_in` after the ChatGPT composer is visible.
- `launchMode` is usually `cdp` on macOS with system Google Chrome, otherwise `persistent`.
- `profilePath` points under `~/.browser-llm-mcp/profiles/chatgpt`.

## 6. Ask A New Session

Call:

```json
{
  "name": "browser_llm_ask",
  "arguments": {
    "provider": "chatgpt",
    "sessionId": "manual-chatgpt-001",
    "prompt": "Reply with exactly: Browser LLM MCP manual test OK"
  }
}
```

Expected:

- The browser submits the prompt.
- The tool returns `ok: true`.
- The returned `answer.answer` contains the full assistant response text.
- The returned `answer.providerConversationUrl` is a ChatGPT conversation URL.
- `~/.browser-llm-mcp/sessions.json` stores the mapping for `chatgpt:manual-chatgpt-001`.

## 6b. Ask With Local File Paths

Prepare a small local file such as `/tmp/browser-llm-manual.json`:

```json
{
  "service": "api",
  "status": "error",
  "retries": 2
}
```

Call:

```json
{
  "name": "browser_llm_ask",
  "arguments": {
    "provider": "chatgpt",
    "sessionId": "manual-chatgpt-files-001",
    "prompt": "Analyze this local file and summarize the issue in one paragraph.",
    "filePaths": ["/tmp/browser-llm-manual.json"]
  }
}
```

Expected:

- The browser submits a single prompt without the MCP client manually pasting the file contents.
- The tool returns `ok: true`.
- The returned warnings include a note that Browser LLM MCP inlined local files into the prompt.
- The assistant answer reflects the JSON file contents.

## 7. Continue The Same Session

Call:

```json
{
  "name": "browser_llm_ask",
  "arguments": {
    "provider": "chatgpt",
    "sessionId": "manual-chatgpt-001",
    "prompt": "What was the exact phrase I asked you to reply with in the previous message?"
  }
}
```

Expected:

- The browser reopens or stays in the same ChatGPT conversation.
- The new prompt appears in the ChatGPT conversation before the tool returns.
- The assistant answer references `Browser LLM MCP manual test OK`.
- The returned `conversationMode` is `continue`.
- The same `sessionId` remains in the response.

To confirm the session is stored:

```bash
cat ~/.browser-llm-mcp/sessions.json
```

Expected:

- The key `chatgpt:manual-chatgpt-001` exists.
- Its `url` starts with `https://chatgpt.com/c/`.

If the key does not exist, send the same `sessionId` once; Browser LLM MCP will create and store a new provider conversation.

## 7b. Stale Session Or Account Switch Recovery

If you switch ChatGPT accounts, delete a stored conversation, or otherwise make the saved `/c/...` URL inaccessible, call `browser_llm_ask` again with the same `sessionId`.

Expected:

- The tool first attempts the stored provider conversation URL.
- If ChatGPT redirects away from the saved URL or shows a conversation-unavailable page, the stale mapping is removed.
- The same prompt is retried in a new provider conversation.
- The result returns `ok: true`, `conversationMode: "new"`, the same `sessionId`, and a warning that the stored provider conversation URL was unavailable.
- `~/.browser-llm-mcp/sessions.json` is updated to the new `https://chatgpt.com/c/...` URL if ChatGPT exposes one.

## 8. Planned Provider Error

Call:

```json
{
  "name": "browser_llm_ask",
  "arguments": {
    "provider": "kimi",
    "sessionId": "manual-kimi-001",
    "prompt": "hello"
  }
}
```

Expected:

- The tool returns `isError: true`.
- The JSON text contains `error.code: "PROVIDER_DISABLED"`.
- The MCP server remains usable after this error.

## 9. Malformed Input Error

Call:

```json
{
  "name": "browser_llm_ask",
  "arguments": {
    "provider": "chatgpt",
    "prompt": ""
  }
}
```

Expected:

- The tool returns an error result.
- The browser should not submit anything.
- The server remains usable after this error.

## 9b. Blank Provider Compatibility

Some MCP clients send an empty string when a provider selector is left blank. Call:

```json
{
  "name": "browser_llm_open_login",
  "arguments": {
    "provider": ""
  }
}
```

Expected:

- The tool treats the blank provider as `chatgpt`.
- No MCP `-32602` input validation error is returned.
- The ChatGPT login browser opens.

## 10. Close Browser

Call:

```json
{
  "name": "browser_llm_close",
  "arguments": {
    "provider": "chatgpt"
  }
}
```

Expected:

- The browser window closes.
- The profile directory remains on disk.
- A later `browser_llm_open_login` should reuse the saved login state.

## 11. Failure Artifacts

If a real ChatGPT interaction fails:

- Check the returned structured error code.
- Check `~/.browser-llm-mcp/artifacts/` for screenshots.
- Record the scenario and update `MEMORY.md`.

## 12. ChatGPT Human Verification Loop

If `browser_llm_open_login` lands on `https://chatgpt.com/api/auth/error` or the human verification repeats:

1. Do not try to bypass the verification. Close the Browser LLM MCP browser window and stop the MCP server.
2. In your normal Chrome, confirm that `https://chatgpt.com/` can log in successfully on the same network.
3. Prefer system Chrome for the MCP browser:

```json
{
  "mcpServers": {
    "browser-llm-mcp": {
      "command": "node",
      "args": ["/Users/yy/project/Browser-LLM-MCP/dist/server.js"],
      "env": {
        "BROWSER_LLM_BROWSER_CHANNEL": "chrome",
        "BROWSER_LLM_LOCALE": "zh-CN",
        "BROWSER_LLM_TIMEZONE_ID": "Asia/Shanghai"
      }
    }
  }
}
```

4. If ChatGPT only works through your local proxy, add this env value:

```json
{
  "BROWSER_LLM_PROXY_SERVER": "http://127.0.0.1:7890"
}
```

If the proxy version loops but normal Chrome without proxy works, remove `BROWSER_LLM_PROXY_SERVER` and retry on the direct network.

5. If the dedicated profile may have a bad auth state, close the browser and move it aside:

```bash
mv ~/.browser-llm-mcp/profiles/chatgpt ~/.browser-llm-mcp/profiles/chatgpt.bad-$(date +%s)
```

6. Start the MCP server again and call `browser_llm_open_login`.

Expected:

- A new system Chrome window opens with a clean Browser LLM MCP profile.
- Manual login completes without a repeated verification loop.
- If the loop still repeats, record the exact URL, network mode, and any screenshot from `~/.browser-llm-mcp/artifacts/`.

## 13. CDP Attach Mode For Persistent Verification Loops

If the Playwright-launched browser still repeats human verification, use CDP attach mode. This keeps login and verification in a Chrome instance you start manually, then lets Browser LLM MCP attach to it.

1. Stop the MCP server.
2. Start Chrome with a debugging port and a dedicated profile:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.browser-llm-mcp/cdp-chrome-profile"
```

3. In that Chrome window, open `https://chatgpt.com/` and complete login manually.
4. Confirm the ChatGPT composer is visible.
5. Configure the MCP server:

```json
{
  "mcpServers": {
    "browser-llm-mcp": {
      "command": "node",
      "args": ["/Users/yy/project/Browser-LLM-MCP/dist/server.js"],
      "env": {
        "BROWSER_LLM_CDP_ENDPOINT": "http://127.0.0.1:9222",
        "BROWSER_LLM_LOCALE": "zh-CN",
        "BROWSER_LLM_TIMEZONE_ID": "Asia/Shanghai"
      }
    }
  }
}
```

6. Call `browser_llm_status` with provider `chatgpt`.
7. Call `browser_llm_ask` with a stable `sessionId`.

Expected:

- `browser_llm_status` includes `launchMode: "cdp"` and `cdpEndpoint: "http://127.0.0.1:9222"`.
- The MCP server reuses the manually opened Chrome session.
- Verification is completed by you in Chrome; Browser LLM MCP only attaches after the browser is available.

Notes:

- Do not use this with sensitive tabs open in the same debug Chrome instance.
- Use the dedicated `cdp-chrome-profile` shown above rather than your daily Chrome profile.
- `browser_llm_close` disconnects Browser LLM MCP from the debug browser connection; close the Chrome window manually when finished.

## 14. CDP Autostart Mode

After CDP attach mode works, you can let Browser LLM MCP start the debug Chrome automatically. Configure Inspector like this:

```bash
BROWSER_LLM_CDP_ENDPOINT="http://127.0.0.1:9222" \
BROWSER_LLM_CDP_AUTOSTART="true" \
BROWSER_LLM_CDP_USER_DATA_DIR="$HOME/.browser-llm-mcp/cdp-chrome-profile" \
BROWSER_LLM_CDP_STARTUP_URL="https://chatgpt.com/" \
BROWSER_LLM_LOCALE="zh-CN" \
BROWSER_LLM_TIMEZONE_ID="Asia/Shanghai" \
npx @modelcontextprotocol/inspector node "dist/server.js"
```

Expected:

- If the debug Chrome is already running, MCP attaches to it.
- If it is not running, MCP starts Chrome with `--remote-debugging-port=9222` and the configured profile directory.
- Login state persists in `BROWSER_LLM_CDP_USER_DATA_DIR`.

Important:

- Keep the Chrome window open while making MCP requests.
- If you close Chrome, the next MCP request can autostart it again, but any page state that was only in memory is gone.
- The first time, you may still need to complete login/verification manually in the autostarted Chrome window.
