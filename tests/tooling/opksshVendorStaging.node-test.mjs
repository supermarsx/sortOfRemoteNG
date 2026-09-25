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
  opksshWindowsBridgeBuildArgs,
  opksshWindowsBridgeEnvironment,
  opksshWindowsBridgePlan,
  verifyOpksshVendorBytes,
} from "../../scripts/opkssh-vendor-artifact.mjs";
import {
  opksshStagingEnabled,
  opksshTarget,
  stageVendorArtifact,
} from "../../scripts/stage-opkssh-vendor.mjs";
import { prepareTauriDevOpkssh } from "../../scripts/tauri-dev.mjs";

function fixtureDll(
  machine = 0x8664,
  symbols = OPKSSH_ABI_EXPORTS,
  { imports = [], delayImports = [] } = {},
) {
  const bytes = Buffer.alloc(4096);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 60);
  bytes.write("PE\0\0", 64);
  bytes.writeUInt16LE(machine, 68);
  bytes.writeUInt16LE(1, 70);
  bytes.writeUInt16LE(240, 84);
  bytes.writeUInt16LE(0x2000, 86);
  bytes.writeUInt16LE(0x20b, 88);
  bytes.writeUInt32LE(16, 196);
  bytes.writeUInt32LE(0x1000, 200);
  bytes.writeUInt32LE(40, 204);
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
  let nameCursor = 2560;
  for (const [names, directory, table, descriptorSize, nameOffset] of [
    [imports, 208, 2048, 20, 12],
    [delayImports, 304, 2304, 32, 4],
  ]) {
    if (!names.length) continue;
    bytes.writeUInt32LE(table - 512 + 0x1000, directory);
    bytes.writeUInt32LE((names.length + 1) * descriptorSize, directory + 4);
    names.forEach((name, index) => {
      const descriptor = table + index * descriptorSize;
      if (descriptorSize === 32) bytes.writeUInt32LE(1, descriptor);
      bytes.writeUInt32LE(nameCursor - 512 + 0x1000, descriptor + nameOffset);
      bytes.write(name, nameCursor);
      nameCursor += Buffer.byteLength(name) + 1;
    });
  }
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
  const external = fixtureDll(0x8664, OPKSSH_ABI_EXPORTS, {
    imports: ["libgcc_s_seh-1.dll"],
  });
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
test("checks actual normal and delayed runtime imports on both Windows architectures", () => {
  for (const [machine, archKey] of [
    [0x8664, "amd64"],
    [0xaa64, "arm64"],
  ]) {
    for (const kind of ["imports", "delayImports"]) {
      for (const name of [
        "libgcc_s_seh-1.dll",
        "libgcc_s_sjlj-1.dll",
        "libgcc_s_dw2-1.dll",
        "libwinpthread-1.dll",
        "LiBuNwInD.DlL",
        "libc++.dll",
        "libc++abi.dll",
        "libstdc++-6.dll",
      ]) {
        assert.throws(
          () =>
            verifyOpksshVendorBytes(
              fixtureDll(machine, OPKSSH_ABI_EXPORTS, { [kind]: [name] }),
              { osKey: "windows", archKey },
            ),
          (error) =>
            error.message.endsWith(
              `unstaged MinGW runtime DLL: ${name.toLowerCase()}`,
            ),
        );
      }
    }
    const systemOnly = fixtureDll(machine, OPKSSH_ABI_EXPORTS, {
      imports: ["KERNEL32.dll", "api-ms-win-crt-runtime-l1-1-0.dll"],
      delayImports: ["USERENV.dll"],
    });
    systemOnly.write("debug path: libunwind.dll libgcc_s_seh-1.dll", 3500);
    assert.doesNotThrow(() =>
      verifyOpksshVendorBytes(systemOnly, { osKey: "windows", archKey }),
    );
  }
});
test("malformed PE import tables cannot bypass runtime validation", () => {
  for (const mutate of [
    (bytes) => bytes.writeUInt32LE(17, 196), // beyond optional header
    (bytes) => bytes.writeUInt32LE(0xffffffff, 208), // unmapped directory
    (bytes) => bytes.writeUInt32LE(0, 212), // missing directory size
    (bytes) => bytes.writeUInt32LE(20, 212), // no terminating descriptor
    (bytes) => bytes.writeUInt32LE(0xffffffff, 2060), // unmapped DLL name
    (bytes) => bytes.fill(65, 2560), // unterminated DLL name
    (bytes) => bytes.writeUInt32LE(0, 2304), // VA-based delay import
  ]) {
    const bytes = fixtureDll(0xaa64, OPKSSH_ABI_EXPORTS, {
      imports: ["libunwind.dll"],
      delayImports: ["USERENV.dll"],
    });
    mutate(bytes);
    // Restore Go markers after the unterminated-name mutation; still no NUL.
    bytes.write("runtime.goexit golang.org go1.26.2", 3072);
    assert.throws(
      () =>
        verifyOpksshVendorBytes(bytes, { osKey: "windows", archKey: "arm64" }),
      /invalid or truncated OPKSSH PE/,
    );
  }
});
test("non-Windows verification does not interpret strings as PE imports", () => {
  const bytes = Buffer.from(
    [
      ...OPKSSH_ABI_EXPORTS,
      "runtime.goexit golang.org go1.26.2",
      "libunwind.dll",
    ].join("\0"),
  );
  for (const osKey of ["linux", "macos"]) {
    for (const archKey of ["amd64", "arm64"]) {
      assert.equal(
        verifyOpksshVendorBytes(bytes, { osKey, archKey }).goVersion,
        "go1.26.2",
      );
    }
  }
});
test("Linux and macOS still stage their Cargo artifacts without Windows linker flags", (t) => {
  const f = sandbox(t);
  const bytes = Buffer.from(
    [...OPKSSH_ABI_EXPORTS, "runtime.goexit golang.org go1.26.2"].join("\0"),
  );
  for (const [osKey, suffix, artifact] of [
    ["linux", "unknown-linux-gnu", "libsorng_opkssh_vendor.so"],
    ["macos", "apple-darwin", "libsorng_opkssh_vendor.dylib"],
  ]) {
    for (const [archKey, arch] of [
      ["amd64", "x86_64"],
      ["arm64", "aarch64"],
    ]) {
      const triple = `${arch}-${suffix}`;
      const source = path.join(f.root, "build", triple, artifact);
      f.write(source, bytes);
      const result = stageVendorArtifact({
        ...f.options,
        argv: ["--release", "--target", triple],
        run(command, args) {
          assert.equal(command, "cargo");
          assert.equal(args[0], "build");
          assert.equal(args[args.indexOf("--target") + 1], triple);
          assert.ok(
            !args.some((arg) => /crt-static|windows|gnullvm/.test(arg)),
          );
          return {
            status: 0,
            stdout: JSON.stringify({
              reason: "compiler-artifact",
              target: { name: "sorng_opkssh_vendor" },
              filenames: [source],
            }),
          };
        },
      });
      assert.equal(
        result.destination,
        path.join(f.bundle, `${osKey}-${archKey}`, artifact),
      );
      assert.deepEqual(readFileSync(result.destination), bytes);
    }
  }
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
test("ARM64 prebuilt with a real unwind import preserves the staged artifact", (t) => {
  const f = sandbox(t);
  const destination = path.join(
    f.bundle,
    "windows-arm64/sorng_opkssh_vendor.dll",
  );
  const healthy = fixtureDll(0xaa64);
  f.write(destination, healthy);
  const prebuilt = path.join(f.root, "prebuilt.dll");
  f.write(
    prebuilt,
    fixtureDll(0xaa64, OPKSSH_ABI_EXPORTS, { imports: ["libunwind.dll"] }),
  );
  assert.throws(
    () =>
      stageVendorArtifact({
        ...f.options,
        argv: ["--target", "aarch64-pc-windows-msvc"],
        env: { SORNG_OPKSSH_VENDOR_ARTIFACT: prebuilt },
      }),
    /unstaged MinGW runtime DLL: libunwind\.dll/,
  );
  assert.deepEqual(readFileSync(destination), healthy);
});
test("only the ARM64 final library gets static CRT linkage in release and debug builds", () => {
  const inputs = {
    manifestPath: "vendor/Cargo.toml",
    targetDir: "bridge-target",
  };
  const arm = opksshWindowsBridgePlan(
    "aarch64-pc-windows-gnullvm",
    "aarch64-pc-windows-msvc",
  );
  const x64 = opksshWindowsBridgePlan(
    "x86_64-pc-windows-gnu",
    "x86_64-pc-windows-msvc",
  );
  for (const release of [true, false]) {
    const armArgs = opksshWindowsBridgeBuildArgs(arm, { ...inputs, release });
    assert.deepEqual(armArgs, [
      "rustc",
      "--lib",
      "--manifest-path",
      inputs.manifestPath,
      "--target",
      arm.triple,
      "--target-dir",
      inputs.targetDir,
      ...(release ? ["--release"] : []),
      "--",
      "-C",
      "target-feature=+crt-static",
    ]);
    const x64Args = opksshWindowsBridgeBuildArgs(x64, { ...inputs, release });
    assert.deepEqual(x64Args, [
      "+stable-x86_64-pc-windows-gnu",
      "build",
      "--manifest-path",
      inputs.manifestPath,
      "--target",
      x64.triple,
      "--target-dir",
      inputs.targetDir,
      ...(release ? ["--release"] : []),
    ]);
  }
});
test("ARM64 bridge compiler environment preserves the caller's MSVC environment", () => {
  const plan = opksshWindowsBridgePlan(
    "aarch64-pc-windows-gnullvm",
    "aarch64-pc-windows-msvc",
  );
  const compilerBin = "C:\\Toolchains with spaces\\llvm-mingw\\bin";
  const appPath = "C:\\Program Files\\LLVM\\bin;C:\\Windows\\System32";
  for (const paths of [
    { PATH: appPath },
    { Path: appPath },
    { PATH: appPath, Path: "C:\\ignored-alias" },
    {},
  ]) {
    const parent = Object.freeze({
      ...paths,
      CC: "cl.exe",
      CXX: "cl.exe",
      CGO_ENABLED: "0",
      CARGO_TARGET_AARCH64_PC_WINDOWS_MSVC_LINKER: "link.exe",
      RUSTFLAGS: "-C debuginfo=1",
      SORNG_OPKSSH_LLVM_MINGW_BIN: compilerBin,
    });
    const original = { ...parent };
    const child = opksshWindowsBridgeEnvironment(plan, parent);
    const compiler = path.win32.join(
      compilerBin,
      "aarch64-w64-mingw32-clang.exe",
    );
    assert.equal(child.CC, plan.compiler);
    assert.equal(child[plan.linkerEnv], compiler);
    assert.equal(child.CGO_ENABLED, "1");
    assert.equal(
      child.PATH,
      compilerBin + (Object.keys(paths).length ? `;${appPath}` : ""),
    );
    assert.equal(child.Path, undefined);
    assert.equal(child.CXX, parent.CXX);
    assert.equal(
      child.CARGO_TARGET_AARCH64_PC_WINDOWS_MSVC_LINKER,
      parent.CARGO_TARGET_AARCH64_PC_WINDOWS_MSVC_LINKER,
    );
    assert.equal(child.RUSTFLAGS, parent.RUSTFLAGS);
    assert.deepEqual(parent, original);
  }
  assert.throws(
    () =>
      opksshWindowsBridgeEnvironment(plan, {
        SORNG_OPKSSH_LLVM_MINGW_BIN: "relative/bin",
      }),
    /must be an absolute path/,
  );
});

test("x64 and existing ARM64 PATH toolchains keep their compiler selection", () => {
  for (const target of [
    "x86_64-pc-windows-gnu",
    "aarch64-pc-windows-gnullvm",
  ]) {
    const plan = opksshWindowsBridgePlan(target, target);
    const parent = Object.freeze({
      Path: "C:\\existing-toolchain\\bin",
      ...(plan.archKey === "amd64"
        ? { SORNG_OPKSSH_LLVM_MINGW_BIN: "C:\\arm64-only\\bin" }
        : {}),
    });
    assert.deepEqual(opksshWindowsBridgeEnvironment(plan, parent), {
      ...parent,
      CC: plan.compiler,
      CGO_ENABLED: "1",
      [plan.linkerEnv]: plan.compiler,
    });
  }
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
  const external = fixtureDll(0xaa64, OPKSSH_ABI_EXPORTS, {
    imports: ["libunwind.dll"],
  });
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
