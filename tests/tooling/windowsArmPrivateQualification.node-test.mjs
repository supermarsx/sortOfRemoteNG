import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import vm from "node:vm";
import * as syncFs from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { parse } from "acorn";
import {
  PRIVATE_DRIVER_ADMITTED,
  sourceJobProjection,
  qualificationPhaseClock,
  privateCommandProjections,
  staticLoadingProjection,
  loadSealedProfile as privateLoadSealedProfile,
  reviewedHostClosure as privateHostClosure,
  sourcePaths as privateSourcePaths,
  bootstrapProgram as privateBootstrapProgram,
} from "../../native/windows-arm-full-sdk/private-source-driver.mjs";
import {
  prepareSourceGitIsolation,
  sourceGitEnvironment,
} from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-custom-runtime.mjs";
import { graphPinSnapshot } from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-engineering-checkpoint.mjs";

const base = "native/windows-arm-full-sdk/";
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const policy = JSON.parse(
  await readFile(base + "private-qualification-profile.json", "utf8"),
);

test("private Windows qualification first slice runs only portable projection and denial tests", () => {
  const result = spawnSync(
    "python",
    ["-I", "-B", base + "test_private_qualification.py"],
    { encoding: "utf8", timeout: 15000, maxBuffer: 65536, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 41 tests/);
  assert.match(result.stderr, /\bOK\b/);
});

test("new private policy leaves both image-qualified recipes and public engine execute closed", async () => {
  assert.equal(policy.privateAuthorityAdmitted, false);
  assert.equal(policy.workflowActivation, false);
  assert.equal(policy.publicExecuteAdmitted, false);
  assert.equal(policy.environmentContractApproved, false);
  assert.equal(policy.sourceClosureStatus, "planned-files-incomplete");
  assert.equal(policy.sourcePaths.length, 105);
  for (const [image, selected] of Object.entries(policy.images)) {
    const raw = await readFile(base + selected.profile);
    assert.equal(hash(raw), selected.profileSha256);
    const actual = JSON.parse(raw);
    assert.equal(actual.image, image);
    assert.equal(actual.sourceGn.sourceId, selected.sourceId);
    assert.deepEqual(actual.admission, {
      sourceAcquisitionAllowed: true,
      gnAllowed: true,
      engineCompilationAllowed: false,
      sdkAllowed: false,
      restoreAllowed: false,
      publicationAllowed: false,
    });
  }
  assert.equal(
    hash(await readFile(base + "engine-qualification-profile.json")),
    policy.baseCandidatePolicySha256,
  );
  assert.equal(
    hash(await readFile(base + "engine_qualification.py")),
    "f202c17fdd92f52da09708c10a755e8ef693075b88760e91b05c914b7c3203b3",
  );
  for (const name of [base + "producer.py", base + "checkpoint.py"])
    assert(!(await readFile(name, "utf8")).includes("private_qualification"));
});

const rawPolicy = await readFile(base + "private-qualification-profile.json");
const ROOT =
  "D:/a/sortOfRemoteNG/sortOfRemoteNG/.artifacts/windows-arm-full-sdk-01234567-89ab-4cde-8123-456789abcdef";
const scope = () => ({
  mode: "private-compiler-input-qualification",
  ref: "refs/heads/codex/windows-arm-engine-qualification-20261101",
  workflow: ".github/workflows/windows-arm-compiler-input-qualification.yml",
  repository: "supermarsx/sortOfRemoteNG",
  repositoryId: "1010282954",
  visibility: "public",
  event: "workflow_dispatch",
  root: ROOT,
});

const staticLoadingFixture = (image = "20261030.294.1") => {
  const loading = policy.staticLoadingPolicy;
  const selected = policy.images[image];
  const context = {
    ...scope(),
    image,
    host: { platform: "win32", architecture: "x64", runner: policy.runner },
    source: {
      target: policy.target,
      sourceId: selected.sourceId,
      profileSha256: selected.profileSha256,
      chromium: policy.chromium,
      cef: policy.cef,
    },
  };
  const pins = Object.fromEntries(
    Object.entries(policy.tools).map(([role, row]) => [
      role,
      {
        path: row.path ?? ROOT + "/" + row.relativePath,
        bytes: row.bytes,
        sha256: row.sha256,
      },
    ]),
  );
  return {
    context,
    observations: {
      kind: "windows-arm-static-loading-candidate",
      toolPins: pins,
      llvmArchive: structuredClone(loading.llvmArchive),
      llvmTools: Object.fromEntries(
        Object.entries(loading.llvmStaticTools).map(([role, row]) => [
          role,
          { path: pins[role].path, ...structuredClone(row) },
        ]),
      ),
      compilerEnvironment: {
        kind: "closed-fixed-compiler-environment",
        cwd: ROOT + "/private-qualification",
        cwdEntriesBefore: [],
        values: {
          ...loading.commandEnvironment.requiredValues,
          TEMP: ROOT + "/private-qualification-tmp",
          TMP: ROOT + "/private-qualification-tmp",
        },
      },
    },
  };
};

test("named OS-TCB policy and mirrored static projections retain false dynamic evidence for both exact images", () => {
  const code =
    "import sys,json;from pathlib import Path;sys.path.insert(0,str(Path('native/windows-arm-full-sdk').resolve()));import test_private_qualification as t;import private_qualification as p;rows=[]\nfor image in t.POLICY['images']:\n c,o=t.static_loading_fixture(image);rows.append({'context':c,'observations':o,'result':p.inspect_static_loading(c,t.RAW,o)})\nprint(json.dumps(rows))";
  const observed = spawnSync("python", ["-I", "-B", "-c", code], {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 200000,
    windowsHide: true,
  });
  assert.equal(observed.status, 0, observed.stdout + observed.stderr);
  for (const row of JSON.parse(observed.stdout)) {
    const projected = staticLoadingProjection(
      row.context,
      rawPolicy,
      row.observations,
    );
    assert.deepEqual(projected, row.result);
    assert.equal(projected.actualLoaderClosureApproved, false);
    assert.equal(projected.system32ByteSetProven, false);
    assert.equal(projected.environmentAuthorityTransferred, false);
    assert.equal(projected.executionAdmitted, false);
  }
  assert.equal(policy.environmentContractApproved, false);
  assert.equal(policy.privateAuthorityAdmitted, false);
  assert.equal(policy.lldStaticCandidate.actualLoaderClosureApproved, false);
});

test("static policy rejects source, image, tool, archive, import, adjacent DLL, cwd and environment substitutions", () => {
  const cases = [
    ({ context }) => {
      context.image = "20261102.000.1";
    },
    ({ context }) => {
      context.host.architecture = "arm64";
    },
    ({ context }) => {
      context.source.sourceId = "b".repeat(64);
    },
    ({ context }) => {
      context.source.profileSha256 =
        policy.images["20261021.278.1"].profileSha256;
    },
    ({ observations }) => {
      observations.toolPins.gn.sha256 = "b".repeat(64);
    },
    ({ observations }) => {
      observations.toolPins.python.path += "/alias";
    },
    ({ observations }) => {
      observations.llvmArchive.url += "&fallback=1";
    },
    ({ observations }) => {
      observations.llvmTools.clang.machine = 0xaa64;
    },
    ({ observations }) => {
      observations.llvmTools.lld.imports.push("unexpected.dll");
    },
    ({ observations }) => {
      observations.llvmTools.clang.delayImports = [];
    },
    ({ observations }) => {
      observations.llvmTools.lld.adjacentBinDlls = ["version.dll"];
    },
    ({ observations }) => {
      observations.actualLoaderClosureApproved = true;
    },
    ({ observations }) => {
      observations.compilerEnvironment.cwd = ROOT;
    },
    ({ observations }) => {
      observations.compilerEnvironment.cwdEntriesBefore = ["version.dll"];
    },
    ({ observations }) => {
      observations.compilerEnvironment.values.PATH += ";C:/untrusted";
    },
    ({ observations }) => {
      observations.compilerEnvironment.values.TEMP =
        ROOT + "/private-qualification";
    },
  ];
  for (const name of [
    "CL",
    "_CL_",
    "LINK",
    "_LINK_",
    "INCLUDE",
    "LIB",
    "LIBPATH",
    "GITHUB_TOKEN",
    "path",
  ])
    cases.push(({ observations }) => {
      observations.compilerEnvironment.values[name] = "untrusted";
    });
  for (const value of ["", "line\n", "x".repeat(129)])
    cases.push(({ observations }) => {
      observations.compilerEnvironment.values.RUNNER_TRACKING_ID = value;
    });
  for (const mutate of cases) {
    const candidate = staticLoadingFixture();
    mutate(candidate);
    assert.throws(
      () =>
        staticLoadingProjection(
          candidate.context,
          rawPolicy,
          candidate.observations,
        ),
      /PRIVATE_/,
    );
  }
  const candidate = staticLoadingFixture();
  candidate.observations.compilerEnvironment.values.RUNNER_TRACKING_ID =
    "owned-fixture-tracking_1";
  assert.equal(
    staticLoadingProjection(
      candidate.context,
      rawPolicy,
      candidate.observations,
    ).executionAdmitted,
    false,
  );
});

test("dedicated private source Job projection retains no environment or live token authority", () => {
  const plan = sourceJobProjection(scope(), rawPolicy, "a".repeat(64));
  assert.equal(PRIVATE_DRIVER_ADMITTED, false);
  assert.equal(plan.role, "private-source-gn");
  assert.deepEqual(plan.argv, [
    policy.driverNode.path,
    "--disable-proto=throw",
    "--no-addons",
    ROOT.split("/.artifacts/")[0] + "/" + policy.handoffContract.sourceWorker,
    "--private-source-gn",
    ROOT,
    "a".repeat(64),
    "--execute",
  ]);
  assert.equal(plan.aggregateWorkMs, 900000);
  assert.equal(plan.cleanupMs, 30000);
  assert.equal(plan.finalReserveMs, 120000);
  assert.equal(plan.environmentAuthorityTransferred, false);
  assert.equal(plan.liveJobCapability, false);
  assert.equal(plan.executionAdmitted, false);
  assert.equal("env" in plan, false);
  assert(Object.isFrozen(plan));
  assert(Object.isFrozen(plan.argv));
  assert.deepEqual(plan.qualificationRoles, policy.qualificationRoles);
});

test("old source modes, wrong ref/policy and supplied grants cannot authorize private handoff", () => {
  for (const change of [
    { mode: "source-gn" },
    { mode: "image-qualified-source-gn" },
    { ref: "refs/heads/main" },
    { workflow: ".github/workflows/windows-arm-source-preflight.yml" },
    { repositoryId: "1" },
    { visibility: "private" },
  ])
    assert.throws(
      () =>
        sourceJobProjection(
          { ...scope(), ...change },
          Buffer.from("{}"),
          "a".repeat(64),
        ),
      /PRIVATE_MODE_SCOPE/,
    );
  assert.throws(
    () =>
      sourceJobProjection(
        scope(),
        Buffer.concat([rawPolicy, Buffer.from(" ")]),
        "a".repeat(64),
      ),
    /PRIVATE_POLICY_PIN/,
  );
  for (const change of [{ root: ROOT + "/.." }, { root: "C:/arbitrary" }])
    assert.throws(
      () =>
        sourceJobProjection(
          { ...scope(), ...change },
          rawPolicy,
          "a".repeat(64),
        ),
      /PRIVATE_ROOT/,
    );
  const supplied = sourceJobProjection(
    {
      ...scope(),
      job: { assigned: true },
      allow: true,
      env: { PATH: "C:/hostile" },
    },
    rawPolicy,
    "a".repeat(64),
  );
  assert.equal(supplied.executionAdmitted, false);
  assert.equal(supplied.environmentAuthorityTransferred, false);
});

test("actual private entry fails before input IO or optional source helper import", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--disable-proto=throw",
      "--no-addons",
      base + "private-source-driver.mjs",
      "--private-source-gn",
      ROOT,
      "a".repeat(64),
      "--execute",
    ],
    { encoding: "utf8", timeout: 5000, maxBuffer: 4096, windowsHide: true },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), {
    success: false,
    firstFailure: "PRIVATE_EXECUTION_CLOSED",
    executionAdmitted: false,
  });
});

test("actual private entry never accepts legacy marker or additional command text", () => {
  for (const argv of [
    ["--source-gn", ROOT, "a".repeat(64), "--execute"],
    ["--private-source-gn", ROOT, "a".repeat(64), "--execute", "clang-cl.exe"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [base + "private-source-driver.mjs", ...argv],
      {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 4096,
        windowsHide: true,
      },
    );
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stderr), {
      success: false,
      firstFailure: "PRIVATE_DRIVER_ARGV",
      executionAdmitted: false,
    });
  }
});

const clockFixture = (remaining = 1600000) => {
  let at = 0;
  return {
    advance: (milliseconds) => {
      at += milliseconds;
    },
    phase: qualificationPhaseClock(
      { remaining: () => remaining - at },
      () => at,
    ),
  };
};

test("one aggregate clock admits six ordered model commands within same 900 seconds", () => {
  const value = clockFixture();
  for (const role of policy.qualificationRoles) {
    value.phase.before(role);
    value.advance(149000);
    value.phase.after(role);
  }
  assert.equal(value.phase.maximumWorkMs, 900000);
  assert.deepEqual(value.phase.finish(), {
    commandsCompleted: 6,
    executionAdmitted: false,
  });
  assert.throws(
    () => value.phase.before(policy.qualificationRoles[0]),
    /PRIVATE_PHASE_ORDER/,
  );
});

test("later command cannot receive a fresh 900 second budget and failure poisons phase", () => {
  const value = clockFixture();
  value.phase.before(policy.qualificationRoles[0]);
  value.advance(899999);
  value.phase.after(policy.qualificationRoles[0]);
  value.advance(2);
  let first;
  try {
    value.phase.before(policy.qualificationRoles[1]);
  } catch (error) {
    first = error;
  }
  assert.match(first.message, /PRIVATE_PHASE_DEADLINE/);
  assert.throws(
    () => value.phase.after(policy.qualificationRoles[1]),
    (error) => error === first,
  );
  assert.throws(
    () => value.phase.finish(),
    (error) => error === first,
  );
});

test("phase reserves original parent cleanup and final metadata time and rejects early finish", () => {
  const value = clockFixture(151000);
  assert.equal(value.phase.maximumWorkMs, 1000);
  value.phase.before(policy.qualificationRoles[0]);
  value.advance(1000);
  assert.throws(
    () => value.phase.after(policy.qualificationRoles[0]),
    /PRIVATE_PHASE_DEADLINE/,
  );
  for (const left of [150000, 7200001, Infinity, NaN])
    assert.throws(
      () => qualificationPhaseClock({ remaining: () => left }, () => 0),
      /PRIVATE_PHASE_BUDGET/,
    );
  assert.throws(() => clockFixture().phase.finish(), /PRIVATE_PHASE_ORDER/);
});

test("reordered commands and source budget failure cannot be retried or reported finished", () => {
  const value = clockFixture();
  assert.throws(
    () => value.phase.before(policy.qualificationRoles[1]),
    /PRIVATE_PHASE_ORDER/,
  );
  assert.throws(
    () => value.phase.before(policy.qualificationRoles[0]),
    /PRIVATE_PHASE_ORDER/,
  );
  let left = 1600000;
  const phase = qualificationPhaseClock({ remaining: () => left }, () => 0);
  phase.before(policy.qualificationRoles[0]);
  left = Infinity;
  assert.throws(
    () => phase.after(policy.qualificationRoles[0]),
    /PRIVATE_PHASE_DEADLINE/,
  );
  left = 1600000;
  assert.throws(() => phase.finish(), /PRIVATE_PHASE_DEADLINE/);
});

test("falsy source-budget exceptions permanently poison the phase and preserve the original value", () => {
  const expectOriginalThrow = (action, original) => {
    let threw = false;
    try {
      action();
    } catch (error) {
      threw = true;
      assert.equal(error, original);
    }
    assert.equal(threw, true);
  };
  for (const original of [0, false, null, undefined, ""]) {
    let throwNow = false;
    const phase = qualificationPhaseClock(
      {
        remaining: () => {
          if (throwNow) throw original;
          return 1600000;
        },
      },
      () => 0,
    );
    throwNow = true;
    expectOriginalThrow(
      () => phase.before(policy.qualificationRoles[0]),
      original,
    );
    throwNow = false;
    for (const retry of [
      () => phase.observe(),
      () => phase.before(policy.qualificationRoles[0]),
      () => phase.after(policy.qualificationRoles[0]),
      () => phase.finish(),
    ])
      expectOriginalThrow(retry, original);
  }
});

