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
