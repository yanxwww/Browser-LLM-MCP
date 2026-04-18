import http from "node:http";
import { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { ensureCdpEndpoint } from "../src/browser/cdpAutostart.js";

describe("CDP autostart helper", () => {
  it("detects an already running local CDP endpoint", async () => {
    const server = http.createServer((request, response) => {
      if (request.url === "/json/version") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ Browser: "Chrome/Test" }));
        return;
      }

      response.statusCode = 404;
      response.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    await expect(
      ensureCdpEndpoint({
        endpoint: `http://127.0.0.1:${address.port}`,
        userDataDir: "/tmp/browser-llm-cdp-autostart-test"
      })
    ).resolves.toBe("already-running");

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("rejects non-local endpoints for autostart", async () => {
    await expect(
      ensureCdpEndpoint({
        endpoint: "http://example.com:9222",
        userDataDir: "/tmp/browser-llm-cdp-autostart-test"
      })
    ).rejects.toMatchObject({ code: "BROWSER_LAUNCH_FAILED" });
  });
});
