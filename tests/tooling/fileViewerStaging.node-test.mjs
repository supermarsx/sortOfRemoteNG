import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  signViewerExecutable,
  stageFileViewerHost,
  verifyViewerExecutable,
} from "../../scripts/stage-file-viewer-host.mjs";

function executable(machine = 0x8664) {
  const bytes = Buffer.alloc(512);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 0x3c);
  bytes.write("PE\0\0", 64);
  bytes.writeUInt16LE(machine, 68);
  return bytes;
}

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "sorng-viewer-stage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (filename, bytes) => {
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, bytes);
  };
  const bundle = path.join(
    root,
    "src-tauri/crates/sorng-file-viewer-host/bundle",
  );
  const destination = (arch = "amd64") =>
    path.join(bundle, `windows-${arch}`, "sorng-file-viewer-host.exe");
  const source = (triple, profile = "debug") =>
    path.join(
      root,
      "src-tauri/target",
      triple,
      profile,
      "sorng-file-viewer-host.exe",
    );
  write(
    path.join(root, "node_modules/pdfjs-dist/LICENSE"),
    "PDF fixture notice",
  );
  const options = {
    root,
    argv: [],
    env: {},
    platform: "win32",
    arch: "x64",
    log: () => {},
    run: () => {
      throw new Error("unexpected native process");
    },
  };
  return { root, bundle, destination, source, write, options };
}

function fakeSdk(f) {
  const programFiles = path.join(f.root, "SDK fixture");
  const sdk = path.join(programFiles, "Windows Kits/10/bin");
  for (const version of ["10.0.9000.0", "10.0.10000.0", "not-a-version"]) {
    f.write(path.join(sdk, version, "x64/signtool.exe"), executable());
  }
  return {
    env: {
      "ProgramFiles(x86)": programFiles,
      WINDOWS_CERT_THUMBPRINT: "AA ".repeat(20).trim(),
      WINDOWS_SDK_ARCH: "x64",
    },
    tool: path.join(sdk, "10.0.10000.0/x64/signtool.exe"),
  };
}

test("PE verification requires a complete header and the exact supported architecture", (t) => {
  const f = fixture(t);
  const file = f.destination();
  f.write(file, executable());
  assert.deepEqual(verifyViewerExecutable(file, "amd64"), {
    bytes: 512,
    machine: 0x8664,
  });
  assert.throws(() => verifyViewerExecutable(file, "arm64"), /architecture/);
  assert.throws(() => verifyViewerExecutable(file, "x86"), /architecture/);
  f.write(file, executable(0xaa64));
  assert.equal(verifyViewerExecutable(file, "arm64").machine, 0xaa64);
  for (const invalid of [Buffer.from("MZ"), Buffer.alloc(512)]) {
    f.write(file, invalid);
    assert.throws(() => verifyViewerExecutable(file, "amd64"), /executable/);
  }
  const invalid = executable();
  invalid.writeUInt32LE(0xffff_ffff, 0x3c);
  f.write(file, invalid);
  assert.throws(() => verifyViewerExecutable(file, "amd64"), /architecture/);
});

test("unsupported platforms do not build or launch an unrestricted replacement", (t) => {
  const f = fixture(t);
  for (const platform of ["linux", "darwin"]) {
    assert.deepEqual(stageFileViewerHost({ ...f.options, platform }), {
      unsupported: true,
    });
  }
  assert.equal(existsSync(f.destination()), false);
  assert.throws(
    () =>
      stageFileViewerHost({
        ...f.options,
        argv: ["--target", "x86_64-pc-windows-gnu"],
      }),
    /MSVC/,
  );
});

