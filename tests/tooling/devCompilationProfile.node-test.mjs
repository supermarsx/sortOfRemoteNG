import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = readFileSync(
  new URL("../../src-tauri/Cargo.toml", import.meta.url),
  "utf8",
).replace(/\r\n?/g, "\n");
const sections = new Map();
for (const match of manifest.matchAll(
  /^\[([^\]\r\n]+)\]\s*\n([\s\S]*?)(?=^\[|(?![\s\S]))/gm,
)) {
  assert.equal(sections.has(match[1]), false, `duplicate table ${match[1]}`);
  sections.set(match[1], match[2]);
}
// These checked profile tables deliberately contain scalar values only. Fail
// rather than silently misread a future multiline/complex profile structure.
function profile(name) {
  assert.ok(sections.has(name), `missing profile ${name}`);
  const result = {};
  for (const line of sections.get(name).split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const field = line.match(
      /^([\w-]+)\s*=\s*("[^"\n]*"|\d+|true|false)\s*(?:#.*)?$/,
    );
    assert.ok(field, `unsupported profile field in ${name}: ${line}`);
    assert.equal(
      Object.hasOwn(result, field[1]),
      false,
      `duplicate profile field ${name}.${field[1]}`,
    );
    result[field[1]] = JSON.parse(field[2]);
  }
  return result;
}
const runtimePackages = [
  "sorng-core",
  "sorng-rdp",
  "sorng-rdp-vendor",
  "ironrdp-core",
  "ironrdp-pdu",
  "ironrdp-graphics",
  "ironrdp-session",
  "ironrdp-blocking",
  "ironrdp-input",
  "ironrdp-dvc",
  "ironrdp-svc",
  "yuv",
  "openh264",
  "openh264-sys2",
];

test("development baseline keeps incremental/debug policy and compiles ordinary dependencies without optimization", () => {
  assert.deepEqual(profile("profile.dev"), {
    incremental: true,
    "split-debuginfo": "unpacked",
    debug: 0,
  });
  assert.deepEqual(profile('profile.dev.package."*"'), {
    debug: 0,
    "opt-level": 0,
  });
  assert.deepEqual(profile("profile.dev.build-override"), { "opt-level": 2 });
});

test("named macro frontends retain effective opt1 despite wildcard precedence over build-override", () => {
  for (const name of [
    "tauri-macros",
    "tauri-codegen",
    "syn",
    "quote",
    "proc-macro2",
  ])
    assert.deepEqual(profile(`profile.dev.package.${name}`), {
      "opt-level": 1,
    });
});

test("all fourteen explicit RDP pixel/protocol/decoder hot paths stay opt2 in dev and release", () => {
  for (const name of runtimePackages) {
    assert.deepEqual(profile(`profile.dev.package.${name}`), {
      "opt-level": 2,
    });
    assert.deepEqual(profile(`profile.release.package.${name}`), {
      "opt-level": 2,
    });
  }
  const actual = [...sections.keys()]
    .filter(
      (key) =>
        key.startsWith("profile.dev.package.") &&
        profile(key)["opt-level"] === 2,
    )
    .map((key) => key.slice("profile.dev.package.".length));
  assert.deepEqual(actual.sort(), [...runtimePackages].sort());
});

test("all six SQLx packages trade dev optimization for four bounded codegen units", () => {
  for (const suffix of [
    "postgres",
    "mysql",
    "core",
    "sqlite",
    "macros",
    "macros-core",
  ])
    assert.deepEqual(profile(`profile.dev.package.sqlx-${suffix}`), {
      "codegen-units": 4,
      "opt-level": 0,
      debug: 0,
    });
});

test("rustls preserves opt1 while allowing four codegen units", () => {
  assert.deepEqual(profile("profile.dev.package.rustls"), {
    "codegen-units": 4,
    "opt-level": 1,
    debug: 0,
  });
});

test("large Windows binding crates retain one codegen unit and existing optimization", () => {
  for (const name of ["windows", "windows-core", "windows-sys"])
    assert.deepEqual(profile(`profile.dev.package.${name}`), {
      "codegen-units": 1,
      "opt-level": 1,
      debug: 0,
    });
});

test("release defaults and override inventory remain unchanged", () => {
  assert.deepEqual(profile("profile.release"), {
    "opt-level": "z",
    lto: "thin",
    "codegen-units": 1,
    strip: true,
    debug: 0,
    incremental: false,
  });
  assert.deepEqual(
    [...sections.keys()]
      .filter((key) => key.startsWith("profile.release."))
      .sort(),
    runtimePackages.map((name) => `profile.release.package.${name}`).sort(),
  );
});

test("full native feature defaults and full-dev alias stay full, never silently lean", () => {
  const featureSection = sections.get("features");
  assert.ok(featureSection);
  const features = Object.fromEntries(
    [...featureSection.matchAll(/^([\w-]+)\s*=\s*(\[[^\]]*\])/gm)].map(
      (match) => [match[1], JSON.parse(match[2])],
    ),
  );
  assert.deepEqual(features.default, ["full"]);
  assert.deepEqual(features["full-dev"], ["full"]);
  for (const name of [
    "cert-auth",
    "cloud",
    "collab",
    "db-mongo",
    "db-mssql",
    "db-mysql",
    "db-postgres",
    "db-redis",
    "db-sqlite",
    "kafka-static",
    "logs-json",
    "opkssh-vendored-wrapper",
    "ops",
    "platform",
    "protocol-serial-dynamic",
    "rdp",
    "rdp-mf-decode",
    "rdp-software-decode",
    "rdp-snapshot",
    "script-engine",
    "tls-cert-details",
    "vpn-softether",
  ])
    assert.ok(features.full.includes(name), `missing full feature ${name}`);
  assert.equal(features.default.includes("lean"), false);
});
