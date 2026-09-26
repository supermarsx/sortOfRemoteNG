// Real Chromium regression using only a local synthetic SPA and production JS.
// node --test tests/tooling/webSpaNavigation.browser-test.mjs
// WEB_SPA_TEST_BROWSER overrides browser discovery. WEB_SPA_TEST_RUNTIME_REF=HEAD
// serves git-show baseline bytes without replacing the working-tree runtime.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const browser =
  process.env.WEB_SPA_TEST_BROWSER ||
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].find(existsSync);
const runtimePath =
  "src-tauri/crates/sorng-protocols/src/web_network_client.js";
const generationKey = "__sorng_generation_v1";
const query = "?view=main&encoded=a%20b&repeated=one&repeated=two";

// Runs in the real renderer. The native fetch is only for harness reporting;
// the /api/proof request deliberately uses the installed fetch interceptor.
async function fixture(configuration) {
  const reportFetch = window.fetch.bind(window);
  const report = (value) =>
    reportFetch("/result", { method: "POST", body: JSON.stringify(value) });
  try {
    const blocked = [];
    const controller = installWebNetworkClient(configuration, (entry) =>
      blocked.push(entry),
    );
    await new Promise((resolve) =>
      window.addEventListener("load", resolve, { once: true }),
    );
    const loads = Number(sessionStorage.getItem("loads") || 0) + 1;
    sessionStorage.setItem("loads", String(loads));
    if (loads > 1) {
      await report({
        ...JSON.parse(sessionStorage.getItem("beforeNavigation")),
        loads,
        stateRetained: false,
        finalUrl: location.href,
      });
      return;
    }
    const initialUrl = location.href;
    const documentBefore = document;
    const state = (window.spaState = { edits: 7 });
    const input = document.querySelector("input");
    input.value = "unsaved local state";
    const parsers = [];
    for (const reference of [
      location.href,
      "/settings?next=a%2Fb&space=a%20b&plus=a+b&key=1&key=2#details",
      `${configuration.sourceOrigin}/settings?key=1&key=2#details`,
      "/settings",
    ]) {
      for (const setter of ["property", "attribute"]) {
        const anchor = document.createElement("a");
        const expected = new URL(reference, initialUrl);
        if (setter === "property") anchor.href = reference;
        else anchor.setAttribute("href", reference);
        // Angular-style URL parsers normalize an anchor by assigning it twice.
        anchor.href = anchor.href;
        parsers.push({
          reference,
          setter,
          expectedSearch: expected.search,
          search: anchor.search,
          hash: anchor.hash,
          expectedHash: expected.hash,
        });
      }
    }
    const proof = await fetch(
      `${configuration.sourceOrigin}/api/proof?keep=a%20b`,
    ).then((response) => {
      if (!response.ok)
        throw new Error(`Proof fetch failed: ${response.status}`);
      return response.json();
    });
    const metrics = {
      parsers,
      proof,
      loads,
      hashSteps: 0,
      fetchInterception: controller.capabilities.fetchInterception,
      blocked,
    };
    sessionStorage.setItem("beforeNavigation", JSON.stringify(metrics));
    for (const [index, hash] of [
      "#/settings?tab=network",
      "#/status",
    ].entries()) {
      const anchor = document.createElement("a");
      anchor.href = index === 0 ? hash : initialUrl + hash;
      anchor.textContent = "Local SPA route";
      document.body.append(anchor);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("No hashchange after anchor click")),
          2500,
        );
        window.addEventListener(
          "hashchange",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        anchor.click();
      });
      if (location.hash !== hash)
        throw new Error(`Unexpected hash: ${location.hash}`);
      metrics.hashSteps++;
      sessionStorage.setItem("beforeNavigation", JSON.stringify(metrics));
    }
    await report({
      ...metrics,
      loads: Number(sessionStorage.getItem("loads")),
      stateRetained:
        document === documentBefore &&
        window.spaState === state &&
        state.edits === 7 &&
        input.isConnected &&
        input.value === "unsaved local state",
      finalUrl: location.href,
    });
  } catch (error) {
    await report({ error: error.stack || String(error) });
  }
}

