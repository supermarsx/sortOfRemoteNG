import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { parse } from "smol-toml";
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
function setup(
  t,
  { check = "delay", index = 0, route, synchronous = false } = {},
) {
  const clock = createClock(),
    calls = [],
    document = { title: `bootstrap-${index}` };
  const fetch = (url, options) => {
    const row = { url, options, at: clock.now };
    calls.push(row);
    if (synchronous) return route(row, clock);
    return Promise.resolve().then(() =>
      route ? route(row, clock) : response(`owned-h3:${url}`),
    );
  };
  const context = vm.createContext({
    document,
    fetch,
    setTimeout: clock.setTimeout.bind(clock),
    clearTimeout: clock.clearTimeout.bind(clock),
    setInterval: clock.setInterval.bind(clock),
    performance: { now: () => clock.now },
    AbortController,
  });
  const probeNonce = `01234567-89ab-cdef-0123-456789abcdef-${index}`;
  vm.runInContext(
    pageScript({
      index,
      check,
      alternateOrigin: "https://alternate-http3.fixture.test",
      probeNonce,
    }),
    context,
    { timeout: 1000 },
  );
  t.after(() => clock.reset());
  return {
    clock,
    calls,
    document,
    probeNonce,
    probe: (nonce = probeNonce) =>
      vm.runInContext(
        `globalThis.__ownedH3RevokeProbe(${JSON.stringify(nonce)})`,
        context,
      ),
    assets: () => calls.filter((row) => /^\/asset\/[0-9]+$/.test(row.url)),
    warmups: () => calls.filter((row) => row.url === "/warmup"),
  };
}

test("revoke waits for full owned H3 response without queuing the old32-request race", async (t) => {
  let release;
  const h = setup(t, {
    check: "revoke",
    route: () => ({
      ok: true,
      text: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    }),
  });
  await h.clock.tickAsync(750);
  assert.equal(h.assets().length, 1);
  assert.equal(h.document.title, "bootstrap-0");
  assert.equal((await h.probe()).attempted, false);
  release("owned-h3:/asset/0");
  await h.clock.tickAsync(0);
  assert.equal(h.document.title, "h3-revoke-ready-0");
  assert.equal(h.assets().length, 1);
});

test("revoke credits one actual H3 body after sequential TCP fallback, then issues one rejected unique probe", async (t) => {
  let initial = 0;
  const h = setup(t, {
    check: "revoke",
    route: (row) => {
      if (row.url === "/asset/0")
        return response(
          ++initial === 1 ? "owned-tcp:/asset/0" : "owned-h3:/asset/0",
        );
      return Promise.reject(new Error("transport revoked"));
    },
  });
  await h.clock.tickAsync(750);
  assert.equal(h.document.title, "h3-revoke-ready-0");
  assert.equal(h.assets().length, 2);
  assert.equal(h.calls.length, 2);
  assert.equal((await h.probe("wrong-nonce")).attempted, false);
  assert.equal(h.calls.length, 2);
  const result = await h.probe();
  assert.equal(result.attempted, true);
  assert.equal(result.blocked, true);
  assert.equal(result.tag, h.probeNonce);
  assert.equal(h.calls.at(-1).url, `/__post-revoke/${h.probeNonce}`);
  assert.equal(h.calls.at(-1).options.cache, "no-store");
  assert.equal(h.calls.at(-1).options.redirect, "error");
  assert.equal((await h.probe()).attempted, false);
  assert.equal(h.calls.length, 3);
});

test("revoke never arms on permanent TCP or wrong-path H3 bodies", async (t) => {
  for (const body of ["owned-tcp:/asset/0", "owned-h3:/asset/other"]) {
    const h = setup(t, { check: "revoke", route: () => response(body) });
    await h.clock.tickAsync(12000);
    assert.equal(h.assets().length, 8);
    assert.equal(h.document.title, "request-rejected-0");
    assert.equal((await h.probe()).attempted, false);
    assert.equal(h.calls.length, 8);
  }
});

test("a delivered post-revoke response is not a blocked probe", async (t) => {
  const h = setup(t, { check: "revoke" });
  await h.clock.tickAsync(750);
  const result = await h.probe();
  assert.equal(result.attempted, true);
  assert.equal(result.blocked, false);
});

test("synchronous fetch failure is not an actually issued blocked probe", async (t) => {
  const h = setup(t, {
    check: "revoke",
    synchronous: true,
    route: (row) => {
      if (row.url === "/asset/0") return response("owned-h3:/asset/0");
      throw new Error("synchronous error");
    },
  });
  await h.clock.tickAsync(750);
  const result = await h.probe();
  assert.equal(result.attempted, false);
  assert.equal(result.blocked, false);
});

