import { readFileSync } from "node:fs";

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

/** Inspect the PE export directory, not incidental symbol strings in debug data. */
function windowsExports(bytes, archKey) {
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
  const exports = rvaOffset(bytes.readUInt32LE(optional + 112), 40);
  const count = bytes.readUInt32LE(exports + 24);
  if (count > 100_000) fail();
  const names = rvaOffset(bytes.readUInt32LE(exports + 32), count * 4);
  const result = new Set();
  for (let index = 0; index < count; index++) {
    const name = rvaOffset(bytes.readUInt32LE(names + index * 4), 1);
    const end = bytes.indexOf(0, name);
    if (end < name || end - name > 4096) fail();
    result.add(bytes.toString("ascii", name, end));
  }
  return result;
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
  const exports = osKey === "windows" ? windowsExports(bytes, archKey) : null;
  if (
    OPKSSH_ABI_EXPORTS.some((symbol) =>
      exports ? !exports.has(symbol) : !text.includes(symbol),
    )
  )
    throw new Error("OPKSSH library is missing required C ABI exports");
  if (
    osKey === "windows" &&
    /libgcc_s_(?:seh|sjlj|dw2)-1\.dll|libwinpthread-1\.dll|libunwind\.dll/i.test(
      text,
    )
  )
    throw new Error("OPKSSH library requires an unstaged MinGW runtime DLL");
  return { goVersion: text.match(/go1\.\d+(?:\.\d+)?/)?.[0] ?? "unknown" };
}

export function verifyOpksshVendorArtifact(filePath, target) {
  return verifyOpksshVendorBytes(readFileSync(filePath), target);
}