test(
  "SPA anchor parsing and hash navigation retain the document with generation routing installed",
  {
    skip: browser
      ? false
      : "Set WEB_SPA_TEST_BROWSER to an installed Chromium browser",
    timeout: 45000,
  },
  async (t) => {
    const source = process.env.WEB_SPA_TEST_RUNTIME_REF
      ? (
          await promisify(execFile)(
            "git",
            ["show", `${process.env.WEB_SPA_TEST_RUNTIME_REF}:${runtimePath}`],
            {
              cwd: new URL("../../", import.meta.url),
              windowsHide: true,
              maxBuffer: 1024 * 1024,
            },
          )
        ).stdout
      : await readFile(
          new URL(`../../${runtimePath}`, import.meta.url),
          "utf8",
        );
    t.diagnostic(
      `runtime SHA-256 ${createHash("sha256").update(source).digest("hex")}`,
    );
    const hostname = `p${randomBytes(16).toString("hex")}.localhost`;
    const generation = randomBytes(16).toString("hex");
    const documents = [];
    const requests = [];
    let configuration;
    let finish;
    const result = new Promise((resolve) => {
      finish = resolve;
    });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, configuration.proxyOrigin);
      res.setHeader("Cache-Control", "no-store");
      if (req.method === "POST" && url.pathname === "/result") {
        try {
          let body = "";
          for await (const chunk of req) body += chunk;
          finish(JSON.parse(body));
          res.writeHead(204).end();
        } catch (error) {
          finish({ error: String(error) });
          res.writeHead(400).end();
        }
      } else if (req.method === "GET" && url.pathname === "/spa") {
        documents.push(req.url);
        res.setHeader("Content-Type", "text/html");
        res.end(`<!doctype html><html><head><link rel="icon" href="data:,"></head>
        <body><input aria-label="Unsaved edit"><script src="/runtime.js"></script>
        <script>(${fixture.toString()})(${JSON.stringify(configuration)});</script></body></html>`);
      } else if (url.pathname === "/runtime.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(source);
      } else if (url.pathname === "/api/proof") {
        const proof = {
          host: req.headers.host,
          method: req.method,
          url: req.url,
        };
        requests.push(proof);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(proof));
      } else {
        res.writeHead(404).end();
      }
    });
    const profile = await mkdtemp(
      path.join(path.resolve(tmpdir()), "sorng-spa-navigation-"),
    );
    let child, exited, deadline;
    let stderr = "";
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      configuration = {
        version: 1,
        sessionId: "spa-browser-fixture",
        documentSequence: 1,
        requestGeneration: generation,
        sourceOrigin: "https://spa-fixture.invalid",
        proxyOrigin: `http://${hostname}:${server.address().port}`,
        mappings: [],
      };
      const browserTemp = path.join(profile, "temp");
      await mkdir(browserTemp);
      child = spawn(
        browser,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--disable-extensions",
          "--disable-sync",
          "--no-proxy-server",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          `--host-resolver-rules=MAP ${hostname} 127.0.0.1, MAP * ~NOTFOUND`,
          `--user-data-dir=${profile}`,
          `${configuration.proxyOrigin}/spa${query}`,
        ],
        {
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["ignore", "ignore", "pipe"],
          env: {
            ...process.env,
            TEMP: browserTemp,
            TMP: browserTemp,
            TMPDIR: browserTemp,
          },
        },
      );
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-2000);
      });
      exited = new Promise((resolve) => {
        child.once("error", (error) => {
          finish({ error: String(error) });
          resolve();
        });
        child.once("exit", (code, signal) => {
          finish({ error: `Browser exited: ${code ?? signal}` });
          resolve();
        });
      });
      deadline = setTimeout(
        () => finish({ error: "Browser wall-clock deadline (30s) exceeded" }),
        30000,
      );
      const outcome = await result;
      t.diagnostic(JSON.stringify({ ...outcome, documents, requests }));
      assert.equal(
        outcome.error,
        undefined,
        `${outcome.error}; browser=${stderr}`,
      );
      await t.test(
        "anchor parser queries remain byte-identical without new generation proof",
        () => {
          assert.equal(outcome.parsers.length, 8);
          for (const parser of outcome.parsers) {
            assert.equal(
              parser.search,
              parser.expectedSearch,
              `${parser.setter}: ${parser.reference}`,
            );
            assert.equal(parser.hash, parser.expectedHash);
          }
        },
      );
      await t.test(
        "hash-only and absolute same-document clicks preserve loaded document and state",
        () => {
          assert.deepEqual(
            documents,
            [`/spa${query}`],
            "exactly one server document GET",
          );
          assert.equal(outcome.loads, 1, "exactly one browser load event");
          assert.equal(
            outcome.hashSteps,
            2,
            "both clicks dispatched hashchange",
          );
          assert.equal(
            outcome.stateRetained,
            true,
            "document, JS object and unsaved input survived",
          );
          assert.equal(
            outcome.finalUrl,
            `${configuration.proxyOrigin}/spa${query}#/status`,
          );
        },
      );
      await t.test(
        "routed fetch still reaches the local server with generation proof",
        () => {
          assert.equal(outcome.fetchInterception, true);
          assert.deepEqual(outcome.blocked, []);
          assert.equal(requests.length, 1);
          assert.deepEqual(outcome.proof, requests[0]);
          assert.equal(
            outcome.proof.host,
            new URL(configuration.proxyOrigin).host,
          );
          assert.equal(outcome.proof.method, "GET");
          assert.equal(
            outcome.proof.url,
            `/api/proof?keep=a%20b&${generationKey}=${generation}`,
          );
        },
      );
    } finally {
      clearTimeout(deadline);
      try {
        if (
          child?.pid &&
          child.exitCode === null &&
          child.signalCode === null
        ) {
          // Terminate only the subprocess tree created with this fresh profile.
          if (process.platform === "win32")
            await promisify(execFile)(
              "taskkill.exe",
              ["/PID", String(child.pid), "/T", "/F"],
              {
                windowsHide: true,
                timeout: 5000,
              },
            );
          else process.kill(-child.pid, "SIGKILL");
          await exited;
        }
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        assert.equal(path.dirname(profile), path.resolve(tmpdir()));
        assert.ok(path.basename(profile).startsWith("sorng-spa-navigation-"));
        await rm(profile, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        });
      }
    }
  },
);
