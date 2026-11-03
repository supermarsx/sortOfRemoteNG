// Native diagnostic only. No checkpoint, SDK or production capability is emitted.
import assert from "node:assert/strict";
import { mkdir, writeFile, lstat, realpath, readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { executeJoined } from "./mac_process_census_proof.mjs";
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
const CLANG =
  "/Applications/Xcode_26.3.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang";
const SISO_SHA =
  "470367b491702bb805e33cec867febafce8feb2018e34c14631372682952015b";
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
for (const mode of ["siso"]) {
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
  let executable = PYTHON,
    args = ["-I", "-B", "-S", actorPath, mode];
  if (mode === "siso") {
    const response = await fetch(
      "https://chrome-infra-packages.appspot.com/dl/build/siso/mac-amd64/+/git_revision:efbbe7f1892211b5e9512576843a3c247b6a6d7c",
      {
        signal: AbortSignal.timeout(
          Math.min(60000, Math.floor(end - performance.now() - 45000)),
        ),
      },
    );
    assert(response.ok && response.body);
    const parts = [];
    let total = 0;
    for await (const part of response.body) {
      total += part.length;
      assert(total <= 31384975 && performance.now() + 45000 < end);
      parts.push(part);
    }
    const zip = Buffer.concat(parts);
    assert(
      total === 31384975 &&
        createHash("sha256").update(zip).digest("hex") ===
          "dba869cafc15546c7826706e30073ce39f6423d692a1b268354f16f1d6bada7b",
    );
    const archive = path.join(root, "siso.zip"),
      binary = path.join(root, "siso");
    await writeFile(archive, zip, { flag: "wx", mode: 0o600 });
    const extract = `import hashlib,os,sys,zipfile
from pathlib import Path
archive,out=map(Path,sys.argv[1:])
assert archive.parent==out.parent and out.name=='siso'
with zipfile.ZipFile(archive) as z:
    rows=z.infolist()
    assert len(rows)==2 and {r.filename for r in rows}=={'siso','.cipdpkg/manifest.json'}
    assert not any(r.is_dir() for r in rows)
    assert z.getinfo('siso').file_size==65793392 and z.getinfo('.cipdpkg/manifest.json').file_size==120
    raw=z.read('siso')
    assert hashlib.sha256(raw).hexdigest()=='470367b491702bb805e33cec867febafce8feb2018e34c14631372682952015b'
    fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o700)
    with os.fdopen(fd,'wb') as stream:assert stream.write(raw)==len(raw)
`;
    await executeJoined(
      PYTHON,
      ["-I", "-B", "-S", "-c", extract, archive, binary],
      {
        cwd: root,
        env,
        timeout: 5000,
        killSignal: "SIGKILL",
        maxBuffer: 2048,
        windowsHide: true,
        joinDeadline: Math.min(end, performance.now() + 8000),
      },
    );
    assert(
      createHash("sha256")
        .update(await readFile(binary))
        .digest("hex") === SISO_SHA,
    );
    const clang = await readFile(CLANG);
    assert(
      clang.length === 272034048 &&
        createHash("sha256").update(clang).digest("hex") ===
          "15339439a6be4a9d33d281ec040a7e0092190b1c8d7de5f94d824b50ffae0769",
    );
    const outDir = path.join(root, "out");
    await mkdir(outDir, { mode: 0o700 });
    await writeFile(path.join(root, ".gn"), "# Benign diagnostic workspace\n", {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(
      path.join(root, "unit.c"),
      "int benign_probe(void) { return 7; }\n",
      { flag: "wx", mode: 0o600 },
    );
    let ninja = `rule cc\n  command = ${CLANG} -x c -c ../unit.c -o $out\n`;
    for (let index = 0; index < 2000; index++)
      ninja += `build probe${index}.o: cc ../unit.c\n`;
    await writeFile(path.join(outDir, "build.ninja"), ninja, {
      flag: "wx",
      mode: 0o600,
    });
    executable = binary;
    args = ["ninja", "--offline", "-load=", "-local_jobs=3", "-C", outDir];
    env.HOME = root;
    env.TMPDIR = root;
  }
  assert(performance.now() + 45000 < end);
  const factory = await createMacCensusIntegrationProofFactory({
    target,
    source,
    canonicalRoot: `/Users/runner/work/_temp/sorng-cef-engineering/${target}/${source}`,
    scratch: root,
    python: PYTHON,
    deadline: Math.min(end, performance.now() + 40000),
  });
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
    result = await compileSlice(executable, args, {
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
    stdoutTail: (
      await readFile(path.join(logs, "checkpoint-compile.stdout.log"), "utf8")
    ).slice(-2048),
    stderrTail: (
      await readFile(path.join(logs, "checkpoint-compile.stderr.log"), "utf8")
    ).slice(-2048),
  });
  if (mode === "siso")
    assert(
      createHash("sha256")
        .update(await readFile(executable))
        .digest("hex") === SISO_SHA,
    );
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