for (const [arch, key, triple, machine] of [
  ["x64", "amd64", "x86_64-pc-windows-msvc", 0x8664],
  ["arm64", "arm64", "aarch64-pc-windows-msvc", 0xaa64],
]) {
  test(`stages ${arch} only after its locked build in the shared default target and preserves other targets`, (t) => {
    const f = fixture(t);
    const otherKey = key === "amd64" ? "arm64" : "amd64";
    f.write(
      f.destination(otherKey),
      Buffer.from("untouched other architecture"),
    );
    const calls = [];
    const result = stageFileViewerHost({
      ...f.options,
      arch,
      argv: ["--release"],
      run: (command, args, options) => {
        calls.push({ command, args, options });
        f.write(f.source(triple, "release"), executable(machine));
        return { status: 0 };
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.deepEqual(calls[0].args.slice(1), [
      "cargo",
      "build",
      "--locked",
      "-p",
      "sorng-file-viewer-host",
      "--bin",
      "sorng-file-viewer-host",
      "--target",
      triple,
      "--target-dir",
      path.join(f.root, "src-tauri/target"),
      "--release",
    ]);
    assert.equal(calls[0].options.cwd, path.join(f.root, "src-tauri"));
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.windowsHide, true);
    assert.equal(result.destination, f.destination(key));
    assert.deepEqual(readFileSync(result.destination), executable(machine));
    assert.equal(
      readFileSync(f.destination(otherKey), "utf8"),
      "untouched other architecture",
    );
    assert.equal(
      readFileSync(path.join(f.bundle, "PDFJS-LICENSE.txt"), "utf8"),
      "PDF fixture notice",
    );
    assert.deepEqual(readdirSync(path.dirname(result.destination)), [
      "sorng-file-viewer-host.exe",
    ]);
  });
}

for (const configuration of ["absolute", "relative"]) {
  test(`uses the ${configuration} configured Cargo target without changing signing or staging paths`, (t) => {
    const f = fixture(t);
    const configured =
      configuration === "absolute"
        ? path.join(f.root, "custom cache")
        : "../custom cache";
    const expected = path.resolve(f.root, "src-tauri", configured);
    const result = stageFileViewerHost({
      ...f.options,
      env: { CARGO_TARGET_DIR: configured },
      run: (_command, args, options) => {
        assert.equal(args[args.indexOf("--target-dir") + 1], expected);
        assert.equal(options.env.CARGO_TARGET_DIR, configured);
        assert.equal(options.cwd, path.join(f.root, "src-tauri"));
        f.write(
          path.join(
            expected,
            "x86_64-pc-windows-msvc",
            "debug",
            "sorng-file-viewer-host.exe",
          ),
          executable(),
        );
        return { status: 0 };
      },
    });
    assert.equal(result.destination, f.destination());
    assert.deepEqual(readFileSync(result.destination), executable());
    assert.equal(existsSync(f.source("x86_64-pc-windows-msvc")), false);
  });
}

test("explicit target overrides host architecture and never reuses a stale cached helper", (t) => {
  const f = fixture(t);
  f.write(f.destination("arm64"), executable(0xaa64));
  let builds = 0;
  const options = {
    ...f.options,
    argv: ["--target=aarch64-pc-windows-msvc"],
    run: (_command, args) => {
      builds++;
      assert.equal(
        args[args.indexOf("--target") + 1],
        "aarch64-pc-windows-msvc",
      );
      f.write(f.source("aarch64-pc-windows-msvc"), executable(0xaa64));
      return { status: 0 };
    },
  };
  stageFileViewerHost(options);
  stageFileViewerHost(options);
  assert.equal(builds, 2);
});

for (const failure of ["build", "wrong architecture", "missing notice"]) {
  test(`${failure} leaves the previous destination intact and no staging residue`, (t) => {
    const f = fixture(t);
    const original = Buffer.from("previous helper must remain");
    f.write(f.destination(), original);
    if (failure === "missing notice")
      rmSync(path.join(f.root, "node_modules/pdfjs-dist/LICENSE"));
    assert.throws(() =>
      stageFileViewerHost({
        ...f.options,
        run: () => {
          f.write(
            f.source("x86_64-pc-windows-msvc"),
            executable(failure === "wrong architecture" ? 0xaa64 : 0x8664),
          );
          return { status: failure === "build" ? 1 : 0 };
        },
      }),
    );
    assert.deepEqual(readFileSync(f.destination()), original);
    assert.deepEqual(readdirSync(path.dirname(f.destination())), [
      "sorng-file-viewer-host.exe",
    ]);
  });
}

test("signing is optional, validates inputs, and uses the newest fixed SDK tool without a shell", (t) => {
  const f = fixture(t);
  const sdk = fakeSdk(f);
  assert.equal(
    signViewerExecutable(f.destination(), { env: {}, run: f.options.run }),
    false,
  );
  for (const env of [
    { ...sdk.env, WINDOWS_CERT_THUMBPRINT: "invalid" },
    { ...sdk.env, WINDOWS_SDK_ARCH: "../arbitrary" },
  ]) {
    assert.throws(() =>
      signViewerExecutable(f.destination(), {
        env,
        platform: "win32",
        run: f.options.run,
      }),
    );
  }
  assert.throws(
    () =>
      signViewerExecutable(f.destination(), {
        env: sdk.env,
        platform: "linux",
        run: f.options.run,
      }),
    /requires Windows/,
  );
  const calls = [];
  assert.equal(
    signViewerExecutable(f.destination(), {
      env: sdk.env,
      platform: "win32",
      arch: "x64",
      run: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0 };
      },
    }),
    true,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, sdk.tool);
  assert.deepEqual(calls[0].args, [
    "sign",
    "/sha1",
    "AA".repeat(20),
    "/fd",
    "SHA256",
    "/td",
    "SHA256",
    "/tr",
    "http://timestamp.digicert.com",
    f.destination(),
  ]);
  assert.deepEqual(calls[1].args, ["verify", "/pa", "/tw", f.destination()]);
  for (const call of calls) {
    assert.equal(call.options.shell, false);
    assert.equal(call.options.windowsHide, true);
  }
});

