import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startPreview } from "../src/preview-server.mjs";
import { ROOT } from "../src/config.mjs";

test(
  "native mini control uses authenticated local endpoints without activating its test window",
  { timeout: 15000 },
  async (t) => {
    let paused = false,
      opened = 0,
      miniOpened = 0;
    const service = await startPreview({
      port: 0,
      command: async ({ action }) => {
        if (action === "pause") paused = true;
        if (action === "resume") paused = false;
        return { running: true, paused };
      },
      capture: { close() {} },
      agent: { close() {} },
      openWindow: async () => {
        opened++;
        return 1;
      },
      openMini: async () => {
        miniOpened++;
      },
    });
    t.after(() => service.close());
    const base = `http://127.0.0.1:${service.port}`;
    const headers = {
      Authorization: `Bearer ${service.token}`,
      "Content-Type": "application/json",
    };
    for (const endpoint of ["/widget/state", "/widget/agent", "/mini"]) {
      assert.equal((await fetch(base + endpoint)).status, 403);
      assert.equal(
        (
          await fetch(base + endpoint, {
            headers: { ...headers, Origin: "https://example.com" },
          })
        ).status,
        403,
      );
    }
    assert.equal(
      (
        await fetch(base + "/widget/agent", {
          method: "POST",
          headers,
          body: '{"action":"stop"}',
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(base + "/mini", { method: "POST", headers })).status,
      200,
    );
    assert.equal(miniOpened, 1);
    await mkdir(path.join(ROOT, "test-results"), { recursive: true });
    const directory = await mkdtemp(path.join(ROOT, ".runtime", "mini-test-"));
    const config = path.join(directory, "preview.json");
    await writeFile(
      config,
      JSON.stringify({ port: service.port, token: service.token }),
      { mode: 0o600 },
    );
    const { stdout } = await promisify(execFile)(
      path.join(ROOT, "bin", "MiniMonitor.exe"),
      ["--check", config, path.join(ROOT, "test-results")],
      { windowsHide: true, timeout: 10000 },
    );
    const result = JSON.parse(stdout.trim());
    assert.equal(result.foregroundUnchanged, true);
    assert.equal(result.connected, true);
    assert.equal(result.pinReflected, true);
    assert.equal(result.expandReflected, true);
    assert.equal(result.collapseReflected, true);
    assert.equal(result.pauseReflected, true);
    assert.equal(result.openCollapsed, true);
    assert.equal(opened, 1);
    assert.equal(paused, true);
    assert.deepEqual(
      await (await fetch(base + "/widget/state", { headers })).json(),
      { running: true, paused: true },
    );
    await writeFile(
      path.join(ROOT, "test-results", "mini-control.json"),
      JSON.stringify(
        {
          ...result,
          authenticatedOpenVerified: true,
          authenticatedPauseVerified: true,
        },
        null,
        2,
      ),
    );
  },
);
