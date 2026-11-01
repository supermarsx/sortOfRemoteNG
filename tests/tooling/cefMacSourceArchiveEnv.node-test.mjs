import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { archiveCommand } from "../../scripts/lib/cef-engineering-checkpoint.mjs";

const modes = ["source-record", "source-apply", "source-verify"];
const facts = {
  ImageOS: "macos15",
  ImageVersion: "20260824.0482.1",
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_REPOSITORY_VISIBILITY: "public",
  RUNNER_TRACKING_ID: "owned-source-env-test",
};
const secrets = {
  GITHUB_TOKEN: "MUST_NOT_REACH_LEAF",
  GH_TOKEN: "MUST_NOT_REACH_LEAF",
  SOURCE_ENV_TEST_SECRET: "MUST_NOT_REACH_LEAF",
};
const argv = (mode, policy) => [
  mode,
  "--input",
  "/owned/source",
  "--output",
  "/owned/sidecar",
  "--manifest",
  "/owned/identity.json",
  "--seconds",
  "1",
  ...(policy ? ["--platform-policy", policy] : []),
];

async function withLeaf(action) {
  const identified = spawnSync(
    "python",
    ["-I", "-B", "-c", "import sys;print(sys.executable)"],
    { encoding: "utf8", timeout: 5000, maxBuffer: 4096, windowsHide: true },
  );
  assert.equal(identified.status, 0, identified.stderr);
  const python = identified.stdout.trim();
  const directory = await mkdtemp(path.join(tmpdir(), "sorng-source-env-"));
  const helper = path.join(directory, "leaf.py");
  const prior = Object.fromEntries(
    Object.keys({ ...facts, ...secrets }).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, facts, secrets);
  try {
    await writeFile(
      helper,
      "import sys,os,json\nprint(json.dumps({'isolated':sys.flags.isolated,'noSite':sys.flags.no_site,'noBytecode':sys.flags.dont_write_bytecode,'argv':sys.argv[1:],'environment':dict(os.environ)}))\n",
      { flag: "wx" },
    );
    await action(python, helper);
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await unlink(helper);
    await rmdir(directory);
  }
}

function assertLeaf(result, python, expectedArgs, publicFacts) {
  const environment =
    process.platform === "win32"
      ? Object.fromEntries(
          Object.entries(result.environment).map(([key, value]) => [
            key.toUpperCase(),
            value,
          ]),
        )
      : result.environment;
  const envKey = (key) =>
    process.platform === "win32" ? key.toUpperCase() : key;
  assert.equal(result.isolated, 1);
  assert.equal(result.noBytecode, 1);
  assert.equal(
    result.noSite,
    0,
    "source workers retain their existing -I -B flags",
  );
  assert.deepEqual(result.argv, expectedArgs);
  assert.equal(environment.PATH, path.dirname(python));
  for (const key of Object.keys(secrets))
    assert.equal(environment[envKey(key)], undefined, key);
  for (const [key, value] of Object.entries(facts))
    assert.equal(
      environment[envKey(key)],
      publicFacts ? value : undefined,
      key,
    );
  // Some Windows Python runtimes materialize ordinary OS defaults even with
  // an explicit child environment. Darwin does not gain these inherited keys.
  const runtimeDefaults =
    process.platform === "win32"
      ? [
          "HOMEDRIVE",
          "HOMEPATH",
          "LOGONSERVER",
          "SYSTEMDRIVE",
          "SYSTEMROOT",
          "TEMP",
          "USERDOMAIN",
          "USERNAME",
          "USERPROFILE",
          "WINDIR",
        ]
      : [];
  assert(
    Object.keys(environment).every((key) =>
      [
        "PATH",
        "LC_CTYPE",
        ...(publicFacts ? Object.keys(facts) : []),
        ...runtimeDefaults,
      ]
        .map(envKey)
        .includes(key),
    ),
  );
}

test("all three real Mac source leaves receive only closed public host facts for both policies", async () => {
  await withLeaf(async (python, helper) => {
    for (const mode of modes) {
      for (const policy of ["mac-arm", "mac-intel"]) {
        const args = argv(mode, policy);
        const result = await archiveCommand(python, helper, args, {
          timeout: 5000,
        });
        assertLeaf(result, python, args, true);
      }
    }
  });
});

test("Linux and unrelated real leaves never gain Mac host facts or tracking", async () => {
  await withLeaf(async (python, helper) => {
    for (const args of [
      ...modes.map((mode) => argv(mode)),
      argv("pack", "mac-arm"),
      ["unrelated-mode", "--platform-policy", "mac-intel"],
    ]) {
      const result = await archiveCommand(python, helper, args, {
        timeout: 5000,
      });
      assertLeaf(result, python, args, false);
    }
  });
});

test("policy-bearing source argv rejects malformed or unreviewed grammar before spawning", async () => {
  const valid = argv("source-record", "mac-arm");
  const malformed = [
    valid.slice(0, -1),
    [...valid.slice(0, -1), "linux"],
    [...valid.slice(0, -1), "MAC-ARM"],
    [...valid, "--platform-policy", "mac-arm"],
    [...valid, "--unknown", "value"],
    [...valid.slice(0, -2), "--platform-policy=mac-arm"],
    [...valid.slice(0, 5), ...valid.slice(-2), ...valid.slice(5, -2)],
    valid.map((value, index) => (index === 5 ? "--input" : value)),
    valid.filter((_, index) => index !== 6),
    ...["0", "01", "601", "1.0", "-1"].map((seconds) =>
      valid.map((value, index) => (index === 8 ? seconds : value)),
    ),
    ...["", "--input", "bad\npath"].map((input) =>
      valid.map((value, index) => (index === 2 ? input : value)),
    ),
  ];
  for (const mode of modes) {
    for (const args of malformed) {
      await assert.rejects(
        archiveCommand("not-an-absolute-python", "not-an-absolute-helper", [
          mode,
          ...args.slice(1),
        ]),
        /^Error: Fixed Mac source archive flags required$/,
      );
    }
  }
});

test("public host facts cannot bypass exact Intel source scope before filesystem IO", () => {
  const helper = path.resolve("scripts/lib/cef-checkpoint-archive.py");
  const code = `import importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location('archive',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
assert module.MAC_INTEL_SOURCE_WRITE_ADMITTED is True
def no_io(*args,**kwargs): raise AssertionError('unexpected filesystem access')
module.source_metadata_identity=no_io
module._source_metadata_owned_codec=no_io
results=[]
for mode in ('source-record','source-apply','source-verify'):
 try: module.source_metadata_owned(mode,pathlib.Path('/not-read'),pathlib.Path('/not-written'),{},platform_policy='mac-intel')
 except module.CheckpointError as error: results.append(str(error))
 else: raise AssertionError('out-of-scope source codec ran')
print(json.dumps({'hostEligible':sys.platform=='darwin' and module.platform.machine()=='x86_64','results':results}))
`;
  const child = spawnSync("python", ["-I", "-B", "-c", code, helper], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 4096,
    windowsHide: true,
    env: { PATH: process.env.PATH, ...facts },
  });
  assert.equal(child.status, 0, child.stderr);
  const decoded = JSON.parse(child.stdout);
  assert.equal(typeof decoded.hostEligible, "boolean");
  assert.deepEqual(
    decoded.results,
    modes.map(() =>
      decoded.hostEligible
        ? "source-mac-identity-scope"
        : "source-mac-host-scope",
    ),
  );
});
