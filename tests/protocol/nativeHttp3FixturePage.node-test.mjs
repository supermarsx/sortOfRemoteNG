import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
// No installed clock/dependency or global timer mutation is needed. A queued
// callback is fired in deadline/insertion order, with real Promise jobs drained.
function createClock() {
  let now = 0,
    sequence = 0;
  const timers = new Map();
  const add = (fn, delay, repeat) => {
    const id = ++sequence;
    timers.set(id, { id, fn, at: now + Math.max(0, delay), repeat });
    return id;
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    get now() {
      return now;
    },
    setTimeout: (fn, delay = 0) => add(fn, delay, 0),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => add(fn, delay, Math.max(1, delay)),
    reset: () => timers.clear(),
    countTimers: () => timers.size,
    async tickAsync(duration) {
      const end = now + duration;
      for (let steps = 0; steps < 10000; steps++) {
        await settle();
        let next = [...timers.values()]
          .filter((row) => row.at <= end)
          .sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!next) {
          now = end;
          await settle();
          next = [...timers.values()]
            .filter((row) => row.at <= end)
            .sort((a, b) => a.at - b.at || a.id - b.id)[0];
          if (!next) return;
        }
        now = Math.max(now, next.at);
        if (next.repeat) next.at += next.repeat;
        else timers.delete(next.id);
        next.fn();
      }
      throw new Error("Fixture clock callback bound");
    },
  };
}

const fixturePath =
  "src-tauri/crates/sorng-browser-host/tests/native_http3_acceptance/src/cef_fixture.rs";
const rust = readFileSync(fixturePath, "utf8");
const source = readFileSync(
  "src-tauri/crates/sorng-browser-host/tests/native_http3_acceptance/src/page.js",
  "utf8",
);
assert.match(
  rust,
  /include_str!\("page\.js"\)/,
  "real native fixture must include the executed page source",
);
function pageScript(config) {
  return `(${source})(${JSON.stringify(config)});`;
}

const response = (body, ok = true) => ({ ok, text: async () => body });
function setup(t, { check = "delay", index = 0, route } = {}) {
  const clock = createClock(),
    calls = [],
    document = { title: `bootstrap-${index}` };
  const fetch = (url, options) => {
    const row = { url, options, at: clock.now };
    calls.push(row);
    return Promise.resolve().then(() =>
      route ? route(row, clock) : response(`owned-h3:${url}`),
    );
  };
  vm.runInNewContext(
    pageScript({
      index,
      check,
      alternateOrigin: "https://alternate-http3.fixture.test",
    }),
    {
      document,
      fetch,
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
      setInterval: clock.setInterval.bind(clock),
      performance: { now: () => clock.now },
      AbortController,
    },
    { timeout: 1000 },
  );
  t.after(() => clock.reset());
  return {
    clock,
    calls,
    document,
    assets: () => calls.filter((row) => /^\/asset\/[0-9]+$/.test(row.url)),
    warmups: () => calls.filter((row) => row.url === "/warmup"),
  };
}

test("delay starts measured assets only after a genuine H3 warmup follows the cold proxied H2 race", async (t) => {
  let admitted = false,
    queued = false;
  const h = setup(t, {
    route: (row, clock) => {
      if (row.url === "/warmup") {
        if (!queued) {
          queued = true;
          clock.setTimeout(() => {
            admitted = true;
          }, 300);
        }
        return response(admitted ? "owned-h3:/warmup" : "owned-tcp:/warmup");
      }
      return response(
        row.url === "/asset/0" && !admitted
          ? "owned-tcp:/asset/0"
          : `owned-h3:${row.url}`,
      );
    },
  });
  await h.clock.tickAsync(750);
  assert.equal(
    h.assets().length,
    0,
    "cold H2 must not be credited as measured H3",
  );
  assert.equal(h.warmups().length, 1);
  await h.clock.tickAsync(299);
  assert.equal(
    h.assets().length,
    0,
    "all measured requests wait for admission/warmup proof",
  );
  await h.clock.tickAsync(1000);
  assert.equal(h.document.title, "h3-done-0");
  assert.deepEqual(
    h.assets().map((row) => row.url),
    Array.from({ length: 32 }, (_, i) => `/asset/${i}`),
  );
  assert.ok(h.assets().every((row) => row.at >= 1050));
  assert.ok(
    h
      .warmups()
      .every(
        (row) =>
          row.options.cache === "no-store" && row.options.redirect === "error",
      ),
  );
  assert.ok(h.assets().every((row) => row.options.cache === "no-store"));
});

