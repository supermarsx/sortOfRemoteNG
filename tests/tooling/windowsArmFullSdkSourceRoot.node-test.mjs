import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { parse } from "acorn";
import {
  FULL_SDK_SOURCE_ROOT_POLICY,
  fullSdkSourceRootName,
} from "../../native/windows-arm-full-sdk/source-root.mjs";

const prefix = new URL("../../native/windows-arm-full-sdk/", import.meta.url);
const vectors = [
  [
    "20261030.294.1",
    "e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90",
    "windows-arm-full-sdk-bb3bd4a8-e93c-44e5-81f2-3ddc15a01d19",
    "image-qualified-current-profile.json",
  ],
  [
    "20261021.278.1",
    "fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa",
    "windows-arm-full-sdk-adaa4b45-ea3f-4a01-b88f-10a988c6b0ac",
    "image-qualified-20261021-profile.json",
  ],
];

test("fixed domain and independently reviewed image/source tuples have stable distinct golden root names", async () => {
  assert.equal(
    FULL_SDK_SOURCE_ROOT_POLICY.domain,
    "sortOfRemoteNG/windows-arm-full-sdk/root/v1",
  );
  assert.equal(FULL_SDK_SOURCE_ROOT_POLICY.repositoryId, "1010282954");
  assert.equal(FULL_SDK_SOURCE_ROOT_POLICY.target, "aarch64-pc-windows-msvc");
  const roots = [];
  for (const [image, sourceId, expected, profileName] of vectors) {
    const profile = JSON.parse(await fs.readFile(new URL(profileName, prefix)));
    assert.equal(profile.image, image);
    assert.equal(profile.sourceGn.sourceId, sourceId);
    for (let count = 0; count < 3; count++)
      assert.equal(fullSdkSourceRootName(image, sourceId), expected);
    roots.push(expected);
    assert.match(
      expected,
      /^windows-arm-full-sdk-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    assert.equal(path.basename(expected), expected);
    assert.equal(path.isAbsolute(expected), false);
  }
  assert.notEqual(roots[0], roots[1]);
});

test("existing exact Python root grammar accepts both names while arbitrary roots and source tuples deny", async () => {
  const source = await fs.readFile(
    new URL("full_sdk_source.py", prefix),
    "utf8",
  );
  const match = /ROOT = re\.compile\(r'([^']*)'\s*r'([^']*)'\)/.exec(source);
  assert(match, "read the actual current Python root grammar");
  const actualGrammar = new RegExp("^(?:" + match[1] + match[2] + ")$");
  for (const [image, sourceId, expected] of vectors) {
    const full = "D:/a/sortOfRemoteNG/sortOfRemoteNG/.artifacts/" + expected;
    assert(actualGrammar.test(full));
    assert(!actualGrammar.test(full + "/extra"));
    assert(!actualGrammar.test(full.replace("/.artifacts/", "/foreign/")));
    assert.equal(fullSdkSourceRootName(image, sourceId), expected);
  }
  const [image, sourceId] = vectors[0];
  for (const args of [
    [],
    [image],
    [image, sourceId, undefined],
    [image, sourceId, "caller-root"],
    [image, sourceId, { head: "a".repeat(40) }],
    [image + " ", sourceId],
    ["unknown", sourceId],
    ["__proto__", sourceId],
    [image, vectors[1][1]],
    [image, "0".repeat(64)],
    [vectors[1][0], sourceId],
  ])
    assert.throws(
      () => fullSdkSourceRootName(...args),
      /FULL_SDK_SOURCE_ROOT_SCOPE/,
    );
});

test("scope validation never invokes caller coercions getters or proxies", () => {
  let calls = 0;
  const hostile = () => {
    calls++;
    throw Error("must not inspect caller object");
  };
  const proxy = new Proxy({}, { get: hostile, getPrototypeOf: hostile });
  const boxed = { toString: hostile, valueOf: hostile };
  for (const value of [
    null,
    undefined,
    false,
    0,
    proxy,
    boxed,
    [],
    Symbol("scope"),
  ]) {
    assert.throws(
      () => fullSdkSourceRootName(value, vectors[0][1]),
      /FULL_SDK_SOURCE_ROOT_SCOPE/,
    );
    assert.throws(
      () => fullSdkSourceRootName(vectors[0][0], value),
      /FULL_SDK_SOURCE_ROOT_SCOPE/,
    );
  }
  assert.equal(calls, 0);
});

test("actual exclusive owner mkdir rejects a preexisting canonical root and preserves its random marker bytes", async (t) => {
  const temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "cef-canonical-root-")),
  );
  t.after(async () => {
    assert.equal(await fs.realpath(temporary), temporary);
    await fs.rm(temporary, { recursive: true });
  });
  const parent = path.join(temporary, ".artifacts");
  await fs.mkdir(parent);
  for (const [image, sourceId] of vectors) {
    const root = path.join(parent, fullSdkSourceRootName(image, sourceId));
    await fs.mkdir(root, { mode: 0o700 });
    const marker = path.join(root, "full-sdk-source-owner.bin");
    const randomOwner = randomBytes(32);
    await fs.writeFile(marker, randomOwner, { flag: "wx" });
    const before = await fs.lstat(root, { bigint: true });
    await assert.rejects(fs.mkdir(root, { mode: 0o700 }), { code: "EEXIST" });
    await assert.rejects(
      fs.writeFile(marker, randomBytes(32), { flag: "wx" }),
      { code: "EEXIST" },
    );
    const after = await fs.lstat(root, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.deepEqual(await fs.readFile(marker), randomOwner);
    assert.deepEqual(await fs.readdir(root), ["full-sdk-source-owner.bin"]);
  }
});

test("naming module is immutable data-only and owning controller creation remains exclusive", async () => {
  assert.equal(FULL_SDK_SOURCE_ROOT_POLICY.rootCreationImplemented, false);
  assert.equal(
    FULL_SDK_SOURCE_ROOT_POLICY.compiledCheckpointImplemented,
    false,
  );
  assert.equal(FULL_SDK_SOURCE_ROOT_POLICY.executionAdmitted, false);
  assert.throws(() => {
    FULL_SDK_SOURCE_ROOT_POLICY.sources[vectors[0][0]] = vectors[1][1];
  }, TypeError);
  const source = await fs.readFile(new URL("source-root.mjs", prefix), "utf8");
  const tree = parse(source, { sourceType: "module", ecmaVersion: "latest" });
  assert.deepEqual(
    tree.body
      .filter((node) => node.type === "ImportDeclaration")
      .map((node) => node.source.value),
    ["node:crypto"],
  );
  assert(
    !/\b(?:process|Date|performance|randomUUID|mkdir|readFile|spawn|execFile|fetch)\b/.test(
      source.replace(/^\/\/.*$/gm, ""),
    ),
  );
  const control = await fs.readFile(
    new URL("full_sdk_control.mjs", prefix),
    "utf8",
  );
  assert(control.includes("fs.mkdir(root, { mode: 0o700 })"));
  assert(control.includes("state.owner.writeFile(randomBytes(32))"));
});
