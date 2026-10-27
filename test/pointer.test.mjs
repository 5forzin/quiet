import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { AgentBrowser } from "../src/browser.mjs";
import { PreviewAgent } from "../src/preview-agent.mjs";
import { startPreview } from "../src/preview-server.mjs";
import { DesktopCapture } from "../src/preview-native.mjs";
import { ROOT } from "../src/config.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test(
  "visible browser pointer produces trusted hover and clicks without OS cursor movement",
  { timeout: 30000 },
  async (t) => {
    const fixture = http.createServer((request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      );
      response.end(`<!doctype html><title>Pointer fixture</title><style>
      body{margin:0;background:#eee;font:18px system-ui}button{position:absolute;left:150px;top:150px;width:240px;height:80px;background:#fff;border:1px solid #999;border-radius:12px;font:inherit}button:hover{background:#cde9df}p{position:absolute;left:150px;top:250px}
      </style><button id="target">Test click</button><p id="result">Waiting</p><script>
      target.dataset.hover='0';target.dataset.clicks='0';target.dataset.trusted='false';
      target.onmouseenter=()=>target.dataset.hover=Number(target.dataset.hover)+1;
      target.onclick=event=>{target.dataset.clicks=Number(target.dataset.clicks)+1;target.dataset.trusted=event.isTrusted;result.textContent='Clicked with the agent pointer';};
      </script>`);
    });
    await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => fixture.close(resolve)));
    const browser = new AgentBrowser({
      directory: await mkdtemp(path.join(ROOT, ".runtime", "pointer-test-")),
    });
    t.after(() => browser.shutdown());
    const tab = await browser.open(
      `http://127.0.0.1:${fixture.address().port}/`,
    );
    await browser.read(tab.id);
    const pointer = new PreviewAgent({ directory: browser.directory });
    const preview = await startPreview({
      port: 0,
      command: (command) => browser.run(command),
      agent: pointer,
      capture: { close() {} },
    });
    t.after(() => preview.close());
    const base = `http://127.0.0.1:${preview.port}/pointer`;
    const headers = {
      Authorization: `Bearer ${preview.token}`,
      "Content-Type": "application/json",
    };
    const call = async (command) => {
      const response = await fetch(base, {
        method: "POST",
        headers,
        body: JSON.stringify(command),
      });
      return { status: response.status, ...(await response.json()) };
    };
    assert.equal((await fetch(base, { method: "POST" })).status, 403);
    assert.equal(
      (
        await fetch(base, {
          method: "POST",
          headers: { ...headers, Origin: "https://example.com" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await call({ action: "move", id: "unowned", x: 200, y: 190 })).ok,
      false,
    );
    assert.equal(
      (await call({ action: "move", id: tab.id, x: -1, y: 10 })).ok,
      false,
    );
    assert.equal(
      (await call({ action: "move", id: tab.id, x: 16000, y: 10 })).ok,
      false,
    );
    const before = await browser.native.call("state");
    assert.equal(
      (
        await call({
          action: "move",
          id: tab.id,
          x: 220,
          y: 190,
          duration: 250,
        })
      ).ok,
      true,
    );
    const hover = await browser.evaluate(
      tab.id,
      '({hover:Number(document.querySelector("#target").dataset.hover),clicks:Number(document.querySelector("#target").dataset.clicks),hit:document.elementFromPoint(220,190)?.id})',
    );
    assert.ok(hover.hover > 0);
    assert.equal(hover.clicks, 0);
    assert.equal(
      hover.hit,
      "target",
      "The cursor overlay does not intercept pointer input.",
    );
    assert.equal(
      (await call({ action: "click", id: tab.id, x: 220, y: 190 })).ok,
      true,
    );
    const evidence = await browser.evaluate(
      tab.id,
      '({clicks:Number(document.querySelector("#target").dataset.clicks),trusted:document.querySelector("#target").dataset.trusted === "true"})',
    );
    assert.equal(evidence.clicks, 1);
    assert.equal(evidence.trusted, true);
    const after = await browser.native.call("state");
    assert.deepEqual(
      after,
      before,
      "Input desktop, foreground window and physical cursor stay unchanged.",
    );
    const view = await call({ action: "view", id: tab.id });
    assert.ok(view.result.width > 200 && view.result.height > 200);
    assert.equal(view.result.coordinateSpace, "page viewport in CSS pixels");
    const configPath = path.join(browser.directory, "preview-test.json");
    await writeFile(
      configPath,
      JSON.stringify({ port: preview.port, token: preview.token }),
      { mode: 0o600 },
    );
    const client = new Client({ name: "pointer-test", version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, "src", "mcp.mjs")],
      env: { ...process.env, QUIET_DESKTOP_PREVIEW_CONFIG: configPath },
    });
    await client.connect(transport);
    t.after(() => client.close());
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "quiet_pointer_move"));
    assert.ok(tools.tools.some((tool) => tool.name === "quiet_pointer_click"));
    const mcpView = await client.callTool({
      name: "quiet_view",
      arguments: { id: tab.id },
    });
    assert.equal(mcpView.isError, undefined);
    assert.equal(mcpView.content[1].type, "image");
    const mcpMove = await client.callTool({
      name: "quiet_pointer_move",
      arguments: { id: tab.id, x: 225, y: 195, duration: 0 },
    });
    assert.equal(mcpMove.isError, undefined);
    await mkdir(path.join(ROOT, "test-results"), { recursive: true });
    await writeFile(
      path.join(ROOT, "test-results", "pointer-page.jpg"),
      Buffer.from(view.result.data, "base64"),
    );
    const capture = new DesktopCapture();
    t.after(() => capture.close());
    const frame = await capture.capture(browser.desktop.desktop);
    await writeFile(
      path.join(ROOT, "test-results", "pointer-desktop.jpg"),
      frame.data,
    );
    await browser.run({ action: "pause" });
    assert.equal(
      (await call({ action: "click", id: tab.id, x: 220, y: 190 })).ok,
      false,
    );
    assert.equal(
      (await call({ action: "view", id: tab.id })).ok,
      true,
      "A paused agent can still be inspected.",
    );
    await browser.run({ action: "resume" });
    let pauseTimer;
    const moving = call({
      action: "move",
      id: tab.id,
      x: 600,
      y: 350,
      duration: 1500,
    });
    pauseTimer = setTimeout(() => browser.run({ action: "pause" }), 150);
    const interrupted = await moving;
    clearTimeout(pauseTimer);
    assert.equal(
      interrupted.ok,
      false,
      "Pausing interrupts an animated movement.",
    );
    assert.equal(
      await browser.evaluate(
        tab.id,
        'Number(document.querySelector("#target").dataset.clicks)',
      ),
      1,
    );
    await writeFile(
      path.join(ROOT, "test-results", "pointer.json"),
      JSON.stringify(
        {
          ...evidence,
          overlayDoesNotIntercept: true,
          physicalInputUnchanged: true,
          pausedInputBlocked: true,
          animatedMoveInterrupted: true,
          viewport: { width: view.result.width, height: view.result.height },
        },
        null,
        2,
      ),
    );
  },
);