// Exact source1192 program carry-forward; historical guards alone use this inverse.
const SOURCE_PROGRAM_HISTORY = [
  {
    name: "bootstrapProgram",
    oldSha256:
      "6dadfc55c531ffc53d2831053c5a45b92617e9610c6d3819dce48b3bf4753410",
    newSha256:
      "4e002707abab160ed1855d8a071d5a6f5386775597b6155466614a8a72287b1b",
    reviewedSourceSha256:
      "efde0d776d2b592f47328c373b317d08623638914f5314d521bbade836b3be4c",
    oldRaw:
      "export function bootstrapProgram(root, p, contextSha) {\n  const files = sourcePaths(root, p);\n  need(/^[a-f0-9]{64}$/.test(contextSha), \"FULL_CONTEXT_PIN\");\n  const policy = {\n    root: root.replaceAll(\"\\\\\", \"/\"),\n    depot: files.depot.replaceAll(\"\\\\\", \"/\"),\n    commands: files.commands.replaceAll(\"\\\\\", \"/\"),\n    native: HERE.replaceAll(\"\\\\\", \"/\"),\n    workspace: files.workspace.replaceAll(\"\\\\\", \"/\"),\n    python: p.python.path,\n    contextSha,\n    enabled:\n      PRIVATE_DRIVER_ADMITTED &&\n      p.privatePolicy.privateAuthorityAdmitted === true &&\n      p.phaseAdmission[\"image-qualified-source-gn\"] === true &&\n      Object.values(p.sourceGn.executionPolicy).every(\n        (value) => value === true,\n      ),\n    image: p.image,\n    sources: BOOTSTRAP_SOURCES,\n    clientSha: CIPD_CLIENT_SHA,\n    instance: VPYTHON_INSTANCE,\n    syncArgs: [\n      \"sync\",\n      \"--jobs\",\n      \"2\",\n      \"--nohooks\",\n      \"--noprehooks\",\n      \"--no-history\",\n      \"--revision\",\n      `src@${p.sourceChromium}`,\n    ],\n  };\n  return Buffer.from(\n    String.raw`import sys,os,json,time,stat,hashlib,subprocess\nfrom pathlib import Path\nP=json.loads(${JSON.stringify(JSON.stringify(policy))})\nsys.path.insert(0,P['native'])\nimport acquire as data\nimport extract\nROOT=Path(P['root']);DEPOT=Path(P['depot']);COMMANDS=Path(P['commands'])\nSCRIPT=COMMANDS/'source_bootstrap.py';WITNESS=COMMANDS/'bootstrap-witness.json'\nSETUP=DEPOT/'sorng-cipd-setup.bat'\nCAP=512*1024**2\ndef context():\n short=data.Clock(time.time()+5,time.monotonic()+5)\n _,raw=extract.held(ROOT/'context.json',short,sha256=P['contextSha'],retain=True,maximum=131072,bounded_reads=True)\n value=json.loads(raw)\n data.need(P['enabled'] is True and value['mode']=='private-compiler-input-qualification' and value['image']==P['image'] and value['image'] in ('20261030.294.1','20261021.278.1') and value['repositoryId']=='1010282954' and value['visibility']=='public' and value['event']=='workflow_dispatch' and value['ref']=='refs/heads/codex/windows-arm-engine-qualification-20261101','FULL_BOOTSTRAP_AUTHORITY')\n clock=data.Clock(value['wallWorkEnd'],value['monotonicWorkEnd'])\n for key,relative in (('CIPD_CACHE_DIR','cipd'),('VPYTHON_VIRTUALENV_ROOT','vpython'),('LOCALAPPDATA','local'),('APPDATA','roaming'),('XDG_CACHE_HOME','xdg')):\n  data.need(Path(os.environ.get(key,''))==ROOT/'source-caches'/relative,'FULL_BOOTSTRAP_ENV');data.plain(ROOT/'source-caches'/relative)\n data.need(Path(os.environ.get('CIPD_CONFIG_FILE',''))==ROOT/'source-caches/cipd.cfg' and not any(os.environ.get(key)for key in ('CIPD_BACKEND','CIPD_SERVICE_URL','CIPD_PLATFORM','VPYTHON_BYPASS','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY')),'FULL_BOOTSTRAP_ENV')\n extract.held(ROOT/'source-caches/cipd.cfg',clock,expected_size=0,sha256=hashlib.sha256(b'').hexdigest(),maximum=0,bounded_reads=True)\n return clock\ndef write_new(path,raw,clock):\n clock.remaining();data.plain(path,exists=False);stream=path.open('xb');failed=False\n try:data.need(stream.write(raw)==len(raw),'FULL_BOOTSTRAP_WRITE')\n except BaseException:failed=True;raise\n finally:\n  try:stream.close()\n  except BaseException:\n   if not failed:raise\n   print('FULL_BOOTSTRAP_CLOSE_FAILURE',file=sys.stderr)\n clock.remaining()\ndef read_pin(path,clock,ledger,pin=None,maximum=256*1024**2):\n path=data.plain(path);size=path.lstat().st_size\n data.need(0<=size<=min(maximum,CAP-ledger[0]),'FULL_BOOTSTRAP_BYTES')\n if pin is not None:data.need(size==pin['bytes'] and pin['nlink']==1,'FULL_BOOTSTRAP_PIN')\n charged=0\n def consumed(count):\n  nonlocal charged\n  data.need(type(count)is int and charged<=count<=size,'FULL_BOOTSTRAP_BYTES')\n  ledger[0]+=count-charged;charged=count;data.need(ledger[0]<=CAP,'FULL_BOOTSTRAP_BYTES')\n observed,raw=extract.held(path,clock,expected_size=size,sha256=None if pin is None else pin['sha256'],retain=True,maximum=min(maximum,CAP-ledger[0]),expected_nlink=1,progress=consumed,bounded_reads=True)\n data.need(observed['bytes']==charged==size,'FULL_BOOTSTRAP_BYTES')\n return dict(path=path.as_posix(),bytes=size,sha256=observed['sha256'],nlink=1),raw\ndef sources(clock,ledger):\n result={}\n for pin in P['sources']:result[pin['path']]=read_pin(DEPOT/pin['path'],clock,ledger,dict(pin,nlink=1),2*1024**2)[1]\n return result\ndef absent(path):\n try:path.lstat()\n except FileNotFoundError:return\n raise data.Denied('FULL_BOOTSTRAP_PREEXISTING')\ndef directory_signature(value):\n signature=data.signature(value)\n return signature[:2]+signature[3:] if os.name=='nt' else signature\ndef empty_directory(path,clock):\n path=data.plain(path);before=path.lstat();data.need(stat.S_ISDIR(before.st_mode),'FULL_BOOTSTRAP_DIRECTORY')\n iterator=os.scandir(path);failed=False\n try:data.need(next(iterator,None)is None,'FULL_BOOTSTRAP_CACHE_NOT_EMPTY')\n except BaseException:failed=True;raise\n finally:\n  try:iterator.close()\n  except BaseException:\n   if not failed:raise\n   print('FULL_BOOTSTRAP_CLOSE_FAILURE',file=sys.stderr)\n data.need(directory_signature(before)==directory_signature(path.lstat()),'FULL_BOOTSTRAP_DIRECTORY_CHANGED');clock.remaining()\ndef override_absent():absent(DEPOT/'.cipd_client_platform')\ndef shim(role,guard_sha,witness_sha):\n return ('@echo off\\r\\n\"'+P['python']+'\" -I -B \"'+str(SCRIPT)+'\" --execute '+role+' '+guard_sha+' '+witness_sha+' %*\\r\\nexit /b %errorlevel%\\r\\n').encode('ascii')\ndef run_checked(command,clock):\n seconds=clock.remaining()-120;data.need(seconds>0,'FULL_SOURCE_RESERVE')\n return subprocess.run(command,check=False,shell=False,timeout=seconds).returncode\ndef derived_setup(raw):\n old=b'call \"%~dp0\\\\cipd.bat\" ensure';new=b'\"%~dp0\\\\.cipd_client.exe\" ensure'\n data.need(raw.count(old)==1,'FULL_BOOTSTRAP_SETUP_SOURCE')\n return raw.replace(old,new)\ndef provision(guard_sha,runner=run_checked):\n clock=context();ledger=[0];raw_sources=sources(clock,ledger)\n read_pin(SCRIPT,clock,ledger,dict(bytes=SCRIPT.stat().st_size,sha256=guard_sha,nlink=1),2*1024**2)\n for path in (DEPOT/'.cipd_client_platform',DEPOT/'.cipd_client.exe',DEPOT/'.versions',DEPOT/'.cipd_bin',SETUP,WITNESS,COMMANDS/'cipd.bat',COMMANDS/'vpython3.bat'):absent(path)\n for name in ('local','roaming','xdg','cipd','vpython'):empty_directory(ROOT/'source-caches'/name,clock)\n code=runner(['C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',str(DEPOT/'.cipd_impl.ps1'),'-CipdBinary',str(DEPOT/'.cipd_client.exe'),'-Platform','windows-amd64','-BackendURL','https://chrome-infra-packages.appspot.com','-VersionFile',str(DEPOT/'cipd_client_version')],clock)\n data.need(type(code)is int and code==0,'FULL_BOOTSTRAP_CLIENT_EXIT')\n client,_=read_pin(DEPOT/'.cipd_client.exe',clock,ledger)\n data.need(client['sha256']==P['clientSha'],'FULL_BOOTSTRAP_CLIENT_HASH')\n write_new(SETUP,derived_setup(raw_sources['cipd_bin_setup.bat']),clock)\n code=runner(['C:\\\\Windows\\\\System32\\\\cmd.exe','/d','/c',str(SETUP)],clock)\n data.need(type(code)is int and code==0,'FULL_BOOTSTRAP_SETUP_EXIT')\n ledger=[0];sources(clock,ledger);override_absent()\n read_pin(SETUP,clock,ledger,dict(bytes=len(derived_setup(raw_sources['cipd_bin_setup.bat'])),sha256=hashlib.sha256(derived_setup(raw_sources['cipd_bin_setup.bat'])).hexdigest(),nlink=1))\n client,_=read_pin(DEPOT/'.cipd_client.exe',clock,ledger,client)\n vpython,body=read_pin(DEPOT/'.cipd_bin/vpython3.exe',clock,ledger)\n data.need(extract.pe_metadata(body)['machine']==0x8664,'FULL_BOOTSTRAP_VPYTHON_MACHINE')\n for target,source in (('.cipd_manifest.txt','cipd_manifest.txt'),('.cipd_manifest.versions','cipd_manifest.versions'),('.cipd_client_version','cipd_client_version')):\n  pin=next(pin for pin in P['sources']if pin['path']==source)\n  read_pin(DEPOT/'.cipd_bin'/target,clock,ledger,dict(pin,nlink=1))\n value=dict(kind='windows-arm-fresh-pinned-bootstrap',contextSha=P['contextSha'],guardSha=guard_sha,setupExit=0,fresh=True,packageInstance=P['instance'],client=client,vpython=vpython,vpythonMachine=0x8664)\n raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\\n').encode();write_new(WITNESS,raw,clock);witness_sha=hashlib.sha256(raw).hexdigest()\n for role,name in (('cipd','cipd.bat'),('vpython','vpython3.bat')):write_new(COMMANDS/name,shim(role,guard_sha,witness_sha),clock)\n verify(witness_sha,guard_sha)\n return value\ndef verify(expected,guard_sha):\n data.need(all(type(value)is str and len(value)==64 and all(c in '0123456789abcdef'for c in value)for value in (expected,guard_sha)),'FULL_BOOTSTRAP_EXPECTED_PIN')\n clock=context();ledger=[0];witness_pin,raw=read_pin(WITNESS,clock,ledger,maximum=65536)\n data.need(witness_pin['sha256']==expected,'FULL_BOOTSTRAP_WITNESS_PIN')\n value=json.loads(raw)\n data.need(type(value)is dict and set(value)=={'kind','contextSha','guardSha','setupExit','fresh','packageInstance','client','vpython','vpythonMachine'} and value['kind']=='windows-arm-fresh-pinned-bootstrap' and value['contextSha']==P['contextSha'] and type(value['setupExit'])is int and value['setupExit']==0 and value['fresh']is True and value['packageInstance']==P['instance'] and type(value['vpythonMachine'])is int and value['vpythonMachine']==0x8664,'FULL_BOOTSTRAP_WITNESS')\n data.need(value['guardSha']==guard_sha,'FULL_BOOTSTRAP_GUARD_PIN')\n read_pin(SCRIPT,clock,ledger,dict(bytes=SCRIPT.stat().st_size,sha256=guard_sha,nlink=1),2*1024**2)\n raw_sources=sources(clock,ledger);override_absent()\n for role,path in (('client',DEPOT/'.cipd_client.exe'),('vpython',DEPOT/'.cipd_bin/vpython3.exe')):\n  pin=value[role]\n  data.need(type(pin)is dict and set(pin)=={'path','bytes','sha256','nlink'} and pin['path']==path.as_posix() and type(pin['bytes'])is int and 0<pin['bytes']<=256*1024**2 and type(pin['nlink'])is int and pin['nlink']==1 and type(pin['sha256'])is str and len(pin['sha256'])==64 and all(c in '0123456789abcdef'for c in pin['sha256']),'FULL_BOOTSTRAP_PIN')\n  data.need(role!='client' or pin['sha256']==P['clientSha'],'FULL_BOOTSTRAP_CLIENT_HASH')\n  read_pin(path,clock,ledger,pin)\n setup=derived_setup(raw_sources['cipd_bin_setup.bat']);read_pin(SETUP,clock,ledger,dict(bytes=len(setup),sha256=hashlib.sha256(setup).hexdigest(),nlink=1))\n for target,source in (('.cipd_manifest.txt','cipd_manifest.txt'),('.cipd_manifest.versions','cipd_manifest.versions'),('.cipd_client_version','cipd_client_version')):\n  pin=next(pin for pin in P['sources']if pin['path']==source);read_pin(DEPOT/'.cipd_bin'/target,clock,ledger,dict(pin,nlink=1))\n for role,name in (('cipd','cipd.bat'),('vpython','vpython3.bat')):\n  body=shim(role,value['guardSha'],witness_pin['sha256']);read_pin(COMMANDS/name,clock,ledger,dict(bytes=len(body),sha256=hashlib.sha256(body).hexdigest(),nlink=1),4096)\n return value,clock\ndef arguments(role,args):\n data.need(type(args)is list and 0<len(args)<=64 and all(type(value)is str and len(value)<=4096 and not any(c in value for c in '\\x00\\r\\n%&|<>!^')for value in args),'FULL_BOOTSTRAP_ARGV')\n if role=='cipd':\n  if args[0]=='expand-package-name':\n   data.need(len(args)==2 and args[1] and not args[1].startswith(('-','/')) and '..'not in args[1] and all(c in 'abcdefghijklmnopqrstuvwxyz0123456789_/{}.-'+chr(36)for c in args[1]),'FULL_BOOTSTRAP_CIPD_ARGV');return\n  data.need(len(args)==7 and args[0]in ('ensure','ensure-file-resolve') and args[1]=='-log-level' and args[2]in ('info','error'),'FULL_BOOTSTRAP_CIPD_ARGV')\n  if args[0]=='ensure':\n   data.need(args[3]=='-root' and data.plain(args[4])==Path(P['workspace']) and args[5]=='-ensure-file','FULL_BOOTSTRAP_CIPD_ARGV')\n   paths=[args[6]]\n  else:\n   data.need(args[3]=='-ensure-file' and args[5]=='-json-output','FULL_BOOTSTRAP_CIPD_ARGV');paths=[args[4],args[6]]\n  for value in paths:\n   path=data.plain(value);info=path.lstat();data.need(path.parent==ROOT/'tmp' and stat.S_ISREG(info.st_mode) and info.st_nlink==1,'FULL_BOOTSTRAP_TEMP_PATH')\ndef execute(role,args,expected,guard_sha,runner=run_checked):\n data.need(role in ('cipd','vpython'),'FULL_BOOTSTRAP_ROLE');arguments(role,args)\n value,clock=verify(expected,guard_sha);failed=False\n try:\n  code=runner([value['client'if role=='cipd'else 'vpython']['path'],*args],clock)\n  data.need(type(code)is int and code==0,'FULL_BOOTSTRAP_CHILD_EXIT')\n except BaseException:failed=True;raise\n finally:\n  try:verify(expected,guard_sha)\n  except BaseException:\n   if not failed:raise\n   print('FULL_BOOTSTRAP_POST_FAILURE',file=sys.stderr)\ndef inherited_environment(approved,candidate):\n current=dict(os.environ);expected=dict(approved)\n # Exact writes from pinned gclient.main; these do not select executables.\n for key,value in (('GIT_PAGER','cat'),('GIT_EDITOR','false'),('GIT_TERMINAL_PROMPT','0')):\n  if key in current:\n   data.need(current[key]==approved.get(key)or current[key]==value,'FULL_BOOTSTRAP_INHERITED_ENV')\n   expected[key]=current[key]\n # Pinned GitDependency.update records commit data, not command/config authority.\n if 'GCLIENT_PREVIOUS_SYNC_COMMITS'in current:\n  value=current['GCLIENT_PREVIOUS_SYNC_COMMITS']\n  data.need(type(value)is str and 0<len(value)<=1024**2 and not any(c in value for c in '\\x00\\r\\n'),'FULL_BOOTSTRAP_INHERITED_ENV')\n  expected['GCLIENT_PREVIOUS_SYNC_COMMITS']=value\n data.need(current==expected,'FULL_BOOTSTRAP_INHERITED_ENV')\n if candidate is None:return\n data.need(type(candidate)is dict,'FULL_BOOTSTRAP_ENV_OVERRIDE');expected=dict(current)\n if 'COLUMNS'not in current or 'LINES'not in current:\n  if 'COLUMNS'in candidate and 'LINES'in candidate:\n   for key in ('COLUMNS','LINES'):\n    value=candidate[key]\n    data.need(type(value)is str and value.isascii()and value.isdecimal()and 1<=len(value)<=5 and value[0]!='0'and 1<=int(value)<=10000,'FULL_BOOTSTRAP_TERMINAL_ENV')\n    expected[key]=value\n data.need(candidate==expected,'FULL_BOOTSTRAP_ENV_OVERRIDE')\n\ndef bind(expected,guard_sha):\n value,_=verify(expected,guard_sha);sys.path.insert(0,str(DEPOT));import subprocess2\n if getattr(subprocess2,'_sorng_cipd_bound',False):return\n popen=subprocess2.Popen;data.need(isinstance(popen,type),'FULL_BOOTSTRAP_POPEN_CLASS')\n original_init=popen.__init__;approved=dict(os.environ)\n def admitted(self,args,**kwargs):\n  if isinstance(args,(list,tuple))and args and args[0]in ('cipd','cipd.bat',str(DEPOT/'cipd.bat')):\n   values=list(args[1:]);arguments('cipd',values);inherited_environment(approved,kwargs.get('env'));current,_=verify(expected,guard_sha);kwargs['shell']=False\n   return original_init(self,[current['client']['path'],*values],**kwargs)\n  return original_init(self,args,**kwargs)\n popen.__init__=admitted;subprocess2._sorng_cipd_bound=True\ndef main(argv):\n data.need(P['enabled']is True and os.name=='nt','FULL_BOOTSTRAP_DISABLED')\n if len(argv)>=3 and argv[:2]==['--prepare-sync','--guard-sha']:\n  guard_sha=argv[2];data.need(argv[3:]==P['syncArgs'][1:],'FULL_BOOTSTRAP_SYNC_ARGV')\n  value=provision(guard_sha);print('FULL_BOOTSTRAP_WITNESS:'+json.dumps(value,sort_keys=True,separators=(',',':')),flush=True)\n  expected=hashlib.sha256((json.dumps(value,sort_keys=True,separators=(',',':'))+'\\n').encode()).hexdigest()\n  bind(expected,guard_sha);sys.path.insert(0,str(DEPOT));import gclient\n  return gclient.main(P['syncArgs'])\n data.need(len(argv)>=5 and argv[0]=='--execute','FULL_BOOTSTRAP_ARGV')\n execute(argv[1],argv[4:],argv[3],argv[2]);return 0\nif __name__=='__main__':sys.exit(main(sys.argv[1:]))\n`,\n    \"utf8\",\n  );\n}",
  },
  {
    name: "hookProjectionArguments",
    oldSha256:
      "a168a3e2b974cb6ef3251e39e9c67acafbfd8fb9c3ea1793fcebec18fec74057",
    newSha256:
      "000b1bcd0c496f86bf117eacbabfa7a4bac4d5acc7a7ff81dfb6e6abae8482aa",
    reviewedSourceSha256:
      "000b1bcd0c496f86bf117eacbabfa7a4bac4d5acc7a7ff81dfb6e6abae8482aa",
    oldRaw:
      "export function hookProjectionArguments(depot, commands = depot) {\n  return [\n    \"-B\",\n    \"-c\",\n    `import sys,os,json\nsys.path.insert(0,sys.argv[2])\nimport source_bootstrap\nsource_bootstrap.bind(sys.argv[3],sys.argv[4])\nsys.path.insert(0,sys.argv[1])\nimport gclient\noptions,args=gclient.OptionParser().parse_args(['--jobs','2'])\noptions.nohooks=True\noptions.noprehooks=True\noptions.process_all_deps=True\nclient=gclient.GClient.LoadCurrentConfig(options)\nif client is None: raise RuntimeError('FULL_HOOK_CONFIG')\nif client.RunOnDeps('flatten',args,progress=False)!=0: raise RuntimeError('FULL_HOOK_FLATTEN')\nflat=gclient.Flattener(client,pin_all_deps=True)\nhooks=[]\nfor kind,rows in [('hooks',flat._hooks),('pre_deps_hooks',flat._pre_deps_hooks)]:\n for dep,hook in rows:\n  if len(hooks)>=512: raise RuntimeError('FULL_HOOK_COUNT')\n  hooks.append(dict(kind=kind,name=hook.name,condition=hook.condition,pattern=hook.pattern,cwd=os.path.relpath(hook.effective_cwd).replace('\\\\\\\\','/'),action=hook.action))\norigins=[dict(url=url,deps_file=filename,hierarchy=hierarchy) for url,filename,hierarchy in sorted(flat.deps_files)]\nif len(origins)>1024: raise RuntimeError('FULL_HOOK_ORIGIN_COUNT')\nraw=json.dumps(dict(kind='windows-arm-hook-projection',hooks=hooks,origins=origins),ensure_ascii=True,separators=(',',':')).encode('ascii')\nif len(raw)>4*1024**2: raise RuntimeError('FULL_HOOK_PROJECTION_BOUND')\nprint('FULL_HOOK_PROJECTION:'+raw.decode('ascii'))\n`,\n    depot,\n    commands,\n    \"__SORNG_BOOTSTRAP_WITNESS__\",\n    \"__SORNG_BOOTSTRAP_GUARD__\",\n  ];\n}",
  },
  {
    name: "dependencyHookArguments",
    oldSha256:
      "ab84844c767d94864a9ffd3fcc692ad649a31b5378e7513e55404100d45d433b",
    newSha256:
      "3afe475238dbd354c4b39cfe3d1a0e5a4b9de4a8bf6e4ae36b25b94e4b351d78",
    reviewedSourceSha256:
      "3afe475238dbd354c4b39cfe3d1a0e5a4b9de4a8bf6e4ae36b25b94e4b351d78",
    oldRaw:
      "export function dependencyHookArguments(depot, adapter, pin) {\n  return [\n    \"-B\",\n    \"-c\",\n    `import sys,os,hashlib,threading\ndepot,adapter,digest,expected_bootstrap,expected_guard=sys.argv[1:]\nsys.path.insert(0,os.path.dirname(adapter))\nimport source_bootstrap\nsource_bootstrap.bind(expected_bootstrap,expected_guard)\nsys.path.insert(0,depot)\nimport gclient\noriginal=gclient.Hook.run\ndispatch=gclient.gclient_utils.CheckCallAndFilter\nscope=threading.local()\ndef admitted_dispatch(command,*args,**kwargs):\n if not getattr(scope,'active',False): return dispatch(command,*args,**kwargs)\n if type(command) is not list or not command or len(command)>64 or command[0] not in ('python3','vpython3.bat'): raise RuntimeError('FULL_HOOK_ENTRY')\n for value in command:\n  if type(value) is not str or len(value)>4096 or any(c in value for c in '\\\\x00\\\\r\\\\n%&|<>!^'): raise RuntimeError('FULL_HOOK_SHELL_ARGUMENT')\n if os.path.islink(adapter) or os.path.realpath(adapter).lower()!=os.path.abspath(adapter).lower(): raise RuntimeError('FULL_PYTHON_ADAPTER_ALIAS')\n source=open(adapter,'rb')\n failed=False\n try: raw=source.read(4097)\n except BaseException:\n  failed=True\n  raise\n finally:\n  try: source.close()\n  except BaseException:\n   if failed: print('FULL_PYTHON_ADAPTER_CLOSE_FAILURE',file=sys.stderr)\n   else: raise\n if len(raw)>4096 or hashlib.sha256(raw).hexdigest()!=digest: raise RuntimeError('FULL_PYTHON_ADAPTER_PIN')\n mapped=[adapter if command[0]=='python3' else os.path.join(os.path.dirname(adapter),'vpython3.bat'),*command[1:]]\n return dispatch(mapped,*args,**kwargs)\ndef admitted(self):\n previous=getattr(scope,'active',False)\n scope.active=True\n try: return original(self)\n finally: scope.active=previous\ngclient.Hook.run=admitted\ngclient.gclient_utils.CheckCallAndFilter=admitted_dispatch\nsys.exit(gclient.main(['runhooks','--jobs','2']))\n`,\n    depot,\n    adapter,\n    pin.sha256,\n    \"__SORNG_BOOTSTRAP_WITNESS__\",\n    \"__SORNG_BOOTSTRAP_GUARD__\",\n  ];\n}",
  },
];
function restoreSourceProgramHistory(text) {
  const ast = parse(text, { sourceType: "module", ecmaVersion: "latest" });
  const edits = SOURCE_PROGRAM_HISTORY.map((row) => {
    const node = ast.body.find(
      (item) => (item.declaration ?? item).id?.name === row.name,
    );
    assert(node, row.name);
    assert.equal(
      hash(Buffer.from(text.slice(node.start, node.end))),
      row.newSha256,
      row.name,
    );
    assert.equal(hash(Buffer.from(row.oldRaw)), row.oldSha256, row.name);
    return { start: node.start, end: node.end, raw: row.oldRaw };
  });
  let restored = text;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    restored =
      restored.slice(0, edit.start) + edit.raw + restored.slice(edit.end);
  assert.equal(
    hash(Buffer.from(restored)),
    "bfd0e1dcf590bfbec524fd30b790926ef2a445fbd65846ad8142bcaf1ee4359e",
  );
  return restored;
}

