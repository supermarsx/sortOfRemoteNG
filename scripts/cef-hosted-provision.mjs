#!/usr/bin/env node
// Explicit ephemeral hosted provisioning. No CEF build, publication, or local install.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  appendFile,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  RECIPE,
  nativeWindowsShell,
  observe,
  probeFailure,
  selectTarget,
} from "./cef-hosted-bootstrap.mjs";

const exec = promisify(execFile);
const fail = (message) => {
  throw new Error(message);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function provisionPlan(
  target,
  platform = process.platform,
  architecture = process.arch,
) {
  const selected = selectTarget(target, platform, architecture);
  return {
    target,
    runner: selected.runner,
    platform,
    architecture,
    execute: false,
    publicationAllowed: false,
    installer:
      platform === "win32"
        ? RECIPE.provisioning.windowsSdk
        : platform === "linux"
          ? RECIPE.provisioning.linuxDependencies
          : null,
    arguments:
      platform === "win32"
        ? [
            "/quiet",
            "/norestart",
            "/ceip",
            "off",
            "/features",
            ...RECIPE.provisioning.windowsSdk.features,
          ]
        : platform === "linux"
          ? RECIPE.provisioning.linuxDependencies.arguments
          : [],
    note: "Hosted-only prerequisite preparation; actual post-install inventory requires review before an engine build.",
  };
}
export function assertProvisionHost(env = process.env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.GITHUB_REPOSITORY_VISIBILITY !== "public" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch"
  )
    fail("Provisioning requires an explicit public GitHub-hosted dispatch");
}
export function verifyInstallerSignature(
  signature,
  pin = RECIPE.provisioning.windowsSdk,
) {
  if (
    signature?.status !== "Valid" ||
    signature?.thumbprint !== pin.signerThumbprint ||
    signature?.subject !==
      "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US" ||
    signature?.productVersion !== pin.productVersion
  )
    fail("Pinned Microsoft SDK signature or product identity mismatch");
}
export async function acquirePinned(pin, fetcher = fetch) {
  const response = await fetcher(pin.url, {
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) fail("Pinned prerequisite download failed");
  const limit =
    pin.encoding === "base64" ? Math.ceil(pin.size / 3) * 4 + 4096 : pin.size;
  const chunks = [];
  let count = 0;
  for await (const chunk of response.body) {
    count += chunk.length;
    if (count > limit)
      fail("Pinned prerequisite download exceeds its reviewed size");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  const bytes =
    pin.encoding === "base64"
      ? Buffer.from(raw.toString("ascii").trim(), "base64")
      : raw;
  if (bytes.length !== pin.size || hash(bytes) !== pin.sha256)
    fail("Pinned prerequisite byte identity mismatch");
  return bytes;
}
export function childEnvironment(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !/^(GH_|GITHUB_|ACTIONS_|INPUT_)/i.test(key),
    ),
  );
}
const SIGNATURE_SCRIPT = String.raw`param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference='Stop'
$s=Get-AuthenticodeSignature -LiteralPath $Installer
@{status=$s.Status.ToString();thumbprint=$s.SignerCertificate.Thumbprint;subject=$s.SignerCertificate.Subject;productVersion=(Get-Item -LiteralPath $Installer).VersionInfo.ProductVersion}|ConvertTo-Json -Compress
`;

