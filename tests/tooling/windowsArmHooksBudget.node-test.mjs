import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { withoutHooksBudget } from "./helpers/cefWindowsEngineHostHistory.mjs";

// Run 44719551671 (continuation of 44663463953) spent 4375 s before the hooks/GN
// stage, then needed about 58 min to reach graph-inventory: dependency hooks,
// patch apply, three setups, verify-setup, the checkpoint restore, cef-gn. The
// single 3600 s stage cap killed graph-inventory 102 s in (exit 124 ->
// FULL_SOURCE_STAGE_DEADLINE). The cap is now 5400 s.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const dir = "native/windows-arm-full-sdk/";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const read = async (leaf) =>
  (await fs.readFile(path.join(root, dir, leaf), "utf8")).replaceAll(
    "\r\n",
    "\n",
  );

async function stageProgram() {
  const { default: ts } = await import("typescript");
  const source = await read("full-sdk-source-driver.mjs");
  const tree = ts.createSourceFile(
    "driver.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  return tree.statements
    .find(
      (node) =>
        ts.isFunctionDeclaration(node) && node.name?.text === "fullSourceStage",
    )
    .getText(tree);
}

function model(program, began) {
  let now = began;
  const timers = [],
    cleared = [];
  const sourceEnd = 14400000,
    wholeEnd = 21600000;
  const budget = {
    remaining() {
      if (now >= wholeEnd) throw new Error("ORIGINAL_WHOLE_DEADLINE");
      if (now >= sourceEnd) throw new Error("ORIGINAL_SOURCE_DEADLINE");
      return Math.min(sourceEnd - now, wholeEnd - now);
    },
  };
  const stage = vm.runInNewContext("(" + program + ")", {
    need(value, code) {
      if (!value) throw new Error(code);
    },
    performance: { now: () => now },
    setTimeout(callback, milliseconds) {
      const value = { callback, milliseconds };
      timers.push(value);
      return value;
    },
    setInterval: (callback, milliseconds) => ({ callback, milliseconds }),
    clearTimeout: (value) => cleared.push(value),
    clearInterval: (value) => cleared.push(value),
    writeFileSync() {
      assert.fail("no deadline report without firing the owned timer");
    },
    process: {
      exit() {
        assert.fail("no real actor in this private clock fixture");
      },
    },
    path,
    Buffer,
    writeSync() {
      assert.fail("no diagnostic fallback expected");
    },
    sourceReportingFailure: false,
  });
  return { stage, budget, timers, cleared, advance: (ms) => (now += ms) };
}

test("FULL hooks5400 admits the measured continuation hooks/GN work and keeps both original clocks", async () => {
  const program = await stageProgram();
  // Measured continuation: hooks begin 4375 s into the source clock and need
  // ~62 min (58 min to graph-inventory plus the inventory itself).
  const f = model(program, 4375000);
  assert.equal(
    await f.stage("owned", f.budget, "source-hooks-gn", 5400, async () => {
      f.advance(3780000);
      return "owned-source-work";
    }),
    "owned-source-work",
  );
  assert.equal(f.timers[0].milliseconds, 5400000);
  assert.equal(f.cleared.length, 2);
  // The old cap is no longer an admitted stage vector.
  const old = model(program, 4375000);
  await assert.rejects(
    old.stage("owned", old.budget, "source-hooks-gn", 3600, async () => "x"),
    /FULL_SOURCE_STAGE/,
  );
  assert.equal(old.timers.length, 0);
  // The stage still ends at its own cap.
  const late = model(program, 4375000);
  await assert.rejects(
    late.stage("owned", late.budget, "source-hooks-gn", 5400, async () => {
      late.advance(2700000);
      await Promise.resolve();
      late.advance(2700001);
      return "late";
    }),
    /FULL_SOURCE_STAGE_DEADLINE/,
  );
  assert.equal(late.timers[0].milliseconds, 5400000);
});

test("FULL hooks5400 still clips to the original source end less the unchanged reserve and rejects spent clocks", async () => {
  const program = await stageProgram();
  const clipped = model(program, 11000000);
  assert.equal(
    await clipped.stage(
      "owned",
      clipped.budget,
      "source-hooks-gn",
      5400,
      async () => "bounded",
    ),
    "bounded",
  );
  assert.equal(clipped.timers[0].milliseconds, 14400000 - 11000000 - 120000);
  for (const [start, code] of [
    [14280000, "FULL_SOURCE_RESERVE"],
    [14400000, "ORIGINAL_SOURCE_DEADLINE"],
    [21600000, "ORIGINAL_WHOLE_DEADLINE"],
  ]) {
    const f = model(program, start);
    let actions = 0;
    await assert.rejects(
      f.stage("owned", f.budget, "source-hooks-gn", 5400, async () => {
        actions++;
      }),
      new RegExp(code),
    );
    assert.equal(actions, 0);
    assert.equal(f.timers.length, 0);
  }
  // Acquisition keeps its own reviewed 7200 s vector.
  const acquisition = model(program, 0);
  await assert.rejects(
    acquisition.stage(
      "owned",
      acquisition.budget,
      "source-acquisition",
      5400,
      async () => "x",
    ),
    /FULL_SOURCE_STAGE/,
  );
});

test("FULL hooks5400 profile, driver, controller and Python pin move together with exact whole-file history", async () => {
  const profileRaw = await read("full-sdk-source-profile.json");
  const profile = JSON.parse(profileRaw);
  assert.deepEqual(profile.limits, {
    wholeSeconds: 21600,
    sourceSeconds: 14400,
    acquisitionSeconds: 7200,
    hooksSeconds: 5400,
    cleanupSeconds: 30,
    finalReserveSeconds: 120,
  });
  const pin = sha(profileRaw);
  const driver = await read("full-sdk-source-driver.mjs");
  assert.equal(driver.split(pin).length, 2);
  assert.equal((await read("full_sdk_control.mjs")).split(pin).length, 2);
  assert.equal((await read("full_sdk_source.py")).split(pin).length, 2);
  assert.match(driver, /limits\.hooksSeconds === 5400 &&/);
  assert.match(driver, /"source-hooks-gn", 5400, async \(\) => \{/);
  assert.doesNotMatch(driver, /"source-hooks-gn", 3600/);
  // The stage cap plus the measured pre-stage time stays inside the original
  // source budget with its reserve; every other limit is unchanged.
  assert.ok(
    4375 + profile.limits.hooksSeconds + 120 <= profile.limits.sourceSeconds,
  );
  assert.ok(profile.limits.hooksSeconds >= 1.2 * 62 * 60);
  const specs = JSON.parse(
    await fs.readFile(
      path.join(root, "tests/fixtures/cef/windows_hooks_budget_inverse.json"),
      "utf8",
    ),
  );
  for (const leaf of [
    "full-sdk-source-driver.mjs",
    "full-sdk-source-profile.json",
    "full_sdk_control.mjs",
    "full_sdk_source.py",
  ]) {
    const file = dir + leaf,
      current = await read(leaf),
      spec = specs[file],
      previous = withoutHooksBudget(current, file);
    assert.equal(sha(current), spec.sha256);
    assert.equal(sha(previous), spec.beforeSha256);
    assert.equal(Buffer.byteLength(previous), spec.beforeBytes);
    // Only an exact whole current file is inverted.
    assert.equal(withoutHooksBudget(current + "\n", file), current + "\n");
    assert.equal(
      withoutHooksBudget(current + spec.pairs[0].current, file),
      current + spec.pairs[0].current,
    );
  }
  const previousProfile = JSON.parse(
    withoutHooksBudget(profileRaw, dir + "full-sdk-source-profile.json"),
  );
  assert.equal(previousProfile.limits.hooksSeconds, 3600);
  assert.deepEqual(
    { ...previousProfile.limits, hooksSeconds: 5400 },
    profile.limits,
  );
});