const driverText = await readFile(base + "private-source-driver.mjs", "utf8");
const coordinatorBegin = "// BEGIN INACTIVE SOURCE OWNED COORDINATOR\n";
const coordinatorEnd = "// END INACTIVE SOURCE OWNED COORDINATOR";
assert.equal(driverText.split(coordinatorBegin).length, 2);
assert.equal(driverText.split(coordinatorEnd).length, 2);
const coordinatorBlock =
  coordinatorBegin +
  driverText.split(coordinatorBegin)[1].split(coordinatorEnd)[0] +
  coordinatorEnd;
// Exact historical inverse literals; no ancestor objects or Git process are required.
const HISTORICAL_POST_GN = String.raw`      await held(
        path.join(files.chromium, "out/Release_GN_arm64/build.ninja"),
        16 * 1024 ** 2,
        budget,
      );
      generatedArguments = validateGeneratedArguments(
        await held(
          path.join(files.chromium, "out/Release_GN_arm64/args.gn"),
          1024 ** 2,
          budget,
        ),
      );
      stage = "graph-inventory";
      currentProgress.phase("graph-inventory");
      let snapshot;
      const maximum = Math.min(180000, Math.floor(budget.remaining() - 120000));
      need(maximum > 0, "FULL_SOURCE_RESERVE");
      graph = await checkpoint.graphInventory(
        path.join(files.chromium, "out/Release_GN_arm64"),
        {
          timeoutMs: maximum,
          observePins: (value) => {
            snapshot = checkpoint.graphPinSnapshot(value);
          },
        },
      );
      need(snapshot !== undefined, "FULL_GRAPH_PINS");
      budget.remaining();
      await fs.writeFile(
        path.join(files.logs, "fresh-graph-pins.json"),
        JSON.stringify(snapshot) + "\n",
        { flag: "wx" },
      );
      budget.remaining();`;
const HISTORICAL_HANDOFF = String.raw`async function privateQualificationHandoff({
  root,
  c,
  p,
  budget,
  graph,
  generatedArguments,
  custom,
  gitPolicy,
  env,
  privatePolicyRaw,
  staticToolObservations,
}) {
  need(PRIVATE_DRIVER_ADMITTED, "PRIVATE_EXECUTION_CLOSED");
  const phase = qualificationPhaseClock(budget);
  let failed = false,
    primary;
  const report = {
    kind: "windows-arm-private-qualification",
    success: false,
    sourceGnCompleted: true,
    target: TARGET,
    sourceId: p.sourceGn.sourceId,
    compilerExecuted: false,
    generatedSecurityHeadersVerified: false,
    engineCompilationRequested: false,
    sdkBuilt: false,
    nativeAcceptance: false,
    runtimeReady: false,
    outerJobCleanupNotInferred: true,
    firstFailure: null,
  };
  const timer = setTimeout(
    () => {
      try {
        writeFileSync(
          path.join(root, "private-qualification-deadline.json"),
          JSON.stringify({
            ...report,
            firstFailure: "PRIVATE_PHASE_DEADLINE",
          }) + "\n",
          { flag: "wx" },
        );
      } catch {
        sourceReportingFailure = true;
      }
      // The dedicated creation-assigned Job reaps this exact worker cohort.
      process.exit(124);
    },
    Math.max(1, phase.maximumWorkMs),
  );
  try {
    need(
      graph !== null && generatedArguments !== null,
      "PRIVATE_FRESH_GRAPH_REQUIRED",
    );
    phase.observe();
    // This is the still-live WeakMap token, not a serialized env/report claim.
    await custom.sourceGitEnvironment(gitPolicy, env);
    phase.observe();
    need(
      p.privatePolicy.environmentContractApproved === true,
      "PRIVATE_ENVIRONMENT_UNAVAILABLE",
    );
    staticLoadingProjection(
      {
        ...c,
        root: root.replaceAll("\\", "/"),
        image: p.image,
        host: {
          platform: process.platform,
          architecture: process.arch,
          runner: p.privatePolicy.runner,
        },
        source: {
          target: TARGET,
          sourceId: p.sourceGn.sourceId,
          profileSha256: p.privateSelectedSha256,
          chromium: p.privatePolicy.chromium,
          cef: p.privatePolicy.cef,
        },
      },
      privatePolicyRaw,
      staticToolObservations,
    );
    privateCommandProjections(
      { ...c, root: root.replaceAll("\\", "/") },
      privatePolicyRaw,
      sha(Buffer.from(JSON.stringify(c))),
    );
    phase.observe();
    // Installing this source derivative does not implement the remaining
    // evaluated-GN/action/header/binary validators or the six-command executor.
    // Unknown/incomplete facts can never fall through to a compiler spawn.
    throw new Error("PRIVATE_QUALIFICATION_EXECUTOR_CLOSED");
  } catch (error) {
    failed = true;
    primary = error;
    report.firstFailure = /^(?:PRIVATE|SOURCE_GIT)_[A-Z_]{1,56}$/.test(
      error?.message ?? "",
    )
      ? error.message
      : "PRIVATE_QUALIFICATION_UNAVAILABLE";
    throw primary;
  } finally {
    try {
      phase.observe();
      await fs.writeFile(
        path.join(root, "private-qualification-result.json"),
        JSON.stringify(report, null, 2) + "\n",
        { flag: "wx" },
      );
      phase.observe();
    } catch (error) {
      sourceReportingFailure = true;
      if (!failed) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}`;
const HISTORICAL_SESSION_PHASE = String.raw`  // The eventual source-run issuer must own these exact directories before
  // minting; this first primitive slice does not implement that issuer.
  const began = performance.now();
  const phase = qualificationPhaseClock(source.budget);
`;
const HISTORICAL_PYTHON_METHOD = String.raw`    def test_new_readers_joiners_have_no_entry_or_source_run_issuer(self):
        text = (HERE / 'private-source-driver.mjs').read_text(encoding='utf-8')
        self.assertEqual(text.count('qualificationSourceRuns.set('), 0)
        self.assertIn('export const PRIVATE_DRIVER_ADMITTED = false;', text)
        self.assertIn('throw new Error("PRIVATE_QUALIFICATION_EXECUTOR_CLOSED")', text)
        for name in ('createQualificationSession', 'issueActualObservation', 'runFixedJoined'):
            self.assertNotIn('export function ' + name, text)
            self.assertNotIn('export async function ' + name, text)
        # Expected BUILD bytes are from the separately audited patched tree.
        self.assertIn('2999ed43e4bddb47d841c6b0587cfdacf9a9b331a06384f27ef896a0ef24fae0', text)
        self.assertIn('e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15', text)
`;
const historyFunctions = [
  "privateSourceBody",
  "privateQualificationHandoff",
  "qualificationPoison",
  "createQualificationSession",
  "runFixedJoined",
  "qualificationCloseLogs",
];
function restoreCoordinatorHistory() {
  let restored = restoreSourceProgramHistory(driverText).replace(
    coordinatorBlock + "\n\n",
    "",
  );
  const current = parse(restored, {
    sourceType: "module",
    ecmaVersion: "latest",
  });
  const node = (name) =>
    current.body.find((item) => (item.declaration ?? item).id?.name === name);
  const once = (text, expected, previous) => {
    assert.equal(
      text.split(expected).length,
      2,
      "exact historical inverse occurs once",
    );
    return text.replace(expected, previous);
  };
  const inverse = (name, text) => {
    if (name === "privateQualificationHandoff") return HISTORICAL_HANDOFF;
    if (name === "privateSourceBody") {
      text = once(text, "  let qualificationOwner;\n", "");
      const begin = text.indexOf(
        "      qualificationOwner = beginQualificationSource({",
      );
      const end = text.indexOf(
        "\n    });\n    const qualificationSource = commitQualificationGraph(qualificationOwner);",
        begin,
      );
      assert(begin > 0 && end > begin);
      text = text.slice(0, begin) + HISTORICAL_POST_GN + text.slice(end);
      for (const line of [
        "    const qualificationSource = commitQualificationGraph(qualificationOwner);\n",
        "      qualificationSource,\n",
        "    retireQualificationSource(qualificationOwner, true, error);\n",
        "    retireQualificationSource(qualificationOwner);\n",
      ])
        text = once(text, line, "");
      return text;
    }
    if (name === "qualificationPoison")
      return once(
        text,
        "  if (state.source.owner)\n    retireQualificationSource(state.source.owner, true, state.primary);\n",
        "",
      );
    if (name === "createQualificationSession") {
      text = once(
        text,
        '  const phase = source.phase;\n  need(phase && Number.isFinite(source.end), "PRIVATE_SOURCE_PHASE");\n',
        HISTORICAL_SESSION_PHASE,
      );
      text = once(
        text,
        "  const state = {\n    token,\n",
        "  const state = {\n",
      );
      text = once(
        text,
        "    end: source.end,",
        "    end: began + phase.maximumWorkMs,",
      );
      return once(text, "  source.sessions?.add(state);\n", "");
    }
    if (name === "runFixedJoined")
      return once(
        text,
        "qualificationCoordinatorSources.has(state.sourceToken)",
        "state.source.coordinatorVerified === true",
      );
    assert.equal(name, "qualificationCloseLogs");
    return once(
      text,
      "primary = qualificationPoison(state, error);",
      "primary = error;",
    );
  };
  const changes = historyFunctions.map((name) => ({ next: node(name), name }));
  for (const { next, name } of changes.sort(
    (a, b) => b.next.start - a.next.start,
  )) {
    assert(next, name);
    restored =
      restored.slice(0, next.start) +
      inverse(name, restored.slice(next.start, next.end)) +
      restored.slice(next.end);
  }
  restored = once(
    restored,
    "// Only the private source-owned issuer below populates this map. The actual\n// source entry and every workload admission remain closed.\n",
    "// No production writer populates this map. JSON projections, model-test maps,\n// and source reports cannot construct a source-run capability. These helpers\n// are deliberately not connected to the still-denied private entry/handoff.\n",
  );
  assert.equal(
    hash(restored),
    "f83d3cf3c9d6f7808d3229e93a0a599e3ea2d5eeba55d468d22a31946465601a",
    "complete historical8e bytes, independent of shallow Git history",
  );
  return restored;
}
const historicalDriverText = restoreCoordinatorHistory();
const pureStart = driverText.indexOf(
  "// BEGIN INACTIVE PURE QUALIFICATION INSPECTORS\n",
);
const pureEndMarker = "// END INACTIVE PURE QUALIFICATION INSPECTORS";
const pureEnd =
  driverText.indexOf(pureEndMarker, pureStart) + pureEndMarker.length;
assert(pureStart > 0 && pureEnd > pureStart);
const pureVerifierBlock = driverText.slice(pureStart, pureEnd);
const joinedStart = driverText.indexOf(
  "// BEGIN INACTIVE JOINED OBSERVATION PRIMITIVES\n",
);
const joinedEndMarker = "// END INACTIVE JOINED OBSERVATION PRIMITIVES";
const joinedEnd =
  driverText.indexOf(joinedEndMarker, joinedStart) + joinedEndMarker.length;
assert(joinedStart > 0 && joinedEnd > joinedStart);
const joinedPrimitiveBlock = driverText.slice(joinedStart, joinedEnd);
const driverAst = parse(driverText, {
  sourceType: "module",
  ecmaVersion: "latest",
});
const functionNode = (ast, name) =>
  ast.body.find((node) => (node.declaration ?? node).id?.name === name);
const functionText = (name) => {
  const node = functionNode(driverAst, name);
  assert(node, name);
  return driverText.slice(node.start, node.end);
};

