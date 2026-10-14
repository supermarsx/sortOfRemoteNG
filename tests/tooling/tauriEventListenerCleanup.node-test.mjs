import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";

const framework = new URL(
  "../../src-tauri/patches/tauri-event-cleanup/",
  import.meta.url,
);

test("the pinned framework contains only the documented event cleanup change", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("SOURCE-MANIFEST.json", framework), "utf8"),
  );
  assert.equal(manifest.version, "2.11.5");
  assert.equal(
    manifest.archiveSha256,
    "667b20e2726d572dea2de7370da16e188eb06008faf9a92fab7cdc46791190b5",
  );
  const changed = [];
  for (const [name, entry] of Object.entries(manifest.files)) {
    const bytes = await readFile(new URL(name, framework));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      entry.sha256,
      name,
    );
    if (entry.sha256 !== entry.upstreamSha256) changed.push(name);
  }
  assert.deepEqual(changed, ["src/event/mod.rs"]);
  const cargo = await readFile(
    new URL("../../src-tauri/Cargo.toml", import.meta.url),
    "utf8",
  );
  assert.match(
    cargo,
    /\[patch\.crates-io\][\s\S]*?tauri = \{ path = "patches\/tauri-event-cleanup" \}/,
  );
});

async function productionScripts(t) {
  const source = await readFile(new URL("src/event/mod.rs", framework), "utf8");
  const unlisten = source.slice(
    source.indexOf("pub(crate) fn unlisten_js_script("),
    source.indexOf("pub(crate) fn event_initialization_script("),
  );
  const dispatch = source.slice(
    source.indexOf("pub(crate) fn event_initialization_script("),
    source.indexOf(
      "#[cfg(test)]",
      source.indexOf("pub(crate) fn event_initialization_script("),
    ),
  );
  const root = await mkdtemp(path.join(os.tmpdir(), "tauri-event-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = path.join(root, "event.rs");
  const executable = path.join(
    root,
    process.platform === "win32" ? "event.exe" : "event",
  );
  await writeFile(
    fixture,
    `${unlisten}\n${dispatch}\nfn main() {
    for script in [unlisten_js_script("listeners", "event", "eventId"), event_initialization_script("dispatch", "listeners")] {
      for byte in script.bytes() { print!("{:02x}", byte); }
      println!();
    }
  }`,
  );
  execFileSync(
    "rustc",
    ["--edition=2021", "-Dwarnings", fixture, "-o", executable],
    { timeout: 60_000 },
  );
  const scripts = execFileSync(executable, {
    encoding: "utf8",
    timeout: 15_000,
  })
    .trim()
    .split(/\r?\n/)
    .map((line) => Buffer.from(line, "hex").toString("utf8"));
  const core = await readFile(new URL("scripts/core.js", framework), "utf8");
  return { cleanup: scripts[0], dispatch: scripts[1], core };
}

function runtime(scripts) {
  const warnings = [];
  let next = 274958114;
  const window = {
    __TAURI_INTERNALS__: {},
    crypto: {
      getRandomValues(array) {
        array[0] = next++;
        return array;
      },
    },
    listeners: { "origin-browser-state": Object.create(null) },
  };
  const context = vm.createContext({
    window,
    console: { warn: (message) => warnings.push(message) },
    setTimeout,
  });
  vm.runInContext(
    scripts.core
      .replaceAll("__TEMPLATE_os_name__", '"windows"')
      .replaceAll("__TEMPLATE_protocol_scheme__", '"http"'),
    context,
  );
  vm.runInContext(scripts.dispatch, context);
  return {
    window,
    context,
    warnings,
    cleanup(id) {
      context.event = "origin-browser-state";
      context.eventId = id;
      vm.runInContext(scripts.cleanup, context);
    },
    register(id, callback) {
      const handlerId = window.__TAURI_INTERNALS__.transformCallback(callback);
      Object.defineProperty(window.listeners["origin-browser-state"], id, {
        value: { handlerId },
        configurable: true,
      });
      return handlerId;
    },
  };
}

test("queued browser events skip a closed tab without calling a deleted Tauri callback", async (t) => {
  const scripts = await productionScripts(t);
  const r = runtime(scripts);
  const delivered = [];
  const retiredCallback = r.register(1, () => delivered.push("closed"));
  r.register(2, () => delivered.push("live"));
  r.cleanup(1);
  vm.runInContext(
    'window.dispatch({event:"origin-browser-state",payload:{}}, [1,2])',
    r.context,
  );
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(delivered, ["live"]);
  assert.equal(
    r.window.__TAURI_INTERNALS__.callbacks.has(retiredCallback),
    false,
  );
  assert.equal(
    Object.hasOwn(r.window.listeners["origin-browser-state"], 1),
    false,
  );
});

test("event cleanup tolerates duplicate and missing registrations", async (t) => {
  const r = runtime(await productionScripts(t));
  r.register(1, () => assert.fail("closed handler must not run"));
  r.cleanup(1);
  assert.doesNotThrow(() => r.cleanup(1));
  assert.doesNotThrow(() => r.cleanup(404));
  delete r.window.listeners["origin-browser-state"];
  assert.doesNotThrow(() => r.cleanup(1));
  assert.deepEqual(r.warnings, []);
});