export async function provision(
  { target, output, execute = false, cleanup = false },
  env = process.env,
  dependencies = {},
) {
  const platform = dependencies.platform ?? process.platform;
  const architecture = dependencies.architecture ?? process.arch;
  const installerExec = dependencies.exec ?? exec;
  const observer = dependencies.observe ?? observe;
  const acquire = dependencies.acquire ?? acquirePinned;
  const nativeShell = dependencies.nativeShell ?? nativeWindowsShell;
  const plan = provisionPlan(target, platform, architecture);
  if (!execute) return plan;
  assertProvisionHost(env);
  if (!output || !env.RUNNER_TEMP)
    fail("An explicit runner-local output is required");
  const root = await realpath(env.RUNNER_TEMP),
    destination = path.resolve(output);
  const relative = path.relative(root, destination);
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  )
    fail("Provision output must be beneath the ephemeral workspace");
  await mkdir(destination, { recursive: true });
  const canonical = path.relative(root, await realpath(destination));
  if (
    path.isAbsolute(canonical) ||
    canonical === ".." ||
    canonical.startsWith(`..${path.sep}`)
  )
    fail("Provision output resolves outside the ephemeral workspace");
  const receipt = {
    schemaVersion: 1,
    kind: "sorng-cef-hosted-provision",
    target,
    completed: false,
    publicationAllowed: false,
    engineBuildAttempted: false,
    stages: [],
  };
  const save = () =>
    writeFile(
      path.join(destination, "provision.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
  await save();
  const run = async (executable, args, timeout, stage) => {
    receipt.stages.push({ stage, state: "running" });
    await save();
    try {
      const result = await installerExec(executable, args, {
        env: childEnvironment(env),
        windowsHide: true,
        timeout,
        maxBuffer: 16 * 1024 ** 2,
      });
      await writeFile(
        path.join(destination, `${stage}.log`),
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      );
      receipt.stages.at(-1).state = "completed";
      await save();
      return result;
    } catch (error) {
      await writeFile(
        path.join(destination, `${stage}.log`),
        `${error.stdout ?? ""}\n${error.stderr ?? ""}`,
      );
      receipt.stages.at(-1).state = "failed";
      receipt.failure = probeFailure(error, stage);
      if (stage === "install-sdk" && error.code === 3010)
        receipt.rebootRequired = true;
      await save();
      throw new Error(`Hosted prerequisite stage failed: ${stage}`);
    }
  };
  try {
    // The observer alone owns the canonical fixed Linux cleanup allowlist.
    const before = await observer(
      { target, output: path.join(destination, "before"), cleanup },
      env,
    );
    if (platform === "linux" && before.availableGiB < RECIPE.minimumFreeDiskGiB)
      fail(
        "Hosted Linux engine workspace remains below the reviewed disk minimum",
      );
    if (plan.installer) {
      const bytes = await acquire(plan.installer);
      const file = path.join(
        destination,
        platform === "win32" ? "winsdksetup.exe" : "install-build-deps.py",
      );
      await writeFile(file, bytes, { flag: "wx" });
      receipt.download = { size: bytes.length, sha256: hash(bytes) };
      await save();
      if (platform === "win32") {
        const shell = await nativeShell(env);
        const verifier = path.join(destination, "verify-signature.ps1");
        await writeFile(verifier, SIGNATURE_SCRIPT, { flag: "wx" });
        const verified = await run(
          shell,
          [
            "-NoProfile",
            "-NonInteractive",
            "-File",
            verifier,
            "-Installer",
            file,
          ],
          90_000,
          "verify-sdk-signature",
        );
        const signature = JSON.parse(verified.stdout.trim());
        verifyInstallerSignature(signature);
        receipt.signature = signature;
        await save();
        await run(
          file,
          [
            ...plan.arguments,
            "/log",
            path.join(destination, "sdk-install.log"),
          ],
          20 * 60_000,
          "install-sdk",
        );
      } else {
        await run(
          "python3",
          ["-I", file, ...plan.arguments],
          20 * 60_000,
          "install-linux-dependencies",
        );
        await run(
          "dpkg-query",
          ["-W", "-f=${binary:Package}\t${Version}\t${Architecture}\n"],
          30_000,
          "installed-packages",
        );
      }
    }
    const after = await observer(
      { target, output: path.join(destination, "after") },
      env,
    );
    receipt.blockers = after.blockers;
    receipt.completed = true;
    receipt.reviewStatus = "unreviewed-post-provision-observations";
    await save();
    if (env.GITHUB_OUTPUT)
      await appendFile(env.GITHUB_OUTPUT, `observations=${destination}\n`);
    return receipt;
  } catch (error) {
    if (!receipt.failure)
      receipt.failure = {
        stage: "provision",
        kind: "failed",
        exitCode: null,
        signal: null,
      };
    await save();
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (
      !args[i].startsWith("--") ||
      !["target", "output", "execute", "cleanup"].includes(key) ||
      key in options
    )
      fail("Unknown or duplicate provision option");
    if (["execute", "cleanup"].includes(key)) options[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) fail("Missing provision argument");
      options[key] = value;
    }
  }
  return provision(options);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
    .then((receipt) => console.log(JSON.stringify(receipt, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
