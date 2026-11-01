// Read-only candidate closure. Results never admit production inputs.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { archiveCommand } from "../../../scripts/lib/cef-engineering-checkpoint.mjs";
import {
  macPythonPackageProofPlan,
  readMacPythonPackageProof,
  macPythonPackageProofEvidence,
  MAC_PYTHON_PACKAGE_PROOF_ROOT,
} from "../../../scripts/lib/cef-mac-source-metadata.mjs";

const PYTHON =
  MAC_PYTHON_PACKAGE_PROOF_ROOT +
  "/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
const helper = fileURLToPath(
  new URL("../../../scripts/lib/cef-checkpoint-archive.py", import.meta.url),
);
const stamp = (info) =>
  [
    info.dev,
    info.ino,
    info.mode,
    info.nlink,
    info.size,
    info.mtimeNs,
    info.ctimeNs,
    info.uid,
    info.gid,
  ]
    .map(String)
    .join(":");
export function authority(env, platform, architecture) {
  assert(
    platform === "darwin" &&
      architecture === "x64" &&
      env.ImageOS === "macos15" &&
      env.ImageVersion === "20260824.0482.1",
    "PACKAGE_HOST",
  );
  assert(
    env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.CEF_DEFAULT_BRANCH === "main" &&
      env.GITHUB_REF === "refs/heads/main",
    "PACKAGE_EVENT",
  );
  assert(
    env.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&
      env.GITHUB_REPOSITORY_ID === "1010282954" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public",
    "PACKAGE_REPOSITORY",
  );
  assert(
    /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      env.GITHUB_WORKFLOW_REF ===
        "supermarsx/sortOfRemoteNG/.github/workflows/cef-mac-owned-source-proof.yml@refs/heads/main",
    "PACKAGE_SOURCE",
  );
}
export function budget(started, now) {
  assert(
    Number.isSafeInteger(started) &&
      Number.isSafeInteger(now) &&
      started > 0 &&
      now >= started,
    "PACKAGE_JOB_CLOCK",
  );
  // Keep the existing five-minute job bound, including setup/tiny proof, and
  // thirty seconds for reporting/upload. One child budget covers BOTH passes.
  const total = Math.min(120000, started + 300000 - now - 30000);
  const seconds = Math.min(100, Math.floor((total - 10000) / 1000));
  assert(seconds >= 1, "PACKAGE_JOB_DEADLINE");
  return { total, seconds };
}
async function verifyPython() {
  const before = await fs.lstat(PYTHON, { bigint: true });
  assert(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.size === 13592n &&
      (await fs.realpath(PYTHON)) === PYTHON,
    "PACKAGE_PYTHON_PIN",
  );
  const fd = await fs.open(PYTHON, constants.O_RDONLY | constants.O_NOFOLLOW);
  let primary;
  try {
    assert(
      stamp(await fd.stat({ bigint: true })) === stamp(before),
      "PACKAGE_PYTHON_PIN",
    );
    const raw = Buffer.alloc(13593);
    let count = 0;
    while (count < raw.length) {
      const { bytesRead } = await fd.read(
        raw,
        count,
        raw.length - count,
        count,
      );
      if (!bytesRead) break;
      count += bytesRead;
    }
    assert(
      count === 13592 &&
        createHash("sha256").update(raw.subarray(0, count)).digest("hex") ===
          "b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d",
      "PACKAGE_PYTHON_PIN",
    );
    assert(
      stamp(await fd.stat({ bigint: true })) === stamp(before) &&
        stamp(await fs.lstat(PYTHON, { bigint: true })) === stamp(before),
      "PACKAGE_PYTHON_CHANGED",
    );
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      await fd.close();
    } catch (error) {
      if (!primary) throw error;
    }
  }
}
export async function main() {
  authority(process.env, process.platform, process.arch);
  assert(process.argv.length === 2, "PACKAGE_ARGUMENTS");
  const selectedBudget = budget(
    Number(process.env.CEF_MAC_PACKAGE_JOB_STARTED_MS),
    Date.now(),
  );
  const end = performance.now() + selectedBudget.total;
  const check = () => assert(performance.now() < end, "PACKAGE_DEADLINE");
  const temp = await fs.realpath(process.env.RUNNER_TEMP);
  assert(temp === "/Users/runner/work/_temp", "PACKAGE_TEMP");
  await verifyPython();
  check();
  const output = path.posix.join(temp, "cef-mac-inputs-" + randomUUID());
  await fs.mkdir(output, { mode: 0o700 });
  const directory = await fs.lstat(output, { bigint: true });
  const rootKey = (info) =>
    [info.dev, info.ino, info.mode, info.uid, info.gid].map(String).join(":");
  const checkRoot = async () => {
    check();
    assert(
      (await fs.realpath(output)) === output &&
        directory.isDirectory() &&
        !directory.isSymbolicLink() &&
        directory.uid === BigInt(process.getuid()) &&
        (directory.mode & 0o777n) === 0o700n &&
        rootKey(await fs.lstat(output, { bigint: true })) ===
          rootKey(directory),
      "PACKAGE_OUTPUT",
    );
  };
  await checkRoot();
  await fs.appendFile(process.env.GITHUB_OUTPUT, `root=${output}\n`);
  const plan = macPythonPackageProofPlan({ runnerTemp: temp, output });
  const contextFile = output + "/context.json";
  await fs.writeFile(contextFile, JSON.stringify(plan.context), {
    flag: "wx",
    mode: 0o600,
  });
  const proof = {
    schemaVersion: 1,
    kind: "sorng-mac-python-package-proof",
    source: process.env.GITHUB_SHA,
    image: process.env.ImageVersion,
    root: MAC_PYTHON_PACKAGE_PROOF_ROOT,
    complete: false,
    productionUseAdmitted: false,
    productionInputWrites: false,
    sourceWriteAdmitted: false,
    nativeAcceptance: false,
    runtimeReady: false,
  };
  let failure;
  try {
    await checkRoot();
    // Recompute only the original remainder, never a new lease per pass.
    const seconds = Math.min(
      selectedBudget.seconds,
      Math.floor((end - performance.now() - 10000) / 1000),
    );
    assert(seconds > 0, "PACKAGE_DEADLINE");
    const result = await archiveCommand(
      PYTHON,
      helper,
      plan.argv(contextFile, seconds).slice(4),
      {
        timeout: Math.floor(
          Math.min(seconds * 1000 + 10000, end - performance.now()),
        ),
        observeFailure: (record) => {
          proof.failure = record;
          console.error(
            JSON.stringify({
              kind: "sorng-mac-python-package-failure",
              ...record,
            }),
          );
        },
      },
    );
    const token = await readMacPythonPackageProof(plan, result, check);
    const evidence = macPythonPackageProofEvidence(token);
    Object.assign(proof, {
      complete: true,
      fullNamespaceVerified: true,
      rawLinkClosureVerified: true,
      fullReadbackUnchanged: true,
      entries: token.entries,
      bytes: token.bytes,
      snapshot: evidence.snapshot,
      physicalRoots: evidence.physicalRoots,
    });
  } catch (error) {
    failure = error;
  }
  await checkRoot();
  await fs.writeFile(
    output + "/proof.json",
    JSON.stringify(proof, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify(proof));
  if (failure) throw failure;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch {
    console.error("MAC_PYTHON_PACKAGE_PROOF_FAILED");
    process.exitCode = 1;
  }
}
