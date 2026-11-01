import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as currentDriver from "../../native/windows-arm-full-sdk/image-qualified-current-driver.mjs";
import * as oldDriver from "../../native/windows-arm-full-sdk/image-qualified-20261021-driver.mjs";
import {
  customRuntimeBuildRecipe,
  validateSourceLock,
  identitySha256,
} from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-custom-runtime.mjs";
import { cefHookArguments } from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/cef-runtime-ci.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => fs.readFile(path.join(root, p));
const sha = (b) => createHash("sha256").update(b).digest("hex");
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
      }
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
