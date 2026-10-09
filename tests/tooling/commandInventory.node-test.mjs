import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { parseCoreCommandGroups } from "../../scripts/lib/core-command-groups.mjs";
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
const infraGroups = {
  bmc: 241,
  virtualization: 143,
  proxmox: 123,
  nas: 119,
  remote: 57,
};
const opsGroups = {
  "ops-system": 225,
  "ops-identity": 178,
  "ops-network": 203,
  "ops-web": 178,
  "ops-databases": 198,
  "ops-platform": 222,
  "ops-monitoring": 232,
  "ops-orchestration": 240,
  "ops-messaging": 58,
};
const base = (name) => `src-tauri/crates/sorng-commands-${name}`;
const manifest = (name) => JSON.parse(read(`${base(name)}/commands.json`));
const modules = (name) =>
  new Set(manifest(name).commands.map((entry) => entry.path.split("::")[0]));
const sha256 = (names) =>
  createHash("sha256")
    .update([...names].sort().join("\n"))
    .digest("hex");

// Checks each bounded owner against its manifest and returns its public names.
function boundedOwnerNames(groups) {
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
  return names;
}

// Adapters own their wrappers through `mod inner;`; the ops crate keeps none.
function assertAdaptersOwnWrappers(groups) {
  const ops = read(`${base("ops")}/src/lib.rs`);
  for (const name of Object.keys(groups)) {
    for (const module of modules(name)) {
      assert.ok(
        fs.existsSync(path.join(root, base(name), "src", `${module}.rs`)),
      );
      const adapter = read(`${base(name)}/src/${module}.rs`);
      assert.match(adapter, /mod inner;/);
      assert.doesNotMatch(adapter, /include!|#\[path/);
      const implementation = read(`${base(name)}/src/${module}/inner.rs`);
      // Some implementations import `tauri::command` and write `#[command]`.
      assert.match(implementation, /#\[(?:tauri::)?command/, module);
      assert.equal(
        fs.existsSync(path.join(root, base("ops"), "src", `${module}.rs`)),
        false,
        module,
      );
      assert.ok(!ops.includes(`mod ${module};`), module);
    }
  }
}

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

test("core routing rejects unsorted or duplicate command lists at compile time", (t) => {
  const source = read(`${base("core")}/src/core_handler.rs`);
  assert.match(
    source,
    /const _: \(\) = command_order::assert_sorted_unique\(\$commands\);/,
  );
  const groups = parseCoreCommandGroups(source);
  assert.equal(groups.length, 10);
  const names = groups.map(({ entries }) => entries.map(commandName));
  const load = names.find((group) =>
    group.includes("database_protection_load"),
  );
  assert.ok(load, "database loading must be registered");
  for (const group of names) assert.deepEqual(group, [...group].sort());

  const parent = fs.realpathSync(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(parent, "sorng-command-order-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(temp)), parent);
    assert.ok(path.basename(temp).startsWith("sorng-command-order-"));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const validator = read(`${base("core")}/src/command_order.rs`);
  const compile = (lists) =>
    spawnSync(
      "rustc",
      [
        "--edition=2021",
        "--crate-type=lib",
        "--emit=metadata",
        "--out-dir",
        temp,
        "-",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 60_000,
        input: `mod command_order { ${validator} }\n${lists
          .map(
            (commands) =>
              `const _: () = command_order::assert_sorted_unique(&${JSON.stringify(commands)});`,
          )
          .join("\n")}`,
      },
    );
  const valid = compile([...names, [], ["one"], ["a", "aa", "b"]]);
  assert.equal(valid.status, 0, valid.error?.message || valid.stderr);
  for (const invalid of [
    ["database_protection_load_plain", "database_protection_load"],
    ["database_protection_load", "database_protection_load"],
    ["b", "a"],
  ]) {
    const result = compile([invalid]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Core commands must be sorted and unique/);
  }
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
  const names = boundedOwnerNames(infraGroups);
  assert.equal(new Set(names).size, 683);
  // Pre-sharding public-name snapshot: catches accidental API additions/removals
  // without maintaining a second hand-written registration list.
  assert.equal(
    sha256(names),
    "2fc173505e8372ce4edf3d1e1fccbf12cf0c5f3401c0d2a606013badead59448",
  );
});

test("the infra facade owns no command wrappers or domain implementation dependencies", () => {
  const facade = read(`${base("infra")}/src/lib.rs`);
  assert.doesNotMatch(facade, /#\[path|mod \w+_commands;/);
  const cargo = read(`${base("infra")}/Cargo.toml`);
  for (const name of Object.keys(infraGroups))
    assert.ok(cargo.includes(`sorng-commands-${name} =`));
  assert.doesNotMatch(cargo, /^sorng-(?:synology|idrac|hyperv|proxmox) =/m);
  assertAdaptersOwnWrappers(infraGroups);
});

test("ops preserves its exact 1,734-command public API in nine bounded owners", () => {
  const names = boundedOwnerNames(opsGroups);
  assert.equal(new Set(names).size, 1734);
  // Snapshot after removing exactly the 39 Kafka commands.
  assert.equal(
    sha256(names),
    "b261ddee13f5a97b6aa2885acfee173dd52d70472694ce09359ce62306f9d3b1",
  );
  for (const name of Object.keys(opsGroups)) {
    for (const entry of manifest(name).commands) {
      assert.ok(!entry.path.startsWith("kafka_commands::"), entry.path);
      assert.equal(entry.cfg, undefined, entry.path);
    }
  }
});

test("the ops facade owns no command wrappers and routes every bounded child", () => {
  const facade = read(`${base("ops")}/src/lib.rs`);
  assert.doesNotMatch(facade, /#\[path|include!|mod \w+_commands;/);
  assert.match(facade, /^mod ops_handler;\r?$/m);

  const cargo = read(`${base("ops")}/Cargo.toml`).replace(/\r\n/g, "\n");
  const section = (title) =>
    cargo.split(`\n[${title}]\n`)[1]?.split("\n[")[0] ?? "";
  const children = Object.keys(opsGroups).map(
    (name) => `sorng-commands-${name}`,
  );
  assert.deepEqual(
    [...section("dependencies").matchAll(/^([\w-]+)\s*=/gm)]
      .map((match) => match[1])
      .sort(),
    [...children, "tauri"].sort(),
    "the facade depends only on its children",
  );
  assert.doesNotMatch(cargo, /kafka/i);

  // Match the router as a whole, not line by line: formatting may place an
  // entry and a closing delimiter on the same line.
  const router = read(`${base("ops")}/src/ops_handler.rs`).replace(
    /\r\n/g,
    "\n",
  );
  assert.equal(extractNativeCommandNames(router).size, 0);
  const crates = children.map((child) => child.replace(/-/g, "_")).sort();
  const owners = (source, pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1]).sort();
  assert.deepEqual(
    owners(router, /\b(sorng_commands_\w+)::build\(\)/g),
    crates,
  );
  const isCommand = router.match(
    /pub fn is_command\(command: &str\) -> bool \{([^}]*)\}/,
  )?.[1];
  assert.ok(isCommand, "ops_handler::is_command");
  assert.deepEqual(
    owners(isCommand, /\b(sorng_commands_\w+)::is_command\(command\)/g),
    crates,
  );
  for (const child of crates) {
    const binding = router.match(
      new RegExp(`let (\\w+) = ${child}::build\\(\\);`),
    )?.[1];
    assert.ok(binding, child);
    assert.match(
      router,
      new RegExp(
        `if ${child}::is_command\\(command\\) \\{\\s*return ${binding}\\(invoke\\);`,
      ),
      child,
    );
    assert.ok(router.includes(`${child}::COMMAND_NAMES,`), child);
  }

  // The Rust facade test's totals must match the manifests.
  const total = Object.keys(opsGroups).reduce(
    (sum, name) => sum + manifest(name).commands.length,
    0,
  );
  const expected = router.match(/const EXPECTED_COMMANDS: usize = (\d+);/)?.[1];
  assert.equal(expected, String(total));

  assertAdaptersOwnWrappers(opsGroups);
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
