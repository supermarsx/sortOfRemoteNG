import { readFileSync } from "node:fs";
import path from "node:path";

/** The bridge is built natively; never silently cross-build a metadata wrapper. */
export function opksshWindowsBridgePlan(target, host) {
  const archKey = target?.startsWith("aarch64-") ? "arm64" : "amd64";
  const triple =
    archKey === "arm64"
      ? "aarch64-pc-windows-gnullvm"
      : "x86_64-pc-windows-gnu";
  if (target !== triple)
    throw new Error(`Unsupported OPKSSH bridge target: ${target}`);
  const hostPrefix =
    archKey === "arm64" ? "aarch64-pc-windows-" : "x86_64-pc-windows-";
  if (!host?.startsWith(hostPrefix))
    throw new Error(
      `OPKSSH ${triple} requires a native ${archKey} Windows Rust host (found ${host || "unknown"}); use a matching native runner or a verified prebuilt artifact.`,
    );
  return {
    triple,
    archKey,
    toolchain: archKey === "arm64" ? null : "stable-x86_64-pc-windows-gnu",
    compiler: archKey === "arm64" ? "aarch64-w64-mingw32-clang" : "gcc",
    linkerEnv:
      archKey === "arm64"
        ? "CARGO_TARGET_AARCH64_PC_WINDOWS_GNULLVM_LINKER"
        : "CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER",
  };
}

/** Scope the bridge compiler and its companion tools to child processes. */
export function opksshWindowsBridgeEnvironment(plan, baseEnv = process.env) {
  const env = { ...baseEnv };
  const compilerBin =
    plan.archKey === "arm64" ? env.SORNG_OPKSSH_LLVM_MINGW_BIN : undefined;
  let compiler = plan.compiler;
  if (compilerBin) {
    if (!path.win32.isAbsolute(compilerBin))
      throw new Error("SORNG_OPKSSH_LLVM_MINGW_BIN must be an absolute path");
    compiler = path.win32.join(compilerBin, `${plan.compiler}.exe`);
    // Node uses the first sorted spelling on Windows. Collapse aliases so a
    // caller providing both PATH and Path cannot mask the child-only prefix.
    const pathKeys = Object.keys(env)
      .filter((key) => key.toUpperCase() === "PATH")
      .sort();
    const inheritedPath = env[pathKeys[0]];
    for (const key of pathKeys) delete env[key];
    env.PATH = compilerBin + (inheritedPath ? `;${inheritedPath}` : "");
  }
  env.CGO_ENABLED = "1";
  // CGO parses CC as a command line; resolve the fixed compiler name via the
  // child PATH so toolchain directories containing spaces need no quoting.
  env.CC = plan.compiler;
  env[plan.linkerEnv] = compiler;
  return env;
}

/** Keep static LLVM unwind linkage local to the ARM64 vendor library. */
export function opksshWindowsBridgeBuildArgs(
  plan,
  { manifestPath, targetDir, release = true },
) {
  const arm64 = plan.triple === "aarch64-pc-windows-gnullvm";
  return [
    ...(plan.toolchain ? [`+${plan.toolchain}`] : []),
    arm64 ? "rustc" : "build",
    ...(arm64 ? ["--lib"] : []),
    "--manifest-path",
    manifestPath,
    "--target",
    plan.triple,
    "--target-dir",
    targetDir,
    ...(release ? ["--release"] : []),
    // Rust's gnullvm std requests dynamic `unwind` unless crt-static is set.
    // -static-libgcc alone cannot override that explicit Rust import. cargo
    // rustc applies this to the final library, preserving caller RUSTFLAGS and
    // leaving the host build script and the separately built MSVC app alone.
    ...(arm64 ? ["--", "-C", "target-feature=+crt-static"] : []),
  ];
}

export const OPKSSH_STUB_MARKER =
  "embedded OPKSSH runtime is not available in this wrapper build";
export const OPKSSH_ABI_EXPORTS = Object.freeze([
  "sorng_opkssh_vendor_abi_version",
  "sorng_opkssh_vendor_embedded_runtime",
  "sorng_opkssh_vendor_backend_callable",
  "sorng_opkssh_vendor_config_load_supported",
  "sorng_opkssh_vendor_login_supported",
  "sorng_opkssh_vendor_login_json",
  "sorng_opkssh_vendor_load_client_config_json",
  "sorng_opkssh_vendor_free_string",
]);

