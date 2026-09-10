import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  OPKSSH_ABI_EXPORTS,
  OPKSSH_STUB_MARKER,
  opksshWindowsBridgePlan,
  verifyOpksshVendorBytes,
} from "../../scripts/opkssh-vendor-artifact.mjs";
import {
  opksshStagingEnabled,
  opksshTarget,
  stageVendorArtifact,
} from "../../scripts/stage-opkssh-vendor.mjs";
import { prepareTauriDevOpkssh } from "../../scripts/tauri-dev.mjs";

function fixtureDll(machine = 0x8664, symbols = OPKSSH_ABI_EXPORTS) {
  const bytes = Buffer.alloc(4096);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 60);
  bytes.write("PE\0\0", 64);
  bytes.writeUInt16LE(machine, 68);
  bytes.writeUInt16LE(1, 70);
  bytes.writeUInt16LE(240, 84);
  bytes.writeUInt16LE(0x2000, 86);
  bytes.writeUInt16LE(0x20b, 88);
  bytes.writeUInt32LE(0x1000, 200);
  bytes.writeUInt32LE(0x1000, 340);
  bytes.writeUInt32LE(3584, 344);
  bytes.writeUInt32LE(512, 348);
  bytes.writeUInt32LE(symbols.length, 536);
  bytes.writeUInt32LE(0x1040, 544);
  let cursor = 1024;
  symbols.forEach((symbol, index) => {
    bytes.writeUInt32LE(cursor - 512 + 0x1000, 576 + index * 4);
    bytes.write(symbol, cursor);
    cursor += Buffer.byteLength(symbol) + 1;
  });
  bytes.write("runtime.goexit golang.org go1.26.2", 3072);
  return bytes;
}
const target = { osKey: "windows", archKey: "amd64" };
function sandbox(t) {
  const root = mkdtempSync(path.join(tmpdir(), "sorng-opkssh-stage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bundle = path.join(
    root,
    "src-tauri/crates/sorng-opkssh-vendor/bundle/opkssh",
  );
  const destination = path.join(
    bundle,
    "windows-amd64/sorng_opkssh_vendor.dll",
  );
  const cached = path.join(
    root,
    "src-tauri/target-opkssh-gnu/x86_64-pc-windows-gnu/release/sorng_opkssh_vendor.dll",
  );
  const write = (file, bytes) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  };
  const options = {
    root,
    argv: [],
    env: {},
    platform: "win32",
    arch: "x64",
    log: () => {},
    run: () => {
      throw new Error("unexpected build");
    },
  };
  return { root, bundle, destination, cached, write, options };
}

