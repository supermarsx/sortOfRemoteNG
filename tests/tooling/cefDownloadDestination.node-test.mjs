import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../native/cef-patches/", import.meta.url);
const seriesRoot = new URL("154.0.8037.58-682c378/", root);
const filename = "0006-cef-explicit-download-destination.patch";
const source = "libcef/browser/download_manager_delegate_impl.cc";

test("explicit download destination fix is maintained and pins upstream source", async () => {
  const series = await readFile(new URL("series", seriesRoot), "utf8");
  assert.equal(
    series.split(/\r?\n/).filter((line) => line === `cef ${filename}`).length,
    1,
  );
  const inventory = JSON.parse(
    await readFile(new URL("upstream-sha256.json", seriesRoot), "utf8"),
  );
  const entries = inventory.filter(
    (row) => row.project === "cef" && row.path === source,
  );
  assert.equal(entries.length, 1);
  assert.equal(
    entries[0].sha256,
    "93327bbf93d9edaf023908f7240abe6e0ccd70cd331fed061fc380129e75ba0d",
  );
  assert.ok(
    (await readFile(new URL("fetch-sources.ps1", root), "utf8")).includes(
      source,
    ),
  );
  const exporter = await readFile(new URL("export-series.mjs", root), "utf8");
  assert.ok(exporter.includes(filename));
  assert.ok(exporter.includes("`:(exclude)${downloadPath}`"));
});

test("explicit directory failure cancels on UI before any fallback without logging paths", async () => {
  const patch = await readFile(new URL(filename, seriesRoot), "utf8");
  const lines = patch.split(/\r?\n/);
  const added = lines
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
  const removed = lines
    .filter((line) => line.startsWith("-") && !line.startsWith("---"))
    .map((line) => line.slice(1))
    .join("\n");
  const after = lines
    .filter((line) => /^[ +]/.test(line) && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
  // The only removed statements are this failure's DCHECK and path clearing;
  // the unspecified-path branch and every other DCHECK remain unchanged.
  assert.equal(
    removed.trim(),
    'DCHECK(false) << "failed to create the download directory";\n        suggested_path.clear();',
  );
  assert.match(
    after,
    /if \(!base::DirectoryExists\(dir_path\) &&\s*!base::CreateDirectory\(dir_path\)\) \{/,
  );
  assert.match(
    added,
    /CEF_POST_TASK\(\s*CEF_UIT, base::BindOnce\(&RunDownloadTargetCallback,\s*std::move\(callback\), base::FilePath\(\)\)\);\s*return;/,
  );
  assert.ok(
    after.indexOf("return;") < after.indexOf("if (suggested_path.empty())"),
  );
  assert.doesNotMatch(
    added,
    /LOG\(|DLOG\(|DCHECK\(|download_path\.value|suggested_path\.value|dir_path\.value|DIR_TEMP|ChooseDownloadPath/,
  );
});

test("documentation separates the local build from runtime selection and scoped live acceptance", async () => {
  const readme = await readFile(new URL("README.md", root), "utf8");
  assert.doesNotMatch(
    readme,
    /not been engine-built, packaged, selected or live-tested/,
  );
  assert.match(readme, /built and packaged locally/);
  assert.match(readme, /package-windows-x64-recovery-05/);
  assert.match(readme, /does \*\*not change normal runtime selection\*\*/);
  assert.match(readme, /explicit-path\s+fallback is still present/);
  assert.match(readme, /Dedicated live cancellation validation/);
  assert.match(readme, /passed locally on Windows x64/);
  assert.match(readme, /run-AyvOLw\/receipt\.json/);
  assert.match(readme, /not a zero-temporary-I\/O claim/);
  assert.match(readme, /upstream `CreateDirectory` warning/);
  assert.match(
    readme,
    /Real app save-dialog acceptance and other platforms remain\s+unverified/,
  );
  assert.match(readme, /Main owns\s+normal selection and app-level acceptance/);
  const adapter = await readFile(
    new URL(
      "../../src-tauri/crates/sorng-browser-host/src/cef_downloads.rs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(adapter, /patch 0006 is required/);
  assert.match(adapter, /guarantee is pending/);
});