/** Inspect PE tables, not incidental symbol/DLL strings in debug data. */
function windowsPeTables(bytes, archKey) {
  const fail = () => {
    throw new Error("invalid or truncated OPKSSH PE library");
  };
  const range = (at, size) => {
    if (
      !Number.isSafeInteger(at) ||
      at < 0 ||
      size < 0 ||
      at + size > bytes.length
    )
      fail();
    return at;
  };
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") fail();
  const pe = bytes.readUInt32LE(60);
  range(pe, 24);
  if (bytes.readUInt32LE(pe) !== 0x4550) fail();
  const expectedMachine =
    archKey === "amd64" ? 0x8664 : archKey === "arm64" ? 0xaa64 : 0;
  if (!expectedMachine || bytes.readUInt16LE(pe + 4) !== expectedMachine)
    throw new Error(
      `OPKSSH DLL architecture does not match windows-${archKey}`,
    );
  if (!(bytes.readUInt16LE(pe + 22) & 0x2000)) fail();
  const sectionCount = bytes.readUInt16LE(pe + 6);
  const optionalSize = bytes.readUInt16LE(pe + 20);
  const optional = range(pe + 24, optionalSize);
  if (optionalSize < 120 || bytes.readUInt16LE(optional) !== 0x20b) fail();
  const directoryCount = bytes.readUInt32LE(optional + 108);
  if (!directoryCount || 112 + directoryCount * 8 > optionalSize) fail();
  const sectionTable = range(optional + optionalSize, sectionCount * 40);
  const rvaOffset = (rva, size) => {
    for (let index = 0; index < sectionCount; index++) {
      const section = sectionTable + index * 40;
      const start = bytes.readUInt32LE(section + 12);
      const rawSize = bytes.readUInt32LE(section + 16);
      const delta = rva - start;
      if (delta >= 0 && delta + size <= rawSize)
        return range(bytes.readUInt32LE(section + 20) + delta, size);
    }
    return fail();
  };
  const readName = (rva) => {
    const name = rvaOffset(rva, 1);
    const end = bytes.indexOf(0, name);
    if (end <= name || end - name > 4096) fail();
    rvaOffset(rva, end - name + 1);
    return bytes.toString("ascii", name, end);
  };
  const exports = rvaOffset(bytes.readUInt32LE(optional + 112), 40);
  const count = bytes.readUInt32LE(exports + 24);
  if (count > 100_000) fail();
  const names = rvaOffset(bytes.readUInt32LE(exports + 32), count * 4);
  const result = new Set();
  for (let index = 0; index < count; index++) {
    result.add(readName(bytes.readUInt32LE(names + index * 4)));
  }
  const imports = new Set();
  for (const [directoryIndex, descriptorSize, nameOffset] of [
    [1, 20, 12], // IMAGE_IMPORT_DESCRIPTOR
    [13, 32, 4], // RVA-based delay imports
  ]) {
    if (directoryCount <= directoryIndex) continue;
    const directory = optional + 112 + directoryIndex * 8;
    const rva = bytes.readUInt32LE(directory);
    const size = bytes.readUInt32LE(directory + 4);
    if (rva === 0 && size === 0) continue;
    if (!rva || size < descriptorSize) fail();
    rvaOffset(rva, size);
    let terminated = false;
    for (
      let index = 0;
      index + descriptorSize <= size;
      index += descriptorSize
    ) {
      const descriptor = rvaOffset(rva + index, descriptorSize);
      if (
        bytes
          .subarray(descriptor, descriptor + descriptorSize)
          .every((b) => b === 0)
      ) {
        terminated = true;
        break;
      }
      // Reject legacy VA-based delay descriptors rather than misreading them.
      if (directoryIndex === 13 && bytes.readUInt32LE(descriptor) !== 1) fail();
      imports.add(
        readName(bytes.readUInt32LE(descriptor + nameOffset)).toLowerCase(),
      );
    }
    if (!terminated) fail();
  }
  return { exports: result, imports };
}

/** This is an artifact/build check, never a login or a read of user configuration. */
export function verifyOpksshVendorBytes(bytes, { osKey, archKey }) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0)
    throw new Error("OPKSSH vendor library is empty");
  const text = bytes.toString("latin1");
  if (text.includes(OPKSSH_STUB_MARKER))
    throw new Error(
      "OPKSSH library is metadata-only; build the embedded Go bridge or explicitly opt out",
    );
  if (
    ["runtime.goexit", "golang.org", "go1."].some(
      (marker) => !text.includes(marker),
    )
  )
    throw new Error("OPKSSH library is missing the embedded Go runtime");
  const pe = osKey === "windows" ? windowsPeTables(bytes, archKey) : null;
  if (
    OPKSSH_ABI_EXPORTS.some((symbol) =>
      pe ? !pe.exports.has(symbol) : !text.includes(symbol),
    )
  )
    throw new Error("OPKSSH library is missing required C ABI exports");
  const externalRuntimes = [...(pe?.imports ?? [])].filter((name) =>
    /^(?:libgcc_s_(?:seh|sjlj|dw2)-1|libwinpthread-1|libunwind|libc\+\+|libc\+\+abi|libstdc\+\+-6)\.dll$/i.test(
      name,
    ),
  );
  if (externalRuntimes.length)
    throw new Error(
      `OPKSSH library requires an unstaged MinGW runtime DLL: ${externalRuntimes.sort().join(", ")}`,
    );
  return { goVersion: text.match(/go1\.\d+(?:\.\d+)?/)?.[0] ?? "unknown" };
}

export function verifyOpksshVendorArtifact(filePath, target) {
  return verifyOpksshVendorBytes(readFileSync(filePath), target);
}
