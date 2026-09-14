import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const featureMap = (path) => {
  const block = read(path).split("[features]")[1].split(/^\[/m)[0];
  return Object.fromEntries(
    [...block.matchAll(/^([\w-]+)\s*=\s*(\[[^\]]*\])/gm)].map((match) => [
      match[1],
      JSON.parse(match[2]),
    ]),
  );
};
const features = featureMap("src-tauri/Cargo.toml");
function closure(names, map = features, seen = new Set()) {
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    closure(map[name] ?? [], map, seen);
  }
  return seen;
}
const capabilities = (names) =>
  [...closure(names)]
    .filter(
      (name) =>
        Object.hasOwn(features, name) &&
        !/^(default|lean|full(?:-.+)?|kafka(?:-.+)?|db-sqlite(?:-dynamic)?|rdp-software-decode(?:-dynamic)?)$/.test(
          name,
        ),
    )
    .sort();
const noLinkCollisions = (names) => {
  const enabled = closure(names);
  for (const pair of [
    ["kafka", "kafka-static"],
    ["db-sqlite", "db-sqlite-dynamic"],
    ["rdp-software-decode", "rdp-software-decode-dynamic"],
  ])
    assert.equal(
      pair.every((name) => enabled.has(name)),
      false,
      `conflicting variants: ${pair}`,
    );
};

test("normal Cargo and full-dev include the full supported capability set", () => {
  assert.deepEqual(features.default, ["full"]);
  assert.deepEqual(features["full-dev"], ["full"]);
  const enabled = closure(["default"]);
  for (const name of [
    "ops",
    "platform",
    "cloud",
    "collab",
    "db-mongo",
    "db-mssql",
    "db-mysql",
    "db-postgres",
    "db-redis",
    "db-sqlite",
    "rdp",
    "rdp-mf-decode",
    "rdp-snapshot",
    "rdp-software-decode",
    "kafka-static",
    "opkssh-vendored-wrapper",
    "script-engine",
    "protocol-serial-dynamic",
    "cert-auth",
    "tls-cert-details",
    "vpn-softether",
  ])
    assert.ok(enabled.has(name), `missing ${name}`);
  noLinkCollisions(["default"]);
  assert.equal(closure(["lean"]).has("ops"), false);
  assert.ok(
    closure(["default", "lean"]).has("ops"),
    "lean requires explicit default opt-out",
  );
});

test("release and platform bundles retain full capabilities without conflicting link variants", () => {
  const expected = capabilities(["full"]);
  for (const profile of [
    "full-windows-dynamic",
    "full-unix-dynamic",
    "full-linux-system",
  ]) {
    noLinkCollisions([profile]);
    assert.deepEqual(
      capabilities([profile]),
      profile === "full-linux-system"
        ? expected.filter((name) => name !== "rdp-mf-decode")
        : expected,
    );
  }
  const workflow = read(".github/workflows/release.yml");
  for (const label of [
    "RELEASE_FEATURES_BUNDLED",
    "RELEASE_FEATURES_WINDOWS",
  ]) {
    const match = workflow.match(
      new RegExp(`${label}:\\s*>-?\\s*\\n\\s*([^\\r\\n]+)`),
    );
    assert.ok(match, label);
    const names = match[1].trim().split(",");
    noLinkCollisions(names);
    assert.deepEqual(capabilities(names), expected);
  }
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts.tauri, "node ./scripts/tauri.mjs");
  assert.equal(pkg.scripts["tauri:dev"], "node ./scripts/tauri-dev.mjs");
  assert.match(
    pkg.scripts["tauri:build"],
    /--dynamic-native-runtime.*--features full.*--no-default-features/,
  );
});

test("static Kafka reaches both command dispatch and its owning startup-state crate", () => {
  assert.ok(features["kafka-static"].includes("sorng-commands-ops?/kafka"));
  assert.ok(features["kafka-static"].includes("sorng-app-domains/kafka"));
  const domains = featureMap("src-tauri/crates/sorng-app-domains/Cargo.toml");
  assert.ok(domains.kafka.includes("sorng-app-domains-ops?/kafka"));
  const ops = featureMap("src-tauri/crates/sorng-app-domains-ops/Cargo.toml");
  assert.ok(ops.kafka.includes("dep:sorng-kafka"));
  assert.match(
    read("src-tauri/crates/sorng-app-domains-ops/src/lib.rs"),
    /#\[path = "\.\.\/\.\.\/\.\.\/src\/state_registry\/ops.rs"\]\s*pub mod ops_startup_state/,
  );
  assert.match(
    read("src-tauri/src/state_registry/ops.rs"),
    /#\[cfg\(feature = "kafka"\)\]\s*\{\s*let kafka_state/,
  );
});

