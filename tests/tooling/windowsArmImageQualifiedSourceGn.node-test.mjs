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
          1800,
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
      assert(text.includes('"source-hooks-gn", 1800'));
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
    assert.deepEqual(values[2].pins, ["src/packages:vendor/package"]);
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
    const depArgs = driver.dependencyHookArguments(
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

test("only the two selected hook projection functions differ from exact 93d22 historical drivers", async () => {
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
      "a630542cf8874e30a76b7e2eedc7621ac544322e7ac0a16cc5473809e541f747",
    );
    const text = (
      await read(
        `native/windows-arm-full-sdk/image-qualified-${label}-driver.mjs`,
      )
    ).toString();
    assert.equal(text.split("export " + next).length, 2);
    const normalized = text.replace("export " + next, previous);
    assert.equal(sha(normalized), expected);
    assert.deepEqual(
      driver.dependencyHookArguments("depot", "adapter", "a".repeat(64)),
      legacy.dependencyHookArguments("depot", "adapter", "a".repeat(64)),
    );
  }
});
