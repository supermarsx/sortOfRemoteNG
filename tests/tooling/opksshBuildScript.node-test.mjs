import test from "node:test";
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
import path from "node:path";

const source = readFileSync(
  new URL(
    "../../src-tauri/crates/sorng-opkssh-vendor/build.rs",
    import.meta.url,
  ),
  "utf8",
);
// Optional execution of a separately compiled, std-only build script. The Node
// suite never invokes Cargo, Go, a staged DLL, or a user's configured checkout.
const executable = process.env.SORNG_TEST_OPKSSH_BUILD_SCRIPT;
const runtimeOptions = {
  skip: executable
    ? false
    : "Set SORNG_TEST_OPKSSH_BUILD_SCRIPT to an isolated compiled build.rs",
};
const explicitInputs = [
  "SORNG_OPKSSH_VENDOR_CHECKOUT",
  "SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE",
  "SORNG_OPKSSH_VENDOR_GO",
];

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "sorng-opkssh-build-watch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = path.join(root, "src-tauri/crates/sorng-opkssh-vendor");
  mkdirSync(manifest, { recursive: true });
  const artifact = (arch = "amd64") =>
    path.join(
      manifest,
      "bundle/opkssh",
      `windows-${arch}`,
      "sorng_opkssh_vendor.dll",
    );
  const writeArtifact = (bytes, arch) => {
    const destination = artifact(arch);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  };
  const run = (target, overrides = {}) => {
    assert.ok(
      path.isAbsolute(executable),
      "fixture executable must be an explicit absolute path",
    );
    const env = {
      ...process.env,
      CARGO_MANIFEST_DIR: manifest,
      HOST: "x86_64-pc-windows-msvc",
      TARGET: target,
      // An explicit missing path prevents discovery of real/default checkouts
      // and stops the GNU branch before overlay writes or Go invocation.
      SORNG_OPKSSH_VENDOR_CHECKOUT: path.join(root, "absent-checkout"),
      SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE: "0",
      SORNG_OPKSSH_VENDOR_GO: path.join(root, "absent-go.exe"),
      ...overrides,
    };
    const result = spawnSync(executable, [], {
      cwd: root,
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 256 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.split(/\r?\n/);
    const watches = lines
      .filter((line) => line.startsWith("cargo:rerun-if-env-changed="))
      .map((line) => line.slice("cargo:rerun-if-env-changed=".length));
    return { output: result.stdout, lines, watches };
  };
  return { artifact, writeArtifact, run };
}

function syntheticRuntime(machine = 0x8664) {
  const bytes = Buffer.alloc(256);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 60);
  bytes.write("PE\0\0", 64);
  bytes.writeUInt16LE(machine, 68);
  bytes.write("runtime.goexit golang.org go1.fixture", 128);
  return bytes;
}

test("PATH watches occur only after metadata-only early returns and before Go discovery", () => {
  const main = source.slice(
    source.indexOf("fn main()"),
    source.indexOf("fn bridge_disabled()"),
  );
  const msvcReturn = main.match(
    /report_staged_bridge_health\(target\.as_deref\(\)\);\s*emit_stub_runtime_metadata\(\);\s*return;/,
  );
  assert.ok(msvcReturn);
  const goDiscovery = main.indexOf(
    "let Some(checkout_path) = discover_checkout_path()",
  );
  for (const variable of ["PATH", "Path"]) {
    const needle = `cargo:rerun-if-env-changed=${variable}`;
    assert.equal(main.split(needle).length, 2, `one ${variable} watch`);
    assert.ok(main.indexOf(needle) > msvcReturn.index + msvcReturn[0].length);
    assert.ok(main.indexOf(needle) < goDiscovery);
  }
  for (const constant of ["CHECKOUT_ENV", "DISABLE_ENV", "GO_BINARY_ENV"]) {
    assert.ok(
      main.indexOf(`cargo:rerun-if-env-changed={${constant}}`) <
        main.indexOf("if bridge_disabled()"),
    );
  }
  assert.match(source, /cargo:rerun-if-changed=\{\}", artifact\.display\(\)/);
});

test(
  "compiled MSVC branch ignores PATH but keeps explicit inputs and staged DLL health",
  runtimeOptions,
  (t) => {
    const f = fixture(t);
    const absent = f.run("x86_64-pc-windows-msvc");
    assert.deepEqual(absent.watches, explicitInputs);
    assert.ok(absent.lines.includes(`cargo:rerun-if-changed=${f.artifact()}`));
    assert.match(absent.output, /no staged vendor DLL/);
    assert.match(
      absent.output,
      /cargo:rustc-env=SORNG_OPKSSH_VENDOR_EMBEDDED_RUNTIME=0/,
    );

    f.writeArtifact(syntheticRuntime());
    const healthy = f.run("x86_64-pc-windows-msvc");
    assert.deepEqual(healthy.watches, explicitInputs);
    assert.ok(healthy.lines.includes(`cargo:rerun-if-changed=${f.artifact()}`));
    assert.doesNotMatch(healthy.output, /OPKSSH EMBEDDED RUNTIME NOT BUILT/);
    // The linked MSVC wrapper stays metadata-only even with a healthy staged DLL.
    assert.match(
      healthy.output,
      /cargo:rustc-env=SORNG_OPKSSH_VENDOR_EMBEDDED_RUNTIME=0/,
    );

    f.writeArtifact(
      Buffer.from(
        "embedded OPKSSH runtime is not available in this wrapper build",
      ),
    );
    assert.match(f.run("x86_64-pc-windows-msvc").output, /metadata-only build/);
    f.writeArtifact(syntheticRuntime(0xaa64));
    assert.match(
      f.run("x86_64-pc-windows-msvc").output,
      /not a matching windows-amd64 embedded runtime/,
    );
    f.writeArtifact(syntheticRuntime(0xaa64), "arm64");
    const arm = f.run("aarch64-pc-windows-msvc", {
      HOST: "aarch64-pc-windows-msvc",
    });
    assert.deepEqual(arm.watches, explicitInputs);
    assert.ok(
      arm.lines.includes(`cargo:rerun-if-changed=${f.artifact("arm64")}`),
    );
    assert.doesNotMatch(arm.output, /OPKSSH EMBEDDED RUNTIME NOT BUILT/);
  },
);

test(
  "compiled GNU branch retains PATH discovery watches without invoking Go",
  runtimeOptions,
  (t) => {
    const result = fixture(t).run("x86_64-pc-windows-gnu");
    assert.deepEqual(result.watches, [...explicitInputs, "PATH", "Path"]);
    assert.match(result.output, /checkout .*does not exist/);
    assert.match(result.output, /OPKSSH checkout not found/);
    assert.doesNotMatch(
      result.output,
      /Applying repo-owned|failed to invoke Go/,
    );
    assert.match(
      result.output,
      /cargo:rustc-env=SORNG_OPKSSH_VENDOR_EMBEDDED_RUNTIME=0/,
    );
  },
);

test(
  "compiled disabled and cross-platform branches keep explicit invalidation without Go watches",
  runtimeOptions,
  (t) => {
    const f = fixture(t);
    for (const result of [
      f.run("x86_64-pc-windows-msvc", {
        SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE: "1",
      }),
      f.run("aarch64-pc-windows-gnu"),
    ]) {
      assert.deepEqual(result.watches, explicitInputs);
      assert.doesNotMatch(result.output, /cargo:rerun-if-changed=/);
      assert.match(
        result.output,
        /cargo:rustc-env=SORNG_OPKSSH_VENDOR_EMBEDDED_RUNTIME=0/,
      );
    }
  },
);