const pureApi = (() => {
  const rootNode = driverAst.body.find(
    (node) =>
      node.type === "VariableDeclaration" &&
      node.declarations.some((row) => row.id.name === "PRIVATE_ROOT"),
  );
  const factory = new Function(
    "Buffer",
    "sha",
    "need",
    "PRIVATE_MODE",
    "PRIVATE_REF",
    "PRIVATE_WORKFLOW",
    "PRIVATE_ROLES",
    "PRIVATE_PROFILE_SHA256",
    driverText.slice(rootNode.start, rootNode.end) +
      "\n" +
      functionText("staticProjectionEqual") +
      "\n" +
      functionText("requirePrivateScope").replace(/^export /, "") +
      "\n" +
      pureVerifierBlock +
      "\nreturn {qualificationBoundedJson,qualificationInspectEvaluatedArgs,qualificationInspectAction,qualificationParseLiteralArgs,qualificationInspectCefHeader,qualificationInspectCoff,qualificationInspectProbePe,qualificationInspectOutputs};",
  );
  return factory(
    Buffer,
    hash,
    (value, code) => {
      if (!value) throw Error(code);
    },
    policy.mode,
    policy.ref,
    policy.workflow,
    policy.qualificationRoles,
    hash(rawPolicy),
  );
})();
const candidatePolicyRaw = await readFile(
  base + "engine-qualification-profile.json",
);
const encodePure = (value) =>
  Buffer.isBuffer(value)
    ? { __qualification_bytes: value.toString("base64") }
    : Array.isArray(value)
      ? value.map(encodePure)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, encodePure(item)]),
          )
        : value;
const decodePure = (value) =>
  value !== null &&
  typeof value === "object" &&
  Object.keys(value).length === 1 &&
  Object.hasOwn(value, "__qualification_bytes")
    ? Buffer.from(value.__qualification_bytes, "base64")
    : Array.isArray(value)
      ? value.map(decodePure)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, decodePure(item)]),
          )
        : value;
function purePython(request) {
  const script = String.raw`import sys,json,base64
sys.path.insert(0,${JSON.stringify(path.resolve(base))})
import test_private_qualification as t, private_qualification as p, engine_qualification as e
def encode(value):
 if type(value)is bytes:return {'__qualification_bytes':base64.b64encode(value).decode()}
 if type(value)is dict:return {key:encode(item)for key,item in value.items()}
 if type(value)is list or type(value)is tuple:return [encode(item)for item in value]
 return value
def decode(value):
 if type(value)is dict and set(value)=={'__qualification_bytes'}:return base64.b64decode(value['__qualification_bytes'],validate=True)
 if type(value)is dict:return {key:decode(item)for key,item in value.items()}
 if type(value)is list:return [decode(item)for item in value]
 return value
raw=sys.stdin.buffer.read(16*1024**2+1);assert len(raw)<=16*1024**2
request=decode(json.loads(raw))
if request['operation']=='fixtures':
 print(json.dumps(encode({image:{'context':value,'observed':observed}for image in t.POLICY['images']for value,observed in [t.output_fixture(image)]})))
else:
 def no_io(*args,**kwargs):raise AssertionError('PURE_READER_MUST_NOT_READ_PROFILE')
 e.load_profile=no_io
 results=[]
 for case in request['cases']:
  try:
   op=case['op'];raw_policy=case.get('rawPolicy',t.RAW);base_policy=case.get('basePolicy',t.BASE_RAW)
   if op=='full':value=p.inspect_private_outputs(case['context'],raw_policy,base_policy,case['observed'],wall_now=case.get('wallNow',200),monotonic_now=case.get('monotonicNow',200))
   elif op=='action':value=p.inspect_action_desc(case['raw'],case['role'],raw_policy,base_policy)
   elif op=='evaluated':value=p.inspect_evaluated_args(case['raw'])
   elif op=='literal':value=e.inspect_args(case['raw'])
   elif op=='cef':value=e.inspect_cef_config_header(case['raw'])
   elif op=='coff':value=e.inspect_coff(case['raw'])
   elif op=='pe':value=e.inspect_pe(case['raw'])
   elif op=='json':value=p.bounded_json(case['raw'])
   else:raise AssertionError('CLOSED_PURE_TEST_OP')
   results.append({'ok':True,'value':encode(value)})
  except (p.Denied,e.QualificationError)as error:results.append({'ok':False,'error':str(error)})
 print(json.dumps(results))
`;
  const result = spawnSync("python", ["-I", "-B", "-c", script], {
    input: JSON.stringify(encodePure(request)),
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 16 * 1024 ** 2,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return decodePure(JSON.parse(result.stdout));
}
const pureFixtures = purePython({ operation: "fixtures" });
const freshPure = (image = "20261030.294.1") =>
  decodePure(encodePure(pureFixtures[image]));
const pureRaw = (value) => Buffer.from(JSON.stringify(value));
const setPureFile = (packet, role, raw) => {
  const row = packet.observed.files[role];
  row.raw = raw;
  row.pin = { path: row.pin.path, bytes: raw.length, sha256: hash(raw) };
};
function nodePure(case_) {
  try {
    const rp = case_.rawPolicy ?? rawPolicy,
      bp = case_.basePolicy ?? candidatePolicyRaw;
    let value;
    if (case_.op === "full")
      value = pureApi.qualificationInspectOutputs(
        case_.context,
        rp,
        bp,
        case_.observed,
        Object.hasOwn(case_, "wallNow") ? case_.wallNow : 200,
        Object.hasOwn(case_, "monotonicNow") ? case_.monotonicNow : 200,
      );
    else if (case_.op === "action")
      value = pureApi.qualificationInspectAction(case_.raw, case_.role, rp, bp);
    else if (case_.op === "evaluated")
      value = pureApi.qualificationInspectEvaluatedArgs(case_.raw);
    else if (case_.op === "literal")
      value = pureApi.qualificationParseLiteralArgs(case_.raw).projection;
    else if (case_.op === "cef")
      value = pureApi.qualificationInspectCefHeader(case_.raw);
    else if (case_.op === "coff")
      value = pureApi.qualificationInspectCoff(case_.raw);
    else if (case_.op === "pe")
      value = pureApi.qualificationInspectProbePe(case_.raw);
    else if (case_.op === "json")
      value = pureApi.qualificationBoundedJson(case_.raw);
    else assert.fail("closed Node pure test operation");
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
const pureDifferentialStats = { groups: 0, cases: 0, accepted: 0, denied: 0 };
function comparePure(cases) {
  const reference = purePython({ operation: "cases", cases });
  assert.equal(reference.length, cases.length);
  for (const [index, case_] of cases.entries())
    assert.deepEqual(
      nodePure(case_),
      reference[index],
      case_.id ?? case_.op + ":" + index,
    );
  pureDifferentialStats.groups++;
  pureDifferentialStats.cases += cases.length;
  pureDifferentialStats.accepted += reference.filter((row) => row.ok).length;
  pureDifferentialStats.denied += reference.filter((row) => !row.ok).length;
  return reference;
}

test("new pure inspector block restores exact995 driver and creates no process or receipt authority", () => {
  assert.equal(
    hash(pureVerifierBlock),
    "ccfffb973a7c008feda1933c6e620d57778eb1bc8b440d3e92ac2d29596f43e8",
  );
  assert.equal(
    hash(historicalDriverText.replace(pureVerifierBlock + "\n\n", "")),
    "2a2957e415479d3584666d6de690895008e799be750320fcbe5b689a2ef561c8",
  );
  const ast = parse(pureVerifierBlock, {
    sourceType: "module",
    ecmaVersion: "latest",
  });
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    assert(!node.type?.startsWith("Export"));
    if (node.type === "CallExpression")
      assert(
        ![
          "spawn",
          "execFile",
          "executeCommand",
          "held",
          "physical",
          "open",
          "require",
          "runFixedJoined",
          "createQualificationSession",
        ].includes(node.callee?.name),
      );
    if (node.type === "Identifier")
      assert(
        ![
          "qualificationSourceRuns",
          "qualificationSessions",
          "qualificationObservations",
          "fs",
          "process",
        ].includes(node.name),
      );
    for (const child of Object.values(node))
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === "object") walk(child);
  };
  walk(ast);
  assert.equal(
    (driverText.match(/qualificationSourceRuns\.set\(/g) ?? []).length,
    1,
  );
  assert.equal(PRIVATE_DRIVER_ADMITTED, false);
});

test("in-process full output projections match actual Python fixtures for both images without inventing ARM defaults", () => {
  const cases = Object.keys(pureFixtures).map((image) => ({
    op: "full",
    id: image,
    ...freshPure(image),
  }));
  const changed = freshPure();
  const top = JSON.parse(changed.observed.gnDescPartitionAlloc),
    action = Object.values(top)[0];
  action.response_file_contents[1] = "ENABLE_USER_SPACE_ZERO_SEGMENT=true";
  changed.observed.gnDescPartitionAlloc = pureRaw(top);
  setPureFile(
    changed,
    "partitionAlloc",
    Buffer.from(
      changed.observed.files.partitionAlloc.raw
        .toString()
        .replace(
          "ENABLE_USER_SPACE_ZERO_SEGMENT() (0)",
          "ENABLE_USER_SPACE_ZERO_SEGMENT() (1)",
        ),
    ),
  );
  cases.push({
    op: "full",
    id: "unconstrained observed flag may differ from synthetic defaults",
    ...changed,
  });
  const results = comparePure(cases);
  for (const result of results) {
    assert(result.ok);
    assert.equal(Object.keys(result.value.partitionAllocMacros).length, 61);
    assert.equal(result.value.completeMacroInventoryMatches, true);
    for (const key of [
      "fullArm64DefaultsQualified",
      "processProvenanceVerified",
      "liveJobCapability",
      "generatedSecurityHeadersVerified",
      "executionAdmitted",
      "outputsExecuted",
      "sdkBuilt",
      "nativeAcceptance",
    ])
      assert.equal(result.value[key], false, key);
  }
});

test("duplicate-aware bounded GN JSON port matches Python and never changes object prototypes", () => {
  const rawCases = [
    '{"same":1,"same":2}',
    '{"nested":{"same":1,"same":2}}',
    Buffer.from([255]),
    Buffer.from([239, 187, 191, 91, 93]),
    "[NaN]",
    "[Infinity]",
    "[-Infinity]",
    "[".repeat(33) + "]".repeat(33),
    "[]\0",
    "[1,]",
    '{"x":}',
    '{"__proto__":{"polluted":true},"constructor":null}',
    '{"text":"braces [ \\" quote ","x":[true,false,null,0,-1,1.5]}',
    "[]",
    " ".repeat(4 * 1024 ** 2 + 1),
  ];
  comparePure(
    rawCases.map((value, index) => ({
      op: "json",
      id: "json:" + index,
      raw: Buffer.isBuffer(value) ? value : Buffer.from(value),
    })),
  );
  assert.equal({}.polluted, undefined);
});

test("GN evaluated/current values, critical CPUs and exact action schema reject the same substitutions as Python", () => {
  const cases = [],
    base = freshPure();
  const addRows = (id, change) => {
    const rows = JSON.parse(base.observed.gnArgs);
    change(rows);
    cases.push({ op: "evaluated", id, raw: pureRaw(rows) });
  };
  addRows("current false cannot fall back to default true", (rows) => {
    rows[0].current = { value: "false" };
  });
  addRows("current true legitimately overrides default false", (rows) => {
    rows[0].default.value = "false";
    rows[0].current = { value: "true" };
  });
  addRows("built-in CPU current", (rows) => {
    const row = rows.find((r) => r.name === "target_cpu");
    row.default.value = '""';
    row.current = { value: '"arm64"' };
  });
  addRows("CPU missing", (rows) => {
    rows.pop();
  });
  addRows("duplicate declaration", (rows) => rows.push(rows[0]));
  addRows("typed bool is not GN text", (rows) => {
    rows[0].default.value = true;
  });
  addRows("long schema rejected", (rows) => {
    rows[0].default.file = "//other";
  });
  addRows("expression not critical true", (rows) => {
    rows[0].default.value = "true || false";
  });
  addRows("unrelated Unicode value remains string", (rows) => {
    rows.push({ name: "other", default: { value: "😀".repeat(32769) } });
  });
  for (const role of ["partitionAlloc", "cefConfig"])
    for (const [field, bad] of [
      ["toolchain", "//build/toolchain/win:win_clang_x64"],
      ["type", "action_foreach"],
      ["script", "//other.py"],
      ["args", ["--run"]],
      ["outputs", ["//out/Release_GN_arm64/../else.h"]],
      ["deps", []],
      ["testonly", true],
      ["metadata", { hook: ["other"] }],
      ["sources", []],
      ["visibility", ["bad\nvisibility"]],
    ]) {
      const top = JSON.parse(
        role === "partitionAlloc"
          ? base.observed.gnDescPartitionAlloc
          : base.observed.gnDescCef,
      );
      Object.values(top)[0][field] = bad;
      cases.push({
        op: "action",
        role,
        id: role + ":" + field,
        raw: pureRaw(top),
      });
    }
  for (const change of [
    "missing",
    "extra",
    "order",
    "boolean-as-one",
    "negative",
    "overflow",
  ]) {
    const top = JSON.parse(base.observed.gnDescPartitionAlloc),
      flags = Object.values(top)[0].response_file_contents;
    if (change === "missing") flags.pop();
    else if (change === "extra") flags.push("UNKNOWN=true");
    else if (change === "order") [flags[1], flags[2]] = [flags[2], flags[1]];
    else if (change === "boolean-as-one")
      flags[1] = "ENABLE_USER_SPACE_ZERO_SEGMENT=1";
    else
      flags[2] =
        "USER_SPACE_ZERO_SEGMENT_SIZE_MB=" +
        (change === "negative" ? "-1" : "2147483648");
    cases.push({
      op: "action",
      role: "partitionAlloc",
      id: change,
      raw: pureRaw(top),
    });
  }
  comparePure(cases);
});

test("flat literal GN/header text ports reject overrides, interpolation, unknown macros and policy failures like Python", () => {
  const cases = [],
    fixture = freshPure(),
    args = fixture.observed.files.args.raw;
  for (const suffix of [
    'target_cpu += "x64"',
    'if (true) { target_cpu = "x64" }',
    'import("//other.gni")',
    "sandbox_other=false",
    'name="${target_cpu}"',
    "unknown = 00",
    "# ordinary comment",
    'extra="Unicode 😀"',
    'extra="escaped \\" quote"',
  ])
    cases.push({
      op: "literal",
      id: suffix,
      raw: Buffer.concat([args, Buffer.from(suffix + "\n")]),
    });
  cases.push({
    op: "literal",
    id: "BOM is not whitespace",
    raw: Buffer.concat([Buffer.from([239, 187, 191]), args]),
  });
  cases.push({
    op: "literal",
    id: "Python whitespace",
    raw: Buffer.from(
      args.toString().replace('target_cpu="arm64"', '\u0085target_cpu="arm64"'),
    ),
  });
  cases.push({
    op: "literal",
    id: "Python non-ASCII whitespace around assignment",
    raw: Buffer.from(
      args
        .toString()
        .replace("is_clang=true", "is_clang\u200a=\u00a0true\u001f"),
    ),
  });
  for (const raw of [
    Buffer.from("/* unclosed"),
    Buffer.from("/* bad */ */"),
    Buffer.from("\\\n"),
    Buffer.from([255]),
    Buffer.from(
      fixture.observed.files.cefConfig.raw
        .toString()
        .replace("SANDBOX 1", "SANDBOX 0"),
    ),
    Buffer.from(
      fixture.observed.files.cefConfig.raw.toString().replaceAll("\n", "\r\n"),
    ),
  ])
    cases.push({ op: "cef", raw });
  for (const change of [
    "unknown",
    "duplicate",
    "order",
    "mismatch",
    "minimum",
    "extra-include",
  ]) {
    const packet = freshPure(),
      original = packet.observed.files.partitionAlloc.raw.toString();
    let text = original;
    if (change === "unknown")
      text = text.replace("ENABLE_USER_SPACE_ZERO_SEGMENT", "UNKNOWN_MACRO");
    if (change === "duplicate")
      text = text.replace(
        "#endif",
        "#define PA_BUILDFLAG_INTERNAL_CHECKED_SPAN() (0)\n#endif",
      );
    if (change === "order") {
      const lines = text.split("\n");
      [lines[4], lines[5]] = [lines[5], lines[4]];
      text = lines.join("\n");
    }
    if (change === "mismatch")
      text = text.replace(
        "ENABLE_USER_SPACE_ZERO_SEGMENT() (0)",
        "ENABLE_USER_SPACE_ZERO_SEGMENT() (1)",
      );
    if (change === "extra-include") text += '#include "extra.h"\n';
    if (change === "minimum") {
      text = text.replace(
        "USE_RAW_PTR_BACKUP_REF_IMPL() (1)",
        "USE_RAW_PTR_BACKUP_REF_IMPL() (0)",
      );
      const top = JSON.parse(packet.observed.gnDescPartitionAlloc),
        flags = Object.values(top)[0].response_file_contents;
      flags[
        flags.findIndex((row) => row.startsWith("USE_RAW_PTR_BACKUP_REF_IMPL="))
      ] = "USE_RAW_PTR_BACKUP_REF_IMPL=false";
      packet.observed.gnDescPartitionAlloc = pureRaw(top);
    }
    setPureFile(packet, "partitionAlloc", Buffer.from(text));
    cases.push({ op: "full", id: change, ...packet });
  }
  const mismatch = freshPure();
  const changedArgs = Buffer.concat([
    mismatch.observed.files.args.raw,
    Buffer.from("extra=27\n"),
  ]);
  setPureFile(mismatch, "args", changedArgs);
  mismatch.context.bindings.args = mismatch.observed.files.args.pin;
  const evaluated = JSON.parse(mismatch.observed.gnArgs);
  evaluated.push({ name: "extra", default: { value: "28" } });
  mismatch.observed.gnArgs = pureRaw(evaluated);
  cases.push({ op: "full", id: "literal/evaluated mismatch", ...mismatch });
  comparePure(cases);
});

test("ARM64 COFF and no-CRT PE ports match Python on bounds, targets, section/symbol overflow and import ambiguities", () => {
  const fixture = freshPure(),
    cases = [];
  for (const op of ["coff", "pe"]) {
    const raw = fixture.observed.files[op].raw;
    cases.push({ op, id: op + ":valid", raw });
    for (const size of [0, 19, 30, Math.max(1, raw.length - 1)])
      cases.push({
        op,
        id: op + ":truncate" + size,
        raw: raw.subarray(0, size),
      });
    cases.push({
      op,
      id: op + ":oversize",
      raw: Buffer.alloc(8 * 1024 ** 2 + 1),
    });
  }
  for (const [id, offset, value, width] of [
    ["target", 0, 0x8664, 2],
    ["optional", 16, 240, 2],
    ["sections", 2, 97, 2],
    ["raw-offset", 40, 0xffffffff, 4],
    ["symbols", 12, 100001, 4],
    ["symbols-at", 8, 0xffffffff, 4],
  ]) {
    const raw = Buffer.from(fixture.observed.files.coff.raw);
    width === 2
      ? raw.writeUInt16LE(value, offset)
      : raw.writeUInt32LE(value, offset);
    cases.push({ op: "coff", id, raw });
  }
  for (const [id, offset, value, width] of [
    ["target", 132, 0x8664, 2],
    ["PE32", 152, 0x10b, 2],
    ["DLL", 150, 0x2002, 2],
    ["bad-offset", 60, 0xffffffff, 4],
    ["import", 272, 0x1000, 4],
    ["IAT", 360, 0x1000, 4],
    ["delay", 368, 0x1000, 4],
    ["CLR", 376, 0x1000, 4],
    ["entry", 168, 0xffffffff, 4],
    ["section", 412, 0xffffffff, 4],
  ]) {
    const raw = Buffer.from(fixture.observed.files.pe.raw);
    width === 2
      ? raw.writeUInt16LE(value, offset)
      : raw.writeUInt32LE(value, offset);
    cases.push({ op: "pe", id, raw });
  }
  // Keep each bounded differential packet below the test harness's 16MiB cap.
  for (const case_ of cases.filter((row) => row.id.endsWith(":oversize")))
    comparePure([case_]);
  comparePure(cases.filter((row) => !row.id.endsWith(":oversize")));
});

test("full private context, policies, all paths and file pins are checked before candidate output acceptance", (t) => {
  const cases = [];
  for (const [id, change] of [
    [
      "source",
      (p) => {
        p.context.source.sourceId = "b".repeat(64);
      },
    ],
    [
      "image",
      (p) => {
        p.context.image = "20261101.000.1";
      },
    ],
    [
      "mode",
      (p) => {
        p.context.mode = "source-gn";
      },
    ],
    [
      "root-alias",
      (p) => {
        p.context.root += "/..";
      },
    ],
    [
      "graph",
      (p) => {
        p.context.bindings.graph.path += "/alias";
      },
    ],
    [
      "tool",
      (p) => {
        p.context.bindings.tools.clang.sha256 = "b".repeat(64);
      },
    ],
    [
      "source-encoding",
      (p) => {
        p.context.sources[1].encoding = "git-crlf";
      },
    ],
    [
      "source-digest",
      (p) => {
        p.context.sourceDigest = "b".repeat(64);
      },
    ],
    [
      "ambient-env-not-input",
      (p) => {
        p.context.environment = { CL: "/unsafe" };
      },
    ],
    [
      "unknown-output-env",
      (p) => {
        p.observed.environment = { PATH: "C:/other" };
      },
    ],
    [
      "expired",
      (p) => {
        p.context.wallWorkEnd = 349;
      },
    ],
    [
      "typed-bool",
      (p) => {
        p.context.bindings.graphInventory.files = true;
      },
    ],
  ]) {
    const packet = freshPure();
    change(packet);
    cases.push({ op: "full", id, ...packet });
  }
  for (const role of ["args", "partitionAlloc", "cefConfig", "coff", "pe"])
    for (const [field, bad] of [
      ["path", ROOT + "/alias"],
      ["bytes", true],
      ["sha256", "b".repeat(64)],
    ]) {
      const packet = freshPure();
      packet.observed.files[role].pin[field] = bad;
      cases.push({ op: "full", id: role + ":" + field, ...packet });
    }
  const changed = freshPure();
  setPureFile(
    changed,
    "args",
    Buffer.concat([changed.observed.files.args.raw, Buffer.from("\n")]),
  );
  cases.push({ op: "full", id: "args readback replaced", ...changed });
  cases.push({
    op: "full",
    id: "private-policy",
    ...freshPure(),
    rawPolicy: Buffer.concat([rawPolicy, Buffer.from(" ")]),
  });
  cases.push({
    op: "full",
    id: "inert-policy",
    ...freshPure(),
    basePolicy: Buffer.concat([candidatePolicyRaw, Buffer.from(" ")]),
  });
  cases.push({
    op: "full",
    id: "null is not a missing clock",
    ...freshPure(),
    wallNow: null,
  });
  cases.push({
    op: "full",
    id: "boolean clock cannot select a default",
    ...freshPure(),
    monotonicNow: false,
  });
  comparePure(cases);
  t.diagnostic(
    JSON.stringify({
      kind: "actual-python-node-pure-differential",
      ...pureDifferentialStats,
      processAuthority: false,
      nativeDefaultsQualified: false,
    }),
  );
});

// This VM holds separate source/session/observation maps. It cannot mint a
// production receipt, invoke a workload tool, or bypass the module's gate.
function primitiveModel(overrides = {}) {
  const heldImport =
    'import { fstatSync as qualificationFdStat } from "node:fs";\n';
  assert.equal(joinedPrimitiveBlock.split(heldImport).length, 2);
  const joinedVmBlock = joinedPrimitiveBlock.replace(heldImport, "");
  const signatureNode = driverAst.body.find(
    (node) =>
      node.type === "VariableDeclaration" &&
      node.declarations.some((item) => item.id.name === "signature"),
  );
  const signatureText = driverText.slice(
    signatureNode.start,
    signatureNode.end,
  );
  return vm.runInNewContext(
    signatureText +
      "\n" +
      functionText("physical") +
      "\n" +
      joinedVmBlock +
      `
      ({ createQualificationSession, issueActualObservation, qualificationHeld,
         qualificationStaticPe, qualificationNoAdjacentDlls, runFixedJoined,
         qualificationSourceRuns, qualificationSessions, qualificationObservations,
         qualificationCoordinatorSources })`,
    {
      fs,
      constants: syncFs.constants,
      path,
      Buffer,
      createHash,
      performance,
      setTimeout,
      clearTimeout,
      REPO: process.cwd(),
      PRIVATE_PROFILE_SHA256: hash(rawPolicy),
      PRIVATE_ROLES: policy.qualificationRoles,
      qualificationPhaseClock,
      qualificationCoordinatorSources: new WeakSet(),
      privateCommandProjections,
      staticProjectionEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      sha: hash,
      need: (value, code) => {
        if (!value) throw new Error(code);
      },
      spawn: () => {
        throw new Error("NO_REAL_PROCESS");
      },
      openSync: syncFs.openSync,
      writeSync: syncFs.writeSync,
      closeSync: syncFs.closeSync,
      qualificationFdStat: syncFs.fstatSync,
      ...overrides,
    },
  );
}

async function primitiveFixture(t, overrides = {}, sourceOverrides = {}) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sorng-private-joined-")),
  );
  const logs = path.join(root, "private-qualification-logs");
  await fs.mkdir(logs);
  t.after(async () => {
    assert.equal(await fs.realpath(root), root);
    await fs.rm(root, { recursive: true });
  });
  let notifySpawn;
  const spawned = new Promise((resolve) => {
    notifySpawn = resolve;
  });
  const requestedSpawn = overrides.spawn;
  const model = primitiveModel({
    ...overrides,
    ...(requestedSpawn
      ? {
          spawn: (...args) => {
            const child = requestedSpawn(...args);
            notifySpawn(child);
            return child;
          },
        }
      : {}),
  });
  const signal = new AbortController();
  const sourceToken = Object.freeze({ modelOnly: true });
  const stamp = (s) =>
    [
      s.dev,
      s.ino,
      s.size,
      s.mtimeNs,
      s.ctimeNs,
      s.birthtimeNs,
      s.mode,
      s.nlink,
    ].join(":");
  const source = {
    root,
    budget: { remaining: () => 600000 },
    signal: signal.signal,
    context: scope(),
    contextSha: "a".repeat(64),
    privatePolicyRaw: Buffer.from(rawPolicy),
    logsIdentity: stamp(await fs.lstat(logs, { bigint: true })),
    coordinatorVerified: true,
    output: { bytes: 0 },
    environment: { TEST_ONLY: "closed" },
    custom: { sourceGitEnvironment: async (_policy, env) => ({ ...env }) },
    gitPolicy: Object.freeze({ modelOnly: true }),
    validateBefore: async () => {},
    validateAfter: async () => {},
    ...sourceOverrides,
  };
  source.phase = qualificationPhaseClock(source.budget);
  source.end = performance.now() + source.phase.maximumWorkMs;
  model.qualificationSourceRuns.set(sourceToken, source);
  model.qualificationCoordinatorSources.add(sourceToken);
  const session = model.createQualificationSession(sourceToken);
  const state = model.qualificationSessions.get(session);
  const receipt = Object.freeze({ modelOnly: true });
  model.qualificationObservations.set(receipt, {
    session,
    state,
    role: policy.qualificationRoles[0],
    epoch: state.epoch,
  });
  return { root, model, source, state, session, receipt, signal, spawned };
}

function modelChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kills = [];
  child.unrefs = 0;
  child.kill = (signal) => {
    child.kills.push(signal);
    return true;
  };
  child.unref = () => {
    child.unrefs++;
  };
  child.complete = (code = 0) => {
    child.emit("exit", code, null);
    child.stdout.destroy();
    child.stderr.destroy();
    child.stdin.destroy();
    setImmediate(() => child.emit("close", code, null));
  };
  return child;
}

