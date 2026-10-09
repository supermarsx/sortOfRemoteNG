import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const runtimeUrl = new URL(
  "../../src-tauri/src/origin_browser_runtime.rs",
  import.meta.url,
);

function between(source, start, end) {
  const a = source.indexOf(start);
  assert.ok(a >= 0, `Missing production boundary: ${start}`);
  const b = source.indexOf(end, a);
  assert.ok(b > a, `Missing production boundary: ${end}`);
  return source.slice(a, b);
}

test("warm startup performs one fresh owner read, with revocation and TLS gates intact", async (t) => {
  const source = await readFile(runtimeUrl, "utf8");
  const ensure = between(
    source,
    "async fn ensure_runtime(",
    "fn cancel_startup(",
  );
  const ready = between(
    ensure,
    "if shared().admission.ready() {",
    "if let Some(permit) = shared().startup.prepare()",
  );
  const create = between(
    source,
    "async fn create_document(",
    "enum Operation {",
  );
  const handoff = between(
    create,
    "ensure_runtime(&window, state, &authorized.lease, None, &timing, &document).await?;",
    "let identity = authorized.policy.identity().clone();",
  );
  // A later edit must not insert another successful readiness path which skips
  // the full recheck that permits this adjacent duplicate read to be removed.
  assert.match(
    ready,
    /recheck_startup\(window, state, lease, prewarm\)\.await\?;/u,
  );
  assert.match(ready, /certificate_hooks\.load\(Ordering::Acquire\)/u);
  assert.equal((handoff.match(/\.await/gu) ?? []).length, 1);
  assert.doesNotMatch(handoff, /\.recheck\(/u);
  // Subsequent asynchronous boundaries still perform independent disk checks.
  assert.match(create, /\.recheck\(&window, state\)\.await\.map_err\(/u);
  assert.match(create, /TimingStage::OwnerCheckedBeforeProxy/u);
  assert.match(create, /TimingStage::OwnerCheckedBeforeContext/u);
  assert.match(create, /flow::admit_prepared\(/u);
  assert.match(create, /\.recheck\(&owner_window, state\)/u);

  const fixture = await readFile(
    new URL("fixtures/nativeWarmStartup.rs", import.meta.url),
    "utf8",
  );
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "sorng-warm-startup-"));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sorng-warm-startup-"));
    await rm(root, { recursive: true, force: true });
  });
  const harness = path.join(root, "contract.rs");
  const binary = path.join(
    root,
    process.platform === "win32" ? "contract.exe" : "contract",
  );
  await writeFile(
    harness,
    fixture
      .replace("/* PRODUCTION_READY */", ready)
      .replace("/* PRODUCTION_HANDOFF */", handoff),
  );
  execFileSync(
    "rustc",
    ["--edition=2021", "--test", "-Dwarnings", harness, "-o", binary],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    },
  );
  t.diagnostic(
    execFileSync(binary, ["--nocapture", "--test-threads=1"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    }).trim(),
  );
});
