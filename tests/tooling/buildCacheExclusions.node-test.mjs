import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";

const read = (file) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const strings = (block) =>
  [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

test("benchmark checkout caches are excluded without excluding live source or tests", () => {
  const vitest = read("vitest.config.ts").match(
    /exclude:\s*\[([\s\S]*?)\]/,
  )?.[1];
  const eslint = read("eslint.config.js").match(
    /ignores:\s*\[([\s\S]*?)\]/,
  )?.[1];
  assert.ok(vitest);
  assert.ok(eslint);
  const tsconfig = JSON.parse(read("tsconfig.json"));
  assert.ok(tsconfig.exclude.includes(".cache"));
  for (const globs of [strings(vitest), strings(eslint)]) {
    for (const fixture of [
      ".cache/build-refactor-before/tests/protocol/fixture.test.tsx",
      ".cache/build-refactor-boxed/src/App.tsx",
    ])
      assert.ok(
        globs.some((glob) => matchesGlob(fixture, glob)),
        fixture,
      );
    for (const live of ["src/App.tsx", "tests/protocol/fixture.test.tsx"])
      assert.ok(!globs.some((glob) => matchesGlob(live, glob)), live);
  }
  assert.ok(!tsconfig.exclude.includes("src"));
  assert.ok(!tsconfig.exclude.includes("tests"));
  assert.ok(tsconfig.include.includes(".next/types/**/*.ts"));
  assert.ok(tsconfig.include.includes("next-env.d.ts"));
});
