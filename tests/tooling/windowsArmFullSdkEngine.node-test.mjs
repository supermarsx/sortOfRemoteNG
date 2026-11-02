import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { parse } from "acorn";
import { fileURLToPath } from "node:url";
import {
  ENGINE_WORKER_ADMITTED,
  EXPENSIVE_ENGINE_ADMITTED,
  engineWorkerMain,
} from "../../native/windows-arm-full-sdk/full-sdk-engine-worker.mjs";
import * as custom from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-custom-runtime.mjs";
import { boundedBuildCommands } from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/cef-runtime-ci.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (
  await fs.readFile(
    path.join(root, "native/windows-arm-full-sdk/full-sdk-engine-worker.mjs"),
    "utf8",
  )
).replace(/\r\n/g, "\n");
const ast = parse(source, { sourceType: "module", ecmaVersion: "latest" });
const functionText = (name, text = source) => {
  const tree =
    text === source
      ? ast
      : parse(text, { sourceType: "module", ecmaVersion: "latest" });
  const row = tree.body.find((wrapped) => {
    const node = wrapped.declaration ?? wrapped;
    return node.type === "FunctionDeclaration" && node.id.name === name;
  });
  assert(row, name);
  return text.slice(row.start, row.end);
};
const need = (ok, code) => {
  if (!ok) throw Error("FULL_SDK_ENGINE_" + code);
};
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const scope = { path, REPO: root, need };

test("reviewed engine attempt rejects caller objects before any property or IO", async () => {
  assert.equal(ENGINE_WORKER_ADMITTED, true);
  assert.equal(EXPENSIVE_ENGINE_ADMITTED, true);
  const proxy = new Proxy([], {
    get() {
      throw Error("caller hook");
    },
  });
  await assert.rejects(engineWorkerMain(proxy), /ARGV/);
  assert(
    source.includes('argv[1] !== "cef-engine" || EXPENSIVE_ENGINE_ADMITTED'),
  );
});

test("actual existing recipe and probe policy produce exact fixed engine package clang and link vectors", async () => {
  const prefix = "native/windows-arm-full-sdk/";
  const selected = JSON.parse(
    await fs.readFile(
      path.join(root, prefix, "image-qualified-current-profile.json"),
    ),
  );
  const policy = JSON.parse(
    await fs.readFile(
      path.join(root, prefix, "private-qualification-profile.json"),
    ),
  );
  const inputsRoot = path.join(root, selected.sourceGn.namespace);
  const lock = custom.validateSourceLock(
    JSON.parse(await fs.readFile(path.join(inputsRoot, "source-lock.json"))),
  );
  const owned = path.join(
      root,
      ".artifacts/windows-arm-full-sdk-bb3bd4a8-e93c-44e5-81f2-3ddc15a01d19",
    ),
    chromium = path.join(owned, "source-checkout/src");
  const recipe = await custom.customRuntimeBuildRecipe({
    sourceLock: lock,
    target: "aarch64-pc-windows-msvc",
    inputsRoot,
    checkouts: {
      chromium,
      cef: path.join(chromium, "cef"),
      depotTools: path.join(owned, "depot_tools"),
    },
  });
  const commands = boundedBuildCommands(recipe, 4),
    actual = vm.runInNewContext("(" + functionText("vectors") + ")", scope)(
      owned,
      recipe,
      policy,
      "fixed-python.exe",
      commands,
    );
  assert.deepEqual(Array.from(actual["cef-engine"].args), commands[1].args);
  assert.deepEqual(commands[1].args.slice(-5), [
    "-C",
    "out/Release_GN_arm64",
    "cef",
    "bootstrap",
    "bootstrapc",
  ]);
  assert.deepEqual(commands[1].args.slice(1, 3), ["-j", "4"]);
  assert.deepEqual(Array.from(actual.package.args), recipe.commands[2].args);
  assert.deepEqual(recipe.commands[2].args, [
    "tools/make_distrib.py",
    "--output-dir",
    "binary_distrib",
    "--ninja-build",
    "--arm64-build",
    "--minimal",
    "--allow-partial",
  ]);
  const old = await fs.readFile(
    path.join(root, prefix, "full-sdk-source-driver.mjs"),
    "utf8",
  );
  const original = vm.runInNewContext(
    "(" +
      functionText("privateCommandProjections", old).replace(/^export /, "") +
      ")",
    {
      sourceJobProjection() {},
      JSON,
      PRIVATE_ROLES: ["a", "b", "c", "d", "e", "f"],
      Object,
    },
  )(
    { root: owned.replaceAll("\\", "/") },
    JSON.stringify(policy),
    "a".repeat(64),
  );
  const normalized = (argv) =>
    Array.from(argv, (item) =>
      item
        .replaceAll("\\", "/")
        .replaceAll("/private-qualification/", "/full-sdk-engine-probe/"),
    );
  // The legacy projection assumes the hosted checkout has no ancestor named
  // .artifacts. This portable test itself runs inside such a worktree.
  const legacyRepo = owned.replaceAll("\\", "/").split("/.artifacts/")[0];
  const legacyClang = Array.from(original[4].argv);
  legacyClang[legacyClang.length - 1] = legacyClang
    .at(-1)
    .replace(legacyRepo + "/native/", root.replaceAll("\\", "/") + "native/");
  assert.deepEqual(
    normalized([
      actual["probe-clang"].executable,
      ...actual["probe-clang"].args,
    ]),
    normalized(legacyClang),
  );
  assert.deepEqual(
    normalized([actual["probe-link"].executable, ...actual["probe-link"].args]),
    normalized(original[5].argv),
  );
});