test("unresolved post-revoke probe stays unproven, never a timeout-as-blocked result", async (t) => {
  const h = setup(t, {
    check: "revoke",
    route: (row) =>
      row.url === "/asset/0"
        ? response("owned-h3:/asset/0")
        : new Promise(() => {}),
  });
  await h.clock.tickAsync(750);
  let done = false;
  h.probe().then(() => {
    done = true;
  });
  await h.clock.tickAsync(35000);
  assert.equal(done, false);
  assert.equal(h.calls.length, 2);
});

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

function assertLinuxParentPreparation(body) {
  assert.match(
    body,
    /#\[cfg\(target_os = "linux"\)\]\s*#\[path = "\.\.\/\.\.\/native_acceptance\/linux_parent_fixture\.rs"\]\s*mod linux_parent_fixture;/,
  );
  const execute = body.slice(body.indexOf("fn execute("));
  const parent = execute.indexOf('with_title("Isolated owned HTTP3 fixture")');
  const prepare = execute.indexOf(
    "linux_parent_fixture::prepare(parent.as_ref())?",
  );
  const initialize = execute.indexOf("CefRuntime::initialize(");
  const host = execute.indexOf(
    "CefBrowserHost::create_owned_engineering_probe(",
  );
  assert.ok(
    parent >= 0 &&
      prepare > parent &&
      initialize > prepare &&
      host > initialize,
    "actual hidden parent must be prepared before CEF initialization and host creation",
  );
  assert.match(
    execute,
    /#\[cfg\(target_os = "linux"\)\]\s*let linux_parent_readiness = Some\(linux_parent_fixture::prepare\(parent.as_ref\(\)\)\?\);/,
  );
  assert.match(
    execute,
    /report\["linuxParentReadiness"\] = serde_json::json!\(linux_parent_readiness\);/,
  );
}

test("actual H3 fixture prepares its retained Linux parent before native host creation", () => {
  assertLinuxParentPreparation(rust);
  for (const mutant of [
    rust.replace(
      "linux_parent_fixture::prepare(parent.as_ref())?",
      "serde_json::Value::Null",
    ),
    rust.replace(
      'report["linuxParentReadiness"]',
      'report["lostParentReadiness"]',
    ),
    rust
      .replace(
        "let linux_parent_readiness = Some(linux_parent_fixture::prepare(parent.as_ref())?);",
        "let linux_parent_readiness_was_moved = ();",
      )
      .replace(
        "    let bridge = unsafe",
        '    #[cfg(target_os = "linux")]\n    let linux_parent_readiness = Some(linux_parent_fixture::prepare(parent.as_ref())?);\n    let bridge = unsafe',
      ),
  ])
    assert.throws(() => assertLinuxParentPreparation(mutant));
  const shared = readFileSync(
    "src-tauri/crates/sorng-browser-host/tests/native_acceptance/linux_parent_fixture.rs",
    "utf8",
  );
  for (const required of [
    "before_realize(",
    "after_realize(",
    "gtk::is_initialized_main_thread()",
    "window.realize()",
    "trustedXlibWindow",
    "trustedXlibDisplay",
  ])
    assert.ok(shared.includes(required), required);
  // This is source prerequisite coverage, not an execution of GTK/Xlib/CEF.
});

test("Linux parent dependencies stay optional and use the existing locked versions", () => {
  const root =
    "src-tauri/crates/sorng-browser-host/tests/native_http3_acceptance/";
  const manifest = parse(readFileSync(root + "Cargo.toml", "utf8"));
  const lock = parse(readFileSync(root + "Cargo.lock", "utf8"));
  for (const [name, version] of [
    ["gtk", "0.18.2"],
    ["gdkx11-sys", "0.18.2"],
    ["x11", "2.21.0"],
  ]) {
    const dependency =
      manifest.target['cfg(target_os = "linux")'].dependencies[name];
    assert.equal(dependency.version, "=" + version);
    assert.equal(dependency.optional, true);
    assert.ok(manifest.features.cef.includes("dep:" + name));
    assert.deepEqual(manifest.features.default, []);
    assert.equal(
      lock.package.filter((p) => p.name === name && p.version === version)
        .length,
      1,
    );
    assert.ok(
      lock.package
        .find((p) => p.name === "sorng-cef-http3-acceptance")
        .dependencies.includes(name),
    );
  }
  assert.deepEqual(
    manifest.target['cfg(target_os = "linux")'].dependencies.x11.features,
    ["xlib"],
  );
});
