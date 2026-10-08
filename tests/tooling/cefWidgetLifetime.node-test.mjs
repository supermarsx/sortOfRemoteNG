import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../native/cef-patches/", import.meta.url);
const seriesRoot = new URL("154.0.8037.58-682c378/", root);
const filename = "0003-cef-native-widget-lifetime.patch";

test("native widget fix stays in the maintained series and upstream inventory", async () => {
  const series = await readFile(new URL("series", seriesRoot), "utf8");
  assert.equal(
    series.split(/\r?\n/).filter((line) => line === `cef ${filename}`).length,
    1,
  );
  const inventory = JSON.parse(
    await readFile(new URL("upstream-sha256.json", seriesRoot), "utf8"),
  );
  const baseline = inventory.filter(
    (row) =>
      row.project === "cef" &&
      row.path === "libcef/browser/native/native_widget_delegate.cc",
  );
  assert.equal(baseline.length, 1);
  assert.equal(
    baseline[0].sha256,
    "55694f7b59c6b109a6c6e980d650b1e7863c59b3a2d2e020f82b882e3d12905a",
  );
  assert.match(
    await readFile(new URL("fetch-sources.ps1", root), "utf8"),
    /libcef\/browser\/native\/native_widget_delegate\.cc/,
  );
  assert.match(
    await readFile(new URL("export-series.mjs", root), "utf8"),
    /0003-cef-native-widget-lifetime\.patch/,
  );
});

test("patched teardown detaches borrowed widget pointers before widget destruction", async () => {
  const patch = await readFile(new URL(filename, seriesRoot), "utf8");
  const after = patch
    .split(/\r?\n/)
    .filter((line) => /^[ +]/.test(line) && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
  assert.equal((after.match(/widget_\.reset\(\)/g) ?? []).length, 1);
  const detached = after.indexOf("std::move(on_delete_).Run()");
  const destroyed = after.indexOf("widget_.reset()");
  assert.ok(detached >= 0 && destroyed > detached);
  assert.ok(after.indexOf("delete this") > destroyed);
  assert.doesNotMatch(
    patch,
    /DanglingUntriaged|disable-features|disable-dangling/,
  );
});
