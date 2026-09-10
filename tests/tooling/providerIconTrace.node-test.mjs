import assert from "node:assert/strict";
import test from "node:test";
import {
  SOURCES,
  traceMask,
  traceSource,
} from "../../scripts/trace-provider-icons.mjs";

test("trace retains disconnected foreground islands and a transparent counter", () => {
  const width = 12,
    height = 8;
  const mask = Uint8Array.from({ length: width * height }, (_, i) => {
    const x = i % width,
      y = Math.floor(i / width);
    return Number(
      (x >= 1 &&
        x <= 6 &&
        y >= 1 &&
        y <= 6 &&
        !(x >= 3 && x <= 4 && y >= 3 && y <= 4)) ||
        (x >= 9 && x <= 10 && y >= 2 && y <= 4),
    );
  });
  const result = traceMask(mask, width, height);
  assert.equal(result.match(/M/g).length, 3);
  assert.equal(result.match(/Z/g).length, 3);
  assert.equal(result, traceMask(mask, width, height));
  assert.doesNotMatch(result, /NaN|Infinity/);
  for (const value of result.match(/\d+(?:\.\d+)?/g).map(Number))
    assert.ok(value >= 1 && value <= 23);
});

test("trace rejects empty or malformed masks", () => {
  assert.throws(
    () => traceMask(new Uint8Array(4), 0, 2),
    /Invalid bounded mask/,
  );
  assert.throws(
    () => traceMask(new Uint8Array(4), 3, 2),
    /Invalid bounded mask/,
  );
  assert.throws(() => traceMask(new Uint8Array(4), 2, 2), /No foreground/);
});

test("publisher inputs are hash pinned before image decoding", async () => {
  assert.deepEqual(Object.keys(SOURCES), [
    "ptservidor",
    "ptisp",
    "webtuga",
    "damewarePublisher",
  ]);
  for (const [name, source] of Object.entries(SOURCES)) {
    assert.match(source.url, /^https:\/\//);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.width > 0 && source.height > 0);
    await assert.rejects(
      traceSource(name, Buffer.from("changed source")),
      /changed publisher/,
    );
  }
  await assert.rejects(
    traceSource("unreviewed", Buffer.from("anything")),
    /Unknown/,
  );
});
