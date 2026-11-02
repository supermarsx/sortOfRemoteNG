import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import * as currentDriver from "../../native/windows-arm-full-sdk/image-qualified-current-driver.mjs";
import * as oldDriver from "../../native/windows-arm-full-sdk/image-qualified-20261021-driver.mjs";
import {
  customRuntimeBuildRecipe,
  validateSourceLock,
  identitySha256,
  prepareSourceGitIsolation,
  sourceGitEnvironment,
} from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-custom-runtime.mjs";
import { cefHookArguments } from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/cef-runtime-ci.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => fs.readFile(path.join(root, p));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const adoptedHelper =
  "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-custom-runtime.mjs";
const adoptedPin = {
  bytes: 70755,
  sha256: "f6772b8785ccf96a721013fa93a79c3ae252d19b986e338f59265f3c62f8827f",
};
const runtimeProfilePolicy = {
  kind: "owned-windows-runtime-profile-v1",
  scope: "explicit-windows-option-only",
  baseBytes: 69741,
  baseSha256:
    "7a2fb8f3ca0ba4404050e37b7382fe53789cdb3b70682d1930205508c72a3217",
  callerPathAccepted: false,
};
const runtimeDelta = [
  [
    `// Only this separately creation-owned runtime profile permits cache writes.
// Existing policy directories retain their complete timestamp fingerprints.
const sourceGitRuntimeDirectory = (s) =>
  [s.dev, s.ino, s.birthtimeNs, s.mode, s.nlink].join(":");
`,
    "",
  ],
  [
    `  let runtimeProfile;
  if (windowsLongPaths) {
    const profile = path.join(directory, "runtime-profile");
    await mkdir(profile, { mode: 0o700 });
    await sourceGitPhysical(profile);
    runtimeProfile = {
      path: profile,
      identity: sourceGitRuntimeDirectory(
        await lstat(profile, { bigint: true }),
      ),
    };
  }
`,
    "",
  ],
  ["    runtimeProfile,\n", ""],
  [
    `    if (policy.runtimeProfile) {
      await sourceGitPhysical(policy.runtimeProfile.path);
      const current = await lstat(policy.runtimeProfile.path, { bigint: true });
      if (
        !current.isDirectory() ||
        sourceGitRuntimeDirectory(current) !== policy.runtimeProfile.identity
      )
        fail("SOURCE_GIT_POLICY_DIRECTORY");
    }
`,
    "",
  ],
  [
    `      USERPROFILE:
        policy.runtimeProfile?.path ?? path.join(policy.directory, "home"),`,
    '      USERPROFILE: path.join(policy.directory, "home"),',
  ],
];
const adoption = {
  commit: "8f0b0dd0fbfc9aefe00bb00871752e195eea447a",
  operation: "windows-longpaths-option-only",
  baseBytes: 69294,
  baseSha256:
    "3c9a1b58222e234447a09c87c68e80247440d85b871f177758ee1ae5f879ee8b",
};
const adoptionBlock = `  const windowsLongPaths = options !== undefined;
  if (
    windowsLongPaths &&
    (process.platform !== "win32" ||
      !options ||
      Object.getPrototypeOf(options) !== Object.prototype ||
      Reflect.ownKeys(options).length !== 1 ||
      Object.getOwnPropertyDescriptor(options, "windowsLongPaths")?.value !==
        true)
  )
    fail("SOURCE_GIT_WINDOWS_LONGPATHS_OPTION");
`;
test("one mirrored helper carries separately reviewed Windows option/profile deltas with the entire historical helper preserved", async () => {
  const raw = await read(adoptedHelper);
  assert.equal(raw.length, adoptedPin.bytes);
  assert.equal(sha(raw), adoptedPin.sha256);
  let text = raw.toString();
  for (const [added, previous] of runtimeDelta) {
    assert.equal(text.split(added).length, 2);
    text = text.replace(added, previous);
  }
  assert.equal(Buffer.byteLength(text), runtimeProfilePolicy.baseBytes);
  assert.equal(sha(text), runtimeProfilePolicy.baseSha256);
  assert.equal(text.split(adoptionBlock).length, 2);
  const stanza = '${windowsLongPaths ? "\\tlongpaths = true\\n" : ""}';
  assert.equal(text.split(stanza).length, 2);
  const historical = text
    .replace(adoptionBlock, "")
    .replace(
      "export async function prepareSourceGitIsolation(directory, options)",
      "export async function prepareSourceGitIsolation(directory)",
    )
    .replace(stanza, "");
  assert.equal(Buffer.byteLength(historical), adoption.baseBytes);
  assert.equal(sha(historical), adoption.baseSha256);
});
const base = JSON.parse(await read("native/windows-arm-full-sdk/profile.json"));
const workflow = (
  await read(".github/workflows/windows-arm-source-preflight.yml")
)
  .toString()
  .replaceAll("\r\n", "\n");
// Exact resource projection inverse; all previous whole-driver pins remain.
const apacheWorkerProjection = String.raw`apache_action=('python3','src/third_party/depot_tools/download_from_google_storage.py','--no_resume','--directory','--recursive','--num_threads=16','--bucket','chromium-apache-win32','src/third_party/apache-win32')
def project_apache(command,kwargs):
 hook=getattr(scope,'hook',None)
 candidate=getattr(hook,'name',None)=='apache_win32' or any(value in command for value in ('chromium-apache-win32','src/third_party/apache-win32'))
 if not candidate:return command
 if type(hook)is not gclient.Hook or hook.name!='apache_win32' or hook.condition!='checkout_win' or hook.pattern!=chr(92)+'.sha1' or tuple(hook.action)!=apache_action or tuple(command)!=apache_action:raise RuntimeError('FULL_HOOK_APACHE_PROJECTION')
 cwd=kwargs.get('cwd');workspace=source_bootstrap.P['workspace']
 if type(cwd)is not str or cwd.replace(chr(92),'/').lower()!=workspace.lower():raise RuntimeError('FULL_HOOK_APACHE_CWD')
 source_bootstrap.data.plain(cwd)
 # Exact source-owned resource projection; preserve the original frozen action.
 effective=list(command);effective[5]='--num_threads=2'
 return effective
`;
const apacheAdmitted = String.raw`def admitted(self):
 previous=getattr(scope,'active',False);previous_hook=getattr(scope,'hook',None)
 original_action=self.action;apache_guard=self.name=='apache_win32';failed=False
 scope.active=True;scope.hook=self
 try: return original(self)
 except BaseException:failed=True;raise
 finally:
  scope.active=previous;scope.hook=previous_hook
  if not failed and apache_guard and (self.name!='apache_win32' or self.condition!='checkout_win' or self.pattern!=chr(92)+'.sha1' or self.action is not original_action or tuple(self.action)!=apache_action):raise RuntimeError('FULL_HOOK_APACHE_POSTCHECK')
`;
const historicalAdmitted = String.raw`def admitted(self):
 previous=getattr(scope,'active',False)
 scope.active=True
 try: return original(self)
 finally: scope.active=previous
`;
function previousTwoWorkerProjection(text) {
  // The same legacy projection also receives a single native Python program,
  // which has no JS observation blocks. Whole-driver inverses require all five.
  if (text.startsWith("// Closed Windows ARM source/GN adapter."))
    text = previousSourceApplyObservation(text);
  const current = " effective=list(command);effective[5]='--num_threads=4'\n";
  const previous = " effective=list(command);effective[5]='--num_threads=2'\n";
  assert.equal(text.split(current).length, 2, "one exact four-worker inverse");
  return text.replace(current, previous);
}
function previousSourceApplyObservation(text) {
  text = previousGnArgumentProjection(text);
  const patterns = [
    /\n\/\/ BEGIN bounded source-apply observation\n[\s\S]*?\/\/ END bounded source-apply observation\n\n/,
    /^  \/\/ BEGIN held source-apply observation snapshot\n[\s\S]*?^  \/\/ END held source-apply observation snapshot\n/m,
    /^  \/\/ BEGIN source-apply observation state\n[\s\S]*?^  \/\/ END source-apply observation state\n/m,
    /^    \/\/ BEGIN source-apply observation capture\n[\s\S]*?^    \/\/ END source-apply observation capture\n/m,
    /^      \/\/ BEGIN source-apply observation report\n[\s\S]*?^      \/\/ END source-apply observation report\n/m,
  ];
  for (const pattern of patterns) {
    assert.equal(
      [...text.matchAll(new RegExp(pattern.source, pattern.flags + "g"))]
        .length,
      1,
    );
    text = text.replace(pattern, "");
  }
  return text;
}
function previousHooksGnStageDeadline(text) {
  for (const [current, previous] of [
    [
      '(stage === "source-hooks-gn" && maximumSeconds === 2700)',
      '(stage === "source-hooks-gn" && maximumSeconds === 1800)',
    ],
    [
      'sourceStage(root, budget, "source-hooks-gn", 2700, async () => {',
      'sourceStage(root, budget, "source-hooks-gn", 1800, async () => {',
    ],
  ]) {
    assert.equal(text.split(current).length, 2);
    text = text.replace(current, previous);
  }
  return text;
}
function previousGnArgumentProjection(text) {
  text = previousHooksGnStageDeadline(text);
  for (const pattern of [
    /^# BEGIN fixed ARM64 GN argument projection\n[\s\S]*?^# END fixed ARM64 GN argument projection\n/m,
    /^# BEGIN fixed ARM64 GN projection completion\n[\s\S]*?^# END fixed ARM64 GN projection completion\n/m,
  ]) {
    assert.equal(
      [...text.matchAll(new RegExp(pattern.source, "gm"))].length,
      1,
    );
    text = text.replace(pattern, "");
  }
  const guard =
    "  if gn_projection_calls!=1:raise RuntimeError('FULL_GN_PROJECTION_COMPLETION')\n";
  assert.equal(text.split(guard).length, 2);
  return text.replace(guard, "");
}
function previousApacheProjection(text) {
  text = previousTwoWorkerProjection(text);
  for (const [added, previous] of [
    [apacheWorkerProjection, ""],
    [" effective=project_apache(command,kwargs)\n", ""],
    ["*effective[1:]]", "*command[1:]]"],
    [apacheAdmitted, historicalAdmitted],
  ]) {
    assert.equal(
      text.split(added).length,
      2,
      "one exact Apache projection inverse",
    );
    text = text.replace(added, previous);
  }
  return text;
}
async function sourceApplyObservationModel(label = "current") {
  const text = (
    await read(
      `native/windows-arm-full-sdk/image-qualified-${label}-driver.mjs`,
    )
  ).toString();
  const begin = text.indexOf("// BEGIN bounded source-apply observation\n");
  const end = text.indexOf("// END bounded source-apply observation\n", begin);
  assert(begin > 0 && end > begin);
  const block = text.slice(begin, end);
  assert(!block.includes("export "));
  const { pathToFileURL } = await import("node:url");
  const context = vm.createContext({
    path,
    pathToFileURL,
    Buffer,
    HELPER_ROOT: path.join(
      root,
      "native/windows-arm-full-sdk/current-source-helpers",
    ),
  });
  const model = vm.runInContext(
    block +
      "\n({ projectSourceApplyFailure, captureSourceApplyPatches, SOURCE_APPLY_FRAME_MODULES });",
    context,
  );
  return { ...model, text, context };
}

test("source-apply observation exact public preflight reasons replace legacy unknown without emitting messages", async () => {
  const helper = (await read(adoptedHelper)).toString();
  const fail = helper.slice(
    helper.indexOf("const fail = (message) => {"),
    helper.indexOf("function shape("),
  );
  assert.equal(
    fail.trim(),
    "const fail = (message) => {\n  throw new Error(message);\n};",
  );
  for (const label of ["current", "20261021"]) {
    const model = await sourceApplyObservationModel(label);
    const actualFail = vm.runInContext(
      fail +
        "\n(message) => {try {fail(message);} catch(error) {return error;}}",
      model.context,
    );
    for (const repository of ["cef", "chromium", "depotTools"]) {
      for (const [suffix, reason] of [
        ["checkout root required", "CHECKOUT_ROOT_REQUIRED"],
        ["source revision mismatch", "SOURCE_REVISION_MISMATCH"],
        [
          "clean checkout required; existing changes are never reset",
          "CLEAN_CHECKOUT_REQUIRED",
        ],
      ]) {
        const message = repository + ": " + suffix;
        assert(helper.includes("`${name}: " + suffix + "`"));
        const error = actualFail(message);
        const legacy = /^(?:FULL|SOURCE_GIT)_[A-Z_]{1,56}$/.test(error.message)
          ? error.message
          : "FULL_SOURCE_FAILED";
        assert.equal(legacy, "FULL_SOURCE_FAILED");
        const value = model.projectSourceApplyFailure(error);
        assert.equal(value.reason, reason);
        assert.equal(value.repository, repository);
        assert.equal(value.provider, "helper-preflight");
        assert.equal(value.frames, null);
        assert(!JSON.stringify(value).includes(message));
      }
    }
  }
});

test("source-apply observation identifies actual wrapped constructor only through copied reviewed patch tuples", async () => {
  const helper = (await read(adoptedHelper)).toString();
  const begin = helper.indexOf(
    "        `Patch application failed; applied repositories:",
  );
  const end = helper.indexOf("\n      );", begin);
  assert(begin > 0 && end > begin);
  const constructor = "throw new Error(\n" + helper.slice(begin, end) + "\n);";
  for (const [label, namespace] of [
    ["current", "current"],
    ["20261021", "reviewed-20261021"],
  ]) {
    const model = await sourceApplyObservationModel(label);
    const lock = JSON.parse(
      await read(
        `native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-${namespace}-source-gn/source-lock.json`,
      ),
    );
    const selectedProfile = JSON.parse(
      await read(
        `native/windows-arm-full-sdk/image-qualified-${label}-profile.json`,
      ),
    );
    assert.equal(identitySha256(lock), selectedProfile.sourceGn.sourceId);
    const expected = lock.patches.map((patch, index) => ({ ...patch, index }));
    assert.equal(expected.length, 23);
    const patches = model.captureSourceApplyPatches(lock);
    assert.equal(patches.length, 23);
    const makeError = vm.runInContext(
      "(appliedRepositories, group, appliedPatches, error) => {" +
        constructor +
        "}",
      model.context,
    );
    const completed = [];
    for (const repository of ["cef", "chromium"]) {
      const group = expected.filter((patch) => patch.repository === repository);
      for (const [count, patch] of group.entries()) {
        let error;
        try {
          makeError(completed, { repository }, count, {
            message: "PRIVATE_URL_TOKEN_PATH\n".repeat(1500),
          });
        } catch (value) {
          error = value;
        }
        assert(error);
        assert.equal(
          model.projectSourceApplyFailure(error).reason,
          "UNKNOWN",
          "bare projector has no trusted patch snapshot",
        );
        const value = model.projectSourceApplyFailure(error, patches);
        assert.equal(value.reason, "PATCH_APPLY_FAILED");
        assert.equal(value.repository, repository);
        assert.equal(value.patchIndex, patch.index);
        assert.equal(value.patchSha256, patch.sha256);
        assert.equal(value.code, null);
        assert(!JSON.stringify(value).includes("PRIVATE_URL_TOKEN_PATH"));
        assert(!JSON.stringify(value).includes(patch.path));
        lock.patches[patch.index].sha256 = "f".repeat(64);
        assert.equal(
          model.projectSourceApplyFailure(error, patches).patchSha256,
          patch.sha256,
        );
      }
      if (group.length) completed.push(repository);
    }
    for (const message of [
      "PRIVATE Patch application failed; applied repositories: none; current repository: cef; completed patches: 0. No rollback/reset performed. private",
      "Patch application failed; applied repositories: none; current repository: cef; completed patches: 99. No rollback/reset performed. private",
      "Patch application failed; applied repositories: none; current repository: chromium; completed patches: 0. No rollback/reset performed. private",
    ])
      assert.equal(
        model.projectSourceApplyFailure({ message }, patches).reason,
        "UNKNOWN",
      );
    assert.equal(
      model.captureSourceApplyPatches({ patches: Array(25).fill(expected[0]) }),
      null,
    );
    const identity = model.text.indexOf('"FULL_SOURCE_IDENTITY",');
    const capture = model.text.indexOf(
      "const sourceApplyPatches = captureSourceApplyPatches(lock);",
    );
    const recipe = model.text.indexOf(
      "const recipe = await custom.customRuntimeBuildRecipe(",
    );
    assert(identity < capture && capture < recipe);
    assert.equal(
      model.text.split("captureSourceApplyPatches(lock)").length,
      3,
      "private declaration and sole held-lock callsite",
    );
  }
});

