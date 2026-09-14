// Explicit native check: node --test tests/release/rdp-build-profile-flags.check.mjs
// Kept outside *.test.mjs so the Node-only release metadata gate needs no Rust.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const manifest = readFileSync(
  new URL("../../src-tauri/Cargo.toml", import.meta.url),
  "utf8",
).replace(/\r\n?/g, "\n");
const profiles = manifest.slice(
  manifest.indexOf("[profile.dev]"),
  manifest.indexOf("[patch.crates-io]"),
);
const runtimePackages = [
  ...profiles.matchAll(
    /^\[profile\.release\.package\.([\w-]+)\]\nopt-level = 2$/gm,
  ),
].map((match) => match[1]);
assert.ok(runtimePackages.length > 0, "missing named RDP runtime overrides");

function writePackage(directory, name) {
  mkdirSync(join(directory, "src"), { recursive: true });
  writeFileSync(
    join(directory, "Cargo.toml"),
    `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\n`,
  );
  writeFileSync(
    join(directory, "src/lib.rs"),
    "pub fn checksum(bytes: &[u8]) -> u64 { bytes.iter().map(|b| u64::from(*b)).sum() }\n",
  );
}

const scenarios = [
  { name: "dev", rootOpt: "0", dependencyOpt: "0" },
  {
    name: "local-release",
    release: true,
    rootOpt: "z",
    dependencyOpt: "z",
    units: "1",
  },
  {
    name: "ci-release-16",
    release: true,
    rootOpt: "0",
    dependencyOpt: "0",
    units: "16",
    ci: true,
  },
  {
    name: "ci-release-32",
    release: true,
    rootOpt: "0",
    dependencyOpt: "0",
    units: "32",
    ci: true,
  },
];

for (const scenario of scenarios) {
  test(`Cargo emits effective RDP package flags for ${scenario.name}`, (t) => {
    const fixture = mkdtempSync(join(tmpdir(), "sorng-rdp-profile-"));
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    const packages = [
      ...runtimePackages,
      "sorng-commands-core",
      "unrelated-dependency",
    ];
    const external = packages.filter((name) => !name.startsWith("sorng-"));
    writePackage(fixture, "app");
    for (const name of packages) writePackage(join(fixture, name), name);
    writeFileSync(
      join(fixture, "openh264-sys2/build.rs"),
      'fn main() { println!("cargo:warning=decoder-opt-level={}", std::env::var("OPT_LEVEL").unwrap()); }\n',
    );
    const members = packages.filter((name) => !external.includes(name));
    writeFileSync(
      join(fixture, "Cargo.toml"),
      [
        '[package]\nname = "app"\nversion = "0.0.0"\nedition = "2021"',
        '[workspace]\nresolver = "2"',
        `members = ${JSON.stringify(members)}`,
        `exclude = ${JSON.stringify(external)}`,
        "[dependencies]",
        ...packages.map((name) => `${name} = { path = "${name}" }`),
        profiles,
      ].join("\n"),
    );
    const env = { ...process.env, CARGO_TERM_COLOR: "never" };
    for (const key of Object.keys(env)) {
      if (
        key.startsWith("CARGO_PROFILE_") ||
        /^(?:RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER|CARGO_BUILD_TARGET|CARGO_TARGET_DIR)$/.test(
          key,
        )
      )
        delete env[key];
    }
    if (scenario.ci)
      Object.assign(env, {
        CARGO_PROFILE_RELEASE_OPT_LEVEL: "0",
        CARGO_PROFILE_RELEASE_LTO: "off",
        CARGO_PROFILE_RELEASE_CODEGEN_UNITS: scenario.units,
      });
    const result = spawnSync(
      "cargo",
      [
        "build",
        "--lib",
        "--offline",
        "--jobs",
        "2",
        "-vv",
        ...(scenario.release ? ["--release"] : []),
      ],
      {
        cwd: fixture,
        env,
        encoding: "utf8",
        timeout: 120_000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stderr + result.stdout,
      /decoder-opt-level=2/,
      "source decoder build scripts must receive OPT_LEVEL=2",
    );
    const invocations = result.stderr
      .split("\n")
      .filter((line) => line.includes("--crate-name "));
    for (const name of ["app", ...packages]) {
      const invocation = invocations.find((line) =>
        line.includes(`--crate-name ${name.replaceAll("-", "_")} `),
      );
      assert.ok(invocation, `missing rustc invocation for ${name}`);
      const expectedOpt = runtimePackages.includes(name)
        ? "2"
        : name === "unrelated-dependency"
          ? scenario.dependencyOpt
          : scenario.rootOpt;
      assert.equal(
        invocation.match(/-C opt-level=([\w]+)(?:\s|$)/)?.[1] ?? "0",
        expectedOpt,
        `${name} optimization in ${scenario.name}: ${invocation}`,
      );
      if (scenario.units)
        assert.match(
          invocation,
          new RegExp(`-C codegen-units=${scenario.units}(?:\\s|$)`),
        );
      if (scenario.ci) {
        assert.match(invocation, /-C lto=off(?:\s|$)/);
        assert.doesNotMatch(
          invocation,
          /-C (?:lto=(?:thin|fat|yes)|linker-plugin-lto)/,
        );
      }
    }
    t.diagnostic(
      `${runtimePackages.length} runtime crates use opt-level=2; app/commands=${scenario.rootOpt}, unrelated dependency=${scenario.dependencyOpt}${scenario.units ? `, codegen-units=${scenario.units}` : ""}${scenario.ci ? ", LTO=off" : ""}`,
    );
  });
}