test("actual child runner modeled close/error paths cannot publish late success and preserve falsy first failures", async () => {
  for (const first of [undefined, null, false, 0, "", new Error("owned")]) {
    const child = new EventEmitter();
    let killed = 0,
      rechecks = 0,
      options;
    child.kill = () => {
      killed++;
    };
    const actual = vm.runInNewContext("(" + functionText("runFixed") + ")", {
      recheck: async () => {
        rechecks++;
      },
      check: () => ({
        monoEnd: performance.now() + 10000,
        packet: { wallPhaseEnd: Date.now() / 1000 + 10 },
      }),
      spawn(_exe, _args, observed) {
        options = observed;
        queueMicrotask(() => {
          child.emit("error", first);
          child.emit("close", 0, null);
        });
        return child;
      },
      setTimeout,
      clearTimeout,
      performance,
      Date,
      need,
    });
    let caught,
      rejected = false;
    try {
      await actual(
        {},
        { executable: "fixed.exe", args: ["fixed"], cwd: "owned" },
        { FIXED: "only" },
      );
    } catch (error) {
      rejected = true;
      caught = error;
    }
    assert(rejected);
    assert.equal(caught, first);
    assert.equal(killed, 1);
    assert.equal(rechecks, 1);
    assert.equal(options.shell, false);
    assert.equal(options.detached, false);
    assert.deepEqual(Array.from(options.stdio), [
      "ignore",
      "inherit",
      "inherit",
    ]);
  }
  const child = new EventEmitter();
  let rechecks = 0;
  const actual = vm.runInNewContext("(" + functionText("runFixed") + ")", {
    recheck: async () => {
      rechecks++;
    },
    check: () => ({
      monoEnd: performance.now() + 10000,
      packet: { wallPhaseEnd: Date.now() / 1000 + 10 },
    }),
    spawn() {
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    },
    setTimeout,
    clearTimeout,
    performance,
    Date,
    need,
  });
  await actual({}, { executable: "fixed.exe", args: [], cwd: "owned" }, {});
  assert.equal(rechecks, 2);
});

test("actual held file body detects byte and physical identity drift and original deadline after close", async (t) => {
  const owned = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "cef-engine-held-")),
  );
  t.after(async () => {
    assert.equal(await fs.realpath(owned), owned);
    await fs.rm(owned, { recursive: true });
  });
  const file = path.join(owned, "data"),
    raw = Buffer.from("actual-held-data");
  await fs.writeFile(file, raw);
  const actual = (io, check) =>
    vm.runInNewContext("(" + functionText("hold") + ")", {
      fence: async () => {},
      check,
      fs: io,
      constants,
      path,
      Buffer,
      BigInt,
      Number,
      need,
      hash,
      identity: vm.runInNewContext("(" + functionText("identity") + ")", {
        need,
      }),
    });
  const check = () => ({ root: owned });
  assert.deepEqual(
    await actual(fs, check)({}, file, 100, {
      bytes: raw.length,
      sha256: hash(raw),
    }),
    raw,
  );
  await assert.rejects(
    actual(fs, check)({}, file, 100, {
      bytes: raw.length,
      sha256: "f".repeat(64),
    }),
    /PIN/,
  );
  let closed = false;
  const io = {
    ...fs,
    open: async (...args) => {
      const fd = await fs.open(...args);
      return {
        stat: (...a) => fd.stat(...a),
        read: (...a) => fd.read(...a),
        close: async () => {
          await fd.close();
          closed = true;
        },
      };
    },
  };
  await assert.rejects(
    actual(io, () => {
      if (closed) throw false;
      return {};
    })({}, file, 100),
    (error) => error === false,
  );
  assert(closed);
});

