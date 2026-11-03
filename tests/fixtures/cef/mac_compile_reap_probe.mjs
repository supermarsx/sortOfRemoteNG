// Native diagnostic only. No checkpoint, SDK or production capability is emitted.
import assert from "node:assert/strict";
import { mkdir, writeFile, lstat, realpath, readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import {
  compileSlice,
  createMacCensusIntegrationProofFactory,
  macCensusIntegrationStatus,
  compileMonitorDetails,
} from "../../../scripts/lib/cef-engineering-checkpoint.mjs";

const PYTHON =
  "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
const source =
  "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef";
const target = "x86_64-apple-darwin";
assert(process.platform === "darwin" && process.arch === "x64");
assert(
  process.env.ImageOS === "macos15" &&
    process.env.ImageVersion === "20260824.0482.1",
);
assert(process.env.RUNNER_ENVIRONMENT === "github-hosted");
assert(
  process.env.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&
    process.env.GITHUB_REPOSITORY_VISIBILITY === "public",
);
const originalStart = Number(process.env.CEF_MAC_REAP_PROBE_STARTED_MS);
assert(
  Number.isSafeInteger(originalStart) &&
    originalStart <= Date.now() &&
    Date.now() - originalStart < 360000,
);
const end =
  performance.now() + Math.min(240000, 360000 - (Date.now() - originalStart));
assert(end - performance.now() > 120000);
const temp = process.env.RUNNER_TEMP;
assert(path.isAbsolute(temp) && (await realpath(temp)) === temp);
assert(
  createHash("sha256")
    .update(await readFile(PYTHON))
    .digest("hex") ===
    "b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d",
);
const report = {
  schemaVersion: 1,
  kind: "mac-compile-reap-diagnostic",
  runtimeReady: false,
  nativeAcceptance: false,
  productionAdmitted: false,
  cases: [],
};
const actor = `import os,sys,time
mode=sys.argv[1]
def leaf():
    time.sleep(45)
    os._exit(0)
if mode=='flat':
    for i in range(7):
        if os.fork()==0:leaf()
elif mode=='churn':
    for i in range(3):
        if os.fork()==0:
            for j in range(1000):
                pid=os.fork()
                if pid==0:os._exit(0)
                os.waitpid(pid,0)
                time.sleep(.005)
            leaf()
elif mode in ('nested','detached'):
    for i in range(2):
        if os.fork()==0:
            if mode=='detached':os.setsid()
            for j in range(2):
                if os.fork()==0:leaf()
            leaf()
else:raise RuntimeError('fixed mode')
leaf()
`;
let failed = false;
for (const mode of ["churn"]) {
  assert(performance.now() + 45000 < end);
  const root = path.join(temp, "cef-mac-census-integration-" + randomUUID());
  await mkdir(root, { mode: 0o700 });
  assert((await realpath(root)) === root);
  const identity = await lstat(root, { bigint: true });
  assert(
    identity.isDirectory() &&
      (identity.mode & 0o777n) === 0o700n &&
      identity.uid === BigInt(process.getuid()),
  );
  const logs = path.join(root, "logs");
  await mkdir(logs, { mode: 0o700 });
  const actorPath = path.join(root, "actor.py");
  await writeFile(actorPath, actor, { flag: "wx", mode: 0o600 });
  const factory = await createMacCensusIntegrationProofFactory({
    target,
    source,
    canonicalRoot: `/Users/runner/work/_temp/sorng-cef-engineering/${target}/${source}`,
    scratch: root,
    python: PYTHON,
    deadline: Math.min(end, performance.now() + 40000),
  });
  const env = {
    PATH: "/usr/bin:/bin",
    RUNNER_TEMP: temp,
    ImageOS: "macos15",
    ImageVersion: "20260824.0482.1",
    RUNNER_ENVIRONMENT: "github-hosted",
    LC_ALL: "C",
    TZ: "UTC",
  };
  if (process.env.RUNNER_TRACKING_ID)
    env.RUNNER_TRACKING_ID = process.env.RUNNER_TRACKING_ID;
  const begin = performance.now();
  let result,
    errorCode = null,
    detail = null,
    diagnostic = null;
  const oldError = console.error;
  console.error = (value, ...args) => {
    if (
      typeof value === "string" &&
      value.startsWith("[cef-engineering-checkpoint] compile-supervision=")
    )
      diagnostic = JSON.parse(value.split("compile-supervision=")[1]);
    oldError(value, ...args);
  };
  try {
    result = await compileSlice(PYTHON, ["-I", "-B", "-S", actorPath, mode], {
      cwd: root,
      env,
      logs,
      milliseconds: 4000,
      censusFactory: factory,
      outputLedger: { bytes: 0, cap: 64 * 1024 ** 2 },
    });
    assert(result.outcome === "slice-ended" && result.quiescent === true);
  } catch (error) {
    failed = true;
    const known = new Set([
      "Observed descendants not reaped; checkpoint denied",
      "CENSUS_DEADLINE",
      "CENSUS_EOF",
      "CENSUS_REQUEST_BOUND",
      "CENSUS_JOIN",
      "CENSUS_FAILED",
      "CENSUS_REQUEST",
      "CENSUS_CAPABILITY",
      "CENSUS_ROOT",
      "CENSUS_OUTPUT_BOUND",
      "CENSUS_READY_DEADLINE",
      "Owned freeze deadline",
      "Observed lineage did not stabilize",
      "Ambiguous owned process",
      "Owned PID replaced before reap",
      "Owned reap deadline",
      "Compile cleanup unconfirmed; checkpoint denied",
    ]);
    errorCode = known.has(error?.message) ? error.message : "UNCLASSIFIED";
    detail = compileMonitorDetails(error);
  } finally {
    console.error = oldError;
  }
  report.cases.push({
    mode,
    elapsedMs: Math.floor(performance.now() - begin),
    outcome: result?.outcome ?? "denied",
    errorCode,
    detail,
    diagnostic,
    status: macCensusIntegrationStatus(factory),
  });
  // Keep owned scratch for ephemeral VM teardown; uncertain cleanup never authorizes deletion or another run.
  if (failed) break;
}
assert(performance.now() < end);
report.complete = true;
const raw = JSON.stringify(report) + "\n";
assert(Buffer.byteLength(raw) <= 32768);
await writeFile(path.join(temp, "cef-mac-reap-probe-report.json"), raw, {
  flag: "wx",
  mode: 0o600,
});
console.log(
  JSON.stringify({
    kind: report.kind,
    complete: true,
    cases: report.cases.length,
    allQuiescent: !failed,
  }),
);
