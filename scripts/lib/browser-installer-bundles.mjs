// Tauri's Rust bundle_type() lives in the Windows client DLL, not the pinned
// CEF bootstrap. Prepare per-installer resources without modifying either the
// bootstrap or any raw/published client. This module never invokes a bundler.
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tauriDir = fileURLToPath(new URL("../../src-tauri/", import.meta.url));
const marker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK");
const installerMarkers = Object.freeze({ msi: "MSI", nsis: "NSS" });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function patchWindowsBundleType(input, installer) {
  if (!Object.hasOwn(installerMarkers, installer))
    throw new Error(`Unsupported Windows installer: ${installer}`);
  const suffix = installerMarkers[installer];
  const offset = input.indexOf(marker);
  if (offset < 0 || input.indexOf(marker, offset + 1) >= 0)
    throw new Error(
      "Windows client must contain exactly one unpatched Tauri UNK marker",
    );
  const bytes = Buffer.from(input);
  // Only the initializer changes. The MSI/NSS comparison literals must survive.
  bytes.write(suffix, offset + marker.length - 3, 3, "ascii");
  return {
    bytes,
    markerOffset: offset,
    markerBefore: marker.toString(),
    markerAfter: `__TAURI_BUNDLE_TYPE_VAR_${suffix}`,
    sourceSha256: digest(input),
    clientSha256: digest(bytes),
    byteLength: bytes.length,
  };
}

export function bundleCliSelection(tauriArgs = []) {
  let bundles;
  const flags = [];
  for (let index = 0; index < tauriArgs.length; index++) {
    const arg = tauriArgs[index];
    if (
      arg === "--bundles" ||
      arg === "-b" ||
      arg.startsWith("--bundles=") ||
      arg.startsWith("-b")
    ) {
      const attached = arg.startsWith("--bundles=")
        ? arg.slice(10)
        : arg.startsWith("-b") && arg !== "-b"
          ? arg.slice(2).replace(/^=/, "")
          : undefined;
      const values = attached === undefined ? [] : [attached];
      while (
        index + 1 < tauriArgs.length &&
        !tauriArgs[index + 1].startsWith("-")
      )
        values.push(tauriArgs[++index]);
      const selected = values
        .flatMap((value) => value.split(/[\s,]+/))
        .filter(Boolean);
      if (!selected.length)
        throw new Error("--bundles requires an installer choice");
      (bundles ??= []).push(...selected);
    } else if (
      ["--ci", "--verbose", "--skip-stapling", "--no-sign"].includes(arg) ||
      /^-v+$/.test(arg)
    )
      flags.push(arg);
  }
  return { bundles, flags };
}

export function bundleArguments({ plan, configFile, options, installer }) {
  const { bundles, flags } = bundleCliSelection(options.tauriArgs);
  const selected = installer ? [installer] : bundles;
  return [
    "bundle",
    "--config",
    configFile,
    "--target",
    plan.target,
    ...(options.features?.length
      ? ["--features", options.features.join(",")]
      : []),
    ...(options.debug ? ["--debug"] : []),
    ...flags,
    ...(selected ? ["--bundles", ...selected] : []),
  ];
}

export function windowsInstallerChoices(options, bundleConfig) {
  if (options.noBundle) return [];
  const { bundles } = bundleCliSelection(options.tauriArgs);
  const configured = bundleConfig.bundle?.targets ?? "all";
  const selected =
    bundles ?? (configured === "all" ? ["msi", "nsis"] : configured);
  const choices = Array.isArray(selected) ? selected : [selected];
  for (const choice of choices)
    if (!Object.hasOwn(installerMarkers, choice))
      throw new Error(`Unsupported Windows installer: ${choice}`);
  return [...new Set(choices)];
}

export async function prepareWindowsInstallerBundles({
  plan,
  bundleConfig,
  options = {},
  outputDirectory,
  resourceBaseDir = tauriDir,
}) {
  const installers = windowsInstallerChoices(options, bundleConfig);
  if (!installers.length) return { skipped: true, installers: [] };
  if (!/^(x86_64|aarch64)-pc-windows-msvc$/.test(plan.target))
    throw new Error(
      "Installer DLL preparation requires a supported Windows target",
    );
  if (!/^[A-Za-z0-9_.-]+$/.test(plan.appName))
    throw new Error("Invalid Windows app name");
  const resources = bundleConfig.bundle?.resources;
  if (!resources || Array.isArray(resources) || typeof resources !== "object")
    throw new Error("Installer DLL preparation requires a resource map");
  const clientName = `${plan.appName}.dll`;
  const matches = Object.entries(resources).filter(
    ([, destination]) =>
      typeof destination === "string" &&
      path.win32.normalize(destination).toLowerCase() ===
        clientName.toLowerCase(),
  );
  if (matches.length !== 1)
    throw new Error("Expected exactly one client DLL resource mapping");
  const [resourceKey] = matches[0];
  const sourceClient = path.resolve(resourceBaseDir, resourceKey);
  const bootstrap = path.join(plan.payload, `${plan.appName}.exe`);
  for (const file of [sourceClient, bootstrap])
    if (!(await lstat(file)).isFile())
      throw new Error(`Expected an ordinary staged file: ${file}`);
  const input = await readFile(sourceClient);
  // Validate before creating output; patch each installer from this same input.
  const first = patchWindowsBundleType(input, installers[0]);
  const bootstrapSha256 = digest(await readFile(bootstrap));
  const root = outputDirectory
    ? path.resolve(outputDirectory)
    : await mkdtemp(path.join(plan.root, "installer-clients-"));
  if (outputDirectory) await mkdir(root); // Never reuse or replace an existing run.
  const report = {
    schema: "sorng-cef-installer-clients/v1",
    target: plan.target,
    stage: "before-signing",
    sourceClient: {
      path: sourceClient,
      sha256: first.sourceSha256,
      byteLength: input.length,
    },
    bootstrap: { path: bootstrap, sha256: bootstrapSha256, modified: false },
    installers: [],
    bundleExecution: "not-run",
    runtimeBundleType: "not-executed",
  };
  for (const installer of installers) {
    const { bytes, ...patch } =
      installer === installers[0]
        ? first
        : patchWindowsBundleType(input, installer);
    const directory = path.join(root, installer);
    await mkdir(directory);
    const clientFile = path.join(directory, clientName);
    await writeFile(clientFile, bytes, { flag: "wx" });
    if (digest(await readFile(clientFile)) !== patch.clientSha256)
      throw new Error("Installer client readback digest mismatch");
    const config = structuredClone(bundleConfig);
    delete config.bundle.resources[resourceKey];
    config.bundle.resources[clientFile] = clientName;
    config.bundle.targets = [installer];
    const configFile = path.join(directory, "bundle-config.json");
    await writeFile(configFile, JSON.stringify(config, null, 2) + "\n", {
      flag: "wx",
    });
    report.installers.push({
      installer,
      clientFile,
      configFile,
      ...patch,
      args: bundleArguments({ plan, configFile, options, installer }),
    });
  }
  if (
    digest(await readFile(sourceClient)) !== report.sourceClient.sha256 ||
    digest(await readFile(bootstrap)) !== bootstrapSha256
  )
    throw new Error(
      "Staged client/bootstrap changed during installer preparation",
    );
  const reportPath = path.join(root, "installer-clients.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  return { ...report, reportPath };
}
