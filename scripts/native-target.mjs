function argumentValue(argv, key) {
  const inline = argv.find((arg) => arg.startsWith(`${key}=`));
  if (inline) {
    const value = inline.slice(key.length + 1);
    if (!value) throw new Error(`${key} requires a value`);
    return value;
  }
  const index = argv.indexOf(key);
  if (index >= 0 && (!argv[index + 1] || argv[index + 1].startsWith("--")))
    throw new Error(`${key} requires a value`);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function nativeTarget(
  argv = [],
  env = process.env,
  platform = process.platform,
  arch = process.arch,
) {
  const triple =
    argumentValue(argv, "--target") ||
    env.CARGO_BUILD_TARGET ||
    env.TAURI_ENV_TARGET_TRIPLE ||
    env.TARGET;
  const osKey = triple
    ? /windows/.test(triple)
      ? "windows"
      : /darwin|apple/.test(triple)
        ? "macos"
        : /linux/.test(triple)
          ? "linux"
          : null
    : { win32: "windows", darwin: "macos", linux: "linux" }[platform];
  const archKey = triple
    ? /^(aarch64|arm64)-/.test(triple)
      ? "arm64"
      : /^(x86_64|amd64)-/.test(triple)
        ? "amd64"
        : null
    : { arm64: "arm64", x64: "amd64" }[arch];
  if (!osKey || !archKey)
    throw new Error(
      `Unsupported native target: ${triple || `${platform}-${arch}`}`,
    );
  return { osKey, archKey, triple };
}
