import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
  new URL(
    "../../src-tauri/src/origin_browser_startup_task.rs",
    import.meta.url,
  ),
);

async function temporaryFixture(t, prefix) {
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, prefix));
  t.after(async () => {
    const resolved = await realpath(root);
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith(prefix));
    await rm(resolved, { recursive: true, force: true });
  });
  return root;
}

test("actual startup task preserves small UI stack, worker construction and cancellation", async (t) => {
  const root = await temporaryFixture(t, "native-startup-task-");
  const executable = path.join(
    root,
    process.platform === "win32" ? "task.exe" : "task",
  );
  execFileSync(
    "rustc",
    ["--edition=2021", "--test", "-Dwarnings", source, "-o", executable],
    { timeout: 60_000, windowsHide: true },
  );
  const output = execFileSync(executable, ["--test-threads=1", "--nocapture"], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  assert.match(output, /5 passed; 0 failed/);
  t.diagnostic(output.trim());
});

test("regression rejects eagerly constructing the large future before executor polling", async (t) => {
  const root = await temporaryFixture(t, "native-startup-eager-mutant-");
  const original = await readFile(source, "utf8");
  const mutated = original.replace(
    "Box::pin(async move { Box::pin(factory()).await })",
    "Box::pin(factory())",
  );
  assert.notEqual(
    mutated,
    original,
    "counterexample must replace the actual factory deferral",
  );
  const mutant = path.join(root, "eager.rs");
  const executable = path.join(
    root,
    process.platform === "win32" ? "eager.exe" : "eager",
  );
  await writeFile(mutant, mutated);
  execFileSync(
    "rustc",
    ["--edition=2021", "--test", "-Dwarnings", mutant, "-o", executable],
    { timeout: 60_000, windowsHide: true },
  );
  const result = spawnSync(
    executable,
    [
      "--exact",
      "tests::realistic_350k_future_constructs_on_two_megabyte_worker_not_ui",
      "--nocapture",
    ],
    { encoding: "utf8", timeout: 15_000, windowsHide: true },
  );
  assert.ifError(result.error);
  assert.notEqual(
    result.status,
    0,
    "eager construction must fail on the small UI stack",
  );
  assert.match(
    result.stdout + result.stderr,
    /small-ui|stack overflow|assertion/,
  );
});

test("both real IPC startup branches defer construction before respond_async", async () => {
  const commands = await readFile(
    new URL("../../src-tauri/src/origin_browser_commands.rs", import.meta.url),
    "utf8",
  );
  const dispatch = commands.slice(
    commands.indexOf('if name == "origin_browser_create"'),
    commands.indexOf("\n    true\n}"),
  );
  assert.equal(
    (
      dispatch.match(
        /respond_async\(crate::origin_browser_startup_task::task\(move \|\| async move/g,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    dispatch,
    /origin_browser_create\(window, state, request, document\)/,
  );
  assert.match(
    dispatch,
    /origin_browser_prewarm\(window, state, request, document\)/,
  );
  assert.doesNotMatch(dispatch, /respond_async\(async move/);
});