test("inactive joined block is private, non-authorizing and restores exact 7ee driver bytes", () => {
  const joinedPrimitiveBlock = historicalDriverText.slice(
    historicalDriverText.indexOf(
      "// BEGIN INACTIVE JOINED OBSERVATION PRIMITIVES\n",
    ),
    historicalDriverText.indexOf(joinedEndMarker) + joinedEndMarker.length,
  );
  const withoutPureDriver = historicalDriverText.replace(
    pureVerifierBlock + "\n\n",
    "",
  );
  assert.equal(
    hash(joinedPrimitiveBlock),
    "1d7aae9e52636742a0c7af0d722a3c09c8ed61b63629f13e7e2018069ffc5902",
  );
  assert.equal(
    hash(withoutPureDriver.replace(joinedPrimitiveBlock + "\n\n", "")),
    "e74804c90200aaf58429f629459f63c78d4de4f8bd77a704e8c51eaa2fb772f6",
  );
  assert.equal(
    (driverText.match(/qualificationSourceRuns\.set\(/g) ?? []).length,
    1,
  );
  assert.equal(PRIVATE_DRIVER_ADMITTED, false);
  for (const name of [
    "createQualificationSession",
    "runFixedJoined",
    "issueActualObservation",
  ])
    assert(
      !driverAst.body.some(
        (node) =>
          node.type.startsWith("Export") && node.declaration?.id?.name === name,
      ),
    );
  assert.throws(
    () => primitiveModel().createQualificationSession({}),
    /PRIVATE_SOURCE_RUN/,
  );
});

test("actual held reads stream the complete byte pin, inspect same FD and reject mutation or aliases", async (t) => {
  const f = await primitiveFixture(t);
  const raw = Buffer.alloc(200000, 7),
    file = path.join(f.root, "owned.bin");
  await fs.writeFile(file, raw, { flag: "wx" });
  const pin = { bytes: raw.length, sha256: hash(raw) };
  const observed = await f.model.qualificationHeld(
    file,
    pin,
    f.state,
    async (read) => {
      assert.deepEqual(await read(100, 5), raw.subarray(100, 105));
      return { sameFdRange: true };
    },
  );
  assert.equal(observed.sha256, pin.sha256);
  assert.equal(observed.projection.sameFdRange, true);
  await assert.rejects(
    f.model.qualificationHeld(file, pin, f.state, async () => {
      await fs.writeFile(file, raw); // Same bytes, changed timestamps still deny.
    }),
    /PRIVATE_READ_CHANGED/,
  );
  assert.equal(f.state.failed, true);
  const other = await primitiveFixture(t);
  const alias = path.join(other.root, "alias.bin");
  await fs.link(file, alias);
  await assert.rejects(
    other.model.qualificationHeld(alias, pin, other.state),
    /PRIVATE_READ_FILE/,
  );
});

test("held read closes actual owned FD on short read and preserves falsy close failures", async (t) => {
  let closes = 0;
  const realOpen = fs.open.bind(fs);
  const mockFs = {
    ...fs,
    open: async (...args) => {
      const fd = await realOpen(...args);
      return {
        stat: fd.stat.bind(fd),
        read: async () => ({ bytesRead: 0 }),
        close: async () => {
          closes++;
          await fd.close();
        },
      };
    },
  };
  const f = await primitiveFixture(t, { fs: mockFs });
  const file = path.join(f.root, "short.bin"),
    raw = Buffer.from("private fixture");
  await fs.writeFile(file, raw);
  await assert.rejects(
    f.model.qualificationHeld(
      file,
      { bytes: raw.length, sha256: hash(raw) },
      f.state,
    ),
    /PRIVATE_READ_SHORT/,
  );
  assert.equal(closes, 1);
  for (const reason of [0, false, null, undefined, ""]) {
    const g = await primitiveFixture(t, {
      fs: {
        ...fs,
        open: async (...args) => {
          const fd = await realOpen(...args);
          return {
            stat: fd.stat.bind(fd),
            read: fd.read.bind(fd),
            close: async () => {
              await fd.close();
              throw reason;
            },
          };
        },
      },
    });
    const owned = path.join(g.root, "close.bin");
    await fs.writeFile(owned, raw);
    let rejected = false;
    try {
      await g.model.qualificationHeld(
        owned,
        { bytes: raw.length, sha256: hash(raw) },
        g.state,
      );
    } catch (error) {
      rejected = true;
      assert.equal(error, reason);
    }
    assert(rejected);
    assert.equal(g.state.unconfirmedClose, true);
  }
});

test("held-FD PE range reader matches native Python projection and rejects malformed descriptors", async (t) => {
  const python = spawnSync(
    "python",
    [
      "-I",
      "-B",
      "-c",
      `import sys,json,base64;sys.path.insert(0,${JSON.stringify(path.resolve(base))});import test_private_qualification as t,extract;r=t.static_import_fixture();p=extract.pe_metadata(r);print(json.dumps({'raw':base64.b64encode(r).decode(),'projection':{k:p[k] for k in ('machine','imports','delayImports')}}))`,
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 65536, windowsHide: true },
  );
  assert.equal(python.status, 0, python.stderr);
  const fixture = JSON.parse(python.stdout),
    raw = Buffer.from(fixture.raw, "base64");
  const f = await primitiveFixture(t),
    file = path.join(f.root, "static.exe");
  await fs.writeFile(file, raw);
  const actual = await f.model.qualificationHeld(
    file,
    { bytes: raw.length, sha256: hash(raw) },
    f.state,
    f.model.qualificationStaticPe,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(actual.projection)),
    fixture.projection,
  );
  const edits = [
    ["DOS", (r) => r.fill(0, 0, 2)],
    [
      "section overlap",
      (r) => {
        r.writeUInt16LE(2, 134);
        r.copy(r, 432, 392, 432);
      },
    ],
    ["delay format", (r) => r.writeUInt32LE(0, 576)],
    ["import bound", (r) => r.writeUInt32LE(65537, 276)],
    ["name RVA", (r) => r.writeUInt32LE(0xffffffff, 524)],
    ["unterminated name", (r) => r.fill(65, 768, 898)],
    ["descriptor terminator", (r) => r.writeUInt32LE(20, 276)],
  ];
  for (const [name, edit] of edits) {
    const candidate = Buffer.from(raw);
    edit(candidate);
    const read = async (at, size) => {
      assert(at >= 0 && size <= 65536 && at + size <= candidate.length);
      return candidate.subarray(at, at + size);
    };
    await assert.rejects(
      f.model.qualificationStaticPe(read, candidate.length),
      /PRIVATE_PE_/,
      name,
    );
  }
});

test("adjacent DLL observer reads only the exact bounded LLVM directory and rejects private DLLs", async (t) => {
  const f = await primitiveFixture(t),
    bin = path.join(f.root, "llvm/bin");
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(
    path.join(bin, "clang-cl.exe"),
    "synthetic metadata fixture",
  );
  await f.model.qualificationNoAdjacentDlls(f.state);
  await fs.writeFile(path.join(bin, "private.DLL"), "not loaded");
  await assert.rejects(
    f.model.qualificationNoAdjacentDlls(f.state),
    /PRIVATE_ADJACENT_DLL/,
  );
  assert.equal(f.state.failed, true);
});

test("cancel during pending open retires its eventual exact FD and cannot produce an observation", async (t) => {
  let entered,
    release,
    confirmClose,
    closed = 0;
  const eventuallyClosed = new Promise((resolve) => {
    confirmClose = resolve;
  });
  const opening = new Promise((resolve) => {
    entered = resolve;
  });
  const deferred = new Promise((resolve) => {
    release = resolve;
  });
  const f = await primitiveFixture(t, {
    fs: {
      ...fs,
      open: async (...args) => {
        const fd = await fs.open(...args);
        entered();
        await deferred;
        return {
          stat: fd.stat.bind(fd),
          read: fd.read.bind(fd),
          close: async () => {
            closed++;
            await fd.close();
            confirmClose();
          },
        };
      },
    },
  });
  const file = path.join(f.root, "pending.bin"),
    raw = Buffer.from("exact owned open");
  await fs.writeFile(file, raw);
  const action = f.model.qualificationHeld(
    file,
    { bytes: raw.length, sha256: hash(raw) },
    f.state,
  );
  await opening;
  f.signal.abort();
  await assert.rejects(action, /PRIVATE_CANCELLED/);
  assert.equal(f.state.unconfirmedClose, true);
  release();
  // Wait for the exact pending handle close, without any actor-name cleanup.
  await eventuallyClosed;
  assert.equal(closed, 1);
  assert.equal(f.state.failed, true);
  await assert.rejects(
    f.model.issueActualObservation(f.session, policy.qualificationRoles[0]),
    /PRIVATE_CANCELLED/,
  );
});

test("actual observation issuer rejects altered policy and serialized session before reading or minting", async (t) => {
  const f = await primitiveFixture(t);
  await assert.rejects(
    f.model.issueActualObservation({}, policy.qualificationRoles[0]),
    /PRIVATE_SESSION/,
  );
  f.source.privatePolicyRaw = Buffer.from(
    rawPolicy.toString().replace('"schemaVersion": 1', '"schemaVersion": 2'),
  );
  await assert.rejects(
    f.model.issueActualObservation(f.session, policy.qualificationRoles[0]),
    /PRIVATE_POLICY_PIN/,
  );
  assert.equal(f.state.failed, true);
});