test("source-apply observation never calls hostile own getters and denies inherited or unknown fields", async () => {
  const { projectSourceApplyFailure: project } =
    await sourceApplyObservationModel();
  let calls = 0;
  const hostile = {};
  for (const name of ["message", "stack", "code", "signal"])
    Object.defineProperty(hostile, name, {
      get() {
        calls++;
        throw "PRIVATE_SECRET";
      },
    });
  const result = project(hostile);
  assert.equal(calls, 0);
  assert.equal(result.reason, "UNKNOWN");
  assert.equal(result.frames, null);
  const inherited = Object.create({
    message: "cef: checkout root required",
    code: 2,
    signal: "SIGKILL",
  });
  assert.equal(project(inherited).reason, "UNKNOWN");
  assert.equal(project(inherited).exitCode, null);
  const proxy = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw "PRIVATE_PROXY";
      },
    },
  );
  assert.equal(project(proxy).reason, "UNKNOWN");
  for (const value of [null, false, 0, "PRIVATE_SECRET", undefined])
    assert.equal(project(value).reason, "UNKNOWN");
  for (const code of [
    "PRIVATE_SECRET",
    "PRIVATE_SECRET".repeat(10000),
    "FULL_NOT_REVIEWED",
    true,
    NaN,
    Infinity,
    -1,
    256,
  ]) {
    const value = project({
      code,
      signal: "PRIVATE_SECRET",
      message: "PRIVATE_SECRET",
    });
    assert.equal(value.code, null);
    assert.equal(value.exitCode, null);
    assert.equal(value.signal, null);
    assert(!JSON.stringify(value).includes("PRIVATE_SECRET"));
  }
  for (const code of [0, 2, 255])
    assert.equal(project({ code }).exitCode, code);
  for (const code of [
    "EACCES",
    "ENOSPC",
    "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    "SOURCE_GIT_POLICY_CHANGED",
  ])
    assert.equal(project({ code }).code, code);
  assert.equal(
    project({ message: "SOURCE_GIT_POLICY_CAPABILITY" }).provider,
    "helper-git-policy",
  );
});

test("source-apply observation filters own data frames to exact pinned public modules and bounds", async () => {
  const model = await sourceApplyObservationModel();
  const [source, pack] = model.SOURCE_APPLY_FRAME_MODULES;
  for (const subject of model.SOURCE_APPLY_FRAME_MODULES) {
    const file =
      subject.module === "source-helper"
        ? adoptedHelper
        : "native/windows-arm-full-sdk/current-source-helpers/scripts/browser-runtime-package.mjs";
    assert.equal(
      (await read(file)).toString().split("\n").length - 1,
      subject.lines,
    );
  }
  const lines = [
    "Error: PRIVATE_SECRET",
    `    at fail (${source.uri}:112:9)`,
    `    at ${pack.uri}:1:1`,
  ];
  const good = model.projectSourceApplyFailure({ stack: lines.join("\n") });
  assert.equal(good.frameEvidence, "own-data-stack");
  assert.equal(
    JSON.stringify(good.frames),
    JSON.stringify([
      { module: "source-helper", line: 112, column: 9 },
      { module: "package-helper", line: 1, column: 1 },
    ]),
  );
  assert(!JSON.stringify(good).includes(source.uri));
  assert(!JSON.stringify(good).includes("PRIVATE_SECRET"));
  for (const frame of [
    `${source.uri}.private:112:9`,
    source.uri.replace("current-source-helpers/", "foreign/") + ":112:9",
    `${source.uri}?private:112:9`,
    `${source.uri}#private:112:9`,
    `${source.uri}:0:1`,
    `${source.uri}:${source.lines + 1}:1`,
    `${source.uri}:1:4097`,
    `${source.uri}:1:01`,
    `${source.uri.replace("/scripts/lib/", "/scripts/../lib/")}:112:9`,
  ])
    assert.equal(
      model.projectSourceApplyFailure({ stack: "    at " + frame }).frames,
      null,
    );
  assert.equal(
    model.projectSourceApplyFailure({ stack: "x".repeat(16385) }).frames,
    null,
  );
  assert.equal(
    model.projectSourceApplyFailure({
      stack: Array(33).fill(`at ${source.uri}:112:9`).join("\n"),
    }).frames,
    null,
  );
  const native = new Error("PRIVATE_SECRET");
  assert.equal(
    typeof Object.getOwnPropertyDescriptor(native, "stack").get,
    "function",
    "pinned Node24 native Error stack is accessor-backed",
  );
  assert.equal(
    model.projectSourceApplyFailure(native).frames,
    null,
    "no native accessor invocation or guaranteed frames claim",
  );
});

test("source-apply observation catch preserves identical falsy primary when projection fails", async () => {
  const model = await sourceApplyObservationModel();
  const begin = model.text.indexOf(
    "    failed = true;\n    primary = error;\n    // BEGIN source-apply observation capture",
  );
  const end =
    model.text.indexOf("    throw error;", begin) + "    throw error;".length;
  assert(begin > 0 && end > begin);
  const body = model.text.slice(begin, end);
  const invoke = vm.runInContext(
    "(value, phase) => {let failed=false,primary,sourceApplyDiagnostic=null;const stage=phase,sourceApplyPatches=null;try {throw value;}catch(error){" +
      body +
      "}}",
    model.context,
  );
  vm.runInContext(
    "projectSourceApplyFailure = () => {throw new Error('PRIVATE_OBSERVER');};",
    model.context,
  );
  for (const value of [
    null,
    false,
    0,
    undefined,
    new Error("PRIVATE_PRIMARY"),
  ]) {
    let caught = false;
    try {
      invoke(value, "source-apply");
    } catch (error) {
      caught = true;
      assert.equal(error, value);
    }
    assert(caught);
  }
  assert.equal(body.split("throw error;").length, 2);
  assert(!body.includes("await"));
});

test("source-apply observation inverse restores complete d61 drivers and keeps helpers and native Hook fixture exact", async () => {
  for (const [label, bytes, digest] of [
    [
      "current",
      102193,
      "836f0023528a8e4c52154fadcf8d9230bf3d6cb0fe01525226877e329b0d1de2",
    ],
    [
      "20261021",
      102205,
      "6293f2bcebdd8d6b4b59149471a2d89f9aa0305e8d599fc83d979f590eb7f4e5",
    ],
  ]) {
    const model = await sourceApplyObservationModel(label);
    const original = previousSourceApplyObservation(model.text);
    assert.equal(Buffer.byteLength(original), bytes);
    assert.equal(sha(original), digest);
    const observation = model.text.slice(
      model.text.indexOf("// BEGIN bounded source-apply observation"),
      model.text.indexOf("// END bounded source-apply observation"),
    );
    assert(!observation.includes("prepareStackTrace"));
    assert(!observation.includes("await "));
    assert(!observation.includes("readFile"));
  }
  assert.equal(sha(await read(adoptedHelper)), adoptedPin.sha256);
  assert.equal(
    sha(await read("native/windows-arm-full-sdk/test_image_dispatch.py")),
    "bbe9a49a3039da95d49d55fb2dab55329a765471d82e659e30f0987f0ad44664",
  );
});

