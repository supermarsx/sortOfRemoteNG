// Keep an intentional reduced Cargo build available while routing every normal
// build through the CEF bootstrap/package driver. This is build selection only,
// never a runtime admission or security-policy override.
const nativeFeatureSets = new Set([
  "native-browser",
  "full",
  "full-dev",
  "full-windows-dynamic",
  "full-unix-dynamic",
  "full-linux-system",
]);

export function requiresBrowserBuildDriver(args) {
  // Tauri's first separator forwards Cargo options. The second starts app
  // arguments, which cannot change build features or turn a build into help.
  let separators = 0;
  const buildArgs = [];
  for (const argument of args) {
    if (argument === "--" && ++separators === 2) break;
    buildArgs.push(argument);
  }
  if (buildArgs.includes("--help") || buildArgs.includes("-h")) return false;
  if (!buildArgs.includes("--no-default-features")) return true;
  const features = [];
  for (let index = 0; index < buildArgs.length; index++) {
    const argument = buildArgs[index];
    if (["--features", "-f", "-F"].includes(argument))
      features.push(...(buildArgs[++index] ?? "").split(/[,\s]+/u));
    else if (argument.startsWith("--features="))
      features.push(...argument.slice("--features=".length).split(/[,\s]+/u));
    else if (argument === "--all-features") return true;
  }
  return features.some((feature) => nativeFeatureSets.has(feature));
}