test("SSH scripting compiles exactly one implementation and retains command registration", () => {
  const commands = read("src-tauri/src/ssh_commands.rs");
  assert.match(
    commands,
    /#\[cfg\(feature = "script-engine"\)\]\s*mod script \{/,
  );
  assert.match(
    commands,
    /#\[cfg\(not\(feature = "script-engine"\)\)\]\s*mod script_stub \{/,
  );
  assert.match(
    commands,
    /#\[cfg\(feature = "script-engine"\)\][\s\S]*?mod script_inner \{/,
  );
  assert.match(
    commands,
    /#\[cfg\(not\(feature = "script-engine"\)\)\][\s\S]*?mod script_stub_inner \{/,
  );
  assert.match(
    read("src-tauri/crates/sorng-ssh/src/script_cmds.rs"),
    /service\.execute_script\(code, script_type, context\)\.await/,
  );
  assert.match(
    read("src-tauri/crates/sorng-commands-core/src/core_handler.rs"),
    /ssh_commands::execute_user_script,/,
  );
});

test("ordinary vendor wrappers retain complete Rust APIs without unused DLL outputs", () => {
  for (const [wrapper, consumer, exports] of [
    [
      "sorng-aws-vendor",
      "sorng-aws",
      ["quick_xml", "percent_encoding", "hmac", "sha2", "hex"],
    ],
    ["sorng-compression-vendor", "sorng-recording", ["zstd", "flate2"]],
  ]) {
    const manifest = read(`src-tauri/crates/${wrapper}/Cargo.toml`);
    const library = manifest.split("[lib]")[1].split(/^\[/m)[0];
    const outputs = library.match(/^crate-type\s*=\s*(\[[^\]]*\])/m);
    assert.ok(outputs, `${wrapper} declares its output contract`);
    assert.deepEqual(JSON.parse(outputs[1]), ["rlib"], wrapper);

    // Removing a companion artifact must not hide APIs behind new opt-ins or
    // disable the dependencies' existing default/native capabilities.
    assert.doesNotMatch(manifest, /^\[features\]/m);
    const dependencies = manifest.split("[dependencies]")[1].split(/^\[/m)[0];
    const names = [...dependencies.matchAll(/^([\w-]+)\s*=/gm)].map((match) =>
      match[1].replaceAll("-", "_"),
    );
    assert.deepEqual(names.sort(), [...exports].sort());
    assert.doesNotMatch(
      dependencies,
      /(?:optional\s*=\s*true|default-features\s*=\s*false)/,
    );
    if (wrapper === "sorng-aws-vendor") {
      assert.match(
        dependencies,
        /^quick-xml\s*=.*features\s*=\s*\["serialize"\]/m,
      );
    }

    const source = read(`src-tauri/crates/${wrapper}/src/lib.rs`);
    const reexports = [...source.matchAll(/^pub extern crate (\w+);/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(reexports.sort(), [...exports].sort());
    assert.doesNotMatch(source, /#\s*!?\[cfg(?:_attr)?\(/);
    assert.match(
      read(`src-tauri/crates/${consumer}/Cargo.toml`),
      new RegExp(
        `^${wrapper}\\s*=\\s*\\{\\s*path\\s*=\\s*"\\.\\./${wrapper}"\\s*\\}`,
        "m",
      ),
    );

    // These are not the explicitly staged OPKSSH/native C runtimes. Adding a
    // wrapper DLL to packaging would contradict their rlib-only contract.
    for (const path of [
      "src-tauri/tauri.conf.json",
      "scripts/stage-windows-native-runtime.mjs",
      "scripts/native-build-env.mjs",
    ]) {
      const text = read(path);
      assert.ok(!text.includes(wrapper), `${path} must not bundle ${wrapper}`);
      assert.ok(
        !text.includes(wrapper.replaceAll("-", "_")),
        `${path} must not load ${wrapper}`,
      );
    }
  }
  // Existing full/static/platform feature parity tests above remain the gate:
  // no application capability is removed to avoid the extra link output.
  assert.ok(closure(["default"]).has("cloud"));
  assert.match(
    read("src-tauri/Cargo.toml"),
    /^sorng-recording\s*=\s*\{\s*path\s*=\s*"crates\/sorng-recording"\s*\}/m,
  );
});