test("joined fixed-vector model waits for root and each pipe, shares output ledger and never claims cohort quiet", async (t) => {
  const child = modelChild();
  let vector,
    options,
    done = false;
  const f = await primitiveFixture(t, {
    spawn: (exe, args, opts) => {
      vector = [exe, ...args];
      options = opts;
      return child;
    },
  });
  const action = f.model
    .runFixedJoined(f.session, policy.qualificationRoles[0], f.receipt)
    .then((result) => {
      done = true;
      return result;
    });
  await f.spawned;
  child.stdout.write("actual model stdout");
  child.stderr.write("actual model stderr");
  child.emit("exit", 0, null);
  child.emit("close", 0, null);
  await new Promise(setImmediate);
  assert.equal(done, false);
  child.stdout.destroy();
  await new Promise(setImmediate);
  assert.equal(done, false);
  child.stderr.destroy();
  const result = await action;
  assert.deepEqual(vector, [
    ...privateCommandProjections(scope(), rawPolicy, "a".repeat(64))[0].argv,
  ]);
  assert.equal(options.shell, false);
  assert.equal(options.detached, false);
  assert.equal(options.windowsHide, true);
  assert.equal(result.rootAndPipesJoined, true);
  assert.equal(result.cohortQuietProven, false);
  assert.equal(result.executionAdmitted, false);
  assert.equal(f.state.next, 1);
  assert.equal(
    f.source.output.bytes,
    Buffer.byteLength("actual model stdoutactual model stderr"),
  );
  assert.equal(child.kills.length, 0);
  assert.equal(
    await fs.readFile(
      path.join(
        f.root,
        "private-qualification-logs/" +
          policy.qualificationRoles[0] +
          ".stdout.log",
      ),
      "utf8",
    ),
    "actual model stdout",
  );
});

test("cancelled joined command waits for actual close, preserves first error and forbids subsequent creation", async (t) => {
  const child = modelChild();
  let spawns = 0;
  const f = await primitiveFixture(t, {
    spawn: () => {
      spawns++;
      return child;
    },
  });
  let settled = false;
  const action = f.model
    .runFixedJoined(f.session, policy.qualificationRoles[0], f.receipt)
    .catch((error) => {
      settled = true;
      throw error;
    });
  await f.spawned;
  f.signal.abort();
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.equal(child.kills[0], "SIGKILL");
  child.complete(-1);
  await assert.rejects(action, /PRIVATE_CANCELLED/);
  assert.equal(f.state.locallyJoined, true);
  await assert.rejects(
    f.model.runFixedJoined(f.session, policy.qualificationRoles[0], f.receipt),
    /PRIVATE_CANCELLED/,
  );
  assert.equal(spawns, 1);
});

test("six sequential fixed roles retain one creation-owned log ledger despite legitimate directory writes", async (t) => {
  const vectors = [],
    children = [];
  const f = await primitiveFixture(
    t,
    {
      spawn: (exe, args) => {
        const child = modelChild();
        children.push(child);
        vectors.push([exe, ...args]);
        setImmediate(() => {
          child.stdout.write("role " + children.length);
          child.complete();
        });
        return child;
      },
    },
    {
      compilerEnvironment: {
        SystemRoot: "C:/Windows",
        WINDIR: "C:/Windows",
        PATH: "C:/Windows/System32",
        TEMP: ROOT + "/private-qualification-tmp",
        TMP: ROOT + "/private-qualification-tmp",
      },
    },
  );
  const phaseEnd = f.state.end;
  for (const [index, role] of policy.qualificationRoles.entries()) {
    const receipt = Object.freeze({ modelOnly: true });
    f.model.qualificationObservations.set(receipt, {
      session: f.session,
      state: f.state,
      role,
      epoch: f.state.epoch,
    });
    const result = await f.model.runFixedJoined(f.session, role, receipt);
    assert.equal(result.rootAndPipesJoined, true);
    assert.equal(result.cohortQuietProven, false);
    assert.equal(f.state.logFiles.size, (index + 1) * 2);
    assert.equal(f.state.end, phaseEnd);
  }
  assert.equal(f.state.phase.finish().commandsCompleted, 6);
  assert.deepEqual(
    vectors,
    privateCommandProjections(scope(), rawPolicy, "a".repeat(64)).map((row) => [
      ...row.argv,
    ]),
  );
  assert(children.every((child) => child.kills.length === 0));
  assert.equal(
    (await fs.readdir(path.join(f.root, "private-qualification-logs"))).length,
    12,
  );
});

test("owned log namespace denies unknown entries, changed files, links and replaced directory before next creation", async (t) => {
  for (const change of ["unknown", "file", "link", "directory"]) {
    let spawns = 0;
    const f = await primitiveFixture(t, {
      spawn: () => {
        spawns++;
        const child = modelChild();
        setImmediate(() => child.complete());
        return child;
      },
    });
    await f.model.runFixedJoined(
      f.session,
      policy.qualificationRoles[0],
      f.receipt,
    );
    const directory = path.join(f.root, "private-qualification-logs");
    const first = path.join(
      directory,
      policy.qualificationRoles[0] + ".stdout.log",
    );
    if (change === "unknown")
      await fs.writeFile(path.join(directory, "unowned.log"), "unknown");
    if (change === "file") {
      await fs.unlink(first);
      await fs.writeFile(first, "replacement");
    }
    if (change === "link") {
      // Directory junctions need no symlink privilege on the Windows test host.
      await fs.unlink(first);
      await fs.symlink(f.root, first, "junction");
    }
    if (change === "directory") {
      await fs.rename(directory, path.join(f.root, "retired-owned-logs"));
      await fs.mkdir(directory);
    }
    const role = policy.qualificationRoles[1],
      receipt = Object.freeze({ modelOnly: true });
    f.model.qualificationObservations.set(receipt, {
      session: f.session,
      state: f.state,
      role,
      epoch: f.state.epoch,
    });
    await assert.rejects(
      f.model.runFixedJoined(f.session, role, receipt),
      /PRIVATE_LOG_(?:UNKNOWN|CHANGED|DIRECTORY)/,
      change,
    );
    assert.equal(spawns, 1, change);
    assert.equal(f.state.failed, true);
  }
});

test("pre-abort and forged/serialized receipts launch no process; no coordinator is implicitly authorized", async (t) => {
  let spawns = 0;
  const f = await primitiveFixture(t, {
    spawn: () => {
      spawns++;
      throw Error("unreachable");
    },
  });
  f.signal.abort();
  await assert.rejects(
    f.model.runFixedJoined(f.session, policy.qualificationRoles[0], f.receipt),
    /PRIVATE_CANCELLED/,
  );
  const g = await primitiveFixture(t, {
    spawn: () => {
      spawns++;
    },
  });
  await assert.rejects(
    g.model.runFixedJoined(
      g.session,
      policy.qualificationRoles[0],
      JSON.parse(JSON.stringify(g.receipt)),
    ),
    /PRIVATE_OBSERVATION/,
  );
  const h = await primitiveFixture(
    t,
    {
      spawn: () => {
        spawns++;
      },
    },
    { coordinatorVerified: false },
  );
  h.model.qualificationCoordinatorSources.delete(h.state.sourceToken);
  await assert.rejects(
    h.model.runFixedJoined(h.session, policy.qualificationRoles[0], h.receipt),
    /PRIVATE_COORDINATOR_CLOSED/,
  );
  assert.equal(spawns, 0);
});

test("pending pre-spawn live-token or input verification is abortable with no process creation", async (t) => {
  for (const gate of ["environment", "inputs"]) {
    let entered,
      spawns = 0;
    const reached = new Promise((resolve) => {
      entered = resolve;
    });
    const pending = () => {
      entered();
      return new Promise(() => {});
    };
    const f = await primitiveFixture(
      t,
      {
        spawn: () => {
          spawns++;
        },
      },
      gate === "environment"
        ? { custom: { sourceGitEnvironment: pending } }
        : { validateBefore: pending },
    );
    const action = f.model.runFixedJoined(
      f.session,
      policy.qualificationRoles[0],
      f.receipt,
    );
    await reached;
    f.signal.abort();
    await assert.rejects(action, /PRIVATE_CANCELLED/);
    assert.equal(spawns, 0);
  }
});

test("falsy first failures and partial/failed log writes permanently poison a joined session", async (t) => {
  for (const reason of [0, false, null, undefined, ""]) {
    const child = modelChild();
    const f = await primitiveFixture(t, {
      spawn: () => child,
      writeSync: () => {
        throw reason;
      },
    });
    const action = f.model.runFixedJoined(
      f.session,
      policy.qualificationRoles[0],
      f.receipt,
    );
    await f.spawned;
    child.stdout.write("private fixture");
    child.complete(0);
    let rejected = false;
    try {
      await action;
    } catch (error) {
      rejected = true;
      assert.equal(error, reason);
    }
    assert(rejected);
    assert.equal(f.state.failed, true);
    assert.equal(f.state.next, 0);
  }
  const child = modelChild();
  let writes = 0;
  const f = await primitiveFixture(t, {
    spawn: () => child,
    writeSync: (fd, raw, at, length) => {
      writes++;
      return syncFs.writeSync(fd, raw, at, Math.min(2, length));
    },
  });
  const action = f.model.runFixedJoined(
    f.session,
    policy.qualificationRoles[0],
    f.receipt,
  );
  await f.spawned;
  child.stdout.write("1234567");
  child.complete();
  await action;
  assert.equal(writes, 4);
});

test("output, stream and log-close failures deny even after root exit without late root signals", async (t) => {
  for (const failure of ["output", "pipe", "close"]) {
    const child = modelChild();
    let closes = 0;
    const f = await primitiveFixture(t, {
      spawn: () => child,
      ...(failure === "close"
        ? {
            closeSync: (fd) => {
              syncFs.closeSync(fd);
              if (++closes === 1) throw Error("fixture log close");
            },
          }
        : {}),
    });
    const action = f.model.runFixedJoined(
      f.session,
      policy.qualificationRoles[0],
      f.receipt,
    );
    await f.spawned;
    child.emit("exit", 0, null);
    if (failure === "output") child.stdout.write(Buffer.alloc(1048577));
    if (failure === "pipe") child.stderr.emit("error", Error("fixture pipe"));
    child.complete();
    await assert.rejects(
      action,
      failure === "output"
        ? /PRIVATE_COMMAND_OUTPUT_BOUND/
        : failure === "pipe"
          ? /fixture pipe/
          : /fixture log close/,
    );
    assert.equal(child.kills.length, 0);
    assert.equal(f.state.failed, true);
  }
});

test("deadline or late root close denies and retires only creation-owned streams without claiming joined", async (t) => {
  for (const lateClose of [false, true]) {
    const child = modelChild();
    const f = await primitiveFixture(t, {
      spawn: () => {
        f.state.end = performance.now() + 40;
        return child;
      },
    });
    const action = f.model.runFixedJoined(
      f.session,
      policy.qualificationRoles[0],
      f.receipt,
    );
    await f.spawned;
    if (lateClose) {
      const end = performance.now() + 60;
      while (performance.now() < end) {
        /* Reproduce event-loop-delayed timers. */
      }
      child.complete();
    }
    await assert.rejects(action, /PRIVATE_PHASE_DEADLINE/);
    assert.equal(f.state.locallyJoined, false);
    assert.equal(child.unrefs, 1);
    assert(
      child.stdout.destroyed && child.stderr.destroyed && child.stdin.destroyed,
    );
    assert.equal(f.state.next, 0);
  }
});

test("named static policy delta normalizes exactly to prior driver, policy and pure/probe module bytes", async () => {
  const driverText = historicalDriverText;
  const driverAst = parse(driverText, {
    sourceType: "module",
    ecmaVersion: "latest",
  });
  const withoutPureDriver = driverText.replace(pureVerifierBlock + "\n\n", "");
  const functionText = (name) => {
    const node = functionNode(driverAst, name);
    return driverText.slice(node.start, node.end);
  };
  const joinedPrimitiveBlock = driverText.slice(
    driverText.indexOf("// BEGIN INACTIVE JOINED OBSERVATION PRIMITIVES\n"),
    driverText.indexOf(joinedEndMarker) + joinedEndMarker.length,
  );
  for (const [name, expected] of Object.entries({
    privateQualificationHandoff:
      "aae468a24322ee38d3c5b8242f693ab7bb9a5e4d61682cde48f6dab5bf691126",
    staticProjectionEqual:
      "494cbf0d7405b81d5e185290c4d58272c2a18388a4466bbbb769d92cbb00d049",
    staticLoadingProjection:
      "4ad301c1b5bb1376c0601223ee971ff87ad7b7a848a4b81ad445953419331fb8",
  }))
    assert.equal(hash(functionText(name)), expected, name);
  const handoff = functionNode(driverAst, "privateQualificationHandoff");
  const block = handoff.body.body.find(
    (node) => node.type === "TryStatement",
  ).block;
  const replacement = block.body.find(
    (node) =>
      node.type === "ExpressionStatement" &&
      node.expression.callee?.name === "staticLoadingProjection",
  );
  assert(replacement);
  const oldGate =
    'const loader = p.privatePolicy.lldStaticCandidate;\n    need(\n      loader.staticProjectionReviewed === true &&\n        loader.actualLoaderClosureApproved === true &&\n        loader.system32ByteSetProven === true,\n      "PRIVATE_LOADER_UNAVAILABLE",\n    );';
  let oldHandoff = driverText.slice(handoff.start, handoff.end);
  oldHandoff =
    oldHandoff.slice(0, replacement.start - handoff.start) +
    oldGate +
    oldHandoff.slice(replacement.end - handoff.start);
  assert.equal(oldHandoff.split("  staticToolObservations,\n").length, 2);
  oldHandoff = oldHandoff.replace("  staticToolObservations,\n", "");
  const edits = [
    { start: handoff.start, end: handoff.end, value: oldHandoff },
    ...["staticProjectionEqual", "staticLoadingProjection"].map((name) => {
      const node = functionNode(driverAst, name);
      assert(node);
      assert.equal(driverText.slice(node.end, node.end + 2), "\n\n");
      return { start: node.start, end: node.end + 2, value: "" };
    }),
  ];
  // First remove only the newly appended, independently tested inactive block.
  // All historical source/function/policy checks below remain unchanged.
  let priorDriver = withoutPureDriver.replace(
    joinedPrimitiveBlock + "\n\n",
    "",
  );
  for (const edit of edits.sort((a, b) => b.start - a.start))
    priorDriver =
      priorDriver.slice(0, edit.start) +
      edit.value +
      priorDriver.slice(edit.end);
  const nextPin = hash(rawPolicy);
  assert.equal(priorDriver.split(nextPin).length, 2);
  priorDriver = priorDriver.replace(
    nextPin,
    "f1f9614d617851761d577f11cafebe1e1aba3e57438801c17f84805ed34d759b",
  );
  assert.equal(
    hash(priorDriver),
    "c626ba27e80b4777eb559b61fa0812bff655df1f5f5e641ce41be8e984facd7b",
  );
  const profile = rawPolicy.toString("utf8");
  const start = profile.indexOf('  "staticLoadingPolicy": {');
  const end = profile.indexOf('  "missingBeforePrivateActivation": [', start);
  assert(start > 0 && end > start);
  const oldPolicy = (profile.slice(0, start) + profile.slice(end)).replace(
    "matching-reviewed-system-image-and-static-tool-projections",
    "actual-loader-resolution-and-system32-byte-contract",
  );
  assert.equal(
    hash(oldPolicy),
    "f1f9614d617851761d577f11cafebe1e1aba3e57438801c17f84805ed34d759b",
  );
  const python = await readFile(base + "private_qualification.py", "utf8");
  assert.equal(python.split("def static_projection_equal").length, 2);
  const oldPython = (
    python.split("def static_projection_equal")[0].trimEnd() + "\n"
  ).replace(
    nextPin,
    "f1f9614d617851761d577f11cafebe1e1aba3e57438801c17f84805ed34d759b",
  );
  assert.equal(
    hash(oldPython),
    "8142966125763a5e04e684188481c78f3481d608a5d0b8b94e0ab147e222d2bc",
  );
});

test("private derivative restores exact historical source body after five explicit reviewed function replacements", async () => {
  const driverText = historicalDriverText;
  const original = await readFile(
    base + "image-qualified-current-driver.mjs",
    "utf8",
  );
  assert.equal(
    hash(Buffer.from(original)),
    "7c02861f5a153e7945556dbdb99267ab8386cd98682ba7ef932aa40c7c096833",
  );
  assert.equal(
    hash(await readFile(base + "image-qualified-20261021-driver.mjs")),
    "e98e2a38f282090fcde7fe900751d22b977d3e9d3fa1ce662b9527711bf0e06d",
  );
  const begin = "// BEGIN REVIEWED SOURCE DERIVATIVE\n";
  const end = "// END REVIEWED SOURCE DERIVATIVE";
  assert.equal(driverText.split(begin).length, 2);
  assert.equal(driverText.split(end).length, 2);
  let body = driverText.split(begin)[1].split(end)[0];
  const originalAst = parse(original, {
    sourceType: "module",
    ecmaVersion: "latest",
  });
  const bodyAst = parse(body, { sourceType: "module", ecmaVersion: "latest" });
  const reviewed = {
    reviewedHostClosure:
      "4338a2da8c01a67bb3b95498250e1191f17fb959a556befb0ff030dad62400fc",
    sourcePaths:
      "02a11455e36ddf932a285f2e05b94485c087ca7d04239e987afea71f13b12373",
    bootstrapProgram:
      "6dadfc55c531ffc53d2831053c5a45b92617e9610c6d3819dce48b3bf4753410",
    loadSealedProfile:
      "85d232cccbb9c93de2aa8cf964bea4b7376e2047dd690e28bf77628a75214c8f",
    privateSourceBody:
      "a6578d57a617cebb8c1544f1fda5e34c58cffa91a59455df012d9402741e817c",
  };
  const edits = Object.entries(reviewed).map(([name, expected]) => {
    const next = functionNode(bodyAst, name);
    const previous = functionNode(
      originalAst,
      name === "privateSourceBody" ? "main" : name,
    );
    assert(next && previous, name);
    assert.equal(
      hash(Buffer.from(body.slice(next.start, next.end))),
      expected,
      name,
    );
    return {
      start: next.start,
      end: next.end,
      raw: original.slice(previous.start, previous.end),
    };
  });
  for (const edit of edits.sort((a, b) => b.start - a.start))
    body = body.slice(0, edit.start) + edit.raw + body.slice(edit.end);
  const trailer = original.slice(
    original.lastIndexOf("\nif (\n  process.argv[1]"),
  );
  const normalized = body.trimEnd() + "\n" + trailer;
  assert.equal(normalized, original);
});