function historicalDependencyArguments(driver, depot, adapter, pin) {
  const args = driver.dependencyHookArguments(depot, adapter, pin);
  args[2] = previousApacheProjection(args[2]);
  return args;
}
const virtualenvExportCase = String.raw`  if args[0]=='export':
   data.need(len(args)==5 and args[1]=='--root' and args[3:]==['--ensure-file','-'],'FULL_BOOTSTRAP_CIPD_EXPORT_ARGV')
   out=data.plain(args[2]);name=out.parent.name;identity=name[len('virtualenv+'):]
   data.need(args[2].replace('\\','/')==out.as_posix() and out.name=='contents' and out.parent.parent==ROOT/'source-caches/vpython/store' and name.startswith('virtualenv+') and len(identity)==26 and all(c in '0123456789abcdefghijklmnopqrstuv'for c in identity) and identity[-1]in '048cgkos' and stat.S_ISDIR(out.lstat().st_mode),'FULL_BOOTSTRAP_CIPD_EXPORT_ROOT');return
`;
const virtualenvInputHelper = String.raw`def export_input(clock):
 # Exact pinned Chromium 3.11 install -> infra c77 / LUCI 7ba3 CIPDExport.
 # ensure.File.Serialize writes two spaces between this package and version.
 expected=b'infra/3pp/tools/virtualenv  version:2@20.25.1.chromium.8\n'
 clock.remaining();raw=sys.stdin.buffer.read(len(expected)+1);clock.remaining()
 data.need(type(raw)is bytes and raw==expected,'FULL_BOOTSTRAP_CIPD_EXPORT_INPUT')
 return raw

`;
const virtualenvExportDelta = [
  [
    "def run_checked(command,clock,stdin=None):",
    "def run_checked(command,clock):",
  ],
  [
    " if stdin is not None:return subprocess.run(command,check=False,shell=False,timeout=seconds,input=stdin).returncode\n",
    "",
  ],
  [virtualenvExportCase, ""],
  [virtualenvInputHelper, ""],
  [
    " stdin=export_input(context())if role=='cipd'and args[0]=='export'else None\n",
    "",
  ],
  [
    "  command=[value['client'if role=='cipd'else 'vpython']['path'],*args]\n  code=runner(command,clock)if stdin is None else runner(command,clock,stdin)",
    "  code=runner([value['client'if role=='cipd'else 'vpython']['path'],*args],clock)",
  ],
  [
    ";data.need(not(values and values[0]=='export'),'FULL_BOOTSTRAP_CIPD_EXPORT_ROLE');arguments",
    ";arguments",
  ],
];
function previousVirtualenvBootstrap(text) {
  for (const [added, previous] of virtualenvExportDelta) {
    assert.equal(text.split(added).length, 2, added);
    text = text.replace(added, previous);
  }
  return text;
}
for (const [label, driver, originalName] of [
  ["current", currentDriver, "current"],
  ["20261021", oldDriver, "reviewed-20261021"],
]) {
  const {
    SourceProgress,
    sourcePaths,
    sourceCommands,
    sourceEnvironment,
    bootstrapProgram,
    loadSealedProfile,
    reviewedHostClosure,
  } = driver;
  const raw = await read(
    `native/windows-arm-full-sdk/image-qualified-${label}-profile.json`,
  );
  const selected = JSON.parse(raw);
  const original = JSON.parse(
    await read(
      `native/windows-arm-full-sdk/${originalName}-source-profile.json`,
    ),
  );
  const p = {
    ...base,
    image: selected.image,
    sourceGn: selected.sourceGn,
    sourcePaths: selected.sourcePaths,
    phaseAdmission: {
      ...base.phaseAdmission,
      "image-qualified-source-gn": true,
    },
  };
  test(
    label +
      ": actual generated vpython export fixes pinned-native old RED with exact root and stdin while old CIPD families remain closed",
    async (t) => {
      const python = await projectionFixturePython();
      const directory = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), "cef-vpython-export-")),
      );
      t.after(async () => {
        assert.equal(await fs.realpath(directory), directory);
        await fs.rm(directory, { recursive: true });
      });
      const program = bootstrapProgram(directory, p, "a".repeat(64)).toString();
      const previous = previousVirtualenvBootstrap(program);
      const run =
        "import sys,json;from pathlib import Path;sys.path.insert(0,str(Path('native/windows-arm-full-sdk').resolve()));import test_image_dispatch as t;raw=sys.stdin.read(131073);assert len(raw)<=131072;p=json.loads(raw);print(json.dumps(t.selected_virtualenv_export_case(p['program'],p['previous'],p['root'])))";
      const result = spawnSync(python, ["-I", "-B", "-c", run], {
        cwd: root,
        input: JSON.stringify({ program, previous, root: directory }),
        encoding: "utf8",
        timeout: 20000,
        maxBuffer: 65536,
        windowsHide: true,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const facts = JSON.parse(result.stdout);
      assert.equal(facts.legacyDenied, "FULL_BOOTSTRAP_CIPD_ARGV");
      assert.equal(facts.newAccepted, true);
      assert.equal(facts.stdinBytes, 57);
      assert.equal(
        facts.stdinSha256,
        "6668f72f25b7f434c5ca5b8205410289381cdbd7d98cc3aaa8fbb6ce991eaf1b",
      );
      assert.deepEqual(facts.argv, [
        "export",
        "--root",
        path.join(
          directory,
          "source-caches/vpython/store/virtualenv+n21fvm7m09pn5o63l11eh3li0k/contents",
        ),
        "--ensure-file",
        "-",
      ]);
      assert.equal(facts.malformedVectorsDenied, 13);
      assert.equal(facts.stdinCasesDenied, 7);
      assert.equal(facts.directExportDenied, true);
      assert.equal(facts.oldEnsureFamiliesUnchanged, true);
      assert.equal(facts.payloadExecutablesInvoked, 0);
      assert.equal(facts.sourceDerivedNotObservedArgv, true);
      t.diagnostic(
        JSON.stringify({
          ...facts,
          argv: [
            facts.argv[0],
            facts.argv[1],
            "<owned-vpython-store-contents>",
            ...facts.argv.slice(3),
          ],
        }),
      );
    },
  );
  test(
    label +
      ": actual generated export rejects an owned-looking junction before stdin or client dispatch",
    async (t) => {
      const python = await projectionFixturePython();
      const directory = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), "cef-vpython-alias-")),
      );
      t.after(async () => {
        assert.equal(await fs.realpath(directory), directory);
        await fs.rm(directory, { recursive: true });
      });
      const store = path.join(directory, "source-caches/vpython/store");
      await fs.mkdir(store, { recursive: true });
      const target = path.join(directory, "alias-target");
      await fs.mkdir(path.join(target, "contents"), { recursive: true });
      const alias = path.join(store, "virtualenv+n21fvm7m09pn5o63l11eh3li0k");
      await fs.symlink(target, alias, "junction");
      const program = bootstrapProgram(directory, p, "a".repeat(64)).toString();
      const run =
        "import sys,json;from pathlib import Path;sys.path.insert(0,str(Path('native/windows-arm-full-sdk').resolve()));import test_image_dispatch as t;raw=sys.stdin.read(65537);assert len(raw)<=65536;p=json.loads(raw);print(json.dumps(t.selected_virtualenv_export_guard(p['program'],p['root'],p['argv'])))";
      const result = spawnSync(python, ["-I", "-B", "-c", run], {
        cwd: root,
        input: JSON.stringify({
          program,
          root: directory,
          argv: [
            "export",
            "--root",
            path.join(alias, "contents"),
            "--ensure-file",
            "-",
          ],
        }),
        encoding: "utf8",
        timeout: 20000,
        maxBuffer: 65536,
        windowsHide: true,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        denied: true,
        code: "ACQ_LINK",
      });
    },
  );
  test(
    label +
      ": " +
      "actual derivative seals all94 files before helper imports and rejects source/profile drift",
    async () => {
      const sources = await Promise.all(
        selected.sourcePaths.map(async (name) => {
          const raw = await read(name);
          return { path: name, bytes: raw.length, sha256: sha(raw) };
        }),
      );
      const c = {
        mode: selected.mode,
        ref: selected.ref,
        image: selected.image,
        workflow: selected.workflow,
        wallWorkEnd: Date.now() / 1000 + 7200,
        sources,
      };
      const operation = path.join(
        root,
        ".artifacts/windows-arm-full-sdk-seal-fixture",
      );
      const sealed = await loadSealedProfile(operation, c);
      assert.equal(sealed.p.sourceGn.sourceId, selected.sourceGn.sourceId);
      for (const [index, kind] of [
        [0, "source"],
        [12, "profile"],
        [13, "other-profile"],
        [14, "driver"],
        [15, "other-driver"],
        [25, "helper"],
      ]) {
        const bad = structuredClone(c);
        bad.sources[index].sha256 = "0".repeat(64);
        await assert.rejects(
          loadSealedProfile(operation, bad),
          /FULL_DRIVER_PIN/,
        );
      }
      const oldImage = {
        ...c,
        image:
          selected.image === "20261030.294.1"
            ? "20261021.278.1"
            : "20261030.294.1",
      };
      await assert.rejects(
        loadSealedProfile(operation, oldImage),
        /FULL_CURRENT_ADMISSION/,
      );
      for (const changes of [
        { ref: original.ref },
        { mode: original.mode },
        { image: "unknown" },
        {
          image:
            selected.image === "20261030.294.1"
              ? "20261021.278.1"
              : "20261030.294.1",
        },
      ])
        await assert.rejects(
          loadSealedProfile(operation, { ...c, ...changes }),
          /FULL_CURRENT_ADMISSION/,
        );
      const reordered = structuredClone(c);
      [reordered.sources[20], reordered.sources[21]] = [
        reordered.sources[21],
        reordered.sources[20],
      ];
      await assert.rejects(
        loadSealedProfile(operation, reordered),
        /FULL_DRIVER_SOURCES/,
      );
      const text = (
        await read(
          `native/windows-arm-full-sdk/image-qualified-${label}-driver.mjs`,
        )
      ).toString();
      const main = text.slice(text.indexOf("export async function main("));
      assert(
        main.indexOf("loadSealedProfile(") <
          main.indexOf("const custom = await import("),
      );
    },
  );

  test(
    label + ": " + "selected host pins are exact and reject the opposite image",
    () => {
      assert.deepEqual(p.sourceGn.hostClosure, original.sourceGn.hostClosure);
      assert.deepEqual(p.sourceGn.hostTools, original.sourceGn.hostTools);
      const value = reviewedHostClosure(p, selected.image);
      assert.equal(value.rows.length, 18);
      assert.equal(value.edgeCount, 242);
      assert.equal(
        value.edgeSha256,
        "78537ac08d4dddabd50a5c83cdbd676114fdf03cf9abe670359c4ffd20ba5d9a",
      );
      assert.throws(
        () =>
          reviewedHostClosure(
            p,
            selected.image === "20261030.294.1"
              ? "20261021.278.1"
              : "20261030.294.1",
          ),
        /FULL_HOST_IMAGE/,
      );
      assert.equal(selected.originalRecipe.image, selected.image);
    },
  );

  test(
    label +
      ": " +
      "actual derivative stage keeps original deadlines and primary errors through telemetry faults",
    async () => {
      const text = (
        await read(
          `native/windows-arm-full-sdk/image-qualified-${label}-driver.mjs`,
        )
      ).toString();
      const begin = text.indexOf("async function sourceStage("),
        end = text.indexOf("async function executeCommand(", begin);
      const scheduled = [];
      let callback,
        closed = 0;
      const exit = { kind: "owned-stage-exit" };
      const records = [];
      const actual = vm.runInNewContext("(" + text.slice(begin, end) + ")", {
        need: (ok, code) => assert(ok, code),
        path,
        Buffer,
        performance: { now: () => 0 },
        setTimeout: (fn, ms) => {
          callback = fn;
          scheduled.push(ms);
          return 1;
        },
        clearTimeout: () => closed++,
        writeFileSync: (_file, raw) => {
          records.push(JSON.parse(raw));
          throw new Error("metadata IO failure");
        },
        writeSync: () => {
          throw new Error("metadata stderr failure");
        },
        process: {
          exit: () => {
            throw exit;
          },
        },
        sourceReportingFailure: false,
      });
      const original = { kind: "original-source-failure" };
      let caught;
      try {
        await actual(
          "owned",
          { remaining: () => 1000000 },
          "source-acquisition",
          4500,
          async () => {
            const progress = new SourceProgress(
              path.join(root, "absent-progress-root"),
              "a".repeat(64),
            );
            progress.close();
            throw original;
          },
        );
      } catch (error) {
        caught = error;
      }
      assert.equal(caught, original);
      assert.equal(scheduled[0], 880000);
      assert.equal(closed, 1);
      try {
        await actual(
          "owned",
          { remaining: () => 500000 },
          "source-hooks-gn",
          2700,
          async () => callback(),
        );
      } catch (error) {
        caught = error;
      }
      assert.equal(caught, exit);
      assert.equal(scheduled[1], 380000);
      assert.equal(closed, 2);
      assert.equal(records[0].firstFailure, "FULL_SOURCE_STAGE_DEADLINE");
    },
  );

  test(
    label +
      ": actual hooks/GN stage old1800 RED new2700 GREEN stays inside original whole end and reserve (modeled clocks only)",
    async () => {
      const text = (
        await read(
          `native/windows-arm-full-sdk/image-qualified-${label}-driver.mjs`,
        )
      ).toString();
      const extract = (source) => {
        const start = source.indexOf("async function sourceStage(");
        const end = source.indexOf("async function executeCommand(", start);
        assert(start > 0 && end > start);
        return source.slice(start, end);
      };
      const run = async ({
        legacy = false,
        remaining = 7200000,
        elapsed = 2000000,
        stage = "source-hooks-gn",
        maximum = legacy ? 1800 : 2700,
        reject = false,
        failure,
      } = {}) => {
        let mono = 0,
          wall = 7200000 - remaining,
          scheduled,
          cleared = 0,
          entered = false,
          rejected = false,
          caught;
        const context = { wallWorkEnd: 7200 };
        const budget = driver.sourceBudget(
          context,
          p,
          () => wall,
          () => mono,
        );
        const actual = vm.runInNewContext(
          "(" +
            extract(legacy ? previousHooksGnStageDeadline(text) : text) +
            ")",
          {
            need: (ok, code) => {
              if (!ok) throw new Error(code);
            },
            performance: { now: () => mono },
            setTimeout: (_fn, ms) => {
              scheduled = ms;
              return 1;
            },
            clearTimeout: () => cleared++,
          },
        );
        try {
          await actual("inert", budget, stage, maximum, async () => {
            entered = true;
            const advance = elapsed === "boundary" ? scheduled : elapsed;
            mono += advance;
            wall += advance;
            if (reject) throw failure;
            return "fulfilled";
          });
        } catch (error) {
          rejected = true;
          caught = error;
        }
        assert.equal(context.wallWorkEnd, 7200);
        return { rejected, caught, scheduled, cleared, entered, budget };
      };
      const old = await run({ legacy: true });
      assert.equal(old.rejected, true);
      assert.equal(old.caught.message, "FULL_SOURCE_STAGE_DEADLINE");
      assert.equal(old.scheduled, 1800000);
      const current = await run();
      assert.equal(current.rejected, false);
      assert.equal(current.scheduled, 2700000);
      assert.equal(current.budget.remaining(), 5200000);
      assert.equal(current.cleared, 1);

      // Actual failed-run remaining987272ms plus its consumed1800s stage.
      // This is a modeled schedule, never a source/GN fulfillment claim.
      const remaining = 2787272.3024;
      const clipped = await run({ remaining });
      assert.equal(clipped.rejected, false);
      assert(Math.abs(clipped.scheduled - (remaining - 120000)) < 0.000001);
      assert(
        Math.abs(clipped.budget.remaining() - (remaining - 2000000)) < 0.000001,
      );
      const boundary = await run({ remaining, elapsed: "boundary" });
      assert.equal(boundary.rejected, true);
      assert.equal(boundary.caught.message, "FULL_SOURCE_STAGE_DEADLINE");
      assert(boundary.budget.remaining() >= 119999.999999);
      const expired = await run({ remaining, elapsed: 2800000 });
      assert.equal(expired.caught.message, "FULL_DRIVER_DEADLINE");
      const reserve = await run({ remaining: 120000 });
      assert.equal(reserve.caught.message, "FULL_SOURCE_RESERVE");
      assert.equal(reserve.entered, false);
      assert.equal(reserve.scheduled, undefined);

      const cancellation = Object.assign(new Error("owned cancellation"), {
        name: "AbortError",
      });
      for (const failure of [cancellation, undefined, null, false, 0, ""]) {
        const result = await run({
          remaining,
          elapsed: 2800000,
          reject: true,
          failure,
        });
        assert.equal(result.rejected, true);
        assert.equal(result.caught, failure);
        assert.equal(result.cleared, 1);
      }
      for (const [stage, maximum] of [
        ["source-hooks-gn", 1800],
        ["source-hooks-gn", 2701],
        ["source-hooks-gn", 4500],
        ["source-acquisition", 2700],
        ["caller-stage", 2700],
      ]) {
        const denied = await run({ stage, maximum });
        assert.equal(denied.caught.message, "FULL_SOURCE_STAGE");
        assert.equal(denied.entered, false);
        assert.equal(denied.scheduled, undefined);
      }
      const acquisition = await run({
        stage: "source-acquisition",
        maximum: 4500,
      });
      assert.equal(acquisition.rejected, false);
      assert.equal(acquisition.scheduled, 4500000);
    },
  );

  test(
    label +
      ": " +
      "exact committed helper mirror and R5 payload closure remain distinct from unpromoted R6",
    async () => {
      assert.equal(
        selected.helperSourceCommit,
        "0fd6ebc70f110ff80909fe996fb4abf5499c9468",
      );
      assert.equal(selected.sourcePaths.length, 94);
      for (const row of [
        ...selected.sourceGn.helpers,
        ...selected.sourceGn.sourceData,
      ]) {
        const bytes = await read(row.path);
        assert.equal(bytes.length, row.bytes, row.path);
        assert.equal(sha(bytes), row.sha256, row.path);
      }
      for (const origin of selected.helperOrigins) {
        const pin = selected.sourceGn.helpers.find(
          (row) => row.path === origin.path,
        );
        assert.equal(pin.sha256, origin.sha256);
        assert.equal(pin.bytes, origin.bytes);
        if (origin.path === adoptedHelper) {
          assert.deepEqual(origin.reviewedDelta, adoption);
          assert.deepEqual(origin.runtimeProfilePolicy, runtimeProfilePolicy);
        } else {
          assert.equal(
            origin.reviewedDelta,
            undefined,
            "other twelve mirrors have no override",
          );
          assert.equal(origin.runtimeProfilePolicy, undefined);
        }
      }
      assert.equal(
        selected.helperOrigins.filter((origin) => origin.reviewedDelta).length,
        1,
      );
      const delta =
        ',\n      "reviewedDelta": ' +
        JSON.stringify(adoption, null, 2).replaceAll("\n", "\n      ") +
        ',\n      "runtimeProfilePolicy": ' +
        JSON.stringify(runtimeProfilePolicy, null, 2).replaceAll(
          "\n",
          "\n      ",
        );
      const profileText = raw.toString();
      assert.equal(profileText.split(adoptedPin.sha256).length, 3);
      assert.equal(profileText.split(delta).length, 2);
      const historicalProfile = profileText
        .replaceAll(adoptedPin.sha256, adoption.baseSha256)
        .replaceAll(
          '"bytes": ' + adoptedPin.bytes,
          '"bytes": ' + adoption.baseBytes,
        )
        .replace(delta, "");
      assert.equal(
        sha(historicalProfile),
        label === "current"
          ? "323b09244942b991c903838a9d1d36a3eed26e49fb38875745ad4102214b766f"
          : "ccf53e052f146ad9a5305cb90c60c720cbb8b9612af57d1338402032f3cc63c2",
      );
      const lock = validateSourceLock(
        JSON.parse(
          await read(selected.sourceGn.namespace + "source-lock.json"),
        ),
      );
      assert.equal(identitySha256(lock), selected.sourceGn.sourceId);
      assert.equal(lock.patches.length, 23);
      assert.equal(lock.bridge.patchId, "sorng-tls-v2-682c378-5");
      assert.equal(
        lock.bridge.header.sha256,
        "1352d790a75c1f48e3d7a7a5bbc4f63b40665d2c233c75f2ea50a10e5246d45e",
      );
      assert(!lock.patches.some((row) => row.path.includes("disk-cache")));
      assert.equal(
        lock.patches.find((row) => row.path.includes("external-webview"))
          .sha256,
        "6513168869d2e12b208ee5e4c4e01c8ac5eaf008ce3af21bbd7dc6251b8d08ce",
      );
    },
  );

  test(
    label +
      ": actual selected driver adopts the deployed helper and checks out a fresh nested long-path repository",
    {
      timeout: 30000,
    },
    async (t) => {
      const text = (
        await read(
          `native/windows-arm-full-sdk/image-qualified-${label}-driver.mjs`,
        )
      ).toString();
      const start = text.indexOf(
          "  const gitPolicy = await custom.prepareSourceGitIsolation(",
        ),
        end = text.indexOf("  const adapter =", start);
      assert(start > 0 && end > start);
      assert.equal(text.split("custom.prepareSourceGitIsolation(").length, 2);
      const call = text.slice(start, end),
        AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const folder = await fs.mkdtemp(
        path.join(await fs.realpath(os.tmpdir()), "deployed-source-longpath-"),
      );
      t.after(async () => {
        assert.equal(await fs.realpath(folder), folder);
        assert.equal(path.dirname(folder), await fs.realpath(os.tmpdir()));
        await fs.rm(folder, { recursive: true, force: true });
      });
      const invoke = new AsyncFunction(
        "root",
        "custom",
        "path",
        call + "return gitPolicy;",
      );
      if (process.platform !== "win32") {
        await assert.rejects(
          invoke(folder, { prepareSourceGitIsolation }, path),
          /SOURCE_GIT_WINDOWS_LONGPATHS_OPTION/,
        );
        await assert.rejects(
          fs.lstat(path.join(folder, "cef-source-git-policy")),
          { code: "ENOENT" },
        );
        return;
      }
      const token = await invoke(folder, { prepareSourceGitIsolation }, path);
      const safe = {
        SystemRoot: process.env.SystemRoot,
        PATH: "C:/Program Files/Git/cmd",
        LC_ALL: "C",
        APPDATA: path.join(folder, "owned-caches", "roaming"),
        LOCALAPPDATA: path.join(folder, "owned-caches", "local"),
      };
      const env = await sourceGitEnvironment(token, {
        ...safe,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.longpaths",
        GIT_CONFIG_VALUE_0: "false",
      });
      assert.equal(env.GIT_CONFIG_COUNT, undefined);
      assert.equal(env.GIT_ALLOW_PROTOCOL, "https");
      assert.equal(
        env.HOME,
        path.join(folder, "cef-source-git-policy", "home"),
      );
      assert.equal(
        env.XDG_CONFIG_HOME,
        path.join(folder, "cef-source-git-policy", "xdg"),
      );
      assert.equal(
        env.USERPROFILE,
        path.join(folder, "cef-source-git-policy", "runtime-profile"),
      );
      assert.notEqual(env.HOME, env.USERPROFILE);
      const beforeHome = await fs.lstat(env.HOME, { bigint: true });
      let python = base.python.path;
      try {
        const raw = await fs.readFile(python);
        assert.equal(raw.length, base.python.bytes);
        assert.equal(sha(raw), base.python.sha256);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        assert.notEqual(
          process.env.GITHUB_ACTIONS,
          "true",
          "Hosted fixture requires the exact pinned Python executable",
        );
        // Local Windows behavior qualification only. A hosted run must use
        // the existing exact3.12.10 executable pin above, never a fallback.
        const local = spawnSync(
          "python",
          ["-I", "-B", "-c", "import sys;print(sys.executable)"],
          {
            encoding: "utf8",
            timeout: 5000,
            maxBuffer: 4096,
            windowsHide: true,
          },
        );
        assert.equal(local.status, 0, local.stderr);
        python = local.stdout.trim();
      }
      const pythonResult = execFileSync(
        python,
        [
          "-I",
          "-B",
          "-c",
          [
            "import os,pathlib,json",
            "home=pathlib.Path.home()",
            "assert os.name=='nt' and str(home)==os.environ['USERPROFILE']",
            "for name in ('AppData','.gsutil'): (home/name).mkdir()",
            "print(json.dumps({'home':str(home),'expanded':os.path.expanduser('~'),'appdata':os.environ.get('APPDATA'),'localappdata':os.environ.get('LOCALAPPDATA')}))",
          ].join("\n"),
        ],
        {
          env,
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 4096,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const observed = JSON.parse(pythonResult);
      assert.equal(observed.home, env.USERPROFILE);
      assert.equal(observed.expanded, env.USERPROFILE);
      assert.equal(observed.appdata, safe.APPDATA);
      assert.equal(observed.localappdata, safe.LOCALAPPDATA);
      for (const name of ["AppData", ".gsutil"]) {
        assert(
          (await fs.lstat(path.join(env.USERPROFILE, name))).isDirectory(),
        );
        await assert.rejects(fs.lstat(path.join(env.HOME, name)), {
          code: "ENOENT",
        });
      }
      const afterHome = await fs.lstat(env.HOME, { bigint: true });
      for (const key of [
        "dev",
        "ino",
        "mtimeNs",
        "ctimeNs",
        "birthtimeNs",
        "mode",
        "nlink",
      ])
        assert.equal(afterHome[key], beforeHome[key], key);
      await fs.writeFile(
        path.join(env.USERPROFILE, ".gitconfig"),
        "[core]\n longpaths = false\n",
      );
      await sourceGitEnvironment(token, safe);
      assert(
        (await fs.readFile(env.GIT_CONFIG_GLOBAL, "utf8")).includes(
          "\tlongpaths = true\n",
        ),
      );
      const executable = "C:/Program Files/Git/cmd/git.exe";
      const git = (cwd, args, environment = env) =>
        execFileSync(executable, ["-C", cwd, ...args], {
          env: environment,
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      const origin = git(folder, [
        "config",
        "--show-origin",
        "--get",
        "core.longpaths",
      ]).trim();
      const [location, value] = origin.split("\t");
      assert.equal(value, "true");
      assert(location.startsWith("file:"));
      const file = location.slice(5),
        decoded = file.startsWith('"') ? JSON.parse(file) : file;
      assert.equal(
        path.normalize(decoded),
        path.normalize(env.GIT_CONFIG_GLOBAL),
      );
      assert.notEqual(
        path.normalize(decoded),
        path.join(env.USERPROFILE, ".gitconfig"),
      );
      const repo = path.join(folder, "seed"),
        checkout = path.join(
          folder,
          "source-checkout",
          "src",
          "docs",
          "website",
        );
      await fs.mkdir(repo);
      await fs.mkdir(path.dirname(checkout), { recursive: true });
      git(repo, ["init", "--template="]);
      git(repo, ["config", "user.name", "Owned deployed fixture"]);
      git(repo, ["config", "user.email", "owned@example.invalid"]);
      git(repo, ["config", "core.autocrlf", "false"]);
      const components = Array.from(
        { length: 9 },
        (_, i) => `segment-${i}-` + "a".repeat(24),
      );
      const relative = components.join("/") + "/proof.txt",
        leaf = path.join(repo, ...components, "proof.txt"),
        content = "owned deployed longpath\n";
      assert(relative.length > 260);
      await fs.mkdir(path.dirname(leaf), { recursive: true });
      await fs.writeFile(leaf, content);
      git(repo, ["add", "--", relative]);
      git(repo, ["commit", "-qm", "owned fixture"]);
      // This sole local clone exception is test-only. Production HTTPS-only
      // protocol policy and all acquisition URLs remain unchanged.
      git(
        folder,
        [
          "-c",
          "protocol.file.allow=always",
          "clone",
          "--no-checkout",
          "--local",
          repo,
          checkout,
        ],
        { ...env, GIT_ALLOW_PROTOCOL: "file" },
      );
      assert.throws(
        () => git(checkout, ["config", "--local", "--get", "core.longpaths"]),
        (error) => error.status === 1,
      );
      assert.equal(
        git(checkout, ["config", "--bool", "core.longpaths"]).trim(),
        "true",
      );
      const defaultParent = path.join(folder, "default");
      await fs.mkdir(defaultParent);
      const legacy = await prepareSourceGitIsolation(
        path.join(defaultParent, "cef-source-git-policy"),
      );
      const legacyEnv = await sourceGitEnvironment(legacy, safe);
      assert.equal(legacyEnv.USERPROFILE, legacyEnv.HOME);
      await assert.rejects(
        fs.lstat(
          path.join(defaultParent, "cef-source-git-policy", "runtime-profile"),
        ),
        { code: "ENOENT" },
      );
      assert.throws(
        () => git(checkout, ["checkout", "--force", "HEAD"], legacyEnv),
        (error) => {
          assert(error.status !== 0);
          assert.match(
            error.stderr,
            /Filename too long|cannot create directory/i,
          );
          return true;
        },
      );
      const partial = path.join(checkout, components[0]);
      try {
        await fs.lstat(partial);
        await fs.rm(partial, { recursive: true, force: true });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      git(checkout, ["checkout", "--force", "HEAD"]);
      assert.equal(
        await fs.readFile(
          path.join(checkout, ...components, "proof.txt"),
          "utf8",
        ),
        content,
      );
      await sourceGitEnvironment(token, safe);
      await sourceGitEnvironment(legacy, safe);
    },
  );

  test(
    label +
      ": " +
      "mirrored current helpers derive an explicit Windows recipe without ambient main fallback",
    async () => {
      const lock = validateSourceLock(
        JSON.parse(
          await read(selected.sourceGn.namespace + "source-lock.json"),
        ),
      );
      const operation = path.join(
        root,
        ".artifacts/windows-arm-full-sdk-recipe-fixture",
      );
      const files = sourcePaths(operation, p);
      const recipe = await customRuntimeBuildRecipe({
        sourceLock: lock,
        target: p.target,
        inputsRoot: files.inputs,
        checkouts: {
          chromium: files.chromium,
          cef: files.cef,
          depotTools: files.depot,
        },
      });
      assert.equal(recipe.requiredHost, "win32");
      assert.equal(recipe.commands.length, 3);
      const env = sourceEnvironment(operation, p, recipe);
      assert.equal(env.DEPOT_TOOLS_WIN_TOOLCHAIN, "0");
      assert.equal(env.GIT_TERMINAL_PROMPT, "0");
      const commands = sourceCommands(
        operation,
        p,
        cefHookArguments(files.cef, files.depot),
        "a".repeat(64),
      );
      assert.deepEqual(
        commands.map((row) => row.role),
        [
          "sync",
          "hook-projection",
          "dependency-hooks",
          "setup-x86",
          "setup-x64",
          "setup-arm64",
          "verify-setup",
          "cef-gn",
        ],
      );
      assert(commands.every((row) => !row.args.includes("--build")));
      const python = bootstrapProgram(operation, p, "a".repeat(64)).toString();
      assert(python.includes("value['mode']=='image-qualified-source-gn'"));
      assert(python.includes("P['image']=='" + selected.image + "'"));
      assert(!python.includes("codex/windows-arm-source-gn-20261026"));
    },
  );

  test(
    label +
      ": " +
      "image-qualified carrier admits only its exact new branch/image/mode and seals all94 sources",
    () => {
      const begin = workflow.indexOf("// BEGIN FIXED CARRIER AUTHORITY");
      const end = workflow.indexOf("// END FIXED CARRIER AUTHORITY", begin);
      const authority = vm.runInNewContext(
        workflow.slice(begin, end) + "\ncarrierAuthority;",
        { assert, Object },
      );
      const ref = selected.ref;
      const env = {
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
        GITHUB_REPOSITORY_ID: "1010282954",
        GITHUB_REPOSITORY_VISIBILITY: "public",
        CEF_DEFAULT_BRANCH: "main",
        GITHUB_REF: ref,
        GITHUB_SHA: "a".repeat(40),
        GITHUB_WORKFLOW_SHA: "a".repeat(40),
        GITHUB_WORKFLOW_REF:
          "supermarsx/sortOfRemoteNG/" + selected.workflow + "@" + ref,
      };
      const event = {
        repository: {
          id: 1010282954,
          full_name: "supermarsx/sortOfRemoteNG",
          private: false,
          visibility: "public",
          default_branch: "main",
        },
        inputs: { mode: selected.mode },
      };
      assert.equal(authority(env, event), "image-qualified-source-gn");
      const select = vm.runInNewContext(
        workflow.slice(begin, end) + "\ncarrierTuple;",
        { assert, Object },
      );
      const tuple = select(selected.image);
      assert.equal(tuple.image, selected.image);
      assert.equal(tuple.profile, `image-qualified-${label}-profile.json`);
      assert.equal(tuple.driver, `image-qualified-${label}-driver.mjs`);
      assert.equal(tuple.sha256, sha(raw));
      assert.equal(tuple.sourceId, selected.sourceGn.sourceId);
      assert.equal(tuple.namespace, selected.sourceGn.namespace);
      for (const image of [
        "",
        "20261031.294.1",
        "__proto__",
        "toString",
        null,
        {},
        [],
        true,
      ])
        assert.throws(() => select(image));
      assert.throws(() =>
        authority(env, {
          ...event,
          inputs: { mode: selected.mode, image: selected.image },
        }),
      );
      const execution = workflow.slice(
        workflow.indexOf("try{\n            const event="),
      );
      assert(
        execution.indexOf("carrierTuple(process.env.ImageVersion)") <
          execution.indexOf("await pinnedPython()"),
      );
      assert(
        execution.indexOf("carrierTuple(process.env.ImageVersion)") <
          execution.indexOf("canonicalSource(process.env.GITHUB_SHA"),
      );

      for (const mode of [
        "source-gn",
        "current-source-gn",
        "source-preflight",
        "command-inventory",
        "compile",
        "sdk",
      ])
        assert.throws(() => authority(env, { ...event, inputs: { mode } }));
      for (const branch of [
        "main",
        "codex/windows-arm-current-source-gn-20261101",
        "codex/windows-arm-reviewed-20261021-source-gn-20261101",
        "codex/windows-arm-current-source-preflight-20261101",
        "codex/windows-arm-source-gn-20261026",
      ])
        assert.throws(() =>
          authority({ ...env, GITHUB_REF: "refs/heads/" + branch }, event),
        );
      assert.deepEqual(
        JSON.parse(workflow.match(/const allowed=(\[[^;]+\]);/)[1]),
        selected.sourcePaths,
      );
      assert.deepEqual(
        JSON.parse(workflow.match(/const sourcePaths=(\[[^;]+\]);/)[1]),
        selected.sourcePaths,
      );
      assert(
        workflow.includes(
          "assert.equal(hash(preflightRaw),selectedTuple.sha256)",
        ),
      );
      assert(workflow.includes("workMs=7200000"));
      assert(workflow.includes("actual.jobs.length===9"));
    },
  );

  test(
    label +
      ": " +
      "source telemetry retains only closed phase/numeric counts and metadata failure stays secondary",
    async () => {
      const folder = await fs.mkdtemp(
        path.join(await fs.realpath(os.tmpdir()), "source-progress-"),
      );
      let now = 0;
      const progress = new SourceProgress(folder, "a".repeat(64), () => now);
      try {
        progress.phase("gclient-sync");
        now = 15000;
        progress.observe(
          "sync",
          true,
          Buffer.from(
            "Syncing projects: 42% (42/100) https://private.invalid/secret\n",
          ),
        );
        progress.flush();
        const raw = (
          await fs.readFile(path.join(folder, "source-phase-result.json"))
        ).toString();
        const value = JSON.parse(raw);
        assert.equal(value.syncCompleted, 42);
        assert.equal(value.syncTotal, 100);
        assert(!raw.includes("private"));
        assert(!raw.includes("https:"));
        assert(!raw.includes("secret"));
        assert.doesNotThrow(() => progress.phase("https://private.invalid"));
        assert.equal(progress.failed, true);
      } finally {
        progress.close();
      }
      const report = JSON.parse(
        await fs.readFile(
          path.join(folder, "source-progress-metadata-result.json"),
        ),
      );
      assert.equal(report.metadataFailure, true);
      assert.equal(report.sourceOutcomeNotInferred, true);
    },
  );

  test(
    label +
      ": " +
      "the new driver changes only isolated authority/helper roots and bounded observation; no engine phase",
    async () => {
      const text = (
        await read(
          `native/windows-arm-full-sdk/image-qualified-${label}-driver.mjs`,
        )
      ).toString();
      assert(
        text.includes(
          'path.join(HELPER_ROOT, "scripts/lib/browser-custom-runtime.mjs")',
        ),
      );
      assert(!text.includes('path.join(REPO, "scripts/'));
      assert(text.includes('"source-acquisition", 4500'));
      assert(text.includes('"source-hooks-gn", 2700'));
      assert(text.includes("engineCompilationRequested: false"));
      assert(text.includes("compilerExecuted: null"));
      assert(!text.includes("--create-distrib"));
      const marker = "          node --input-type=module <<'NODE'\n",
        start = workflow.indexOf(marker),
        end = workflow.indexOf("          NODE\n", start);
      const script = workflow
        .slice(start + marker.length, end)
        .split("\n")
        .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
        .join("\n");
      new vm.Script(
        "(async()=>{\n" + script.replace(/^import .*;\n/gm, "") + "\n})",
      );
    },
  );
}

test(
  "deployed Windows profile capability rejects caller paths, replacement, aliases and sealed HOME writes",
  {
    skip:
      process.platform !== "win32"
        ? "Requires native Windows profile and junction behavior"
        : false,
  },
  async (t) => {
    const temp = await fs.realpath(os.tmpdir()),
      folder = await fs.mkdtemp(path.join(temp, "deployed-profile-guards-"));
    t.after(async () => {
      assert.equal(await fs.realpath(folder), folder);
      assert.equal(path.dirname(folder), temp);
      await fs.rm(folder, { recursive: true, force: true });
    });
    let getterRead = false;
    const getter = {};
    Object.defineProperty(getter, "windowsLongPaths", {
      get() {
        getterRead = true;
        throw Error("must not run");
      },
    });
    for (const [i, options] of [
      null,
      {},
      false,
      { windowsLongPaths: false },
      { windowsLongPaths: true, runtimeProfile: folder },
      Object.create(null),
      getter,
    ].entries()) {
      const parent = path.join(folder, "option-" + i);
      await fs.mkdir(parent);
      const policy = path.join(parent, "cef-source-git-policy");
      await assert.rejects(
        prepareSourceGitIsolation(policy, options),
        /SOURCE_GIT_WINDOWS_LONGPATHS_OPTION/,
      );
      await assert.rejects(fs.lstat(policy), { code: "ENOENT" });
    }
    assert.equal(getterRead, false);
    for (const kind of [
      "profile-replacement",
      "profile-link",
      "root-replacement",
      "home-write",
    ]) {
      const parent = path.join(folder, kind);
      await fs.mkdir(parent);
      const policy = path.join(parent, "cef-source-git-policy"),
        token = await prepareSourceGitIsolation(policy, {
          windowsLongPaths: true,
        });
      const env = await sourceGitEnvironment(token, {});
      if (kind === "home-write") await fs.mkdir(path.join(env.HOME, "AppData"));
      else if (kind === "root-replacement") {
        await fs.rename(policy, policy + "-old");
        await fs.mkdir(policy);
      } else {
        await fs.rename(env.USERPROFILE, env.USERPROFILE + "-old");
        if (kind === "profile-link")
          await fs.symlink(
            env.USERPROFILE + "-old",
            env.USERPROFILE,
            "junction",
          );
        else await fs.mkdir(env.USERPROFILE);
      }
      await assert.rejects(
        sourceGitEnvironment(token, {}),
        /SOURCE_GIT_POLICY_|ENOENT/,
      );
    }
    const ordinary = path.join(folder, "ordinary"),
      alias = path.join(folder, "alias");
    await fs.mkdir(ordinary);
    await fs.symlink(ordinary, alias, "junction");
    await assert.rejects(
      prepareSourceGitIsolation(path.join(alias, "cef-source-git-policy"), {
        windowsLongPaths: true,
      }),
      /SOURCE_GIT_POLICY_ALIAS|SOURCE_GIT_POLICY_LINK/,
    );
    await assert.rejects(
      fs.lstat(path.join(ordinary, "cef-source-git-policy")),
      { code: "ENOENT" },
    );
  },
);

async function projectionFixturePython() {
  try {
    const raw = await fs.readFile(base.python.path);
    assert.equal(raw.length, base.python.bytes);
    assert.equal(sha(raw), base.python.sha256);
    return base.python.path;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    assert(
      process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true",
      "Hosted Windows projection fixture requires the pinned Python",
    );
    return process.platform === "win32" ? "python" : "python3";
  }
}

async function selectedProjectionCases(driver, cases) {
  const python = await projectionFixturePython();
  const program = driver.hookProjectionArguments("fixture-depot")[2];
  assert(Buffer.byteLength(program) < 32768);
  const fixture =
    "import sys,json;from pathlib import Path;sys.path.insert(0,str(Path('native/windows-arm-full-sdk').resolve()));import test_image_dispatch as t;raw=sys.stdin.read(32769);assert len(raw)<=32768;p=json.loads(raw);print(json.dumps([t.selected_hook_projection_case(p['program'],case) for case in p['cases']]))";
  const result = spawnSync(python, ["-I", "-B", "-c", fixture], {
    cwd: root,
    input: JSON.stringify({ program, cases }),
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 262144,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

const formatterPinning = `# Reuse the unchanged pinned native helper, which has no instance state.
# This retains pin_all_deps behavior without constructing the DEPS formatter.
for dep in all_deps.values(): gclient.Flattener._pin_dep(None,dep)
`;
const originPinning = `# Only recursive Git dependencies can supply the DEPS origins observed here.
# Formatter-wide pinning would resolve all registered CIPD packages, even those
# that are irrelevant to this hook observation. Native source sync is unchanged.
for dep in all_deps.values():
 if not dep.should_recurse: continue
 if dep.GetScmName()!='git': raise RuntimeError('FULL_HOOK_PROJECTION_ORIGIN')
 gclient.Flattener._pin_dep(None,dep)
`;

test("actual native CIPD chain is RED for exact 4a32 observer and GREEN with origin-only pins for both selected images", async () => {
  for (const driver of [currentDriver, oldDriver]) {
    const current = driver.hookProjectionArguments("fixture-depot")[2];
    assert.equal(current.split(originPinning).length, 2);
    const previous = current.replace(originPinning, formatterPinning);
    assert.equal(
      sha(previous),
      "e26385be87b6cad3898ab3004dd669eaf32e185daec33676dfa95467ea64c794",
    );
    const red = await selectedProjectionCases(
      { hookProjectionArguments: () => ["-B", "-c", previous] },
      ["cipd-selected", "cipd-unselected"],
    );
    for (const value of red) {
      assert.equal(value.error?.message, "FULL_FIXTURE_CIPD_GLOBAL_RESOLVE");
      assert.equal(value.packet, null);
      assert.equal(value.cipdRegistrations, 1);
      assert.equal(value.cipdScmCreations, 1);
      assert.equal(value.cipdResolves, 1);
      assert.equal(value.ensureIncludedInactive, true);
    }
    const green = await selectedProjectionCases(driver, [
      "cipd-selected",
      "cipd-unselected",
      "gcs-nonrecursive",
    ]);
    for (const value of green) {
      assert.equal(value.error, null, JSON.stringify(value));
      assert.equal(value.cipdRegistrations, 0);
      assert.equal(value.cipdScmCreations, 0);
      assert.equal(value.cipdResolves, 0);
      assert.deepEqual(value.pins, []);
      assert.equal(value.parsed, 1);
      assert.equal(value.varsUnchanged, true);
      assert.equal(value.outsideMetadataQueried, false);
      const packet = driver.validateHookProjection(
        "FULL_HOOK_PROJECTION:" + JSON.stringify(value.packet) + "\n",
      );
      assert.equal(packet.origins.length, 3);
      assert.deepEqual(
        packet.hooks.map((hook) => hook.name),
        ["src", "src/third_party/angle", "src/third_party/dawn", "pre"],
      );
    }
  }
});

test("selected hook projection supports actual pinned sibling DEPS scoped vars without flattening them", async () => {
  for (const driver of [currentDriver, oldDriver]) {
    const [value] = await selectedProjectionCases(driver, ["scoped"]);
    assert.equal(value.error, null, JSON.stringify(value.error));
    assert.equal(value.flattenerConstructed, 0);
    assert.equal(value.parsed, 1);
    assert.equal(value.bootstrapBound, 1);
    assert.equal(value.varsUnchanged, true);
    assert.equal(value.outsideMetadataQueried, false);
    const projection = driver.validateHookProjection(
      "FULL_HOOK_PROJECTION:" + JSON.stringify(value.packet) + "\n",
    );
    assert.deepEqual(
      projection.hooks.map((hook) => [hook.name, hook.condition, hook.kind]),
      [
        ["src", "checkout_win", "hooks"],
        ["src/third_party/angle", "checkout_win", "hooks"],
        ["src/third_party/dawn", "False", "hooks"],
        ["pre", "False", "pre_deps_hooks"],
      ],
    );
    assert.deepEqual(projection.hooks[2].action, [
      "unsupported-platform-tool",
      "%PATH%",
      "x&echo y",
    ]);
    assert.equal(projection.origins.length, 3);
  }
});

test("selected hook projection retains native full-revision pinning, DEPS fallback and scoped Hook order", async () => {
  for (const driver of [currentDriver, oldDriver]) {
    const values = await selectedProjectionCases(driver, [
      "pinning",
      "custom-origin",
      "nonrecursive-pin",
      "shared-subtree",
    ]);
    for (const value of values) {
      assert.equal(value.error, null, JSON.stringify(value));
      assert.equal(value.varsUnchanged, true);
      assert.equal(value.flattenerConstructed, 0);
      assert.equal(value.outsideMetadataQueried, false);
      driver.validateHookProjection(
        "FULL_HOOK_PROJECTION:" + JSON.stringify(value.packet) + "\n",
      );
    }
    assert.deepEqual(values[0].pins, ["src/third_party/angle"]);
    assert(
      values[0].packet.origins.some((origin) =>
        origin.url.endsWith("@" + "b".repeat(40)),
      ),
    );
    const preferred = values[1].packet.origins;
    assert.equal(
      preferred.find(
        (origin) => origin.hierarchy.at(-1)[0] === "src/third_party/angle",
      ).deps_file,
      "DEPS",
    );
    assert.equal(
      preferred.find(
        (origin) => origin.hierarchy.at(-1)[0] === "src/third_party/dawn",
      ).deps_file,
      "DEPS.custom",
    );
    // Full formatter metadata was unnecessary: this non-origin never needs
    // PinToActualRevision. Typed CIPD/GCS side effects are covered above.
    assert.deepEqual(values[2].pins, []);
    assert.equal(values[2].packet.origins.length, 3);
    assert.deepEqual(
      values[3].packet.hooks.map((hook) => hook.name),
      [
        "src",
        "src/third_party/angle",
        "src/third_party/dawn",
        "src/third_party/angle",
        "pre",
      ],
    );
    const depArgs = historicalDependencyArguments(
      driver,
      "fixed-depot",
      "fixed-adapter",
      "a".repeat(64),
    );
    // Existing genuine Hook.run controls condition evaluation and dispatch.
    // Projection never replaces or pre-evaluates that existing execution API.
    const legacy =
      await import("../../native/windows-arm-full-sdk/source-driver.mjs");
    assert.deepEqual(
      depArgs,
      legacy.dependencyHookArguments(
        "fixed-depot",
        "fixed-adapter",
        "a".repeat(64),
      ),
    );
  }
});

test("selected hook projection denies graph, origin, pin and output failures before runhooks", async () => {
  const expected = {
    identity: "FULL_HOOK_DEP_IDENTITY",
    cycle: "FULL_HOOK_DEP_CYCLE_OR_DEPTH",
    unparsed: "FULL_HOOK_DEPS_UNPARSED",
    "hook-bound": "FULL_HOOK_COUNT",
    "dep-bound": "FULL_HOOK_DEP_BOUND",
    depth: "FULL_HOOK_DEP_CYCLE_OR_DEPTH",
    "unsafe-origin": "FULL_HOOK_PROJECTION_ORIGIN",
    "unsafe-name": "FULL_HOOK_PROJECTION_ORIGIN",
    "unsafe-url": "FULL_HOOK_PROJECTION_ORIGIN",
    "unsafe-url-space": "FULL_HOOK_PROJECTION_ORIGIN",
    "origin-bound": "FULL_HOOK_ORIGIN_COUNT",
    "output-bound": "FULL_HOOK_PROJECTION_BOUND",
    "pin-failure": "FULL_FIXTURE_PIN_FAILED",
    "recursive-non-git": "FULL_HOOK_PROJECTION_ORIGIN",
  };
  for (const driver of [currentDriver, oldDriver]) {
    for (const value of await selectedProjectionCases(
      driver,
      Object.keys(expected),
    )) {
      assert.equal(value.packet, null, value.case);
      assert.equal(value.error?.message, expected[value.case], value.case);
      assert.equal(value.varsUnchanged, true, value.case);
      assert.equal(value.flattenerConstructed, 0, value.case);
      assert.equal(value.outsideMetadataQueried, false, value.case);
    }
  }
});

async function apacheWorkerCases(driver, cases, previous = false) {
  let program = driver.dependencyHookArguments(
    "fixed-depot",
    "fixed-adapter",
    "a".repeat(64),
  )[2];
  if (previous === true) program = previousApacheProjection(program);
  if (previous === "two") {
    program = previousTwoWorkerProjection(
      driver.dependencyHookArguments(
        "fixed-depot",
        "fixed-adapter",
        "a".repeat(64),
      )[2],
    );
  }
  const code =
    "import sys,json;from pathlib import Path;sys.path.insert(0,str(Path('native/windows-arm-full-sdk').resolve()));import test_image_dispatch as t;raw=sys.stdin.read(65537);assert len(raw)<=65536;p=json.loads(raw);print(json.dumps([t.selected_apache_worker_case(p['program'],case)for case in p['cases']]))";
  const result = spawnSync("python", ["-I", "-B", "-c", code], {
    cwd: root,
    input: JSON.stringify({ program, cases }),
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 1024 ** 2,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const values = JSON.parse(result.stdout);
  for (const value of values) {
    assert.equal(value.nativeHookBytes, 4177);
    assert.equal(
      value.nativeHookSha256,
      "e6b563524e7f5efab03547a60b0f36fa6a6772e5563f45741e5f111dc6e926e9",
    );
    assert.equal(value.payloadExecutablesInvoked, 0);
    assert.equal(value.nativeJobExecuted, false);
    assert.equal(value.quotaConditionModeled, true);
  }
  return values;
}

test("exact Apache resource projection uses actual pinned native Hook.run old16 RED, prior2 and fixed4 for both images", async () => {
  for (const driver of [currentDriver, oldDriver]) {
    const [before] = await apacheWorkerCases(driver, ["apache"], true);
    assert.equal(before.modeledQuotaDenial, true);
    assert.equal(before.exitCode, 2);
    assert.equal(before.commands.length, 1);
    assert.equal(before.commands[0][5], "--num_threads=16");
    const [priorTwo] = await apacheWorkerCases(driver, ["apache"], "two");
    assert.equal(priorTwo.error, null);
    assert.equal(priorTwo.exitCode, 0);
    assert.equal(priorTwo.commands[0][5], "--num_threads=2");
    assert.equal(priorTwo.originalActionRetained, true);
    const [after] = await apacheWorkerCases(driver, ["apache"]);
    assert.equal(after.error, null);
    assert.equal(after.exitCode, 0);
    assert.equal(after.modeledQuotaDenial, false);
    assert.equal(after.commands.length, 1);
    assert.equal(after.commands[0][5], "--num_threads=4");
    assert.equal(after.originalThreads, "--num_threads=16");
    assert.equal(after.originalActionRetained, true);
    assert.equal(after.plainChecks, 1);
    assert.equal(after.bootstrapBound, 1);
    assert.deepEqual(after.evaluatedConditions, ["checkout_win"]);
    assert.deepEqual(
      after.commands[0].slice(1, 5),
      before.commands[0].slice(1, 5),
    );
    assert.deepEqual(after.commands[0].slice(6), before.commands[0].slice(6));
  }
});

test("Apache resource projection leaves unrelated hooks and native false conditions unchanged", async () => {
  for (const driver of [currentDriver, oldDriver]) {
    const [unrelated, disabled] = await apacheWorkerCases(driver, [
      "unrelated",
      "false-condition",
    ]);
    assert.equal(unrelated.error, null);
    assert.equal(unrelated.commands.length, 1);
    assert.equal(unrelated.commands[0].at(-1), "--num_threads=16");
    assert.equal(unrelated.plainChecks, 0);
    assert.equal(unrelated.originalActionRetained, true);
    assert.equal(disabled.error, null);
    assert.deepEqual(disabled.commands, []);
    assert.deepEqual(disabled.evaluatedConditions, ["checkout_win"]);
    assert.equal(disabled.plainChecks, 0);
  }
});

test("Apache resource projection rejects near-match hook/action/cwd substitutions and preserves first failure over postcheck", async () => {
  const cases = [
    "wrong-name",
    "wrong-condition",
    "wrong-pattern",
    "wrong-script",
    "wrong-bucket",
    "wrong-output",
    "wrong-flag-order",
    "duplicate-threads",
    "already-two",
    "already-four",
    "extra-flag",
    "cwd-outside",
    "cwd-alias",
  ];
  for (const driver of [currentDriver, oldDriver]) {
    const values = await apacheWorkerCases(driver, cases);
    for (const value of values) {
      assert.match(
        value.error?.message ?? "",
        value.case.startsWith("cwd-")
          ? /FULL_HOOK_APACHE_CWD/
          : /FULL_HOOK_APACHE_PROJECTION/,
      );
      assert.deepEqual(value.commands, []);
      assert.equal(value.plainChecks, 0);
    }
    const [mutated, first] = await apacheWorkerCases(driver, [
      "post-action-replaced",
      "first-failure",
    ]);
    assert.equal(mutated.error?.message, "FULL_HOOK_APACHE_POSTCHECK");
    assert.equal(mutated.originalActionRetained, false);
    assert.equal(mutated.commands.length, 1);
    assert.equal(first.exitCode, 2);
    assert.equal(first.error?.type, "SystemExit");
    assert.match(first.stderr, /FIXED_FIRST_FAILURE/);
    assert(!first.stderr.includes("FULL_HOOK_APACHE_POSTCHECK"));
  }
});

test("exact four-worker inverse restores complete1192 drivers and fixture before older historical inverses", async () => {
  for (const [label, expected] of [
    [
      "current",
      "2c495d997f7e68710a0a3482a55681d8f2a92dbe88587ba282e7cd4d73d183f6",
    ],
    [
      "20261021",
      "a0b1849b7860db6f4b0b4592aefedce52250b44ae505f4a8ec4e6913f5251d14",
    ],
  ]) {
    const text = (
      await read(
        `native/windows-arm-full-sdk/image-qualified-${label}-driver.mjs`,
      )
    ).toString();
    assert.equal(sha(previousTwoWorkerProjection(text)), expected);
  }
  const fixture = (
    await read("native/windows-arm-full-sdk/test_image_dispatch.py")
  ).toString();
  const added =
    "        elif case=='already-four':action[5]='--num_threads=4'\n";
  assert.equal(fixture.split(added).length, 2);
  assert.equal(
    sha(fixture.replace(added, "")),
    "76bc1c651f5fa382c0155a6e03c6c04a6156d2c23521e10b24850b240add9286",
  );
});

test("only reviewed selected hook projections, exact Apache resource projection and virtualenv bootstrap delta differ from historical drivers", async () => {
  const legacy =
    await import("../../native/windows-arm-full-sdk/source-driver.mjs");
  const previous = "export " + legacy.hookProjectionArguments.toString();
  for (const [label, driver, expected] of [
    [
      "current",
      currentDriver,
      "7c02861f5a153e7945556dbdb99267ab8386cd98682ba7ef932aa40c7c096833",
    ],
    [
      "20261021",
      oldDriver,
      "e98e2a38f282090fcde7fe900751d22b977d3e9d3fa1ce662b9527711bf0e06d",
    ],
  ]) {
    const next = driver.hookProjectionArguments.toString();
    assert.equal(
      sha(next),
      "ed7df75819d0af5e05b2e5bdca75838c0d3fb8c83da5e402c115a52a2a5d6a5d",
    );
    const current = (
      await read(
        `native/windows-arm-full-sdk/image-qualified-${label}-driver.mjs`,
      )
    ).toString();
    const source230c = previousApacheProjection(current);
    assert.equal(
      sha(source230c),
      label === "current"
        ? "6557ed37285875251c7c462238372e68a4e760fe06114f701f7485f226249422"
        : "f73355b7af6aba661a5ecb58c4556ddcb776309a7a02ba540aa4a0bc6de24181",
    );
    const text = previousVirtualenvBootstrap(source230c);
    assert.equal(
      sha(text),
      label === "current"
        ? "bf5ca75e2ea8dbda8cea19b6f276dfd1e64faa5f11d33d315a4528cd44a47eeb"
        : "dea410fbc0eb7a2b1c1a4449a052d309b33ee632b0065280f33efbccdc2c9e35",
    );
    assert.equal(text.split("export " + next).length, 2);
    assert.equal(next.split(originPinning).length, 2);
    const priorFunction = next.replace(originPinning, formatterPinning);
    assert.equal(
      sha(priorFunction),
      "a630542cf8874e30a76b7e2eedc7621ac544322e7ac0a16cc5473809e541f747",
    );
    assert.equal(
      sha(text.replace("export " + next, "export " + priorFunction)),
      label === "current"
        ? "ea8ca831574bfb25b6d52246e3174082641e00059b72b1651f4ed08b28e59b57"
        : "0620eb9c13e03a9623b4ce71d0320d79f0366eaf166f20c551415411b493a0b0",
    );
    const normalized = text.replace("export " + next, previous);
    assert.equal(sha(normalized), expected);
    assert.deepEqual(
      historicalDependencyArguments(driver, "depot", "adapter", "a".repeat(64)),
      legacy.dependencyHookArguments("depot", "adapter", "a".repeat(64)),
    );
  }
});

// Complete, unchanged CEF tools/gn_args.py at 682c378d70d5780061e96644dca16ddd8fd157a9.
// Deflate only transports the pinned primary source; no network or vendor process.
const pinnedCefGnArgsDeflate =
  "eNrFPGtz28iR3/Ur5qi4SO6S1MvW2rooVbIkO76VZcWyvZXYPiwIDCmcQIDBgHpsvP/9+jFPEKTkXCrn2rUJYKanp6df090zm+K4nN9X2fSqFrvbO/viw5UUx1dVOcsWM3E6G8s0lal4VcUzeVtW1+JoUV+VlRqJi7Kqs7JQIjEANjYRxK54XZbTXIo3RTISR3ku6KMSlVSyupHpSHxUUpQTUV9lSqhyUSUSgKRSwOO0vJFVASOO7wFcLF5engxVfQ/g8iyRBXSsr+JaJHEhxlJMykWRiqyAl1KcvTk+Pb88FZMsl6MN6P2B4CdVNq9FKmtZzbJCKmqblEUtC0CK0JBiLqshvJtk00UV47TEr3E1VaNp8SvBUwCOBo4rKRYK8KtLMV5keSqOT19tWYLdZvWVeH0+EpcSB5nNaBBAEFp1YehyPszljcwB3MuPb85OYACCDzOpxFQWsopz6A9DxFOgR6HqapEQmUcbm40pAc7Qa8YTmpR5Xt5mxVTUsbpWB9R6KE7khObMw6dyEi9ymAQQrZJ/X2QVTATmKW7ifCEJzyRW8OP2SlZIaXkv0mwykRUAE2ICk7S80UWMYISjJJFzmCMQpRqmNFwA8yaLCcHX59HJ6as356eXQhY3WVUWSBtoVWXxGBcMgX2SVTbJaI2A1qtApqUoyhrXcAJMUTPRaYaEpp4ZkZ7BvibC1tB1BtPP5jkxgFtsBdyGqzXOCqTgqnFxHBphDTW5KS/WSwnrI0Wcpgg1FoW8deCYa1sYNFxOs5CO7HZcAjPCJXaPihjU4K4FI5VJDq8j5Ohen2agJHMV8v8PwIQZc/moORajGlAUPsvkmhg2VkCputdH2c6BviQVOKKZIVPLCAfKOI/wy5WEZgBAzGPQIskC8DOdAKc54gaCAENYwuJ4QHfu/7FIofctaYKySDOeSzu0JgTRmwOuKDkDQo+luL6fy4E4vvgIBEyushros6jgjayTPq/mmwn1Rs0DDLJyQYgdrmIFLEorr6cC37KUmA1A+fREehWapa9gwb9vsPEC2L9cwATy7Foi+WUBU0ukNzaAc6O3jD0tsd/ey+bIKGNAMnVF8PFpLSoEK7kqS1TuBSp40plLvLwzMmNoVHDhWMuwQkBgMiP+mOblOM7ze8RjHKPaLZmlzRIe4BKCEkpBUAvLj7TUPh821W+ofEcOCHYKZRl7v5b1e/3yiGRI93gvFcz/QENv9LvNwPSN2VqMyKyiXrGEBTNXZSmRjdhQ90J16VQlL8nuYygWkMfxNFIOuJqH8Fn730a5Y9K0/x902/PoxrY4VaKHIpOWUhFH67H7D7MgD7aWD4U4QsNfa6XrCYf+HJBKY7TEZ/a9Vuwe5UQb8ZpwfPqhXdOIhKTU0ERAzzWkhD8vLTVRu7WqtkC5LM/ZkMQahIBN9MsVs75gZ8cfDPp94ie5ikZHhTgizob2p1UFq2eoU8NwtwBj4kOcxFkONnCDHJ0omixQUKJIZLM5OLsiHqsyX9Qy4udVzeZVVtTwtiATu6Hflsr8MjwDQifm9+BNF5F5ZZpU0vxSV7m8sw/3iv1aSeuQAqmTuqzu0cwRN8bEv+49WPcInYxIexmjjUROIvguDgGh0Tyur0YwK/y3Z57/p8wK+wBNC/D8ezBLEPco6g+4XwUf+n2Ni6qSx+FSNxEfbUDfx+Cj0Q5Hh+FPAq/JkHG0AesKxBpZUh8eii6YoL3d7sGGcCvAb9PyVnXh9ab4hR/ELAZFiX5zJYnw3aP3b/efdlH8u0dvT+DnCNrrVgglrmb4HYZtrOhINwLVijhoODIHI9mNZyk8bMi8Dds0rgC1JXQBHKP6Nk6W0dRoIJp3z/ejfx5P3W49niNVg7+l0C3udfOsWNx1+018+fUGAqJPKBu97sfiukDxK+fol6N3DHBrObNdu31ojGPJuwzM0sZG9JePb04/AMRXMYDa2NgAZSJmatqD/2lQwA0VOrfDF3aw83cfTg9EV/yI7fu660VcKfkJ9U+PtFAEOy2C0+l04G/6LFAPaiUFn8mJJ18f5J3VfzyfVyUMAypIXBBByeiOLBwLGzC3v0cIbI6zwoX8M8CEDcnfFyU60DyOGvGMen4fR+tOt0+YuK9o2uy3PjLAFyLBCgidbmclBPzWZwJugiKdgYVg5AgpYaZve37eORjufA3mMi7LXMaF3QwJrWf1UOANykozGuxvZffAB/wB3sAzcVt7nwmyQNhJc4WHQ7GYwWYy8XCoq3vuA4C7oy7aDwufP1hwk7yMa48x6KvhYa8d8lfQSt7hblgQY5HB0ZwI/lWAXVxV8T06I7ECHNVijvLbX6KUv+if1yz6165dsUuwFWYAVMIK2XaIDh4QBHab/BmdhnioJDSgfZujEmBQwG7Z51deYcu1moQobdS0QZPPxAvQBORZARh4xkd0LPEVkp26jdQ8B9nuDgzu3AV64D/BaDQevjUNNfQRyB8QoecJM77v933WoJZM/Pf8BuyuFmeahijJ0SNveRbXyRUTosnnWnG8Au0U11ZzeDrjvdMLTbVBm2WjIXjfbrvh1BRGeuIiIZADkp++5VV41SAxS80qptTyYWSoCRx4lhRE8z3xfP+gIeOroOSZajQGBgUV2x2AbJHJ/hxQincWN1rovvax6VfG0UzAwOk8UZ2ueKJH91DxNDc6fK/AI+mhW4JuQrvuxogHx9c8xQ3evECnZouXaB5nlUKewC0AuWwxOiYGWkWuJHDlP37fcGbGOCdgnlStQiygT5wBBojfeVm/whgl6YLepIPvCABFLg/EP0zP3ztkDiiUBVaxsCCBnhVKPsyDgedk8Q/FZFTJOKUnNiVIYHxEGtNr1x6a4z++4SFdcZ3NhZzN63sNFalkopYjX9AJiIYfaKVNJ70YUwVrLw30s7LkMJGJ8aESyqYFhx56uARGy/R5MJI+eFfJEf3sVd3/7n2Oh78dDf8WfdU/tocvoq8/9L+oHw7h/97ox/4fugNCLFBNBKAdNcAn0qNTq9G0Khfz3k7ffmXOCD/v9pvkY0ZzGye7M8xgfhPifmMykYc+m3G/AuTA/9ADEmDNpNzFZ/lz6EkdzoDliHrcK7KiyAz7Ib6mldQmANxu7VMYD5xcs+750dvTw09HZx9Pu7zswE21DKUAoJn4OAoJbQBjqzu1MbkXCGrA8Z8gdEB7Ph8YdsHtcUlGnsARBiacD8sE21EdR4ytG4HKqqjlVIL/n4HRUe3SGdqYBoGYE+ryWhbKmhg2QIfAPnrtr+U9fORWn7eXTF4OcskfyRHZNez1HaxgmQGGavCBHnbn67K7sSnOS2NRwFfIM5kCwXHFkCCkuwyxcC2RyNmKAbV71cZml7jXPC1uerK4IUb1uOoSaYVc1Ra8FwvyMtSVzPMhBSLVfVHHd26dJnk8VbzJ0wBGU1nbgQbgJfRZu1JLnrfpRHtgvVr0rr/heWrwrPF/K6upPAGGU70fkO8o4O3N4XV2I5FA9+gcjsHkA3NjOzWAIWIMUlIui0g4Q1jIdqUO3GNDnM8FbF1lKsEQiilGkaABco1vS1D/xjVsTBn6Om514oG9LNIHntoYLeYY4ui5pv0V67ciigLb/1SOF9NlV8UEZLSlpBARsPFsobT+5B27Cdfo5jShdwUIPplXStXMQNOMMaoFAiNv0KHEIJJEBJi5+0BEnTUD7pjLBPM8qcA8k6MPWCSJMUoThVTSy0yFWYxVGQwcYQK7eILmBZ0wrCPsAy6Blo5ummA+I4rzW/DIoxK23LybGJgGQL9Yxa3vwVbOywJEIaKIKzQxxPZb0Qv4hqLnvy8nkyzJ4tx2DuGDlQUZiZL5Aj5172ALjp+MFxIEC3iXzVxj5vi5u1DguN6rqizrrhX9lt4mBNLsDyjCp2gSqxoGuCYYvNEK291kagGzUPUizcoInRZq2u2ubQeaXsECPqZptQDzDeo8Belqb6+nEKn0eg0CfqvG8E6kTHMnVJaJkfUGKO4Du86H57D+y5KFihJdQ1SLLF1aQ+jwelOmUAYwlPbNwP2GfRakZf0cViND+w1w+QZfKXCdoJzgngxVXasqcJLmCcJDWgNac3aA3CorTqi+iRJEAEQSfwxM3EF0wGKtCPg68Uc5B28fnH0A5ZaAU+9mALt+aMH6bllWhcqXFsOPkTdUHmsvDv2H+e1A2/2b1JOzD9bun2SKLKzVNJzbUS7vm8o5JTYaGYkRibsGqSy8DKPcCm1TXiZxrqFRHpFEO+A2QJbdQrCBGLcdZ9qRY1hphv4RdIWJjtZqRa3YlmalAx9E0HGcXKOnDcYXtvUgZ7dXGdA6BRlF+4JOBdV/mGz/yEHTlADUZYFwyfNKpbquy7klCJk3aDKBCS1Adm7RbcoVTDEm98WCg0nFBRh/dbWoU4xSJlUMrg3JXKFdHSvDQGFWToxXDMiA0FhYjWVDvHSM2RKMUY7c9KNZmcpHEg2Wl+tnyH1BR1dXkdCaYJ69sDTBRIDHB3VVpouEPH4T9jYGSSPLnAWK5V4zl+3d2dpKaPYH/E+U5nlHsMEyC0eZFsyouFKZ5tKZuZtZRHYWkZvFGkrg6kyrOAWur0qYCi7NFgDD/SkPtrxOjm2u6nquDra2ptBwMR7BUvGkQPilrnvaSuRkK1MKZHxrb3/7eQNvO37kxl+D7pwU0TzLyfGBbpXhSfgvWVSYMMFcN7pWZtFcAs+Cw3UvymL4zqyWWT6jGY4mKN9megnAvaHZpc9+2t6fTJ6OdyZPf7LgqBzq7g5WqcxRPWxtEZwtfE6u4qzYArPpnkiXFeAqLwpbekH5UQMPY53AVcMJsPEil0PaaWNhAljce3H844+CiaBZ9J2ViIFPILdKTChBxWdcpgMNUAYZTddnlCRu0bf+mtDegHxaXxxRh1GyDxRziOOP1AlT3j/+uLsnUApJN8Bkzs4+vRW7e10nP6Dsi+kwIebmjViICO3JENC24DFoC1tNYpDVRZEZKfFXQecfwUGmUXmvjvEiXU0i70jsNTi2N3GgezVbemSMNPl85/L3dT4gOijBB0w4mdjykRhX0AiYS5vwxHg1EwEUgP0n6J+9XQGMUsVJjctG9jVISZN/YhkP8FzUdkFIXE/eggouKyyAe3MSBFC6cQ5AYf1klKSzSLeKsjQC14A9uRf7z8dPf9p/sf0ijZ/u/bQ33n7+Ynsv2X0unz978fTZ025z8v+x5ABv6s0NbQhR0JwSJ+VubCagjF+N9AV2RmonedM0dtrQmQCRLkgy0LmWGJBFPSN6oKioDK0Emww0AWVUVvcDDY7qkai68DvV1+7+Ty9CYgKyYyAdzMGz2OTzsd1WnsP/wJ5jk0o6Y6F3G36QYOSb55rCPp6j4Rwzil6iSxLQbWTyUIuiUeZIGQz0e4CAqIfzMuYqgxYcDJJ3z/etHc7vD+DdH4xUvf7rhal4ODQ7L/T1DrN4b7fr9Qc0YSvGYA6g/zTJM2QNWLWrsrxWAYmbOzBLTN8s/OWDp+Wt9N9K7frcxgWFzKzFdhU+GpC101g5GddcVki2DrMVvmOlpGFLyz0Y2wRnm0p2iYliy0ajsppuTe3jcA6AQN4qtZVsDXc/vZZ3fzn6ef92a7b17Odn8/nPL355eXT0X0sE+Hv9rLF1DL/uL5PGFNGMUTTEh7NL0sakbIlHhuk9qOwsGW38c6b8+fbeJv3Wwe7h7ovn2093957tbgcI0vioQ+dRVqgMDL0C1QZqNc/GFbjCwbZaV+eSysZ4CG0A2Wmk1eLSUi4F1V4bMBoWF1F2kn/S/oGKLbySCMqn6EqJAQUGbFMwx10dOTOtM4Xde0sA+21RpTCbstxnZUwaNmCvz0+LmxV7LrO/cnu99kJgrwDYRckIQkvQ2wYouw5Itx9sCf0qvZaNoN7Y2IDXEW4AdMkkOVu2EI48IeQZU/DWFsYzhhcrVmfZbzK6BfWZNUI9m+K0WHLcfwFmusGkCpi7pv2+1d8sHOdJkkYwzgH73oLL4+f5Ypo5V4D8kwgFTHvo/P1f5AjoCfmTEFclcPsNFXAnbNApFL3CkuupohnHjpHfsevFqVt7OMMfCKCH2cKcMJDi/dnfhBZX9MosD8Bir3M1zNYk/21t7Cy0grw+eu/iRXkod5rnYOS1DjWOf3xTZmDDgB/dZstYekwZKrtnEj1Q3uwjiM3dve2dvlF+J+xF4FxvQe2Q9reR+UyZyAQHj4gZtiw+lrtFVmtwSYxzAG+tTSxaaUQ0iCzMUJ2v0B0Uq2c5JeXYjNVriaUwvJNXF7/Cuv9DP+K/JiA0aCirgfCGZM1NBw/u2VutTZ1kxjWidXVPW/7SFUv6hyd0sYB+cbishnSoH7MEmdNBI3jWOoq4Sn/GiZmsjw674SudvTm03emFi7ZRxO2JOnyi/AAOBtY4hubn4gMQgYL3yImDDiwgo2KDekuOhrZkF0wrE/n0dl1mQyAFFoCJeAxOrtbCsIW+QdqqxRTkgxpjQpzinF6dlccDjcA9074RrF0O75O15JB+ew8T79cNaXYrW3JsXzcNA/or+zTi/n22/jrW397LywX0H1JDntPZDsz3SvsPJwQaaYCV0wpyBTqXvpQZaO/dkkFoA6Bj9o+BYcL7bWD8dMJjYAXpBwbYzDe0g1nKSix3XjultnyFVlgfiCGWDqyM6OPQ7jC1y6FEB/YunQH8s/+0Q4a5QyWeHdMBy0m9xitanSGbuXYUqeLGiyKXSjn/tmUj2MJozqfQus6TA1CGPc56mXLUfiAInKYEO8UIgIbVyNrKpzU8vWq45/s4nMm1rfrzED4eqR9CyxfcdqQsHgF2hIOH5ONRGhBCIWYPaBT45iuoQ0alYaY8rRIgcUiDu6MrXrtDv45teRCc4aMHoTn9c4MA3b5nGFzWNQORqBxdHp27Ru8lhsakF9OgijoyM8HSU02lySCLjm5CgB00m3qkOr+OX/TUNHZmWlgo3W1Asydimp14HlrPvAtTAg9OKbRtD0wubPzANB+0U01kVfPo2tbJ6cuPrw9eHV1+OHtz/rMtcFuBdhNx376txh+Dr/ki5Qn4Xehzx+xTjIJOQELLmbDh9cbpVWpsa7GD3etCn7Lhj2229rDzR7JN4Ll+uhTIon/q2Oacb3bHM2p9mLIGJJT4RMDEJQHjMJK8i7F0eIDafTHGEqNy4kHrHB98uajKaRXPqPJRiR7Iff/L2yypSlVO6hCm2Hk62u6MVmCvjR1MABDXD0u4u08NBDu72zvPVsL2rXlIoeP3Hx5NoJoRgC6NwRunyx9BIcMKP2e1+rKz/eW9xMTql0VS1V9Ozs7UFzIksH9XDWC645dLOjuxt0tdqPJshPk427rphnizBhCXJz9/16yhi4A+/yemaEzZW6sWlwfQZTRXckL4uckNO9uj7dHu7v7ujuO4pki1VbV5snVyevHuQ/Th3buzy+iXN+f06/jPR2/OD7dtG4wgv738dBm9+3T6/v2bk9Po4ujDnw+bIjjwy6uWZfZPy/AA3OWbd+eHniysAWJoZOEcn76KPh1/Onp/eViUhQzm/86ctG6dv+i5upOJuEngg8Jo5Tj2TlBSlLPvSPXm/Pjs48kpYZsVpAoFTkw5jM7evKTPJirT+Mxkg+/yTiaLmlOnXhMbIw5vWNCB+Aij8KP5Pe25VxQrxlPp8wFObnmjgomhpl/Qvh2hlq27GGfN2ncn66AHu5TvHyLYtITjLG1eHgN9aS+zGub30KVti7MRgm7UjHZXCiOO1eUjQttdPzbSWYfBGtkOAtSdDetM3Siz6Wvi1q4EGLFwVh6Uwzb2w91X45SB7dJ/9ORIQ1ARWitiayboNqYr56gV08rZWRCH7ey/Zham65qJ6NHbp7CCdZwu9HgFteLj2aWhTtuHp2sUQoXJa8h5/nZta7LkqawyLKHFcjS/PqDiUyxYv+yyKlrdboFOddeUMJxsWpQm0K0D0RZcj1afQoVo2bGVzjtmsHh0G5A2+i60iQaMlYoFwxo8k6pPxfy1zX+F5sGdDfDQ3SIUGGcLEG8voaKsIExv8pG6GRPWE0GXJLMiAsv76ZiUj78KXe88WcsxHg9w3x01+67hjhZ3WZ5hahAeXlJ8b10kwYUUVuL5KBzxSKOmLR1sdIx/4I2OKVT35bPt8TWAA2vzHTCw9VJ/UnrfBYN6GDj+0QcryyvmF4TAUT5a8F9u04JgI5i+TgdoTAboyRC8JV2qOl5NvrsAIwyZD0QyXzyU87A3coTXU+mToBRndyHxOOWshn9c7XEx6INGUYJNXYGWwatEYFo5uVlhjaDeoppxP3dT7h9RN+oV1ZLqoCOewFLG7pgv9tCFpit21TYYQE9hbQgl0rDqr+ITElwHqnNXXkEbj88Zr+N356/evNZZXdLXBeyh4nQgykUlOnaSVPDT0cEPzNeFgQ/OznEAhU7PaWjqfjYuczUSl/zD6mSTGvQL+2iFG2T9TyzVsCWXm3yjU2bKpLoMP6IbWbotc9TlX5X9gVV7fryDiGmP3bokh6vRCBa1mUMJ13Bd6NDUBl3gzUyI/1Gel8nwFIsBObcDpmh42qcUKSyAydoa2vC9AM4+YO8YdqZBWRFVOtvSP9tGqKtsZiopbaWlX77MNZZ0bGyG+Sd40OU88XxOxWkgbWNQ6PW9l39VYnNve3/HrjcCgzcvnvVtcal3bqvWV9aFFKCzcDVyRXwTZznnavXlPVRlzaeQ6FiNBUb1c/JungOrYKUodFBYAUBHAsACm7uggNHGkg4gUd0QE9YxrIX3DaOXllwRkoujbRTWnBuEuQl/+UZF4SVurWuZ3zeJ2bYApCCDyQ/EVXmL9aA6vGBKX111JZddMso6EY6FmUYp+bnwgPCOZ1tmEMUqmtGvZsURjvkyTq4X8/dyclFXtlTDqnxk0gFQ207Una9zY3ql3It5VMlJNK+BrAwrqIFyFu6RqciwvMG7fSdAm8VYV7gTyYJCYb9orHEBHi2EmTUs4oyLDLe2ZlgBjEGlLS5E3KriW5zWaJYa4bdnRZZqRvxiEj0XvsTAmVrU/e0zbx4jaOSanTJzYfRVRFISeAyFWGtqlHgM0Y88+aSQvfFbPWiGKA9qMD48XShgGS7k1hlt5QPL0bfO773bpsxFQTFqGVMWUtH5WmQ+MPKSCwCxsNqdU0Bovw6HzHJDs+SHIZY+c/xqTojoyskhneV2XtYDXKxHiLCouqH/SXreXzhhWVYC5lCALqkwmjX31PYvujCYtMl4iqFVtoLatkWm+kJtNeTaGTed4sEhHFPiurRyZd9nGi5g5du+BAedqLQbqEA3BuSwJxOa90kGgDDC3IlAVahXMp97AHnwNC6mVK0+L6kA3BT+BIrl8atgBowQMV1q4ztTxn17/cvFkBga1nwWJ+8uw9JlPNWKlUdggmAZsOgdyAkM+BvfUGgmEKdA3WuEEeOhY13WRccrwhrkpALgVHb5dP/Z0xc/Pd3bbvUMMN9L69F0QZbmPb2dk1wvK+yHOljmaNH0sMwF75v1fUNcTG+Xw8tc057L0pOqODmPxCK46TW11OSrFGiv4IyWcc30UEE9odFVdDCIk+ueXxivOMexk8bbz58+fxrvJnvPVqZuic4rtGtQAXKwsWw5F0ymiMkUMe7Nwi5dBelVDTF4A2rgCiS9U7BLJ2SDc67wN5UmrqlysRODtsFdFJgvbt5chNESeD80F5TqGAkd9UPbCN+0KdT7iaBUiypl/UItU6rVHDfylQlub71D9xteSRTtAvmbZ85WlMkRQ1zyMp3y7r9tw8hl9ZSk98rfzbbRhYq+QedvQbWIDkr5JxxPVmR+NFhqq39HusJoRZWyMdrmZjACf3zxcWjPjhhUXbYJz+EoFoxLzt26Y+juqGWw1dFAjA2o9PbsEBHIgVXvKfcPxLGlCzbdb+ah7wLpwmJkoECegEeBN54NjYSIJwasKeFYrlBYA6uaXU0eB+sxmGGrVdDsTTp0/8wp3UUFihDvW8N8P5DoN1Z9RHZYiwPxRCEQZCuvDtBVksPShBfx+Ws/CPD067DB+bjQgsvRD7/KcyBA18r6kDRJy9FpWPM5X83gswVq2aWQCG8cvHv/Vt/aQ2MyebSR56vi6I29Xc7V8nOBKo+HYo6ncdxVkTiSDrSsLGZFOBzVsNtrB54rhXXQQ7sKer54ioNvV46LsL5i3Q6Bp9YYz1lMqgABZ9ceDwWXhF2CMK6kjyT5tSK8+9BuMNgEYBZ9r9e/thBRa1fvpQsh0IksW1fd2LsgsYx+YrV1Fd/gFlgWtvI6NT4WNm4pL/OqzIKo6hodbP6ElDF3kpFImSZhQLN9NZ6o9qWYZUrpGxJDbdltxJW1GDfHW144mvbXpXI0oojxjQfsrLn6ZHuJ5KG5EBI3dW0JltPzo5dnpxHfk+nSLDvddowMwQgrL+69ptJnHZDn+46VApzt1ZjrcKbrOb8DZ80yD2lf29u/4HLD3ikUAqeht1fAOi8dKoEtV117CZhm7xCqXUhfRRyEVwR1SSNEr88jvMoNen3V90M0I9h0LMWxm+muY6OPAMBnUKzdAeWqw8OqLeF4Hr37+CHimC1m7ujKCe8yNq+3vociOMlp9UboD4VahPVDiMjnxNwAxXSl+Ldr4d1g+LXpO+Ih9l7gQPoeJGKtG3rwHHN/j35oUIfv0uivdEY9DPDKKI2jRW49wzUUL97cHIwuenh5Xx+QWJHzAlrpC4bdtNeeMWPOwdqhY11U1Wve6hRaBc4/2gos4yrYgjnnI/BlTfqCSlo6DqjiTGmQcOH4CjQt+HzWgs9XhKcraA91/bXf97z6zpeiw9MmIOgobQpTFwVIYQ0Mhgfo3uKIvKkoIgUURRh/iyLSQ/4t0FRkSieU7aEUc1Wb0ZvmwJ0f72F6cEJm5Cmge5hZNb3piz+JHT1dd4mv+fp5J2Cf0HCw4ddmY9ASZEEoqk4B2dFtBVoL9CIW4qALKv5oYP3pS4EcbEfc/tr3upvLgO3VvsbJNH6sAaOLV08Ws3lL7sxezuZu4i7SZqm60wLt/uw/fu/bO7xgu6OZD49YaeVA946afaPG90vxpQDO33qiDniieJG116Cd4RkiMNT/Anm5pJc=";
const gnArgumentProjectionFixture = String.raw`import ast,base64,contextlib,hashlib,importlib,io,json,os,pathlib,sys,tempfile,zlib
packet=json.loads(sys.stdin.read(65537))
raw=zlib.decompress(base64.b64decode(packet['source']))
assert len(raw)==26541 and hashlib.sha256(raw).hexdigest()=='ab94e3b3c214198b396c8b4858b5d5e9cb42be956bbc294d651dd86eac44df6e'
results=[]
class NativeFailure(Exception):pass
for case in packet['cases']:
 with tempfile.TemporaryDirectory(prefix='cef-gn-data-',dir=packet.get('temporaryRoot')) as folder:
  workspace=pathlib.Path(folder).resolve(strict=True);tools=workspace/'source-checkout/src/cef/tools';tools.mkdir(parents=True)
  source=tools/'gn_args.py';source.write_bytes(raw)
  if case=='source-drift':source.write_bytes(raw+b'\n')
  vs=workspace/'custom-vs';(vs/'VC').mkdir(parents=True);(vs/'VC/vcvarsall.bat').write_text('')
  sdk=dict(visual_studio_path=str(vs),visual_studio_version='2026',visual_studio_runtime_dirs=str(workspace/'runtime/x64'),windows_sdk_path=str(workspace/'Windows Kits/10'),windows_sdk_version='10.0.28000.0')
  fixed={}
  for line in packet['fixed'].splitlines():
   key,value=line.split('=',1);fixed[key]=True if value=='true' else False if value=='false' else ast.literal_eval(value)
  definitions=' '.join("'"+key+'='+('true' if value is True else 'false' if value is False else json.dumps(value))+"'" for key,value in fixed.items())
  saved_env=dict(os.environ);saved_path=list(sys.path);saved_platform=sys.platform
  sys.path.insert(0,str(tools));sys.modules.pop('gn_args',None);sys.platform='win32'
  os.environ.update(GN_DEFINES=definitions,GN_OUT_CONFIGS='Release_GN_arm64',CEF_ENABLE_ARM64='1',DEPOT_TOOLS_WIN_TOOLCHAIN='0',GYP_MSVS_OVERRIDE_PATH=str(vs),GYP_MSVS_VERSION='2026',CEF_VCVARS='none',VS_CRT_ROOT=sdk['visual_studio_runtime_dirs'],SDK_ROOT=sdk['windows_sdk_path'],SDK_VERSION=sdk['windows_sdk_version'])
  scope={'os':os,'sys':sys,'hook':str(tools/'gclient_hook.py')};calls=[];error=None;error_location=None;output=None;before=dict(sdk)
  def profile(frame,event,value):
   if frame.f_code.co_filename!=str(source):return
   if frame.f_code.co_name=='GetConfigArgs' and event=='return':
    selected=frame.f_locals.get('cpu')=='arm64' and frame.f_locals.get('is_debug') is False
    if selected and case=='native-failure':raise NativeFailure('')
    if selected and case=='native-extra':value['unexpected']=True
    if selected and case=='native-other-drift':value['symbol_level']=2
    if selected and case=='native-tracer-drift':value['enable_backup_ref_ptr_instance_tracer']=False
    if selected and case=='native-type-drift':value['enable_rlz']=1
    if selected and case=='input-mutation':sdk['unexpected']=True
    calls.append(dict(cpu=frame.f_locals['cpu'],debug=frame.f_locals['is_debug'],result=dict(value)))
  try:
   with contextlib.redirect_stdout(io.StringIO()):
    if case=='baseline':
     native=importlib.import_module('gn_args');sys.setprofile(profile)
     try:output=native.GetAllPlatformConfigs(sdk)
     finally:sys.setprofile(None)
    else:
     if case=='function-drift':
      native=importlib.import_module('gn_args');native.GetConfigArgs=lambda *args:None
     exec(packet['program'],scope)
     native=scope['gn_args']
     if case in ('explicit-true','component','debug','cpu','numeric-false'):
      changed=dict(fixed)
      if case=='explicit-true':changed['enable_backup_ref_ptr_instance_tracer']=True
      elif case=='component':changed['is_component_build']=True
      elif case=='debug':changed['is_debug']=True
      elif case=='cpu':changed['target_cpu']='x64'
      else:changed['enable_backup_ref_ptr_instance_tracer']=0
      os.environ['GN_DEFINES']=' '.join("'"+key+'='+('true' if value is True else 'false' if value is False else json.dumps(value))+"'" for key,value in changed.items())
     if case=='other-selection':os.environ['GN_OUT_CONFIGS']='Release_GN_x64'
     if case=='sdk':sdk['windows_sdk_version']='10.0.28000.1'
     if case=='input-extra':sdk['unexpected']=True
     sys.setprofile(profile)
     try:output=native.GetAllPlatformConfigs(sdk)
     finally:sys.setprofile(None)
     if case=='repeat':native.GetAllPlatformConfigs(sdk)
  except BaseException as caught:
   error='EMPTY_NATIVE_FAILURE' if type(caught)is NativeFailure and str(caught)=='' else str(caught)
   location=caught.__traceback__
   while location.tb_next is not None:location=location.tb_next
   error_location=[location.tb_frame.f_code.co_name,location.tb_lineno]
  finally:
   sys.setprofile(None);sys.platform=saved_platform;sys.path[:]=saved_path;os.environ.clear();os.environ.update(saved_env);sys.modules.pop('gn_args',None)
  serialized=native.GetConfigFileContents(output['Release_GN_arm64']) if error is None and output is not None else None
  results.append(dict(case=case,error=error,errorLocation=error_location,calls=calls,inputUnchanged=sdk==before,output=output,serialized=serialized,modeledWindowsHost=True,nativeGnExecuted=False,compilerExecuted=False))
print(json.dumps(results))`;

async function gnArgumentProjectionCases(driver, cases, options = {}) {
  const args = driver.boundGnArguments(
    [
      "-B",
      "-c",
      "unchanged-hook",
      "fixed-cef/tools/gclient_hook.py",
      "fixed-depot/gn.py",
    ],
    "fixed-gn.exe",
    {
      bytes: 2601472,
      sha256:
        "e398eefd1241ad44e98aececa6a260abac0fdcb80f41c23176944ad3f0e76486",
    },
  );
  const begin = args[2].indexOf("# BEGIN fixed ARM64 GN argument projection\n");
  const end = args[2].indexOf(
    "# END fixed ARM64 GN argument projection\n",
    begin,
  );
  assert(begin > 0 && end > begin);
  const program = args[2].slice(begin, end);
  const fixed = (
    await read(
      "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/gn/aarch64-pc-windows-msvc.gn",
    )
  )
    .toString()
    .trim();
  const result = spawnSync(
    await projectionFixturePython(),
    [
      "-I",
      "-B",
      "-c",
      options.unresolvedWorkspace
        ? gnArgumentProjectionFixture.replace(
            "workspace=pathlib.Path(folder).resolve(strict=True)",
            "workspace=pathlib.Path(folder)",
          )
        : gnArgumentProjectionFixture,
    ],
    {
      cwd: root,
      input: JSON.stringify({
        source: pinnedCefGnArgsDeflate,
        program,
        fixed,
        cases,
        ...(options.temporaryRoot
          ? { temporaryRoot: options.temporaryRoot }
          : {}),
      }),
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 ** 2,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

test("fixed ARM64 GN projection fixture canonicalizes an actual aliased temporary root while the production alias guard remains strict", async (t) => {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "cef-gn-fixture-alias-")),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const physical = path.join(directory, "physical"),
    alias = path.join(directory, "alias");
  await fs.mkdir(physical);
  await fs.symlink(
    physical,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  const [old] = await gnArgumentProjectionCases(currentDriver, ["positive"], {
    temporaryRoot: alias,
    unresolvedWorkspace: true,
  });
  assert.equal(old.error, "FULL_GN_PROJECTION_SOURCE");
  assert.equal(old.calls.length, 0);
  const [fixed] = await gnArgumentProjectionCases(currentDriver, ["positive"], {
    temporaryRoot: alias,
  });
  assert.equal(fixed.error, null, JSON.stringify(fixed.errorLocation));
  assert.equal(fixed.calls.length, 6);
  assert.equal(
    fixed.output.Release_GN_arm64.enable_backup_ref_ptr_instance_tracer,
    false,
  );
  assert.equal(
    currentDriver.validateGeneratedArguments(Buffer.from(fixed.serialized))
      .criticalArgumentsVerified,
    true,
  );
  assert.equal(fixed.nativeGnExecuted, false);
  assert.equal(fixed.compilerExecuted, false);
});

test("fixed ARM64 GN projection runs actual pinned native six-config generator: old RED, only selected tracer GREEN, neighboring native configurations unchanged", async () => {
  for (const driver of [currentDriver, oldDriver]) {
    const [before, after] = await gnArgumentProjectionCases(driver, [
      "baseline",
      "positive",
    ]);
    assert.equal(before.error, null);
    assert.equal(after.error, null, JSON.stringify(after.errorLocation));
    assert.equal(
      before.output.Release_GN_arm64.enable_backup_ref_ptr_instance_tracer,
      true,
    );
    assert.equal(
      after.output.Release_GN_arm64.enable_backup_ref_ptr_instance_tracer,
      false,
    );
    assert.throws(
      () => driver.validateGeneratedArguments(Buffer.from(before.serialized)),
      /FULL_GN_CRITICAL_ARGUMENT/,
    );
    assert.equal(
      driver.validateGeneratedArguments(Buffer.from(after.serialized))
        .criticalArgumentsVerified,
      true,
    );
    assert.equal(before.calls.length, 6);
    assert.equal(after.calls.length, 6);
    const selected = after.calls.filter(
      (x) => x.cpu === "arm64" && x.debug === false,
    );
    assert.equal(selected.length, 1);
    assert.equal(
      selected[0].result.enable_backup_ref_ptr_instance_tracer,
      true,
    );
    // Dynamic SDK roots differ between independently owned fixtures.
    const stable = (calls) =>
      calls.map((x) => ({
        ...x,
        result: Object.fromEntries(
          Object.entries(x.result).filter(
            ([key]) =>
              ![
                "visual_studio_path",
                "visual_studio_runtime_dirs",
                "windows_sdk_path",
              ].includes(key),
          ),
        ),
      }));
    assert.deepEqual(stable(before.calls), stable(after.calls));
    assert.equal(after.inputUnchanged, true);
    assert.equal(after.modeledWindowsHost, true);
    assert.equal(after.nativeGnExecuted, false);
    assert.equal(after.compilerExecuted, false);
    const actual = {
      ...after.output.Release_GN_arm64,
      enable_backup_ref_ptr_instance_tracer: true,
    };
    assert.deepEqual(actual, selected[0].result);
  }
});

test("fixed ARM64 GN projection denies near arguments, source/output/input drift and repeats, preserving actual first native failure", async () => {
  const cases = [
    "explicit-true",
    "component",
    "debug",
    "cpu",
    "numeric-false",
    "other-selection",
    "sdk",
    "input-extra",
    "native-extra",
    "native-other-drift",
    "native-tracer-drift",
    "native-type-drift",
    "input-mutation",
    "source-drift",
    "function-drift",
    "repeat",
    "native-failure",
  ];
  const errors = [
    "ARGUMENTS",
    "ARGUMENTS",
    "ARGUMENTS",
    "ARGUMENTS",
    "ARGUMENTS",
    "SELECTION",
    "INPUT",
    "INPUT",
    "OUTPUT",
    "OUTPUT",
    "OUTPUT",
    "OUTPUT",
    "INPUT",
    "SOURCE",
    "FUNCTION",
    "SELECTION",
    "EMPTY_NATIVE_FAILURE",
  ];
  for (const driver of [currentDriver, oldDriver]) {
    const values = await gnArgumentProjectionCases(driver, cases);
    for (const [index, value] of values.entries()) {
      assert.equal(
        value.error,
        errors[index] === "EMPTY_NATIVE_FAILURE"
          ? errors[index]
          : "FULL_GN_PROJECTION_" + errors[index],
        value.case + JSON.stringify(value.errorLocation),
      );
      assert.equal(value.nativeGnExecuted, false);
      assert.equal(value.compilerExecuted, false);
    }
  }
});

test("hooks/GN stage deadline whole inverse restores both complete c9 drivers before GN projection and older history", async () => {
  for (const [label, bytes, digest] of [
    [
      "current",
      117221,
      "4201bcb93eecfc333c92a76327d8312100b0b3a9b1b2e0ccaf288a8db9d5f899",
    ],
    [
      "20261021",
      117233,
      "ff170a7e760f3dd3168604b9a78c761862e41d1407236442e5038d1abed12351",
    ],
  ]) {
    const text = (
      await read(
        `native/windows-arm-full-sdk/image-qualified-${label}-driver.mjs`,
      )
    )
      .toString()
      .replaceAll("\r\n", "\n");
    const previous = previousHooksGnStageDeadline(text);
    assert.equal(Buffer.byteLength(previous), bytes);
    assert.equal(sha(previous), digest);
  }
});

test("fixed ARM64 GN projection whole inverse restores both complete ffd drivers before all historical inverses", async () => {
  for (const [label, bytes, digest] of [
    [
      "current",
      111030,
      "8dfbf7ee4cf6aea7345f4b38062e9d1e1b0c696561d5c0323b7c8f4c26084909",
    ],
    [
      "20261021",
      111042,
      "c21ebeaa8595fb271b8fcc1ae85eaa1d6d66f29974d7a789a45a63cd83adce6e",
    ],
  ]) {
    const text = (
      await read(
        `native/windows-arm-full-sdk/image-qualified-${label}-driver.mjs`,
      )
    ).toString();
    const previous = previousGnArgumentProjection(text);
    assert.equal(Buffer.byteLength(previous), bytes);
    assert.equal(sha(previous), digest);
    assert(text.includes('"kind":"windows-arm-fixed-gn-argument-projection"'));
    assert(text.includes('"vendorSourceModified":false'));
    assert(text.includes('enable_backup_ref_ptr_instance_tracer: "false"'));
  }
});