for (const failure of ["sign", "verify"]) {
  test(`failed Authenticode ${failure} never replaces the previous staged helper`, (t) => {
    const f = fixture(t);
    const sdk = fakeSdk(f);
    f.write(f.destination(), "previous signed helper");
    const phases = [];
    assert.throws(
      () =>
        stageFileViewerHost({
          ...f.options,
          env: sdk.env,
          run: (command, args) => {
            if (command === process.execPath) {
              f.write(f.source("x86_64-pc-windows-msvc"), executable());
              return { status: 0 };
            }
            phases.push(args[0]);
            assert.equal(command, sdk.tool);
            assert.ok(args.at(-1).endsWith(`.${process.pid}.staging`));
            assert.equal(
              readFileSync(f.destination(), "utf8"),
              "previous signed helper",
            );
            return { status: args[0] === failure ? 1 : 0 };
          },
        }),
      /signing or verification failed/,
    );
    assert.deepEqual(
      phases,
      failure === "sign" ? ["sign"] : ["sign", "verify"],
    );
    assert.equal(
      readFileSync(f.destination(), "utf8"),
      "previous signed helper",
    );
    assert.deepEqual(readdirSync(path.dirname(f.destination())), [
      "sorng-file-viewer-host.exe",
    ]);
  });
}

test("successful signing and verification both happen before atomic publication", (t) => {
  const f = fixture(t);
  const sdk = fakeSdk(f);
  const phases = [];
  f.write(f.destination(), "old helper");
  stageFileViewerHost({
    ...f.options,
    env: sdk.env,
    run: (command, args) => {
      if (command === process.execPath) {
        f.write(f.source("x86_64-pc-windows-msvc"), executable());
        return { status: 0 };
      }
      phases.push(args[0]);
      assert.equal(readFileSync(f.destination(), "utf8"), "old helper");
      if (args[0] === "sign")
        writeFileSync(
          args.at(-1),
          Buffer.concat([
            readFileSync(args.at(-1)),
            Buffer.from("synthetic-signature"),
          ]),
        );
      return { status: 0 };
    },
  });
  assert.deepEqual(phases, ["sign", "verify"]);
  assert.ok(
    readFileSync(f.destination()).toString().endsWith("synthetic-signature"),
  );
});
