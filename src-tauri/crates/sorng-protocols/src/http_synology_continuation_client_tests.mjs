// Companion tests for the native-served continuation request adapter.
// Run from the repository root with node --test <this file>.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const routing = readFileSync(
  new URL("./web_network_client.js", import.meta.url),
  "utf8",
);
const native = readFileSync(
  new URL("./http_synology_continuation.rs", import.meta.url),
  "utf8",
);
const proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
const token = "0123456789abcdef0123456789abcdef";
const generationKey = "__sorng_generation_v1";

function fixture() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: `${proxy}/webman/index.cgi?name=a%2Fb+z&__sorng_navigation_v1=${token}`,
    runScripts: "outside-only",
  });
  const { window } = dom;
  const calls = [];
  window.fetch = async (...args) => {
    calls.push(args);
    return { ok: true };
  };
  window.Headers = Headers;
  window.navigator.sendBeacon = (...args) => {
    calls.push(args);
    return true;
  };
  window.WebSocket = class {
    constructor(url) {
      this.url = url;
    }
  };
  // Exercise the actual Rust-format bootstrap, also verified to be placed
  // ahead of readiness/vendor code by the native response integration test.
  const bootstrap = native
    .match(/r#"<script>([\s\S]*?)<\/script>"#/)[1]
    .replaceAll("{GENERATION_MARKER}", generationKey)
    .replaceAll("{token}", token)
    .replaceAll("{{", "{")
    .replaceAll("}}", "}");
  window.eval(bootstrap);
  // Readiness strips the visible marker; the native bootstrap must preserve
  // it on the actual document URL for subsequent browser-native form requests.
  window.history.replaceState({}, "", `${proxy}/webman/index.cgi?name=a%2Fb+z`);
  window.eval(routing);
  const client = window.installWebNetworkClient(
    {
      version: 1,
      sessionId: "same-session",
      documentSequence: 7,
      sourceOrigin: "http://example.quickconnect.to",
      proxyOrigin: proxy,
      mappings: [],
      synologyQuickConnect: {
        version: 1,
        navigationOrigins: ["https://global.quickconnect.to"],
        redirectEndpoint: `${proxy}/__sortofremoteng_quickconnect_redirect_v1`,
        rpc: {
          upstreamUrl: "https://global.quickconnect.to/Serv.php",
          proxyUrl: `${proxy}/__sortofremoteng_quickconnect_control_v1`,
        },
      },
    },
    () => {},
  );
  return {
    window,
    calls,
    client,
    close: () => {
      client.dispose();
      window.close();
    },
  };
}

test("native bootstrap preserves generation and exact query bytes through SPA history", () => {
  const page = fixture();
  try {
    assert.equal(
      page.window.location.search,
      `?name=a%2Fb+z&__sorng_navigation_v1=${token}`,
    );
    page.window.history.pushState({}, "", "/desktop?name=a%20b&flag#files");
    assert.equal(
      page.window.location.search,
      `?name=a%20b&flag&__sorng_navigation_v1=${token}`,
    );
    assert.equal(page.window.location.hash, "#files");
    assert.equal(
      page.client.mapUrl("/api?name=a%2Fb+z", "fetch"),
      `${proxy}/api?name=a%2Fb+z&${generationKey}=${token}`,
    );
  } finally {
    page.close();
  }
});

test("successor fetch, beacon and sockets carry a generation fixed at document installation", async () => {
  const page = fixture();
  try {
    await page.window.fetch("/api", {
      method: "POST",
      body: "successor-body",
      referrerPolicy: "no-referrer",
    });
    assert.equal(page.calls[0][0], `${proxy}/api?${generationKey}=${token}`);
    assert.equal(page.calls[0][1].body, "successor-body");
    page.window.navigator.sendBeacon("/api", "keepalive-body");
    assert.equal(page.calls[1][0], `${proxy}/api?${generationKey}=${token}`);
    assert.equal(page.calls[1][1], "keepalive-body");
    const socket = new page.window.WebSocket(
      "ws://example.quickconnect.to/events",
    );
    assert.equal(new URL(socket.url).searchParams.get(generationKey), token);
    assert.equal(
      new URL(socket.url).searchParams.get("__sorng_ws_document_v1"),
      "7",
    );
    // Even if application code edits its address, the routing closure cannot
    // accidentally acquire a subsequent document's generation.
    page.window.location.hash = "another-route";
    assert.equal(
      new URL(page.client.mapUrl("/api", "xhr")).searchParams.get(
        generationKey,
      ),
      token,
    );
  } finally {
    page.close();
  }
});

test("QuickConnect control keeps its document header and anonymous credentials after stamping", async () => {
  const page = fixture();
  try {
    await page.window.fetch("https://global.quickconnect.to/Serv.php", {
      method: "POST",
      body: "control",
    });
    assert.equal(
      page.calls[0][0],
      `${proxy}/__sortofremoteng_quickconnect_control_v1?${generationKey}=${token}`,
    );
    assert.equal(page.calls[0][1].credentials, "omit");
    assert.equal(
      page.calls[0][1].headers.get("X-Sorng-QuickConnect-Document"),
      "7",
    );
    assert.equal(
      page.client.mapUrl("data:image/png;base64,AA==", "image", true),
      "data:image/png;base64,AA==",
    );
    assert.throws(
      () => page.client.mapUrl("https://foreign.example/api", "fetch"),
      /origin-not-approved/,
    );
  } finally {
    page.close();
  }
});