test("both private source projections retain complete corresponding old images and compiler-false source policies", async () => {
  const basePolicy = JSON.parse(await readFile(base + "profile.json", "utf8"));
  for (const [image, selected] of Object.entries(policy.images)) {
    const original = JSON.parse(
      await readFile(base + selected.profile, "utf8"),
    );
    const p = {
      ...basePolicy,
      image,
      sourceGn: original.sourceGn,
      privatePolicy: policy,
      privateSelectedSha256: selected.profileSha256,
      phaseAdmission: {
        ...basePolicy.phaseAdmission,
        "image-qualified-source-gn": true,
      },
    };
    const projectionRoot =
      process.platform === "win32"
        ? ROOT
        : "/tmp/sorng-private-source-projection";
    const files = privateSourcePaths(projectionRoot, p);
    assert.equal(
      files.inputs
        .replaceAll("\\", "/")
        .replace(/\/$/, "")
        .endsWith(selected.namespace.replace(/\/$/, "")),
      true,
    );
    assert.equal(privateHostClosure(p, image).rows.length, 18);
    assert.equal(p.sourceGn.compilerAllowed, false);
    assert.equal(p.sourceGn.sdkAllowed, false);
    const text = privateBootstrapProgram(
      projectionRoot,
      p,
      "a".repeat(64),
    ).toString("utf8");
    const encoded = text
      .split("\n")
      .find((line) => line.startsWith("P=json.loads("));
    assert(encoded);
    const serialized = JSON.parse(
      JSON.parse(encoded.slice("P=json.loads(".length, -1)),
    );
    assert.equal(serialized.enabled, false);
    assert.equal(serialized.image, image);
    assert(
      text.includes("value['mode']=='private-compiler-input-qualification'"),
    );
    assert(
      text.includes("value['image'] in ('20261030.294.1','20261021.278.1')"),
    );
    assert(
      text.includes(
        "value['ref']=='refs/heads/codex/windows-arm-engine-qualification-20261101'",
      ),
    );
  }
});

test("actual private loader and public entry deny before input getters, FS and optional imports", async () => {
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error("input getter touched");
      },
    },
  );
  await assert.rejects(
    privateLoadSealedProfile(hostile, hostile, hostile),
    /PRIVATE_EXECUTION_CLOSED/,
  );
  const source = functionText("privateSourceBody");
  assert.match(
    source,
    /^async function privateSourceBody\(argv\) \{\s*need\(PRIVATE_DRIVER_ADMITTED, "PRIVATE_EXECUTION_CLOSED"\);/,
  );
  assert(
    source.indexOf("requirePrivateScope(c)") < source.indexOf("await import("),
  );
  assert(
    source.indexOf("await loadSealedProfile(") <
      source.indexOf("await import("),
  );
});

test("private fixed six vectors match the actual independent Python projection without executing any tool", () => {
  const code =
    "import sys,json;from pathlib import Path;sys.path.insert(0,str(Path('native/windows-arm-full-sdk').resolve()));import test_private_qualification as t;import private_qualification as p;print(json.dumps([{'role':r,**{k:p.command_projection(r,t.context(),t.RAW,wall_now=200,monotonic_now=200)[k] for k in ('argv','cwd')}} for r in p.ROLES]))";
  const result = spawnSync("python", ["-I", "-B", "-c", code], {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 32768,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const projected = privateCommandProjections(
    scope(),
    rawPolicy,
    "a".repeat(64),
  );
  assert.deepEqual(
    projected.map(({ role, argv, cwd }) => ({ role, argv, cwd })),
    JSON.parse(result.stdout),
  );
  assert(projected.every((command) => command.executionAdmitted === false));
});

test("live-token handoff rejects forged Git policy and unknown environment, then reaches only the unqualified-defaults stop", async (t) => {
  // Trusted unit seam only: no real Job receipt, process permission or mutable
  // source authority is minted. Actual module gate remains false throughout.
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sorng-private-handoff-")),
  );
  t.after(async () => {
    assert.equal(await fs.realpath(directory), directory);
    await fs.rm(directory, { recursive: true });
  });
  const token = await prepareSourceGitIsolation(
    path.join(directory, "cef-source-git-policy"),
  );
  let records = [],
    cleared = 0,
    metadataAt = 0;
  const sourceRuns = new WeakMap();
  const owners = new WeakMap();
  const runner = vm.runInNewContext(
    "(" + functionText("privateQualificationHandoff") + ")",
    {
      PRIVATE_DRIVER_ADMITTED: true,
      TARGET: "aarch64-pc-windows-msvc",
      PRIVATE_ROLES: policy.qualificationRoles,
      qualificationSourceRuns: sourceRuns,
      retireQualificationSource(owner) {
        const source = owners.get(owner);
        source.retired = true;
        sourceRuns.delete(source.token);
      },
      coordinateQualification() {
        throw new Error("PRIVATE_ARM64_DEFAULTS_UNQUALIFIED");
      },
      performance: { now: () => metadataAt },
      need: (condition, code) => {
        if (!condition) throw new Error(code);
      },
      qualificationPhaseClock: (budget) =>
        qualificationPhaseClock(budget, () => metadataAt),
      privateCommandProjections,
      // The VM creates foreign-realm object literals. Materialize only that
      // pure JSON projection in this realm; production stays plain-object-only.
      staticLoadingProjection: (context, ...args) =>
        staticLoadingProjection(JSON.parse(JSON.stringify(context)), ...args),
      path,
      Buffer,
      sha: (raw) => hash(raw),
      setTimeout: () => 1,
      clearTimeout: () => {
        cleared++;
      },
      fs: {
        writeFile: async (file, data, options) => {
          assert.equal(
            file,
            path.join(ROOT, "private-qualification-result.json"),
          );
          assert.equal(options.flag, "wx");
          records.push(JSON.parse(data));
        },
      },
      writeFileSync: () => {
        throw new Error("deadline callback not expected");
      },
      process: {
        platform: "win32",
        arch: "x64",
        exit: () => {
          throw new Error("no owned process exists in unit seam");
        },
      },
      sourceReportingFailure: false,
    },
    { timeout: 1000 },
  );
  const invoke = (
    gitPolicy,
    candidate,
    liveEnvironment = sourceGitEnvironment,
  ) => {
    metadataAt = 0;
    const owner = {},
      qualificationSource = {};
    const source = {
      owner,
      token: qualificationSource,
      root: ROOT,
      policyImage: "20261030.294.1",
      phase: qualificationPhaseClock(
        { remaining: () => 1600000 },
        () => metadataAt,
      ),
      end: 900000,
    };
    owners.set(owner, source);
    sourceRuns.set(qualificationSource, source);
    return runner({
      qualificationSource,
      root: ROOT,
      c: scope(),
      p: {
        image: "20261030.294.1",
        privateSelectedSha256: policy.images["20261030.294.1"].profileSha256,
        sourceGn: { sourceId: policy.images["20261030.294.1"].sourceId },
        privatePolicy: candidate,
      },
      budget: { remaining: () => 1600000 },
      graph: {},
      generatedArguments: {},
      custom: { sourceGitEnvironment: liveEnvironment },
      gitPolicy,
      env: { PATH: "C:/Windows/System32" },
      privatePolicyRaw: rawPolicy,
    });
  };
  await assert.rejects(invoke({}, policy), /SOURCE_GIT_POLICY_CAPABILITY/);
  await assert.rejects(
    invoke(token, policy),
    /PRIVATE_ENVIRONMENT_UNAVAILABLE/,
  );
  const knownEnvironment = { ...policy, environmentContractApproved: true };
  await assert.rejects(
    invoke(token, knownEnvironment),
    /PRIVATE_ARM64_DEFAULTS_UNQUALIFIED/,
  );
  await assert.rejects(
    invoke(token, policy, async (...args) => {
      const value = await sourceGitEnvironment(...args);
      metadataAt = 900001;
      return value;
    }),
    /PRIVATE_PHASE_DEADLINE/,
  );
  assert.equal(cleared, 4);
  assert.equal(records.length, 3);
  assert.deepEqual(
    records.map((record) => record.firstFailure),
    [
      "SOURCE_GIT_POLICY_CAPABILITY",
      "PRIVATE_ENVIRONMENT_UNAVAILABLE",
      "PRIVATE_ARM64_DEFAULTS_UNQUALIFIED",
    ],
  );
  assert(
    records.every(
      (record) =>
        record.sourceGnCompleted &&
        !record.compilerExecuted &&
        !record.success &&
        record.outerJobCleanupNotInferred,
    ),
  );
});

// Isolated same-realm lexical maps. This fixture cannot register a source run
// in the imported production module and has no workload executable seam.
test("source coordinator slice restores exact8e, revokes synchronously and changes only the superseded Python source contract", async () => {
  const approved = {
    privateSourceBody:
      "ed0d5b6a8fad7f1b991b3ab55cc344f92255d8ad82500a7d3fb6af601bfe9076",
    privateQualificationHandoff:
      "a181fb5428689c6ab6650928522cd890dbbacd5c52ead4da435124448d95e7c9",
    qualificationPoison:
      "93acd882f5a618d0b759abb8a791abb3e7956713c403fc2d99b5c0377fe578c0",
    createQualificationSession:
      "a84d7ca058245bc70c22af78e45f821e90167dbd9c52a32c1b53b615621ef2fb",
    runFixedJoined:
      "86ff6e28a8e663c80e7f52b5f6ff335e00009136cac12d8a3a3584f0ef622528",
    qualificationCloseLogs:
      "c95cf7934e92baf68fa3c0192072eaac6db36ca512a19ea632091bee1ee191b7",
  };
  assert.equal(
    hash(coordinatorBlock),
    "41f8b98e07048353386ece2efa2839d6a0949fc5a71edafb06d6e5745d806132",
  );
  assert.deepEqual(Object.keys(approved), historyFunctions);
  for (const [name, pin] of Object.entries(approved))
    assert.equal(hash(functionText(name)), pin, name);
  assert.equal(
    hash(historicalDriverText),
    "f83d3cf3c9d6f7808d3229e93a0a599e3ea2d5eeba55d468d22a31946465601a",
  );
  assert.equal(
    (coordinatorBlock.match(/qualificationSourceRuns\.set\(/g) ?? []).length,
    1,
  );
  const ast = parse(coordinatorBlock, {
    sourceType: "module",
    ecmaVersion: "latest",
  });
  assert(ast.body.every((node) => !node.type.startsWith("Export")));
  const retire = functionNode(ast, "retireQualificationSource");
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    assert.notEqual(node.type, "AwaitExpression");
    for (const item of Object.values(node))
      if (Array.isArray(item)) item.forEach(walk);
      else if (item && typeof item === "object") walk(item);
  };
  walk(retire);
  const session = functionText("createQualificationSession");
  assert.match(session, /const phase = source.phase;/);
  assert(!session.includes("qualificationPhaseClock("));
  const body = functionText("privateSourceBody");
  assert(
    body.indexOf("qualificationOwner = beginQualificationSource(") <
      body.indexOf("const capture = await collectQualificationGraph("),
  );
  assert(
    body.indexOf("const capture = await collectQualificationGraph(") <
      body.indexOf("commitQualificationGraph("),
  );
  const sourceWriter = functionText("commitQualificationGraph");
  assert(
    sourceWriter.indexOf("qualificationOwnerCheck(owner)") <
      sourceWriter.indexOf("qualificationGraphReceipts.set("),
  );
  assert(
    sourceWriter.indexOf("qualificationGraphReceipts.set(") <
      sourceWriter.indexOf("qualificationSourceRuns.set("),
  );
  const current = await readFile(
    base + "test_private_qualification.py",
    "utf8",
  );
  const begin = current.indexOf(
    "    def test_private_source_issuer_has_no_public_entry_or_arm_defaults_grant(self):",
  );
  const end = current.indexOf("\n\nif __name__", begin);
  assert(begin > 0 && end > begin);
  assert.equal(
    hash(
      current.slice(0, begin) + HISTORICAL_PYTHON_METHOD + current.slice(end),
    ),
    "3ba4d689527b49832aea77eef15a9a2a76bd2e00d0bbec5b1e533c0f76c88f5c",
    "exact old whole Python source after only one literal method inverse",
  );
});

const outputFixture = (image) => ({
  ...freshPure(image),
  wallNow: 200,
  monotonicNow: 200,
});
function sourceOwnerModel(hooks = {}, overrides = {}) {
  const joined = joinedPrimitiveBlock.replace(
    'import { fstatSync as qualificationFdStat } from "node:fs";\n',
    "",
  );
  const rootNode = driverAst.body.find(
    (item) =>
      item.type === "VariableDeclaration" &&
      item.declarations.some((row) => row.id.name === "PRIVATE_ROOT"),
  );
  const names = [
    "fs",
    "path",
    "Buffer",
    "structuredClone",
    "performance",
    "setTimeout",
    "clearTimeout",
    "createHash",
    "constants",
    "openSync",
    "writeSync",
    "closeSync",
    "qualificationFdStat",
    "sha",
    "need",
    "REPO",
    "HERE",
    "TARGET",
    "process",
    "PRIVATE_MODE",
    "PRIVATE_REF",
    "PRIVATE_WORKFLOW",
    "PRIVATE_ROLES",
    "PRIVATE_PROFILE_SHA256",
    "qualificationPhaseClock",
    "privateCommandProjections",
    "held",
    "testHooks",
  ];
  const values = {
    fs,
    path,
    Buffer,
    structuredClone,
    performance,
    setTimeout,
    clearTimeout,
    createHash,
    constants: syncFs.constants,
    openSync: syncFs.openSync,
    writeSync: syncFs.writeSync,
    closeSync: syncFs.closeSync,
    qualificationFdStat: syncFs.fstatSync,
    sha: hash,
    need(value, code) {
      if (!value) throw Error(code);
    },
    REPO: process.cwd(),
    HERE: path.resolve(base),
    TARGET: policy.target,
    process: { platform: "win32", arch: "x64" },
    PRIVATE_MODE: policy.mode,
    PRIVATE_REF: policy.ref,
    PRIVATE_WORKFLOW: policy.workflow,
    PRIVATE_ROLES: policy.qualificationRoles,
    PRIVATE_PROFILE_SHA256: hash(rawPolicy),
    qualificationPhaseClock,
    privateCommandProjections,
    held: async (file) =>
      file.endsWith("engine-qualification-profile.json")
        ? Buffer.from(candidatePolicyRaw)
        : Buffer.from("fixed model read"),
    testHooks: hooks,
    ...overrides,
  };
  const factory = new Function(
    ...names,
    driverText.slice(rootNode.start, rootNode.end) +
      "\n" +
      functionText("staticProjectionEqual") +
      "\n" +
      functionText("requirePrivateScope").replace(/^export /, "") +
      "\n" +
      "const signature=" +
      ((s) =>
        [
          s.dev,
          s.ino,
          s.size,
          s.mtimeNs,
          s.ctimeNs,
          s.birthtimeNs,
          s.mode,
          s.nlink,
        ].join(":")).toString() +
      ";\n" +
      functionText("physical") +
      "\n" +
      joined +
      "\n" +
      pureVerifierBlock +
      "\n" +
      coordinatorBlock +
      `
    if(testHooks.validate) validateQualificationSource=testHooks.validate;
    if(testHooks.observe) issueActualObservation=testHooks.observe;
    if(testHooks.run) runFixedJoined=testHooks.run;
    if(testHooks.readLog) qualificationReadLog=testHooks.readLog;
    if(testHooks.metadata) qualificationMetadataObservation=testHooks.metadata;
    if(testHooks.readPin) qualificationHeld=testHooks.readPin;
    if(testHooks.adjacent) qualificationNoAdjacentDlls=testHooks.adjacent;
    return {beginQualificationSource,collectQualificationGraph,commitQualificationGraph,
      retireQualificationSource,qualificationOwnerAwait,qualificationOwnerCheck,
      qualificationSourceOwners,qualificationSourceRuns,qualificationGraphReceipts,
      qualificationSessions,qualificationObservations,createQualificationSession,
      qualificationCheck,qualificationHeld,qualificationInspectMetadata,
      coordinateQualification,qualificationCoordinatorSources,validateQualificationSource};`,
  );
  return factory(...names.map((name) => values[name]));
}

function sourceOwnerFixture(options = {}) {
  let at = 0,
    left = 600000;
  const modelRoot =
    options.input?.root ??
    (process.platform === "win32"
      ? ROOT
      : "/tmp/sorng-private-source-owner-model");
  const directory = {
    dev: 1n,
    ino: 1n,
    size: 0n,
    mtimeNs: 0n,
    ctimeNs: 0n,
    birthtimeNs: 1n,
    mode: 0o40700n,
    nlink: 1n,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  };
  const modelFs = {
    ...fs,
    realpath: async (file) => file,
    lstat: async () => ({ ...directory }),
    mkdir: async () => {},
  };
  const packet = outputFixture("20261030.294.1");
  const graphPins = ["args.gn", "build.ninja"].map((name) => ({
    path: name,
    name,
    bytes: name === "args.gn" ? packet.observed.files.args.raw.length : 1,
    sha256:
      name === "args.gn"
        ? hash(packet.observed.files.args.raw)
        : hash(Buffer.from("n")),
  }));
  const canonical = (value) =>
    Array.isArray(value)
      ? "[" + value.map(canonical).join(",") + "]"
      : value !== null && typeof value === "object"
        ? "{" +
          Object.keys(value)
            .sort()
            .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
            .join(",") +
          "}"
        : JSON.stringify(value);
  const pins = {
    pins: graphPins,
    files: 2,
    bytes: graphPins.reduce((n, row) => n + row.bytes, 0),
    sha256: hash(Buffer.from(canonical(graphPins))),
  };
  const summary = {
    files: pins.files,
    bytes: pins.bytes,
    sha256: pins.sha256,
    visited: 2,
  };
  const hooks = options.hooks ?? {};
  const model = sourceOwnerModel(hooks, {
    performance: { now: () => at },
    fs: modelFs,
    ...options.globals,
  });
  const policyClone = structuredClone(policy);
  policyClone.environmentContractApproved = true; // isolated model, never actual policy bytes
  const controls = { post: null, graph: null };
  const input = {
    root: modelRoot,
    c: { ...scope(), ...packet.context, sources: [] },
    p: { image: packet.context.image, privatePolicy: policyClone },
    files: { chromium: modelRoot + "/source-checkout/src" },
    tools: {},
    privatePolicyRaw: rawPolicy,
    contextSha: "a".repeat(64),
    budget: { remaining: () => left },
    output: { bytes: 0 },
    custom: { sourceGitEnvironment: async (_token, env) => ({ ...env }) },
    gitPolicy: {},
    env: { MODEL: "closed" },
    checked: async (action) => {
      const result = await action();
      await controls.post?.();
      return result;
    },
    checkpoint: {
      graphPinSnapshot,
      graphInventory: async (_out, args) => {
        if (controls.graph) return controls.graph(args, pins, summary);
        args.observePins(pins);
        return structuredClone(summary);
      },
    },
    ...options.input,
  };
  const owner = model.beginQualificationSource(input);
  return {
    model,
    owner,
    input,
    controls,
    packet,
    pins,
    summary,
    directory,
    clock(value, remaining = left) {
      at = value;
      left = remaining;
    },
  };
}

test("source-owned graph capability rejects forged/missing/repeated/cross-owner data and failed native postchecks", async () => {
  const forged = sourceOwnerFixture();
  assert.throws(
    () => forged.model.commitQualificationGraph({ ...forged.owner }),
    /PRIVATE_SOURCE_OWNER/,
  );
  await assert.rejects(
    forged.model.collectQualificationGraph(
      JSON.parse(JSON.stringify(forged.owner)),
    ),
    /PRIVATE_SOURCE_OWNER/,
  );
  const other = sourceOwnerFixture();
  assert.throws(
    () => other.model.commitQualificationGraph(forged.owner),
    /PRIVATE_SOURCE_OWNER/,
  );
  for (const variation of ["missing", "repeat", "summary", "post"]) {
    const f = sourceOwnerFixture();
    if (variation === "post")
      f.controls.post = () => {
        throw Error("FIXED_POSTCHECK");
      };
    else
      f.controls.graph = (args, pins, summary) => {
        if (variation !== "missing") args.observePins(pins);
        if (variation === "repeat") {
          try {
            args.observePins(pins);
          } catch {
            /* native helper swallows */
          }
        }
        return {
          ...summary,
          ...(variation === "summary" ? { bytes: summary.bytes + 1 } : {}),
        };
      };
    await assert.rejects(
      f.model.collectQualificationGraph(f.owner),
      /PRIVATE_GRAPH|FIXED_POSTCHECK/,
    );
    assert.equal(f.model.qualificationSourceOwners.get(f.owner).retired, true);
    assert.throws(() => f.model.commitQualificationGraph(f.owner));
  }
});

test("graph callback data is captured before await; late caller mutation and diagnostic JSON cannot rebrand it", async () => {
  const f = sourceOwnerFixture();
  f.controls.graph = async (args, pins, summary) => {
    args.observePins(pins);
    pins.pins[0].sha256 = "f".repeat(64);
    return structuredClone(summary);
  };
  await f.model.collectQualificationGraph(f.owner);
  const token = f.model.commitQualificationGraph(f.owner);
  const state = f.model.qualificationSourceOwners.get(f.owner);
  const receipt = f.model.qualificationGraphReceipts.get(state.graphReceipt);
  assert.notEqual(receipt.snapshot.pins[0].sha256, f.pins.pins[0].sha256);
  assert.equal(f.model.qualificationSourceRuns.has(token), true);
  assert.equal(
    f.model.qualificationSourceRuns.has(JSON.parse(JSON.stringify(token))),
    false,
  );
  assert.equal(
    f.model.qualificationGraphReceipts.has(
      JSON.parse(JSON.stringify(state.graphReceipt)),
    ),
    false,
  );
  f.model.retireQualificationSource(f.owner);
});

test("same source-owned graph rejects physical directory replacement and swallowed later callback corruption", async () => {
  const replaced = sourceOwnerFixture();
  await replaced.model.collectQualificationGraph(replaced.owner);
  const token = replaced.model.commitQualificationGraph(replaced.owner);
  replaced.directory.ino++;
  await assert.rejects(
    replaced.model.validateQualificationSource(replaced.owner),
    /PRIVATE_SOURCE_DIRECTORY_CHANGED/,
  );
  assert.equal(replaced.model.qualificationSourceRuns.has(token), false);
  const corrupted = sourceOwnerFixture();
  await corrupted.model.collectQualificationGraph(corrupted.owner);
  const other = corrupted.model.commitQualificationGraph(corrupted.owner);
  corrupted.controls.graph = (args, pins, summary) => {
    args.observePins(pins);
    try {
      args.observePins(pins);
    } catch {
      /* actual graph helper treats observer errors as diagnostic */
    }
    return structuredClone(summary);
  };
  await assert.rejects(
    corrupted.model.validateQualificationSource(corrupted.owner),
    /PRIVATE_GRAPH_CALLBACK/,
  );
  assert.equal(corrupted.model.qualificationSourceRuns.has(other), false);
});

test("source retirement poisons before awaited cleanup, pending callbacks and last-await publication", async () => {
  const f = sourceOwnerFixture();
  await f.model.collectQualificationGraph(f.owner);
  const token = f.model.commitQualificationGraph(f.owner),
    session = f.model.createQualificationSession(token);
  const state = f.model.qualificationSourceOwners.get(f.owner);
  const sessionState = f.model.qualificationSessions.get(session);
  let finish;
  const close = new Promise((resolve) => {
    finish = resolve;
  });
  const pending = f.model.qualificationOwnerAwait(f.owner, close);
  f.model.retireQualificationSource(f.owner, true, 0);
  assert.equal(f.model.qualificationSourceRuns.has(token), false);
  assert.equal(
    f.model.qualificationGraphReceipts.has(state.graphReceipt),
    false,
  );
  assert.equal(sessionState.closed, true);
  assert.throws(
    () => f.model.qualificationCheck(sessionState),
    (error) => error === 0,
  );
  finish("late close");
  await assert.rejects(pending, (error) => error === 0);
  assert.throws(
    () => f.model.commitQualificationGraph(f.owner),
    (error) => error === 0,
  );
  const late = sourceOwnerFixture();
  late.controls.post = () => {
    queueMicrotask(() => late.model.retireQualificationSource(late.owner));
  };
  await assert.rejects(
    late.model.collectQualificationGraph(late.owner),
    /PRIVATE_SOURCE_RETIRED/,
  );
  assert.throws(
    () => late.model.commitQualificationGraph(late.owner),
    /PRIVATE_SOURCE_RETIRED/,
  );
});

test("all falsy original source failures poison graph/source/session reuse without resetting one phase", async () => {
  for (const original of [0, false, null, undefined, Error("fixed")]) {
    const f = sourceOwnerFixture();
    f.controls.post = () => {
      throw original;
    };
    await assert.rejects(
      f.model.collectQualificationGraph(f.owner),
      (error) => error === original,
    );
    assert.throws(
      () => f.model.commitQualificationGraph(f.owner),
      (error) => error === original,
    );
    assert.throws(
      () => f.model.qualificationOwnerCheck(f.owner),
      (error) => error === original,
    );
  }
  const f = sourceOwnerFixture();
  f.clock(100000, 500000);
  await f.model.collectQualificationGraph(f.owner);
  const token = f.model.commitQualificationGraph(f.owner),
    source = f.model.qualificationSourceRuns.get(token);
  const session = f.model.createQualificationSession(token),
    current = f.model.qualificationSessions.get(session);
  assert.equal(
    current.phase,
    f.model.qualificationSourceOwners.get(f.owner).phase,
  );
  assert.equal(current.end, 450000);
  assert.equal(source.end, current.end);
  f.clock(450001, 149999);
  assert.throws(
    () => f.model.qualificationCheck(current),
    /PRIVATE_PHASE_DEADLINE/,
  );
  assert.equal(f.model.qualificationSourceRuns.has(token), false);
});

test("actual held-FD failure revokes graph/source/session before its delayed close can settle", async (t) => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sorng-source-retire-")),
  );
  t.after(async () => {
    assert.equal(await fs.realpath(root), root);
    await fs.rm(root, { recursive: true });
  });
  const file = path.join(root, "owned-input"),
    raw = Buffer.from("owned immutable fixture");
  await fs.writeFile(file, raw, { flag: "wx" });
  await fs.mkdir(path.join(root, "source-checkout/src/out/Release_GN_arm64"), {
    recursive: true,
  });
  let closeEntered,
    finishClose,
    closes = 0;
  const entered = new Promise((resolve) => {
    closeEntered = resolve;
  });
  const closeGate = new Promise((resolve) => {
    finishClose = resolve;
  });
  const mockFs = {
    ...fs,
    async open(...args) {
      const fd = await fs.open(...args);
      return {
        stat: (...args) => fd.stat(...args),
        read: (...args) => fd.read(...args),
        async close() {
          closes++;
          closeEntered();
          await fd.close();
          await closeGate;
        },
      };
    },
  };
  const f = sourceOwnerFixture({ input: { root }, globals: { fs: mockFs } });
  await f.model.collectQualificationGraph(f.owner);
  const token = f.model.commitQualificationGraph(f.owner),
    session = f.model.createQualificationSession(token);
  const state = f.model.qualificationSessions.get(session),
    ownerState = f.model.qualificationSourceOwners.get(f.owner);
  const pending = f.model.qualificationHeld(
    file,
    { bytes: raw.length, sha256: "0".repeat(64) },
    state,
  );
  // Observe rejection now so no late promise rejection can escape this test.
  const denial = assert.rejects(pending, /PRIVATE_READ/);
  await entered;
  assert.equal(closes, 1);
  assert.equal(f.model.qualificationSourceRuns.has(token), false);
  assert.equal(
    f.model.qualificationGraphReceipts.has(ownerState.graphReceipt),
    false,
  );
  assert.equal(state.closed, true);
  assert.equal(state.failed, true);
  finishClose();
  await denial;
  assert.equal(closes, 1);
});

