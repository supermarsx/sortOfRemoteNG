import { existsSync } from "node:fs";
import { resolveWindowsOpenSslEnvironment } from "./windows-openssl-env.mjs";
import { rustTargetFromArgs } from "../stage-windows-native-runtime.mjs";

export function nativeWindowsPathPrefix({
  platform = process.platform,
  exists = existsSync,
} = {}) {
  return platform === "win32"
    ? ["C:\\Strawberry\\perl\\bin", "C:\\Strawberry\\c\\bin"].filter(exists)
    : [];
}

/** Shared by direct native commands and managed dev. Never mutates the parent. */
export function buildNativeChildEnvironment({
  baseEnv = process.env,
  argv = [],
  platform = process.platform,
  arch = process.arch,
  exists = existsSync,
} = {}) {
  const env = { ...baseEnv };
  Object.assign(
    env,
    resolveWindowsOpenSslEnvironment(
      {
        ...env,
        CARGO_BUILD_TARGET: rustTargetFromArgs(argv, env),
      },
      { platform, arch, exists },
    ),
  );
  const prefix = nativeWindowsPathPrefix({ platform, exists });
  if (prefix.length) {
    env.PATH = `${prefix.join(";")};${env.Path ?? env.PATH ?? ""}`;
    env.Path = env.PATH;
  }
  return env;
}
