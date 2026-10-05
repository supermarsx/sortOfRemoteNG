// node --test tests/styles/appShellScroll.browser-test.mjs
// Isolated installed-Edge rendering regression, not a live Tauri session.
// Compile the real global CSS and read the shell/chrome classes from JSX so a
// copied layout cannot silently keep passing after the product changes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const executable =
  process.env.APP_SHELL_TEST_BROWSER ||
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);

async function jsx(file) {
  return ts.createSourceFile(
    file,
    await readFile(path.join(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function attribute(node, name) {
  return node.attributes.properties.find(
    (prop) => ts.isJsxAttribute(prop) && prop.name.getText() === name,
  )?.initializer;
}

function opening(source, name, value) {
  let found;
  function visit(node) {
    if (ts.isJsxOpeningElement(node)) {
      const attr = attribute(node, name);
      if (
        attr &&
        (ts.isStringLiteral(attr) ? attr.text : attr.expression?.getText()) ===
          value
      )
        found = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `Missing JSX anchor ${name}=${value}`);
  return found;
}

function classes(node) {
  const attr = attribute(node, "className");
  if (attr && ts.isStringLiteral(attr)) return attr.text;
  // The app shell's conditional suffix only toggles glow/transparency/motion.
  if (
    attr &&
    ts.isJsxExpression(attr) &&
    ts.isTemplateExpression(attr.expression)
  )
    return attr.expression.head.text;
  assert.fail("Expected literal classes or app shell template prefix");
}

function children(node) {
  return node.parent.children
    .filter(ts.isJsxElement)
    .map((child) => child.openingElement);
}

async function fixture() {
  const app = await jsx("src/App.tsx");
  const toolbar = await jsx("src/components/app/AppToolbar.tsx");
  const tabs = await jsx("src/components/session/SessionTabs.tsx");
  const bottom = await jsx("src/components/app/AppBottomBars.tsx");
  const row = opening(app, "ref", "layoutRef");
  const tabBar = opening(tabs, "data-testid", "session-tabs");
  const pane =
    '<div style="height:1200px"></div><button id="target" style="height:40px">Reveal setting</button><div style="height:1200px"></div>';
  return `<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body class="font-sans">
    <div data-testid="app-shell" class="${classes(opening(app, "data-testid", "app-shell"))} app-glow">
      <div id="toolbar" class="${classes(opening(toolbar, "data-testid", "toolbar"))}">Toolbar</div>
      <div id="actions" class="${classes(opening(toolbar, "data-testid", "toolbar-actions"))}">Actions</div>
      <div id="layout" class="${classes(row)}">
        <aside style="width:200px;flex-shrink:0;overflow:auto"><div style="height:1800px">Connections</div></aside>
        <div id="column" class="${classes(children(row)[0])}">
          <div id="tabs" class="${classes(tabBar)}">
            <div class="${classes(children(tabBar)[0])}">
              <div id="tab-scroll" class="${classes(opening(tabs, "data-testid", "session-tabs-scroll"))}">
                <button style="min-width:1800px">First tab</button><button id="last-tab" style="min-width:200px">Last tab</button>
              </div>
            </div>
          </div>
          <div id="session-main-panel" class="${classes(opening(app, "id", "session-main-panel"))}">
            <div id="pane" style="height:100%;overflow:auto">${pane}</div>
          </div>
        </div>
      </div>
      <div class="${classes(opening(bottom, "data-testid", "app-bottom-bars"))}"><div id="status" class="app-status-bar">Status</div></div>
    </div>
    <script>
    addEventListener('load', () => {
      const shell = document.querySelector('[data-testid="app-shell"]');
      const pane = document.getElementById('pane');
      const target = document.getElementById('target');
      const state = () => {
        const ids = ['toolbar', 'actions', 'layout', 'column', 'tabs', 'session-main-panel', 'status'];
        return {
          windowY: window.scrollY, documentY: document.scrollingElement.scrollTop,
          shellY: shell.scrollTop, shellX: shell.scrollLeft,
          shellTop: shell.getBoundingClientRect().top, shellHeight: shell.clientHeight,
          shellScrollHeight: shell.scrollHeight, shellTransform: getComputedStyle(shell).transform,
          paneY: pane.scrollTop, tabX: document.getElementById('tab-scroll').scrollLeft,
          focus: document.activeElement.id,
          chrome: Object.fromEntries(ids.map(id => {
            const el = document.getElementById(id), rect = el.getBoundingClientRect();
            return [id, {top:rect.top, height:rect.height, transform:getComputedStyle(el).transform}];
          })),
          targetVisible: target.getBoundingClientRect().top >= pane.getBoundingClientRect().top &&
            target.getBoundingClientRect().bottom <= pane.getBoundingClientRect().bottom,
        };
      };
      const reset = (glow, legacy) => {
        shell.classList.toggle('app-glow', glow);
        shell.style.overflow = legacy ? 'hidden' : '';
        document.activeElement.blur();
        for (const el of [document.scrollingElement, document.body, shell, ...shell.querySelectorAll('*')]) {
          el.scrollTop = 0; el.scrollLeft = 0;
        }
      };
      const cases = [];
      for (const [glow, legacy, action] of [
        [true, true, 'reveal'], [false, true, 'reveal'],
        [true, false, 'reveal'], [false, false, 'reveal'],
        [true, false, 'focus'], [false, false, 'focus'],
        [true, false, 'tabs'], [true, false, 'direct'],
      ]) {
        reset(glow, legacy);
        const before = state();
        if (action === 'reveal') target.scrollIntoView({block:'center', behavior:'instant'});
        if (action === 'focus') target.focus();
        if (action === 'tabs') document.getElementById('last-tab').scrollIntoView({block:'nearest', inline:'nearest'});
        if (action === 'direct') {
          shell.scrollTo(50, 50);
          pane.scrollTop = 100;
          document.querySelector('aside').scrollTop = 100;
        }
        cases.push({glow, legacy, action, before, after:state(), sidebarY:document.querySelector('aside').scrollTop});
      }
      const result = document.createElement('pre');
      result.id = 'result'; result.textContent = JSON.stringify(cases);
      document.body.append(result);
    });
    </script></body></html>`;
}

async function render(html, css, size) {
  const profile = await mkdtemp(path.join(tmpdir(), "sorng-shell-scroll-"));
  const server = createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/app.css" ? "text/css" : "text/html",
    );
    res.end(req.url === "/app.css" ? css : html);
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const output = await new Promise((resolve, reject) => {
      const child = spawn(
        executable,
        [
          "--headless=new",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--disable-extensions",
          "--disable-sync",
          `--user-data-dir=${profile}`,
          `--window-size=${size}`,
          "--dump-dom",
          `http://127.0.0.1:${server.address().port}/`,
        ],
        {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 20000,
        },
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => {
        stdout += data;
      });
      child.stderr.on("data", (data) => {
        stderr += data;
      });
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve(stdout)
          : reject(new Error(`Edge exited ${code}: ${stderr}`)),
      );
    });
    const result = /<pre id="result">([^]*?)<\/pre>/u.exec(output);
    assert.ok(result, "Browser did not finish the layout regression fixture");
    return JSON.parse(
      result[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    // Only this test's mkdtemp profile is removed, never a user's browser data.
    assert.equal(path.dirname(profile), path.resolve(tmpdir()));
    assert.ok(path.basename(profile).startsWith("sorng-shell-scroll-"));
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}

test(
  "shell chrome stays anchored during native reveal/focus while inner panels scroll",
  {
    skip: executable
      ? false
      : "Set APP_SHELL_TEST_BROWSER to an installed Chromium/Edge executable",
    timeout: 60000,
  },
  async (t) => {
    const from = path.join(root, "app/globals.css");
    const { css } = await postcss([tailwind({ base: root })]).process(
      await readFile(from, "utf8"),
      { from },
    );
    const html = await fixture();
    for (const size of ["1200,900", "800,600"]) {
      const cases = await render(html, css, size);
      const legacy = cases[0];
      t.diagnostic(
        `${size} legacy: shell scrollTop=${legacy.after.shellY}, toolbar top=${legacy.after.chrome.toolbar.top}, document scrollTop=${legacy.after.documentY}`,
      );
      assert.ok(
        legacy.before.shellScrollHeight > legacy.before.shellHeight,
        "Glow must create real scrollable overflow in the old shell",
      );
      assert.ok(
        legacy.after.shellY >= 45 && legacy.after.shellY <= 60,
        "Old hidden shell must reproduce the reported ~50px shift",
      );
      assert.equal(legacy.after.windowY, 0);
      assert.equal(legacy.after.documentY, 0);
      assert.equal(legacy.after.shellTop, legacy.before.shellTop);
      assert.equal(legacy.after.shellHeight, legacy.before.shellHeight);
      assert.equal(legacy.after.shellTransform, "none");
      assert.equal(legacy.after.chrome.toolbar.top, -legacy.after.shellY);
      assert.equal(
        cases[1].after.shellY,
        0,
        "Without the oversized glow the same reveal cannot scroll the shell",
      );

      for (const result of cases.slice(2)) {
        const { before, after, action, glow } = result;
        const label = `${size} ${action} glow=${glow}`;
        assert.equal(after.windowY, 0, label);
        assert.equal(after.documentY, 0, label);
        assert.equal(after.shellY, 0, label);
        assert.equal(after.shellX, 0, label);
        assert.equal(after.shellTop, 0, label);
        assert.equal(after.shellHeight, before.shellHeight, label);
        assert.equal(after.shellTransform, before.shellTransform, label);
        assert.deepEqual(after.chrome, before.chrome, label);
        if (action === "reveal" || action === "focus") {
          assert.ok(after.paneY > 0, `${label}: inner pane must still scroll`);
          assert.ok(after.targetVisible, `${label}: target must be visible`);
        }
        if (action === "focus") assert.equal(after.focus, "target", label);
        if (action === "tabs") assert.ok(after.tabX > 0, label);
        if (action === "direct") {
          assert.equal(after.paneY, 100, label);
          assert.equal(result.sidebarY, 100, label);
        }
      }
    }
  },
);