test("metadata-only inspector matches full actual Python metadata and never treats minimums as ARM defaults", () => {
  const model = sourceOwnerModel();
  for (const image of Object.keys(pureFixtures)) {
    const f = outputFixture(image),
      files = f.observed.files;
    delete files.coff;
    delete files.pe;
    const observed = model.qualificationInspectMetadata(
      f.context,
      rawPolicy,
      candidatePolicyRaw,
      f.observed,
      f.wallNow,
      f.monotonicNow,
    );
    const full = outputFixture(image);
    const reference = pureApi.qualificationInspectOutputs(
      full.context,
      rawPolicy,
      candidatePolicyRaw,
      full.observed,
      full.wallNow,
      full.monotonicNow,
    );
    for (const key of [
      "metadata",
      "literalArguments",
      "partitionAllocMacros",
      "cefHeader",
    ])
      assert.deepEqual(observed[key], reference[key]);
    assert.equal(observed.fullArm64DefaultsQualified, false);
    assert.equal(observed.compilerExecuted, false);
    assert.equal(observed.cohortQuietProven, false);
    const bad = outputFixture(image);
    delete bad.observed.files.coff;
    delete bad.observed.files.pe;
    bad.observed.files.partitionAlloc.pin.sha256 = "0".repeat(64);
    assert.throws(
      () =>
        model.qualificationInspectMetadata(
          bad.context,
          rawPolicy,
          candidatePolicyRaw,
          bad.observed,
          bad.wallNow,
          bad.monotonicNow,
        ),
      /PRIVATE_OUTPUT_PIN/,
    );
  }
});

test("source-owned postchecks stream all fixed tool/archive/patched/probe pins and revoke on changed post-input", async () => {
  for (const corrupt of [false, true]) {
    const reads = [],
      failure = Error("FIXED_POST_INPUT_CHANGED");
    let adjacent = 0;
    const f = sourceOwnerFixture({
      hooks: {
        readPin: async (file, pin) => {
          assert(Number.isSafeInteger(pin.bytes) && pin.bytes > 0);
          assert.match(pin.sha256, /^[a-f0-9]{64}$/);
          reads.push(file);
          if (
            corrupt &&
            file.replaceAll("\\", "/").endsWith("partition_alloc/BUILD.gn")
          )
            throw failure;
          return {};
        },
        adjacent: async () => {
          adjacent++;
        },
      },
    });
    await f.model.collectQualificationGraph(f.owner);
    const token = f.model.commitQualificationGraph(f.owner),
      session = f.model.createQualificationSession(token);
    const state = f.model.qualificationSessions.get(session);
    state.running = true;
    const source = f.model.qualificationSourceRuns.get(token);
    if (corrupt) {
      await assert.rejects(
        source.validateAfter(policy.qualificationRoles[0]),
        (error) => error === failure,
      );
      assert.equal(f.model.qualificationSourceRuns.has(token), false);
      assert.equal(state.closed, true);
      assert.equal(adjacent, 0);
    } else {
      await source.validateAfter(policy.qualificationRoles[0]);
      assert.equal(reads.length, 9);
      assert.equal(adjacent, 1);
      assert.equal(f.model.qualificationSourceRuns.has(token), true);
      f.model.retireQualificationSource(f.owner);
    }
  }
});

test("genuine coordinator model performs only four fixed steps and always stops before clang despite matching full61 metadata", async () => {
  const calls = [],
    metadata = [];
  let f;
  const packet = outputFixture("20261030.294.1");
  const hooks = {
    validate: async () => {},
    observe: async (session, role) => ({ session, role }),
    run: async (session, role) => {
      const state = f.model.qualificationSessions.get(session);
      state.phase.before(role);
      calls.push(role);
      state.phase.after(role);
      state.next++;
    },
    readLog: async (_owner, _session, index) =>
      [
        packet.observed.gnDescPartitionAlloc,
        packet.observed.gnDescCef,
        packet.observed.gnArgs,
      ][index],
    metadata: async () => {
      const fixture = outputFixture("20261030.294.1");
      delete fixture.observed.files.coff;
      delete fixture.observed.files.pe;
      const result = f.model.qualificationInspectMetadata(
        fixture.context,
        rawPolicy,
        candidatePolicyRaw,
        fixture.observed,
        fixture.wallNow,
        fixture.monotonicNow,
      );
      metadata.push(result);
      return { ...result, fullArm64DefaultsQualified: true };
    },
  };
  f = sourceOwnerFixture({
    hooks,
    globals: {
      held: async (file) =>
        file.endsWith("args.gn")
          ? Buffer.from(packet.observed.files.args.raw)
          : Buffer.from(candidatePolicyRaw),
    },
  });
  await f.model.collectQualificationGraph(f.owner);
  const token = f.model.commitQualificationGraph(f.owner);
  await assert.rejects(
    f.model.coordinateQualification(token),
    /PRIVATE_ARM64_DEFAULTS_UNQUALIFIED/,
  );
  assert.deepEqual(calls, policy.qualificationRoles.slice(0, 4));
  assert.equal(metadata.length, 1);
  assert.equal(metadata[0].completeMacroInventoryMatches, true);
  assert.equal(metadata[0].fullArm64DefaultsQualified, false);
  assert.equal(f.model.qualificationSourceRuns.has(token), false);
  await assert.rejects(
    f.model.coordinateQualification(token),
    /PRIVATE_SOURCE_RUN/,
  );
});

test("post-GN failure keeps original source result truthful and qualification separate", () => {
  const body =
    functionNode(driverAst, "privateSourceBody").declaration ??
    functionNode(driverAst, "privateSourceBody");
  const source = functionText("privateSourceBody");
  assert(
    source.indexOf("success = true;") <
      source.indexOf("await privateQualificationHandoff("),
  );
  assert.match(source, /stage: success \? "complete" : stage/);
  assert.match(source, /firstFailure: success \? null : code/);
  const sourceRecord = body.body.body
    .find((node) => node.type === "TryStatement")
    .finalizer.body.find(
      (node) =>
        node.type === "VariableDeclaration" &&
        node.declarations.some(
          (declaration) => declaration.id.name === "report",
        ),
    );
  assert(sourceRecord);
  const properties = sourceRecord.declarations[0].init.properties.filter(
    (property) =>
      ["success", "stage", "firstFailure"].includes(property.key.name),
  );
  const projection =
    "({" +
    properties
      .map((property) => driverText.slice(property.start, property.end))
      .join(",") +
    "})";
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        vm.runInNewContext(projection, {
          success: true,
          stage: "private-qualification",
          code: "PRIVATE_LOADER_UNAVAILABLE",
        }),
      ),
    ),
    { success: true, stage: "complete", firstFailure: null },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        vm.runInNewContext(projection, {
          success: false,
          stage: "cef-gn",
          code: "FULL_SOURCE_CHILD_FAILED",
        }),
      ),
    ),
    {
      success: false,
      stage: "cef-gn",
      firstFailure: "FULL_SOURCE_CHILD_FAILED",
    },
  );
});

test("reviewed1192 source programs carry into the private builder without changing private authority or any other source byte", () => {
  const ast = parse(driverText, {
    sourceType: "module",
    ecmaVersion: "latest",
  });
  for (const row of SOURCE_PROGRAM_HISTORY) {
    const node = ast.body.find(
      (item) => (item.declaration ?? item).id?.name === row.name,
    );
    let raw = driverText.slice(node.start, node.end);
    if (row.name === "bootstrapProgram") {
      const gate =
        "      PRIVATE_DRIVER_ADMITTED &&\n      p.privatePolicy.privateAuthorityAdmitted === true &&\n";
      assert.equal(raw.split(gate).length, 2);
      assert.equal(
        raw.split(
          " data.need(P['enabled'] is True and value['mode']=='private-compiler-input-qualification' and value['image']==P['image'] and value['image'] in ('20261030.294.1','20261021.278.1') and value['repositoryId']=='1010282954' and value['visibility']=='public' and value['event']=='workflow_dispatch' and value['ref']=='refs/heads/codex/windows-arm-engine-qualification-20261101','FULL_BOOTSTRAP_AUTHORITY')",
        ).length,
        2,
      );
      raw = raw
        .replace(gate, "")
        .replace(
          " data.need(P['enabled'] is True and value['mode']=='private-compiler-input-qualification' and value['image']==P['image'] and value['image'] in ('20261030.294.1','20261021.278.1') and value['repositoryId']=='1010282954' and value['visibility']=='public' and value['event']=='workflow_dispatch' and value['ref']=='refs/heads/codex/windows-arm-engine-qualification-20261101','FULL_BOOTSTRAP_AUTHORITY')",
          " data.need(P['enabled'] is True and value['mode']=='image-qualified-source-gn' and value['image']==P['image']=='20261030.294.1' and value['repositoryId']=='1010282954' and value['visibility']=='public' and value['event']=='workflow_dispatch' and value['ref']=='refs/heads/codex/windows-arm-image-qualified-source-gn-20261101','FULL_BOOTSTRAP_AUTHORITY')",
        );
    }
    assert.equal(hash(Buffer.from(raw)), row.reviewedSourceSha256, row.name);
  }
  assert.equal(
    hash(Buffer.from(restoreSourceProgramHistory(driverText))),
    "bfd0e1dcf590bfbec524fd30b790926ef2a445fbd65846ad8142bcaf1ee4359e",
  );
  assert.equal(PRIVATE_DRIVER_ADMITTED, false);
  assert.equal(policy.privateAuthorityAdmitted, false);
  assert.equal(policy.workflowActivation, false);
});