test("embedded staging defaults on, with explicit CLI-only opt-outs", () => {
  assert.equal(opksshStagingEnabled([], {}), true);
  assert.equal(opksshStagingEnabled(["--disable"], {}), false);
  assert.equal(
    opksshStagingEnabled([], { SORNG_ENABLE_OPKSSH_VENDOR_BUNDLE: "0" }),
    false,
  );
  assert.equal(
    opksshStagingEnabled(["--enable"], {
      SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE: "1",
    }),
    false,
  );
  assert.throws(() =>
    opksshStagingEnabled([], { SORNG_ENABLE_OPKSSH_VENDOR_BUNDLE: "typo" }),
  );
  assert.throws(
    () => opksshTarget(["--target"], {}, "win32", "x64"),
    /requires a value/,
  );
  assert.throws(
    () => opksshTarget(["--target="], {}, "win32", "x64"),
    /requires a value/,
  );
});
test("verifies actual export table, runtime presence and exact x64/ARM64 machine", () => {
  assert.equal(
    verifyOpksshVendorBytes(fixtureDll(), target).goVersion,
    "go1.26.2",
  );
  assert.throws(
    () =>
      verifyOpksshVendorBytes(fixtureDll(), { ...target, archKey: "arm64" }),
    /architecture/,
  );
  assert.doesNotThrow(() =>
    verifyOpksshVendorBytes(fixtureDll(0xaa64), {
      ...target,
      archKey: "arm64",
    }),
  );
  const missingExport = fixtureDll(0x8664, OPKSSH_ABI_EXPORTS.slice(1));
  missingExport.write(OPKSSH_ABI_EXPORTS[0], 3500);
  assert.throws(
    () => verifyOpksshVendorBytes(missingExport, target),
    /C ABI exports/,
  );
  const stub = fixtureDll();
  stub.write(OPKSSH_STUB_MARKER, 3500);
  assert.throws(() => verifyOpksshVendorBytes(stub, target), /metadata-only/);
  const external = fixtureDll();
  external.write("libgcc_s_seh-1.dll", 3500);
  assert.throws(() => verifyOpksshVendorBytes(external, target), /MinGW/);
  assert.throws(
    () =>
      verifyOpksshVendorBytes(
        Buffer.from("not a library runtime.goexit golang.org go1.26"),
        target,
      ),
    /PE/,
  );
});
test("preserves healthy staged bridge without rebuilding or touching other platforms", (t) => {
  const f = sandbox(t);
  f.write(f.destination, fixtureDll());
  const other = path.join(f.bundle, "linux-arm64/fixture.so");
  f.write(other, "keep");
  assert.equal(stageVendorArtifact(f.options).reused, true);
  assert.deepEqual(readFileSync(f.destination), fixtureDll());
  assert.equal(readFileSync(other, "utf8"), "keep");
});
test("replaces stale metadata only with verified cached GNU bridge", (t) => {
  const f = sandbox(t);
  f.write(f.destination, OPKSSH_STUB_MARKER);
  f.write(f.cached, fixtureDll());
  const other = path.join(f.bundle, "windows-arm64/fixture.dll");
  f.write(other, "keep");
  assert.equal(stageVendorArtifact(f.options).reused, false);
  assert.deepEqual(readFileSync(f.destination), fixtureDll());
  assert.equal(readFileSync(other, "utf8"), "keep");
});
test("missing bridge uses dedicated GNU builder, then validates before staging", (t) => {
  const f = sandbox(t);
  let calls = 0;
  stageVendorArtifact({
    ...f.options,
    run(command, args, options) {
      calls++;
      assert.equal(command, process.execPath);
      assert.equal(path.basename(args[0]), "build-opkssh-vendor-bridge.mjs");
      assert.deepEqual(args.slice(1), [
        "--target",
        "x86_64-pc-windows-gnu",
        "--skip-stage",
      ]);
      assert.equal(options.windowsHide, true);
      f.write(f.cached, fixtureDll());
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(readFileSync(f.destination), fixtureDll());
});
test("failed or metadata-only build never overwrites an existing artifact", (t) => {
  const f = sandbox(t);
  f.write(f.destination, "old artifact");
  assert.throws(
    () =>
      stageVendorArtifact({
        ...f.options,
        run() {
          return { status: 1 };
        },
      }),
    /preserved/,
  );
  assert.equal(readFileSync(f.destination, "utf8"), "old artifact");
  assert.throws(
    () =>
      stageVendorArtifact({
        ...f.options,
        run() {
          f.write(f.cached, OPKSSH_STUB_MARKER);
          return { status: 0 };
        },
      }),
    /metadata-only/,
  );
  assert.equal(readFileSync(f.destination, "utf8"), "old artifact");
});
test("explicit disable removes only the selected artifact", (t) => {
  const f = sandbox(t);
  f.write(f.destination, fixtureDll());
  const other = path.join(f.bundle, "windows-arm64/fixture.dll");
  f.write(other, "keep");
  assert.equal(
    stageVendorArtifact({ ...f.options, argv: ["--disable"] }).disabled,
    true,
  );
  assert.equal(existsSync(f.destination), false);
  assert.equal(readFileSync(other, "utf8"), "keep");
});
test("ARM64 accepts only matching prebuilt, never reuses x64 or falls back to metadata", (t) => {
  const f = sandbox(t);
  const argv = ["--target", "aarch64-pc-windows-msvc"];
  assert.equal(opksshTarget(argv, {}, "win32", "x64").archKey, "arm64");
  const prebuilt = path.join(f.root, "prebuilt.dll");
  f.write(prebuilt, fixtureDll());
  const env = { SORNG_OPKSSH_VENDOR_ARTIFACT: prebuilt };
  assert.throws(
    () => stageVendorArtifact({ ...f.options, argv, env }),
    /architecture/,
  );
  f.write(prebuilt, fixtureDll(0xaa64));
  const result = stageVendorArtifact({ ...f.options, argv, env });
  assert.match(result.destination, /windows-arm64/);
  assert.deepEqual(readFileSync(result.destination), fixtureDll(0xaa64));
});
test("ARM64 staging uses native gnullvm builder and its separate artifact", (t) => {
  const f = sandbox(t);
  f.write(f.cached, fixtureDll());
  const cachedArm = path.join(
    f.root,
    "src-tauri/target-opkssh-gnu/aarch64-pc-windows-gnullvm/release/sorng_opkssh_vendor.dll",
  );
  let calls = 0;
  const result = stageVendorArtifact({
    ...f.options,
    arch: "arm64",
    argv: ["--target", "aarch64-pc-windows-msvc"],
    run(command, args, options) {
      calls++;
      assert.equal(command, process.execPath);
      assert.deepEqual(args.slice(1), [
        "--target",
        "aarch64-pc-windows-gnullvm",
        "--skip-stage",
      ]);
      assert.equal(options.windowsHide, true);
      f.write(cachedArm, fixtureDll(0xaa64));
      return { status: 0 };
    },
  });
  assert.equal(calls, 1);
  assert.match(result.destination, /windows-arm64/);
  assert.deepEqual(readFileSync(result.destination), fixtureDll(0xaa64));
  assert.deepEqual(readFileSync(f.cached), fixtureDll());
});
test("native build plans require exact host architecture and select fixed compiler/toolchain", () => {
  const arm = opksshWindowsBridgePlan(
    "aarch64-pc-windows-gnullvm",
    "aarch64-pc-windows-msvc",
  );
  assert.deepEqual(arm, {
    triple: "aarch64-pc-windows-gnullvm",
    archKey: "arm64",
    toolchain: null,
    compiler: "aarch64-w64-mingw32-clang",
    linkerEnv: "CARGO_TARGET_AARCH64_PC_WINDOWS_GNULLVM_LINKER",
  });
  const x64 = opksshWindowsBridgePlan(
    "x86_64-pc-windows-gnu",
    "x86_64-pc-windows-msvc",
  );
  assert.equal(x64.toolchain, "stable-x86_64-pc-windows-gnu");
  assert.equal(x64.compiler, "gcc");
  for (const host of [
    "x86_64-pc-windows-msvc",
    "aarch64-unknown-linux-gnu",
    undefined,
  ])
    assert.throws(
      () => opksshWindowsBridgePlan("aarch64-pc-windows-gnullvm", host),
      /native arm64 Windows Rust host/,
    );
  assert.throws(
    () =>
      opksshWindowsBridgePlan(
        "x86_64-pc-windows-gnu",
        "aarch64-pc-windows-msvc",
      ),
    /native amd64/,
  );
  assert.throws(
    () =>
      opksshWindowsBridgePlan(
        "aarch64-pc-windows-msvc",
        "aarch64-pc-windows-msvc",
      ),
    /Unsupported/,
  );
  const external = fixtureDll(0xaa64);
  external.write("libunwind.dll", 3500);
  assert.throws(
    () =>
      verifyOpksshVendorBytes(external, { osKey: "windows", archKey: "arm64" }),
    /unstaged/,
  );
});
test("managed dev runs staging with its exact target and opt-out environment", () => {
  const env = { SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE: "1" };
  let received;
  prepareTauriDevOpkssh(
    [
      "--features",
      "lean",
      "--target",
      "aarch64-pc-windows-msvc",
      "--",
      "--no-default-features",
    ],
    env,
    () => {},
    (options) => {
      received = options;
    },
  );
  assert.equal(received.env, env);
  assert.deepEqual(received.argv, ["--target", "aarch64-pc-windows-msvc"]);
});
