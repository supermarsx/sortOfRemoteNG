// Mechanical export from isolated git-index baselines. No commits needed.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const lane = fileURLToPath(new URL(".", import.meta.url));
const scratch = resolve(process.argv[2] ?? "");
const artifacts = resolve(lane, "../../.artifacts");
if (!scratch.startsWith(artifacts + sep))
  throw new Error("Expected isolated .artifacts scratch");
const series = resolve(lane, "154.0.8037.58-682c378");
mkdirSync(series, { recursive: true });
const entries = [];
const bases = [];
for (const [local, engine] of [
  ["cef_sorng_tls_bridge.h", "cef/include/cef_sorng_tls_bridge.h"],
  ["sorng_tls_policy.h", "chromium/net/socket/sorng_tls_policy.h"],
]) {
  const canonical = readFileSync(resolve(lane, local), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  const patched = readFileSync(resolve(scratch, engine), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  if (canonical !== patched)
    throw new Error(`Canonical and engine header differ: ${local}`);
}
const widgetPath = "libcef/browser/native/native_widget_delegate.cc";
const downloadPath = "libcef/browser/download_manager_delegate_impl.cc";
const sodaPaths = [
  "components/soda/soda_features.h",
  "components/soda/soda_features.cc",
  "components/soda/soda_installer.cc",
  "components/soda/soda_util.cc",
  "chrome/browser/accessibility/soda_installer_impl.cc",
];
const probePaths = [
  "net/dns/host_resolver_manager.cc",
  "net/dns/host_resolver_manager_unittest.cc",
];
for (const [project, filename, pathspec] of [
  [
    "chromium",
    "0001-chromium-socket-admission.patch",
    [
      ".",
      ...sodaPaths.map((path) => `:(exclude)${path}`),
      ...probePaths.map((path) => `:(exclude)${path}`),
    ],
  ],
  [
    "cef",
    "0002-cef-native-bridge.patch",
    [".", `:(exclude)${widgetPath}`, `:(exclude)${downloadPath}`],
  ],
  ["cef", "0003-cef-native-widget-lifetime.patch", [widgetPath]],
  ["chromium", "0004-chromium-soda-provisioning.patch", sodaPaths],
  ["chromium", "0005-chromium-proxy-route-probe.patch", probePaths],
  ["cef", "0006-cef-explicit-download-destination.patch", [downloadPath]],
]) {
  const cwd = resolve(scratch, project);
  const patch = execFileSync(
    "git",
    [
      "-c",
      "core.autocrlf=false",
      "diff",
      "--no-ext-diff",
      "--no-color",
      "--full-index",
      "--binary",
      "--",
      ...pathspec,
    ],
    { cwd },
  );
  if (!patch.length) throw new Error(`No ${project} delta`);
  writeFileSync(resolve(series, filename), patch);
  entries.push(`${project} ${filename}`);
  // Only modified pre-existing files have a baseline blob; added CEF files
  // are already fully represented by the patch. Pin SHA-256 of upstream bytes.
  const paths = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=M", "--", ...pathspec],
    { cwd, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const path of paths) {
    const bytes = execFileSync("git", ["show", `:${path}`], { cwd });
    bases.push({
      project,
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}
writeFileSync(resolve(series, "series"), entries.join("\n") + "\n");
writeFileSync(
  resolve(series, "upstream-sha256.json"),
  JSON.stringify(bases, null, 2) + "\n",
);
console.log(relative(process.cwd(), series));
