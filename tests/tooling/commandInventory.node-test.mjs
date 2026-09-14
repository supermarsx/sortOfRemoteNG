import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  renderCommandInventory,
  commandName,
} from "../../scripts/lib/command-inventory.mjs";
import {
  extractNativeCommandNames,
  reachableNativeHandlers,
} from "../ipc/nativeCommandInventory.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const groups = {
  bmc: 241,
  virtualization: 143,
  proxmox: 123,
  nas: 119,
  remote: 57,
};
const base = (name) => `src-tauri/crates/sorng-commands-${name}`;
const manifest = (name) => JSON.parse(read(`${base(name)}/commands.json`));

test("generated command inventories are current without Cargo or generation", () => {
  execFileSync(
    process.execPath,
    ["scripts/generate-command-inventory.mjs", "--check"],
    {
      cwd: root,
      stdio: "pipe",
    },
  );
});

test("sorted lookup and generated dispatch preserve identical feature gates", () => {
  const source = renderCommandInventory({
    version: 1,
    commands: [
      { path: "b::zulu", cfg: 'any(feature = "one", feature = "two")' },
      { path: "a::alpha" },
    ],
  });
  assert.ok(source.indexOf('"alpha"') < source.indexOf('"zulu"'));
  assert.equal(
    (source.match(/#\[cfg\(any\(feature = "one", feature = "two"\)\)\]/g) ?? [])
      .length,
    2,
  );
  assert.match(source, /COMMAND_NAMES\.binary_search/);
  assert.deepEqual([...extractNativeCommandNames(source)], ["alpha", "zulu"]);
});

test("invalid, duplicate and oversized command registrars are rejected", () => {
  for (const commands of [
    [],
    [{ path: "bad-path" }],
    [{ path: "a::same" }, { path: "b::same" }],
    [{ path: "a::fine", cfg: "bad]; injected!{}" }],
    [{ path: "a::fine", renamed: "other" }],
    Array.from({ length: 251 }, (_, i) => ({ path: `a::command_${i}` })),
  ])
    assert.throws(() => renderCommandInventory({ version: 1, commands }));
});

test("infra preserves its exact 683-command public API in five bounded owners", () => {
  const names = [];
  const reachable = reachableNativeHandlers(root);
  for (const [name, count] of Object.entries(groups)) {
    const entries = manifest(name).commands;
    assert.equal(entries.length, count, name);
    assert.ok(entries.length <= 250);
    const source = read(`${base(name)}/src/handler.rs`);
    assert.deepEqual(
      [...extractNativeCommandNames(source)].sort(),
      entries.map(commandName).sort(),
    );
    assert.ok(
      reachable.includes(path.join(root, base(name), "src/handler.rs")),
      name,
    );
    names.push(...entries.map(commandName));
  }
  assert.equal(new Set(names).size, 683);
  // Pre-sharding public-name snapshot: catches accidental API additions/removals
  // without maintaining a second hand-written registration list.
  assert.equal(
    createHash("sha256").update(names.sort().join("\n")).digest("hex"),
    "2fc173505e8372ce4edf3d1e1fccbf12cf0c5f3401c0d2a606013badead59448",
  );
});

test("the infra facade owns no command wrappers or domain implementation dependencies", () => {
  const facade = read(`${base("infra")}/src/lib.rs`);
  assert.doesNotMatch(facade, /#\[path|mod \w+_commands;/);
  const cargo = read(`${base("infra")}/Cargo.toml`);
  for (const name of Object.keys(groups))
    assert.ok(cargo.includes(`sorng-commands-${name} =`));
  assert.doesNotMatch(cargo, /^sorng-(?:synology|idrac|hyperv|proxmox) =/m);
  const ops = read(`${base("ops")}/src/lib.rs`);
  for (const name of Object.keys(groups)) {
    for (const module of new Set(
      manifest(name).commands.map((entry) => entry.path.split("::")[0]),
    )) {
      assert.ok(
        fs.existsSync(path.join(root, base(name), "src", `${module}.rs`)),
      );
      const adapter = read(`${base(name)}/src/${module}.rs`);
      assert.match(adapter, /mod inner;/);
      assert.doesNotMatch(adapter, /include!|#\[path/);
      const implementation = read(`${base(name)}/src/${module}/inner.rs`);
      assert.match(implementation, /#\[tauri::command/);
      assert.equal(
        fs.existsSync(path.join(root, base("ops"), "src", `${module}.rs`)),
        false,
      );
      assert.ok(!ops.includes(`mod ${module};`));
    }
  }
});

test("NAS retains production compilation and the original managed-state IPC fixture", () => {
  const fixture = read(`${base("nas")}/src/synology_dispatch_tests.rs`);
  assert.match(fixture, /let _production_handler = crate::build\(\)/);
  assert.match(fixture, /\.invoke_handler\(tauri::generate_handler!\[/);
  assert.match(fixture, /crate::synology::service::SynologyServiceState/);
  assert.match(
    read(`${base("nas")}/src/synology_commands.rs`),
    /pub use crate::synology::service::\*/,
  );
});
