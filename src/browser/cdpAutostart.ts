import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { BrowserLlmError } from "../errors.js";

export interface CdpAutostartOptions {
  endpoint: string;
  userDataDir: string;
  startupUrl?: string;
  proxyServer?: string;
}

export async function ensureCdpEndpoint(options: CdpAutostartOptions): Promise<"already-running" | "started"> {
  if (await isCdpEndpointReady(options.endpoint)) {
    return "already-running";
  }

  await startChromeWithCdp(options);

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isCdpEndpointReady(options.endpoint)) {
      return "started";
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new BrowserLlmError("BROWSER_LAUNCH_FAILED", "Started Chrome but the CDP endpoint did not become ready.", {
    endpoint: options.endpoint,
    userDataDir: options.userDataDir
  });
}

async function isCdpEndpointReady(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function startChromeWithCdp(options: CdpAutostartOptions): Promise<void> {
  const endpoint = new URL(options.endpoint);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
    throw new BrowserLlmError("BROWSER_LAUNCH_FAILED", "CDP autostart only supports local endpoints.", {
      endpoint: options.endpoint
    });
  }

  const port = endpoint.port || "9222";
  await fs.mkdir(options.userDataDir, { recursive: true });

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${options.userDataDir}`,
    "--no-first-run",
    ...(options.proxyServer ? [`--proxy-server=${options.proxyServer}`] : []),
    ...(options.startupUrl ? [options.startupUrl] : [])
  ];

  if (process.platform === "darwin") {
    const child = spawn("open", ["-na", "Google Chrome", "--args", ...chromeArgs], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return;
  }

  const executable = process.platform === "win32" ? "chrome.exe" : "google-chrome";
  const child = spawn(executable, chromeArgs, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}