test("persistent TCP warmup is finite and cannot emit assets or a positive H3 title", async (t) => {
  const h = setup(t, { route: () => response("owned-tcp:/warmup") });
  await h.clock.tickAsync(12000);
  assert.equal(h.assets().length, 0);
  assert.ok(h.warmups().length > 0 && h.warmups().length <= 8);
  assert.equal(h.document.title, "request-rejected-0");
  assert.equal(h.clock.countTimers(), 0);
});

for (const [name, body, ok] of [
  ["different H3 response path", "owned-h3:/other", true],
  ["non-success response", "owned-h3:/warmup", false],
]) {
  test(`delay refuses ${name} as its warmup proof`, async (t) => {
    const h = setup(t, { route: () => response(body, ok) });
    await h.clock.tickAsync(12000);
    assert.equal(h.assets().length, 0);
    assert.ok(h.warmups().length > 0 && h.warmups().length <= 8);
    assert.equal(h.document.title, "request-rejected-0");
  });
}

test("unresponsive warmup bodies are aborted within finite attempts without measured traffic", async (t) => {
  const signals = [];
  const h = setup(t, {
    route: (row) => {
      if (row.url !== "/warmup") return response(`owned-h3:${row.url}`);
      signals.push(row.options.signal);
      return {
        ok: true,
        text: () =>
          new Promise((_, reject) =>
            row.options.signal.addEventListener(
              "abort",
              () => reject(new Error("fixture abort")),
              { once: true },
            ),
          ),
      };
    },
  });
  await h.clock.tickAsync(12000);
  assert.ok(signals.length > 0 && signals.length <= 8);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(h.assets().length, 0);
  assert.equal(h.document.title, "request-rejected-0");
  assert.equal(h.clock.countTimers(), 0);
});

test("a successful warmup never credits a subsequent TCP asset as H3", async (t) => {
  const h = setup(t, {
    route: (row) =>
      response(
        row.url === "/asset/0" ? "owned-tcp:/asset/0" : `owned-h3:${row.url}`,
      ),
  });
  await h.clock.tickAsync(2000);
  assert.equal(h.assets().length, 32);
  assert.equal(h.document.title, "fallback-done-0");
});

for (const check of [
  "multiplex",
  "deny",
  "revoke",
  "isolation",
  "cross-authority",
  "h2-fallback",
  "h1-fallback",
]) {
  test(`${check} preserves its original eager measured request sequencing`, async (t) => {
    const fallback = check.endsWith("fallback");
    const h = setup(t, {
      check,
      route: (row) =>
        response(`${fallback ? "owned-tcp" : "owned-h3"}:${row.url}`),
    });
    await h.clock.tickAsync(750);
    assert.equal(h.warmups().length, 0);
    assert.equal(h.assets().length, 32);
    assert.ok(h.assets().every((row) => row.at === 750));
    assert.equal(h.document.title, `${fallback ? "fallback" : "h3"}-done-0`);
    if (check === "cross-authority")
      assert.deepEqual(
        h.calls.slice(-2).map((row) => row.url),
        [
          "https://alternate-http3.fixture.test/bootstrap-alternate",
          "https://alternate-http3.fixture.test/asset/denied",
        ],
      );
  });
}

test("isolation survivor requests retain their original interval only for context B", async (t) => {
  const h = setup(t, { check: "isolation", index: 1 });
  await h.clock.tickAsync(750);
  assert.equal(h.calls.filter((row) => row.url === "/survivor").length, 3);
  assert.equal(h.assets().length, 32);
  assert.equal(h.document.title, "h3-done-1");
});

test("even a fetch promise ignoring AbortSignal cannot hold the bounded warmup open", async (t) => {
  const h = setup(t, {
    route: (row) =>
      row.url === "/warmup"
        ? new Promise(() => {})
        : response(`owned-h3:${row.url}`),
  });
  await h.clock.tickAsync(12000);
  assert.ok(h.warmups().length > 0 && h.warmups().length <= 8);
  assert.ok(h.warmups().every((row) => row.options.signal.aborted));
  assert.equal(h.assets().length, 0);
  assert.equal(h.document.title, "request-rejected-0");
  assert.equal(h.clock.countTimers(), 0);
});
