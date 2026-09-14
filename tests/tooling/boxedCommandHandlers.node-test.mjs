import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const crateRoot = "src-tauri/crates";
const owners = readdirSync(new URL(`../../${crateRoot}/`, import.meta.url), {
  withFileTypes: true,
})
  .filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("sorng-commands-"),
  )
  .map((entry) => entry.name.slice("sorng-commands-".length))
  .sort();
const router = read("src-tauri/src/invoke_handler.rs").split("#[cfg(test)]")[0];
const rootOwners = [
  ...router.matchAll(/let \w+_handler = sorng_commands_(\w+)::build\(\);/g),
]
  .map((match) => match[1])
  .sort();

function checkExport(source, owner) {
  assert.match(
    source,
    /pub type Handler\s*=\s*Box<tauri::ipc::InvokeHandler<tauri::Wry>>;/,
    `${owner}: public return type must be a fixed trait object`,
  );
  const body = source.match(/pub fn build\(\) -> Handler\s*\{([^}]+)\}/)?.[1];
  assert.ok(
    body,
    `${owner}: build() must expose Handler, not an opaque closure`,
  );
  assert.equal(
    body.trim(),
    owner === "core" || owner === "infra"
      ? `${owner}_handler::build()`
      : source.includes("mod handler;")
        ? "Box::new(handler::build())"
        : `Box::new(${owner}_handler::build())`,
    `${owner}: erase once inside its owning crate; do not double-box core`,
  );
}

for (const owner of owners) {
  test(`${owner} exports a fixed handler without redundant boxing`, () => {
    checkExport(read(`${crateRoot}/sorng-commands-${owner}/src/lib.rs`), owner);
  });
}

test("the final app router is erased and consumes each crate's existing box", () => {
  assert.match(
    router,
    /type InvokeHandler\s*=\s*Box<tauri::ipc::InvokeHandler<tauri::Wry>>;/,
  );
  assert.match(router, /pub\(crate\) fn build\(\) -> InvokeHandler\s*\{/);
  assert.equal((router.match(/Box::new\(move \|invoke\|/g) ?? []).length, 1);
  assert.doesNotMatch(router, /(?:Box::new|erase_handler)\(sorng_commands_/);
  for (const owner of rootOwners) {
    assert.match(
      router,
      new RegExp(
        `let ${owner}_handler = sorng_commands_${owner}::build\\(\\);`,
      ),
    );
  }
  // Root-local generated handlers still need their own single erasure.
  assert.match(
    router,
    /let tray_handler = erase_handler\(tauri::generate_handler!/,
  );
  assert.match(
    router,
    /let web_guard_handler = erase_handler\(tauri::generate_handler!/,
  );
  assert.match(router, /false\s*\}\)\s*\}\s*$/);
});

function gatedStatements(source, pattern) {
  const result = [];
  let gates = [];
  for (const line of source.split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("//")) continue;
    if (text.startsWith("#[cfg(")) {
      gates.push(text);
      continue;
    }
    const match = text.match(pattern);
    if (match) result.push({ owner: match[1], gates });
    gates = [];
  }
  return result;
}

test("root routing order, owning handlers and feature gates remain aligned", () => {
  const bindings = gatedStatements(
    router,
    /^let \w+_handler = sorng_commands_(\w+)::build\(\);$/,
  );
  const routes = gatedStatements(
    router,
    /^if sorng_commands_(\w+)::is_command\(command\) \{$/,
  );
  assert.deepEqual(
    routes.map(({ owner }) => owner),
    [
      "core",
      "access",
      "sessions",
      "cloud",
      "collab",
      "platform",
      "ops",
      "infra",
      "mail",
      "services",
      "tools",
      "webservers",
    ],
  );
  assert.deepEqual(bindings.map(({ owner }) => owner).sort(), rootOwners);
  const expectedGates = {
    core: [],
    access: [],
    sessions: [],
    cloud: ['#[cfg(feature = "cloud")]'],
    collab: ['#[cfg(any(feature = "collab", feature = "platform"))]'],
    platform: ['#[cfg(feature = "platform")]'],
    ops: ['#[cfg(feature = "ops")]'],
    infra: ['#[cfg(feature = "ops")]'],
    mail: ['#[cfg(feature = "ops")]'],
    services: ['#[cfg(feature = "ops")]'],
    tools: ['#[cfg(feature = "ops")]'],
    webservers: ['#[cfg(feature = "ops")]'],
  };
  for (const route of routes) {
    assert.deepEqual(route.gates, expectedGates[route.owner], route.owner);
    assert.deepEqual(
      bindings.find(({ owner }) => owner === route.owner)?.gates,
      route.gates,
      `${route.owner}: construction and routing need the same feature gates`,
    );
    assert.match(
      router,
      new RegExp(
        `if sorng_commands_${route.owner}::is_command\\(command\\) \\{\\s*return ${route.owner}_handler\\(invoke\\);`,
      ),
    );
  }
  assert.ok(
    router.indexOf('if command == "web_network_guard_status"') <
      router.indexOf("if is_tray_command(command)"),
  );
  assert.ok(
    router.indexOf("if is_tray_command(command)") <
      router.indexOf("if sorng_commands_core::is_command(command)"),
  );
});

test("core's existing internal box and generic mock-runtime helpers are preserved", () => {
  const core = `${crateRoot}/sorng-commands-core/src`;
  const internal = read(`${core}/core_handler.rs`);
  assert.match(
    internal,
    /type InvokeHandler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;/,
  );
  assert.match(internal, /pub fn build\(\) -> InvokeHandler\s*\{/);
  for (const module of ["artifact", "llm", "telegram"]) {
    assert.match(
      read(`${core}/${module}_handler.rs`),
      /pub fn build<R: tauri::Runtime>\(\) -> impl Fn\(tauri::ipc::Invoke<R>\)/,
      `${module}: generic fixtures must not be restricted to Wry`,
    );
  }
  assert.match(
    read(`${core}/lib.rs`),
    /pub fn build_force_delete_trust_handler<R: tauri::Runtime>\(\s*\) -> impl Fn\(tauri::ipc::Invoke<R>\)/,
  );
});

test("the export contract rejects opaque return types and double-boxed core", () => {
  const source = read(`${crateRoot}/sorng-commands-core/src/lib.rs`);
  assert.throws(() =>
    checkExport(
      source.replace(
        "build() -> Handler",
        "build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool",
      ),
      "core",
    ),
  );
  assert.throws(() =>
    checkExport(
      source.replace(
        "    core_handler::build()",
        "    Box::new(core_handler::build())",
      ),
      "core",
    ),
  );
});
