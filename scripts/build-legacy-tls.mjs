// Builds the pipe-only compatibility engine. The old library is statically
// linked only into this executable, never into the application.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const build = resolve(root, "native/legacy-tls/build");
const source = join(build, "openssl-1.0.2u");
const archive = join(build, "openssl-1.0.2u.tar.gz");
const digest =
  "ecd0c6ffb493dd06707d38b14bb4d8c2288bb7033735606569d8f90f89669d16";
const windows = process.platform === "win32";
const output = resolve(root, "native/legacy-tls/bundle");
if (windows && existsSync("C:/msys64/mingw64/bin/gcc.exe")) {
  process.env.Path = `C:/msys64/mingw64/bin;C:/msys64/usr/bin;${process.env.Path ?? process.env.PATH ?? ""}`;
  process.env.PERL ??= "C:/msys64/usr/bin/perl.exe";
}

mkdirSync(build, { recursive: true });
mkdirSync(output, { recursive: true });
if (!existsSync(archive)) {
  const response = await fetch(
    "https://www.openssl.org/source/old/1.0.2/openssl-1.0.2u.tar.gz",
  );
  if (!response.ok)
    throw new Error(`OpenSSL source download: HTTP ${response.status}`);
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
}
if (
  createHash("sha256").update(readFileSync(archive)).digest("hex") !== digest
) {
  throw new Error("OpenSSL archive SHA-256 mismatch");
}
function run(command, args, cwd = source) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited ${result.status}`);
}
if (!existsSync(source))
  run(
    windows ? "C:/Windows/System32/tar.exe" : "tar",
    ["-xzf", archive, "-C", build],
    root,
  );
const target =
  process.env.LEGACY_OPENSSL_TARGET ??
  (windows
    ? "mingw64"
    : process.platform === "darwin"
      ? process.arch === "arm64"
        ? "darwin64-arm64-cc"
        : "darwin64-x86_64-cc"
      : process.arch === "arm64"
        ? "linux-aarch64"
        : "linux-x86_64");
const cc = process.env.CC ?? "gcc";
const make = process.env.MAKE ?? (windows ? "mingw32-make" : "make");
// Derive a portable Apple arm64 target from the upstream Darwin target.
// Assembly is disabled for this compatibility helper on every platform.
if (target === "darwin64-arm64-cc") {
  const configPath = join(source, "Configure");
  let config = readFileSync(configPath, "utf8");
  if (!config.includes('"darwin64-arm64-cc",')) {
    const line = config
      .split("\n")
      .find((line) => line.startsWith('"darwin64-x86_64-cc",'));
    if (!line) throw new Error("Missing upstream Darwin configuration");
    config = config.replace(
      line,
      line +
        "\n" +
        line
          .replace('"darwin64-x86_64-cc"', '"darwin64-arm64-cc"')
          .replaceAll("-arch x86_64", "-arch arm64"),
    );
    writeFileSync(configPath, config);
  }
}
const configureTarget = target;
const configurationKey = JSON.stringify({
  target,
  cc,
  make,
  digest,
  revision: 1,
});
const stamp = join(build, "configuration.json");
const reconfigure =
  !existsSync(stamp) ||
  readFileSync(stamp, "utf8") !== configurationKey ||
  process.argv.includes("--reconfigure");
if (reconfigure) {
  run(process.env.PERL ?? "perl", [
    "Configure",
    configureTarget,
    "no-shared",
    "no-asm",
    "no-tests",
    "enable-ssl2",
    "enable-ssl3",
    "enable-ssl3-method",
    "enable-weak-ssl-ciphers",
    "no-comp",
    "no-engine",
    `--openssldir=${join(build, "unused-config")}`,
  ]);
  run(make, ["depend"]);
  writeFileSync(stamp, configurationKey);
}
if (
  reconfigure ||
  !existsSync(join(source, "libssl.a")) ||
  !existsSync(join(source, "libcrypto.a"))
) {
  run(make, ["-j", process.env.LEGACY_TLS_JOBS ?? "4", "build_libs"]);
}

const binary = join(
  output,
  windows ? "sorng-legacy-tls.exe" : "sorng-legacy-tls",
);
const args = [
  "-O2",
  "-Wall",
  "-Wextra",
  "-I",
  join(source, "include"),
  resolve(root, "native/legacy-tls/helper.c"),
  join(source, "libssl.a"),
  join(source, "libcrypto.a"),
  "-o",
  binary,
];
if (windows) args.push("-static", "-lws2_32", "-lgdi32", "-lcrypt32");
else if (process.platform !== "darwin") args.push("-ldl", "-pthread");
run(cc, args, root);
if (process.argv.includes("--test-fixture")) {
  const fixtureArgs = [...args];
  fixtureArgs[fixtureArgs.indexOf("-o") + 1] = join(
    build,
    windows ? "tls-fixture.exe" : "tls-fixture",
  );
  run(cc, ["-DSORNG_TLS_TEST_SERVER", ...fixtureArgs], root);
}
copyFileSync(join(source, "LICENSE"), join(output, "OPENSSL-LICENSE.txt"));
writeFileSync(
  join(output, "build-receipt.json"),
  JSON.stringify(
    {
      openssl: "1.0.2u",
      sha256: digest,
      platform: process.platform,
      arch: process.arch,
      target: configureTarget,
      helperSha256: createHash("sha256")
        .update(readFileSync(binary))
        .digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Built ${binary}`);
