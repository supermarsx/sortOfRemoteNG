import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";
const require = createRequire(import.meta.url);
const patched = require("../../vendor/braces-depth-guard");
test("the reviewed local guard preserves normal public brace APIs", () => {
  assert.deepEqual(patched("{a,b}"), ["(a|b)"]);
  assert.equal(patched.compile("a/{b,c}/d"), "a/(b|c)/d");
  for (const [pattern, expected] of [
    ["a/{b,c}/d", ["a/b/d", "a/c/d"]],
    ["{01..05..2}", ["01", "03", "05"]],
    ["{-2..2}", ["-2", "-1", "0", "1", "2"]],
    ["{a..c}", ["a", "b", "c"]],
    ["\\{a,b\\}", ["{a,b}"]],
    ["a/{unclosed", ["a/{unclosed"]],
    ["{a,{b,c}}", ["a", "b", "c"]],
  ])
    assert.deepEqual(patched.expand(pattern), expected);
  for (const pattern of [
    "src/**/*.{ts,tsx}",
    "a/{b,c}/d",
    "{01..05..2}",
    "(a|b)/{c,d}",
  ])
    assert.equal(patched.stringify(patched.parse(pattern)), pattern);
});
test("all string entrypoints reject advisory-sized nesting predictably in a bounded child", () => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    const assert = require('node:assert/strict');
    const braces = require('./vendor/braces-depth-guard');
    const pattern = '{'.repeat(4000) + 'x' + '}'.repeat(4000);
    for (const fn of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
      assert.throws(() => fn(pattern, { maxDepth: Infinity }), error => error instanceof SyntaxError && /nesting safety limit/.test(error.message));
    }
    assert.throws(() => braces.parse('('.repeat(4000)+'x'+')'.repeat(4000)), SyntaxError);
  `,
    ],
    {
      cwd: new URL("../../", import.meta.url),
      timeout: 5000,
      encoding: "utf8",
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test("direct AST entrypoints reject deep, cyclic and oversized graphs before recursion", () => {
  let deep = { type: "text", value: "x" };
  for (let i = 0; i < 4000; i++) deep = { type: "root", nodes: [deep] };
  const cyclic = { type: "root", nodes: [] };
  cyclic.nodes.push(cyclic);
  const wide = {
    type: "root",
    nodes: Array.from({ length: 50001 }, () => ({ type: "text", value: "x" })),
  };
  for (const fn of [patched.compile, patched.expand, patched.stringify]) {
    for (const ast of [deep, cyclic, wide])
      assert.throws(() => fn(ast), SyntaxError);
  }
});