test("actual initial packet reader bounds real files and strict parser rejects duplicate equivalent keys", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "cef-engine-packet-"),
  );
  try {
    const reader = vm.runInNewContext(
      "(" + functionText("initialPacket") + ")",
      {
        fs,
        constants,
        Buffer,
        identity: vm.runInNewContext("(" + functionText("identity") + ")", {
          need,
        }),
        need,
      },
    );
    const file = path.join(directory, "packet.json"),
      raw = Buffer.from('{"fixed":true}\n');
    await fs.writeFile(file, raw, { flag: "wx" });
    assert.deepEqual(await reader(file), raw);
    await fs.writeFile(file, Buffer.alloc(131073));
    await assert.rejects(reader(file), /CONTEXT_BOUND/);
    const strict = vm.runInNewContext(
      "(" + functionText("strictRecord") + ")",
      { TextDecoder, need },
    );
    assert.equal(strict(Buffer.from('{\n  "a": 1\n}\n')).a, 1);
    for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}'])
      assert.throws(() => strict(Buffer.from(text)), /JSON_FORMAT/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("fixed embedded SDK extractor equals canonical LF bytes of existing bounded packager counterpart", async () => {
  const declarations = ast.body.filter(
    (node) => node.type === "VariableDeclaration",
  );
  const value = (name) =>
    declarations
      .flatMap((node) => node.declarations)
      .find((node) => node.id.name === name).init;
  const pin = vm.runInNewContext(
    "(" +
      source.slice(value("EXTRACT_PIN").start, value("EXTRACT_PIN").end) +
      ")",
  );
  const encoded = value("EXTRACT_DEFLATE").value;
  const raw = inflateRawSync(Buffer.from(encoded, "base64"), {
    maxOutputLength: pin.bytes,
  });
  assert.equal(raw.length, pin.bytes);
  assert.equal(hash(raw), pin.sha256);
  assert.deepEqual(
    raw,
    Buffer.from(
      (
        await fs.readFile(
          path.join(root, "scripts/lib/extract-custom-runtime.py"),
          "utf8",
        )
      ).replaceAll("\r\n", "\n"),
    ),
  );
  assert(source.includes('extract.toString("utf8")'));
  assert(
    !source.includes(
      "current-source-helpers/scripts/lib/extract-custom-runtime.py",
    ),
  );
});

test("worker recipe topology comes from actual source checkout paths and rejects the old misplaced depot tools root", async () => {
  const driver =
    await import("../../native/windows-arm-full-sdk/full-sdk-source-driver.mjs");
  const selected = JSON.parse(
    await fs.readFile(
      path.join(
        root,
        "native/windows-arm-full-sdk/image-qualified-current-profile.json",
      ),
    ),
  );
  const owned = path.join(
    root,
    ".artifacts/windows-arm-full-sdk-bb3bd4a8-e93c-44e5-81f2-3ddc15a01d19",
  );
  const expected = driver.sourcePaths(owned, {
    ...selected,
    privatePolicy: JSON.parse(
      await fs.readFile(
        path.join(
          root,
          "native/windows-arm-full-sdk/private-qualification-profile.json",
        ),
      ),
    ),
  });
  const loadTree = parse(functionText("load"), {
    sourceType: "module",
    ecmaVersion: "latest",
  });
  const declaration = loadTree.body[0].body.body
    .find((node) => node.type === "TryStatement")
    .block.body.find(
      (node) =>
        node.type === "VariableDeclaration" &&
        node.declarations.some((item) => item.id.name === "checkouts"),
    );
  assert(declaration);
  const text = functionText("load");
  const expression = declaration.declarations.find(
    (node) => node.id.name === "checkouts",
  ).init;
  const actualText = text.slice(expression.start, expression.end);
  const actual = vm.runInNewContext("(" + actualText + ")", {
    path,
    root: owned,
  });
  assert.equal(actual.chromium, expected.chromium);
  assert.equal(actual.cef, expected.cef);
  assert.equal(actual.depotTools, expected.depot);
  assert.equal(actualText.split('"source-checkout/depot_tools"').length, 2);
  const previous = vm.runInNewContext(
    "(" +
      actualText.replace('"source-checkout/depot_tools"', '"depot_tools"') +
      ")",
    { path, root: owned },
  );
  assert.notEqual(previous.depotTools, expected.depot);
});

test("actual worker report and probe mkdir continuations preserve false retirement before any late mutation", async () => {
  for (const name of ["save", "execute"]) {
    const current = functionText(name);
    const point =
      name === "save"
        ? "  await fence(token);\n  check(token);\n"
        : "  await prior(job);\n  check(token);\n";
    assert.equal(current.split(point).length, 2);
    const old = current.replace(point, point.replace("  check(token);\n", ""));
    for (const [program, expected] of [
      [old, 1],
      [current, 0],
    ]) {
      let retired = false,
        mutations = 0;
      const state = { root: "owned", packet: { role: "probe-clang" } };
      const fn = vm.runInNewContext("(" + program + ")", {
        check() {
          if (retired) throw false;
          return state;
        },
        fence: async () => {
          queueMicrotask(() => {
            retired = true;
          });
        },
        recheck: async () => {},
        prior: async () => {
          queueMicrotask(() => {
            retired = true;
          });
        },
        fs: {
          writeFile: async () => {
            mutations++;
          },
          mkdir: async () => {
            mutations++;
          },
        },
        path,
        Buffer,
        need,
        hash,
      });
      await assert.rejects(
        name === "save"
          ? fn({}, "result.json", { fixed: true })
          : fn({ token: {}, state }),
        (error) => error === false,
      );
      assert.equal(mutations, expected, name);
    }
  }
});

test("actual pack continuation checks the original lease before starting the inventory writer", async () => {
  const current = functionText("packageSdk"),
    boundary = "  check(token);\n  await inventory.inventoryCustomArtifact({";
  assert.equal(current.split(boundary).length, 2);
  const previous = current.replace(
    boundary,
    "  await inventory.inventoryCustomArtifact({",
  );
  for (const mode of ["deadline", "retired"]) {
    for (const guarded of [false, true]) {
      let now = 0,
        calls = 0,
        lateWrites = 0,
        actualCheck;
      const token = {},
        state = {
          root: "C:/owned",
          closed: false,
          failed: false,
          packet: {
            target: "aarch64-pc-windows-msvc",
            wallPhaseEnd: 1,
            wallWholeEnd: 1000,
          },
          monoEnd: 1000,
        };
      const states = new WeakMap([[token, state]]),
        marker = new Error("LATE_INVENTORY_INVOKED");
      const context = {
        path,
        states,
        need,
        Date: { now: () => now },
        performance: { now: () => now },
        fs: {
          readdir: async () => [
            { name: "cef_binary_example_minimal", isDirectory: () => true },
          ],
          mkdir: async () => {},
          writeFile: async () => {},
        },
        runFixed: async () => {
          actualCheck(token); // Same actual final check as the successful callee.
          if (++calls === 2)
            queueMicrotask(() => {
              if (mode === "deadline") now = 1001;
              else {
                state.failed = true;
                state.primary = false;
              }
            });
        },
      };
      const api = vm.runInNewContext(
        functionText("check") +
          "\n" +
          (guarded ? current : previous) +
          ";({check,packageSdk})",
        context,
      );
      actualCheck = api.check;
      const job = {
        token,
        state,
        lock: {},
        inputsRoot: "/inputs",
        environment: {},
        profile: { python: { path: "/python" } },
        vector: { package: {} },
        runtime: {
          flattenSdk: async () => "/sdk",
          releaseIdentity: () => ({ archive: "sdk.tar" }),
          stableJson: () => "{}",
          PACK_PYTHON: "fixed-data",
        },
        custom: {},
        inventory: {
          inventoryCustomArtifact: async () => {
            lateWrites++;
            throw marker;
          },
        },
      };
      await assert.rejects(api.packageSdk(job), (error) =>
        guarded
          ? mode === "retired"
            ? error === false
            : /DEADLINE/.test(error.message)
          : error === marker,
      );
      assert.equal(calls, 2);
      assert.equal(lateWrites, guarded ? 0 : 1);
    }
  }
});
// BEGIN FINITE ENGINE ASSEMBLY INVERSE
const ENGINE_ASSEMBLY = {
  rows: [
    {
      name: "finite-0",
      oldRaw:
        '// Fixed child of the creation-assigned engine Job. No standalone SDK authority.\nimport * as fs from "node:fs/promises";\nimport { constants } from "node:fs";\nimport { createHash } from "node:crypto";\nimport { spawn } from "node:child_process";\nimport { inflateRawSync } from "node:zlib";\nimport path from "node:path";\nimport { fileURLToPath, pathToFileURL } from "node:url";\nimport { fullSdkSourceRootName } from "./source-root.mjs";\n\nexport const ENGINE_WORKER_ADMITTED = false;\nexport const EXPENSIVE_ENGINE_ADMITTED = false;\nconst HERE = fileURLToPath(new URL("./", import.meta.url));\nconst REPO = path.resolve(HERE, "../..");\nconst ROLES = ["probe-clang", "probe-link", "cef-engine", "package"];\nconst METADATA_MAXIMA = [\n  65536, 65536, 1048576, 1048576, 4194304, 1048576, 8388608, 8388608, 131072,\n];\n// Exact existing bounded SDK extractor source, transported as fixed DATA.\nconst EXTRACT_PIN = {\n  bytes: 4123,\n  sha256: "701f220319cb2aed27ae903f3f41abc3469ee457ac3cb04349ec71fc8482935f",\n',
      newRaw:
        '// Fixed child of the creation-assigned engine Job. No standalone SDK authority.\nimport * as fs from "node:fs/promises";\nimport { constants } from "node:fs";\nimport { createHash } from "node:crypto";\nimport { spawn } from "node:child_process";\nimport { inflateRawSync } from "node:zlib";\nimport { types as utilTypes } from "node:util";\nimport path from "node:path";\nimport { fileURLToPath, pathToFileURL } from "node:url";\nimport { fullSdkSourceRootName } from "./source-root.mjs";\n\nexport const ENGINE_WORKER_ADMITTED = true; // Reviewed fixed execution attempt, not a qualification fact.\nexport const EXPENSIVE_ENGINE_ADMITTED = true; // Original slice/whole limits and checkpoint alternative remain.\nconst HERE = fileURLToPath(new URL("./", import.meta.url));\nconst REPO = path.resolve(HERE, "../..");\nconst ROLES = [\n  "probe-clang",\n  "probe-link",\n  "cef-engine",\n  "package",\n  "checkpoint-seal",\n];\nconst METADATA_MAXIMA = [\n  65536, 65536, 1048576, 1048576, 4194304, 1048576, 8388608, 8388608, 131072,\n];\n// Exact existing bounded SDK extractor source, transported as fixed DATA.\nconst EXTRACT_PIN = {\n  bytes: 4123,\n  sha256: "701f220319cb2aed27ae903f3f41abc3469ee457ac3cb04349ec71fc8482935f",\n',
      oldSha256:
        "2e6848deae5de22d13dcafd4aa5fb82a90af460fd724fbdf8b2eadb080af88ac",
      newSha256:
        "1d46b843bab1c3146a3f7a4d0250c2f43f56993d136d3ba33c7fb6d7aaf7a612",
    },
    {
      name: "finite-1",
      oldRaw:
        '          row.bytes === 0 && row.sha256 === hash(Buffer.alloc(0)),\n          "GIT_SYSTEM_PIN",\n        );\n    }\n  }\n  if (role === "probe-clang") need(packet.prior === null, "PRIOR");\n  else {\n    shape(packet.prior, ["result", "receipt"]);\n    for (const pin of Object.values(packet.prior)) {\n      shape(pin, ["bytes", "sha256"]);\n      need(\n        Number.isSafeInteger(pin.bytes) &&\n          pin.bytes > 0 &&\n          pin.bytes <= 2097152 &&\n          typeof pin.sha256 === "string" &&\n          /^[a-f0-9]{64}$/.test(pin.sha256),\n',
      newRaw:
        '          row.bytes === 0 && row.sha256 === hash(Buffer.alloc(0)),\n          "GIT_SYSTEM_PIN",\n        );\n    }\n  }\n  if (role === "probe-clang") need(packet.prior === null, "PRIOR");\n  else {\n    const sliceSeal = role === "checkpoint-seal";\n    shape(\n      packet.prior,\n      sliceSeal\n        ? ["result", "receipt", "closure", "launch"]\n        : ["result", "receipt"],\n    );\n    if (sliceSeal) need(packet.prior.result === null, "PRIOR_SLICE_RESULT");\n    for (const pin of Object.entries(packet.prior)\n      .filter(([name]) => !sliceSeal || name !== "result")\n      .map(([, value]) => value)) {\n      shape(pin, ["bytes", "sha256"]);\n      need(\n        Number.isSafeInteger(pin.bytes) &&\n          pin.bytes > 0 &&\n          pin.bytes <= 2097152 &&\n          typeof pin.sha256 === "string" &&\n          /^[a-f0-9]{64}$/.test(pin.sha256),\n',
      oldSha256:
        "a4d6cd334773e5a993c54dba2ebc1d962909fc71155dbbce52b208193c344f51",
      newSha256:
        "8a1f02e1c47a13584ea83fd76153d26b9ff76bd6074d59c6fd39b5fef5462e9d",
    },
    {
      name: "finite-2",
      oldRaw:
        '    GCM_INTERACTIVE: "never",\n    GIT_TEMPLATE_DIR: path.join(p, "hooks"),\n    GIT_ALLOW_PROTOCOL: "https",\n    GIT_PROTOCOL_FROM_USER: "0",\n    GIT_OPTIONAL_LOCKS: "0",\n  };\n}\nfunction vectors(root, recipe, candidate, python, commands) {\n  const source = path.join(root, "source-checkout/src"),\n    out = path.join(source, "out/Release_GN_arm64"),\n    probe = path.join(root, "full-sdk-engine-probe");\n  return {\n    "probe-clang": {\n      executable: path.join(root, "llvm/bin/clang-cl.exe"),\n      cwd: probe,\n',
      newRaw:
        '    GCM_INTERACTIVE: "never",\n    GIT_TEMPLATE_DIR: path.join(p, "hooks"),\n    GIT_ALLOW_PROTOCOL: "https",\n    GIT_PROTOCOL_FROM_USER: "0",\n    GIT_OPTIONAL_LOCKS: "0",\n  };\n}\nfunction vectors(\n  root,\n  recipe,\n  candidate,\n  python,\n  commands,\n  sourceContextSha256,\n) {\n  const source = path.join(root, "source-checkout/src"),\n    out = path.join(source, "out/Release_GN_arm64"),\n    probe = path.join(root, "full-sdk-engine-probe");\n  return {\n    "probe-clang": {\n      executable: path.join(root, "llvm/bin/clang-cl.exe"),\n      cwd: probe,\n',
      oldSha256:
        "613660a755f223e61d43ba18ef5b203e3e4bc424762b7e1a2a405e699b24293b",
      newSha256:
        "ebc8628192a92b3d5cc85c85b26ceae34f00c28155be1db799832a7275673ea4",
    },
    {
      name: "finite-3",
      oldRaw:
        '        "/entry:" + candidate.probeEntry,\n        "/manifest:no",\n        "/out:" + path.join(probe, "probe.exe"),\n        path.join(probe, "probe.obj"),\n      ],\n    },\n    "cef-engine": { executable: python, cwd: source, args: commands[1].args },\n    package: {\n      executable: python,\n      cwd: recipe.commands[2].cwd,\n      args: recipe.commands[2].args,\n    },\n  };\n}\n',
      newRaw:
        '        "/entry:" + candidate.probeEntry,\n        "/manifest:no",\n        "/out:" + path.join(probe, "probe.exe"),\n        path.join(probe, "probe.obj"),\n      ],\n    },\n    "cef-engine": { executable: python, cwd: source, args: commands[1].args },\n    "checkpoint-seal": {\n      executable: python,\n      cwd: root,\n      args: [\n        "-I",\n        "-B",\n        path.join(REPO, "native/windows-arm-full-sdk/compiled_checkpoint.py"),\n        "--seal",\n        root,\n        sourceContextSha256,\n      ],\n    },\n    package: {\n      executable: python,\n      cwd: recipe.commands[2].cwd,\n      args: recipe.commands[2].args,\n    },\n  };\n}\n',
      oldSha256:
        "b238514ade9b28ae61eb29c32e0b349d0fd4f21d46bb582c0e4e57025b631e1d",
      newSha256:
        "5b76ab832bb89b42386a68ef14c88644e94340d8d54baeeb1b016912ba2247fd",
    },
    {
      name: "finite-4",
      oldRaw:
        '      });\n      child.once("error", deny);\n      child.once("close", (code, signal) => {\n        if (failed) reject(primary);\n        else if (code === 0 && signal === null) resolve(code);\n        else deny(new Error("FULL_SDK_ENGINE_CHILD_FAILED"));\n      });\n      timer = setTimeout(\n        () => deny(new Error("FULL_SDK_ENGINE_DEADLINE")),\n        Math.max(\n          1,\n          Math.min(\n            s.monoEnd - performance.now(),\n            s.packet.wallPhaseEnd * 1000 - Date.now(),\n          ),\n        ),\n      );\n    });\n    need(result === 0, "CHILD_FAILED");\n    check(token);\n    await recheck(token);\n  } finally {\n    clearTimeout(timer);\n  }\n',
      newRaw:
        '      });\n      child.once("error", deny);\n      child.once("close", (code, signal) => {\n        if (failed) reject(primary);\n        else if (code === 0 && signal === null) resolve(code);\n        else deny(new Error("FULL_SDK_ENGINE_CHILD_FAILED"));\n      });\n      // Only the fixed CEF slice delegates expiry to its genuine Python Job.\n      // Probe/package/seal retain their own strict inner deadline.\n      if (s.packet.role !== "cef-engine")\n        timer = setTimeout(\n          () => deny(new Error("FULL_SDK_ENGINE_DEADLINE")),\n          Math.max(\n            1,\n            Math.min(\n              s.monoEnd - performance.now(),\n              s.packet.wallPhaseEnd * 1000 - Date.now(),\n            ),\n          ),\n        );\n    });\n    need(result === 0, "CHILD_FAILED");\n    check(token);\n    await recheck(token);\n  } finally {\n    clearTimeout(timer);\n  }\n',
      oldSha256:
        "1dc1feef4d41e6877e703cf04362e69a5dc41785b5ae0ffe9e92b365618933ba",
      newSha256:
        "2a774926633f3c0cd98cb7fdfa580eb9e4146bbbe693603a5f71ef353d513757",
    },
    {
      name: "finite-5",
      oldRaw:
        '      commands,\n      vector: vectors(\n        root,\n        recipe,\n        privatePolicy,\n        profile.python.path,\n        commands,\n      ),\n      environment: env,\n    };\n  } catch (error) {\n    state.failed = true;\n    state.primary = error;\n    state.closed = true;\n    states.delete(token);\n    throw error;\n  }\n}\nasync function prior(job) {\n  const { token, state } = job,\n    index = ROLES.indexOf(state.packet.role);\n  if (index === 0) {\n    need(state.packet.prior === null, "PRIOR");\n    return;\n  }\n  const previous = ROLES[index - 1],\n',
      newRaw:
        '      commands,\n      vector: vectors(\n        root,\n        recipe,\n        privatePolicy,\n        profile.python.path,\n        commands,\n        packet.sourceContextSha256,\n      ),\n      environment: env,\n    };\n  } catch (error) {\n    state.failed = true;\n    state.primary = error;\n    state.closed = true;\n    states.delete(token);\n    throw error;\n  }\n}\n// BEGIN FIXED NATIVE SLICE READER\nexport function inspectNativeSlice(value, seconds) {\n  need(\n    Number.isSafeInteger(seconds) &&\n      seconds > 0 &&\n      seconds <= 10800 &&\n      value &&\n      value.kind === "owned-job-proof" &&\n      value.outcome === "deadline" &&\n      value.success === false &&\n      value.rootExit === null &&\n      value.finalRootExit === 124 &&\n      value.rootReaped === true &&\n      value.activeAtEnd === 0 &&\n      value.cleanupVerified === true &&\n      value.logReadersStopped === true &&\n      value.cleanupBudgetMs === 30000 &&\n      Number.isSafeInteger(value.elapsedMs) &&\n      value.elapsedMs >= seconds * 1000 &&\n      value.started === true &&\n      value.jobCreated === true &&\n      value.assignedBeforeResume === true &&\n      value.resumed === true &&\n      value.assignedAtCreationVerified === true &&\n      value.assignmentMode === "creation-attribute" &&\n      value.handleListOnly === true &&\n      value.jobHandleInheritable === false &&\n      value.jobHandleInStdioAllowlist === false &&\n      Number.isSafeInteger(value.rootPid) &&\n      value.rootPid > 0 &&\n      typeof value.rootCreationFiletime === "string" &&\n      /^[1-9][0-9]{0,19}$/.test(value.rootCreationFiletime) &&\n      (!Object.hasOwn(value, "observerStopped") ||\n        value.observerStopped === true) &&\n      value.outputCapBytes === 67108864 &&\n      Number.isSafeInteger(value.capturedBytes) &&\n      value.capturedBytes >= 0 &&\n      value.capturedBytes <= value.outputCapBytes,\n    "SLICE_NATIVE_DEADLINE",\n  );\n  const policy = {\n    flags: 8712,\n    activeProcessLimit: 64,\n    jobMemoryBytes: "8589934592",\n    cpuFlags: 5,\n    cpuRate: 2500,\n    inheritedHandles: 3,\n    affinityChanged: false,\n  };\n  shape(value.policyReadback, Object.keys(policy));\n  need(\n    Object.entries(policy).every(\n      ([key, expected]) => value.policyReadback[key] === expected,\n    ),\n    "SLICE_POLICY",\n  );\n  return value; // Data only; no source/compiler/checkpoint capability is issued.\n}\nasync function deadlinePrior(job) {\n  const { token, state } = job,\n    pins = state.packet.prior;\n  need(\n    state.packet.role === "checkpoint-seal" && pins.result === null,\n    "PRIOR_SLICE",\n  );\n  const rows = [\n    ["jobs/cef-engine/receipt.json", pins.receipt],\n    ["full-sdk-engine-closed-cef-engine.json", pins.closure],\n    ["full-sdk-engine-cef-engine-launch.json", pins.launch],\n  ];\n  const values = [];\n  for (const [relative, pin] of rows) {\n    values.push(\n      JSON.parse(\n        await hold(token, path.join(state.root, relative), 1048576, pin),\n      ),\n    );\n    state.inputs.push([path.join(state.root, relative), pin]);\n  }\n  const [receipt, closed, launch] = values;\n  inspectNativeSlice(receipt, closed.jobSeconds);\n  need(\n    closed.kind === "windows-arm-full-sdk-engine-launcher-close" &&\n      closed.role === "cef-engine" &&\n      closed.completion === "native-slice-ended" &&\n      closed.success === true &&\n      closed.parentHandleClosed === true &&\n      closed.ownHandleClosed === true &&\n      closed.sdkBuilt === false &&\n      closed.nativeAcceptance === false &&\n      closed.ownPid === launch.ownPid &&\n      closed.ownCreationFiletime === launch.ownCreationFiletime &&\n      closed.parentPid === state.packet.parentPid &&\n      closed.parentCreationFiletime === state.packet.parentCreationFiletime &&\n      closed.sourceContextSha256 === state.packet.sourceContextSha256 &&\n      closed.receiptPin?.bytes === pins.receipt.bytes &&\n      closed.receiptPin?.sha256 === pins.receipt.sha256 &&\n      launch.kind === "windows-arm-full-sdk-engine-launch" &&\n      launch.role === "cef-engine" &&\n      launch.parentPid === state.packet.parentPid &&\n      launch.parentCreationFiletime === state.packet.parentCreationFiletime &&\n      receipt.rootPid !== launch.ownPid &&\n      typeof launch.contextSha256 === "string" &&\n      /^[a-f0-9]{64}$/.test(launch.contextSha256),\n    "PRIOR_SLICE_CLOSE",\n  );\n  const contextFile = path.join(\n      state.root,\n      "full-sdk-engine-cef-engine-context.json",\n    ),\n    raw = await hold(token, contextFile, 131072);\n  need(hash(raw) === launch.contextSha256, "PRIOR_SLICE_CONTEXT");\n  const previous = JSON.parse(raw);\n  need(\n    previous.role === "cef-engine" &&\n      previous.sourceContextSha256 === state.packet.sourceContextSha256 &&\n      previous.image === state.packet.image &&\n      previous.sourceId === state.packet.sourceId &&\n      previous.wallWholeEnd === state.packet.wallWholeEnd &&\n      previous.monotonicWholeEnd === state.packet.monotonicWholeEnd &&\n      previous.wallPhaseEnd <= previous.wallWholeEnd - 3600 &&\n      previous.monotonicPhaseEnd <= previous.monotonicWholeEnd - 3600,\n    "PRIOR_SLICE_SCOPE",\n  );\n  state.inputs.push([contextFile, { bytes: raw.length, sha256: hash(raw) }]);\n  await recheck(token);\n}\n// END FIXED NATIVE SLICE READER\n\nasync function prior(job) {\n  if (job.state.packet.role === "checkpoint-seal") return deadlinePrior(job);\n  const { token, state } = job,\n    index = ROLES.indexOf(state.packet.role);\n  if (index === 0) {\n    need(state.packet.prior === null, "PRIOR");\n    return;\n  }\n  const previous = ROLES[index - 1],\n',
      oldSha256:
        "32fbab1451b3446ef00038b774db01ea2822dd88a1d70df00017f8a41618eb7c",
      newSha256:
        "08dafdb9121cefdce458f604c3b0b7af62f571d4d6eff450c01c1cae84c7d241",
    },
    {
      name: "finite-6",
      oldRaw:
        '  check(token);\n  let output = null;\n  if (role === "probe-clang") {\n    await fs.mkdir(path.join(s.root, "full-sdk-engine-probe"));\n    check(token);\n  }\n  if (role === "package") output = await packageSdk(job);\n  else {\n    const environment = role.startsWith("probe-")\n      ? {\n          SystemRoot: "C:/Windows",\n          WINDIR: "C:/Windows",\n          PATH: "C:/Windows/System32",\n          TEMP: path.join(s.root, "tmp"),\n          TMP: path.join(s.root, "tmp"),\n',
      newRaw:
        '  check(token);\n  let output = null;\n  if (role === "probe-clang") {\n    await fs.mkdir(path.join(s.root, "full-sdk-engine-probe"));\n    check(token);\n  }\n  if (role === "package") output = await packageSdk(job);\n  else if (role === "checkpoint-seal") {\n    await runFixed(token, job.vector[role], job.environment);\n    const raw = await hold(\n      token,\n      path.join(s.root, "full-sdk-checkpoint-seal-result.json"),\n      131072,\n    );\n    const result = JSON.parse(raw);\n    need(\n      result.schemaVersion === 1 &&\n        result.kind === "windows-arm-full-sdk-checkpoint-seal-result" &&\n        result.sourceContextSha256 === s.packet.sourceContextSha256 &&\n        result.dataOnly === true &&\n        result.sealed === true &&\n        result.outcome === "quiet-deadline" &&\n        result.bundle === "full-sdk-checkpoint-output" &&\n        result.sdkBuilt === false &&\n        result.nativeAcceptance === false &&\n        result.executionAdmitted === false,\n      "CHECKPOINT_SEAL_RESULT",\n    );\n    output = { ...result, result: { bytes: raw.length, sha256: hash(raw) } };\n  } else {\n    const environment = role.startsWith("probe-")\n      ? {\n          SystemRoot: "C:/Windows",\n          WINDIR: "C:/Windows",\n          PATH: "C:/Windows/System32",\n          TEMP: path.join(s.root, "tmp"),\n          TMP: path.join(s.root, "tmp"),\n',
      oldSha256:
        "4907c58ec6808f6625e0fa6bfd813555fbb803a9e9fd08282b983dfae146f3ea",
      newSha256:
        "aa322b726e57a85cac2fd1a431913bf2ff030df12557726a25cd2d2ce9c86187",
    },
    {
      name: "finite-7",
      oldRaw:
        '    runtimeReady: false,\n  });\n}\nexport async function engineWorkerMain(argv = process.argv.slice(2)) {\n  const began = performance.now();\n  need(ENGINE_WORKER_ADMITTED, "NATIVE_CLOSED");\n  need(\n    argv.length === 5 &&\n      argv[0] === "--full-sdk-engine-worker" &&\n      ROLES.includes(argv[1]) &&\n      /^[a-f0-9]{64}$/.test(argv[3]) &&\n      argv[4] === "--execute",\n    "ARGV",\n  );\n  need(\n',
      newRaw:
        '    runtimeReady: false,\n  });\n}\nexport async function engineWorkerMain(argv = process.argv.slice(2)) {\n  const began = performance.now();\n  need(ENGINE_WORKER_ADMITTED, "NATIVE_CLOSED");\n  need(\n    !utilTypes.isProxy(argv) &&\n      Array.isArray(argv) &&\n      Object.getPrototypeOf(argv) === Array.prototype &&\n      Object.keys(Object.getOwnPropertyDescriptors(argv)).sort().join() ===\n        "0,1,2,3,4,length" &&\n      Object.values(Object.getOwnPropertyDescriptors(argv)).every((row) =>\n        Object.hasOwn(row, "value"),\n      ) &&\n      argv.length === 5 &&\n      argv.every((value) => typeof value === "string") &&\n      argv[0] === "--full-sdk-engine-worker" &&\n      ROLES.includes(argv[1]) &&\n      /^[a-f0-9]{64}$/.test(argv[3]) &&\n      argv[4] === "--execute",\n    "ARGV",\n  );\n  need(\n',
      oldSha256:
        "43b03fda0c4cc270c04f8e172babbe99afec68c11b8ea9ecb80a7c841f75e56a",
      newSha256:
        "7f7444a9bfb7837309b21ad2396589eddb7e45f41a2175c6ac7b491206de66a2",
    },
  ],
  bytes: 33021,
  sha256: "33b1b63c9ceac9b60dd6b5a29d92ba1709917085d2c465947c458601ac8391e3",
};
function engineAssemblyInverse(text) {
  for (const row of [...ENGINE_ASSEMBLY.rows].reverse()) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(hash(row.oldRaw), row.oldSha256);
    assert.equal(text.split(row.newRaw).length, 2);
    text = text.replace(row.newRaw, () => row.oldRaw);
  }
  assert.equal(Buffer.byteLength(text), ENGINE_ASSEMBLY.bytes);
  assert.equal(hash(text), ENGINE_ASSEMBLY.sha256);
  return text;
}
// END FINITE ENGINE ASSEMBLY INVERSE

test("the inventory continuation fence is the sole change to the complete reviewed worker", () => {
  const current =
    "  check(token);\n  await inventory.inventoryCustomArtifact({";
  const reviewed = engineAssemblyInverse(source);
  assert.equal(reviewed.split(current).length, 2);
  const prior = reviewed.replace(
    current,
    "  await inventory.inventoryCustomArtifact({",
  );
  assert.equal(Buffer.byteLength(prior), 33005);
  assert.equal(
    hash(prior),
    "e1cfd4e72c03cdb8ee580b9b571532ab06a5aecf9371f3d2968c634ebc994870",
  );
});

test("finite engine assembly inverse rejects modified and duplicate branch bytes", () => {
  for (const row of ENGINE_ASSEMBLY.rows) {
    assert.throws(() =>
      engineAssemblyInverse(
        source.replace(row.newRaw, row.newRaw + "/*tamper*/"),
      ),
    );
    assert.throws(() => engineAssemblyInverse(source + row.newRaw));
  }
});
