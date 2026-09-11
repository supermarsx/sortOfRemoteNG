import { existsSync } from "node:fs";
import path from "node:path";

/** Repair a vendor install root, never replace a valid explicit toolchain.
 * Changes are returned for the child process only, not persisted to the OS. */
export function resolveWindowsOpenSslEnvironment(
  env,
  {
    platform = process.platform,
    arch = process.arch,
    exists = existsSync,
  } = {},
) {
  if (platform !== "win32" || !env.OPENSSL_LIB_DIR) return {};
  const root = env.OPENSSL_LIB_DIR;
  const present = (directory, names) =>
    names.every((name) => exists(path.join(directory, name)));
  const configured = env.OPENSSL_LIBS?.split(":").filter(Boolean);
  if (
    present(
      root,
      (configured ?? ["libssl", "libcrypto"]).map((name) => `${name}.lib`),
    )
  )
    return {};
  const target = env.CARGO_BUILD_TARGET ?? env.TARGET ?? "";
  if (target && !/^(?:x86_64|aarch64|i686)-pc-windows-msvc$/u.test(target))
    return {};
  const machine =
    target.startsWith("aarch64-") || (!target && arch === "arm64")
      ? "ARM64"
      : target.startsWith("i686-") || (!target && arch === "ia32")
        ? "x86"
        : "x64";
  const rustFlags =
    env.CARGO_ENCODED_RUSTFLAGS !== undefined
      ? env.CARGO_ENCODED_RUSTFLAGS.replaceAll("\x1f", " ")
      : (env.RUSTFLAGS ?? "");
  const crt = /(?:^|\s|=|,)\+crt-static(?:\s|,|$)/u.test(rustFlags)
    ? "MT"
    : "MD";
  const candidates = [
    path.join(root, "VC", machine, crt),
    ...(machine === "ARM64" ? [path.join(root, "VC", "arm64", crt)] : []),
  ];
  for (const directory of candidates) {
    if (configured) {
      if (
        present(
          directory,
          configured.map((name) => `${name}.lib`),
        )
      )
        return { OPENSSL_LIB_DIR: directory };
      continue;
    }
    if (
      env.OPENSSL_STATIC !== "0" &&
      present(directory, ["libssl_static.lib", "libcrypto_static.lib"])
    )
      return {
        OPENSSL_LIB_DIR: directory,
        OPENSSL_STATIC: "1",
        OPENSSL_LIBS: "libssl_static:libcrypto_static",
      };
  }
  // Leave the invalid explicit input intact: openssl-sys gives its precise
  // diagnostic. Never select a foreign architecture or download a fallback.
  return {};
}
