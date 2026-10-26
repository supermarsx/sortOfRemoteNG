import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  authority,
  emptyInputs,
  remaining,
  closeScope,
  held,
  copyNinja,
  numericLines,
  stopAfterGn,
  capture,
  sourceTimes,
  errorScalars,
  carriedBudget,
  eventRepository,
  BRANCH,
  SOURCE,
  TOOLS,
  NINJAS,
  LIMIT,
  OWN,
} from "../../native/mac-gn-graph-diagnostic/observe.mjs";
import { canonical } from "../../scripts/lib/cef-engineering-checkpoint.mjs";
import { run } from "../../scripts/cef-runtime-ci.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
async function fixture(run) {
  const folder = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "mac-gn-data-"),
  );
  try {
    return await run(folder);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
}
function env() {
  return {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
    GITHUB_REPOSITORY_ID: "1010282954",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_REF: "refs/heads/" + BRANCH,
    CEF_DEFAULT_BRANCH: "main",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_REF:
      "supermarsx/sortOfRemoteNG/.github/workflows/cef-sdk-layout-probe.yml@refs/heads/" +
      BRANCH,
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
  };
}

test("only actual fixed diagnostic branch/public/manual hosted identity is admitted", () => {
  authority(env(), "darwin", "x64");
  for (const change of [
    { CEF_DEFAULT_BRANCH: "other" },
    { GITHUB_REF: "refs/heads/main" },
    { GITHUB_REF: "refs/heads/other" },
    { GITHUB_WORKFLOW_SHA: "b".repeat(40) },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REPOSITORY_ID: "1" },
    { GITHUB_REPOSITORY_VISIBILITY: "private" },
    { GITHUB_ACTIONS: "false" },
    { GITHUB_RUN_ATTEMPT: "0" },
    { GITHUB_WORKFLOW_REF: "foreign" },
  ])
    assert.throws(() => authority({ ...env(), ...change }, "darwin", "x64"));
  assert.throws(() => authority(env(), "linux", "x64"), /MAC_GN_HOST/);
  assert.throws(() => authority(env(), "darwin", "arm64"), /MAC_GN_HOST/);
  emptyInputs({ inputs: null });
  emptyInputs({ inputs: {} });
  for (const event of [
    {},
    { inputs: [] },
    { inputs: "" },
    { inputs: false },
    { inputs: { path: "other" } },
  ])
    assert.throws(() => emptyInputs(event), /MAC_GN_INPUTS/);
});

test("event repository projection requires actual fixed public default-main metadata", () => {
  const repository = {
    id: 1010282954,
    full_name: "supermarsx/sortOfRemoteNG",
    private: false,
    default_branch: "main",
    visibility: "public",
  };
  assert.deepEqual(eventRepository({ repository }), {
    id: repository.id,
    full_name: repository.full_name,
    private: false,
    default_branch: "main",
  });
  for (const change of [
    { id: "1010282954" },
    { full_name: "other/repo" },
    { private: true },
    { default_branch: "other" },
    { visibility: "private" },
  ])
    assert.throws(
      () => eventRepository({ repository: { ...repository, ...change } }),
      /MAC_GN_EVENT_REPOSITORY/,
    );
  assert.throws(() => eventRepository({}), /MAC_GN_EVENT_REPOSITORY/);
});

test(
  "actual maintained run receives a finite numeric carried budget, natural benign child, and expired pre-spawn denial",
  { timeout: 10000 },
  async () =>
    fixture(async (folder) => {
      const budget = carriedBudget(Date.now() + 5000, 5000);
      assert(Number.isFinite(budget.remaining()) && budget.remaining() > 1000);
      assert(Number.isFinite(budget.assertRemaining()));
      const result = await run(
        process.execPath,
        [
          "-e",
          "setTimeout(()=>process.stdout.write('fixed-budget-fixture\\n'),50)",
        ],
        {
          cwd: folder,
          logs: folder,
          name: "budget-natural",
          env: {
            SystemRoot: process.env.SystemRoot ?? "C:/Windows",
            PATH: path.dirname(process.execPath),
          },
          capture: true,
          budget,
        },
      );
      assert.equal(result, "fixed-budget-fixture");
      await assert.rejects(
        run(process.execPath, ["-e", "throw Error('must not spawn')"], {
          cwd: folder,
          logs: folder,
          name: "expired",
          env: {},
          budget: carriedBudget(0, 5000),
        }),
        /MAC_GN_DEADLINE/,
      );
      assert.deepEqual((await fs.readdir(folder)).sort(), [
        "budget-natural.stderr.log",
        "budget-natural.stdout.log",
      ]);
    }),
);

test("single wall and monotonic deadline cannot be reset or extended", () => {
  assert.equal(remaining({ wallEnd: 100, monoEnd: 90 }, 70, 85), 5);
  for (const row of [
    { wallEnd: 100, monoEnd: 80 },
    { wallEnd: Infinity, monoEnd: 100 },
    { wallEnd: 70, monoEnd: 100 },
  ])
    assert.throws(() => remaining(row, 70, 85));
});

test("streamed numeric projection retains only decimal scalars/public roles and counts", () => {
  const parser = numericLines(),
    line =
      "command = TOOL_VERSION=1792980000 python ../../build/toolchain/apple/linker_driver.py -o output\n";
  for (const byte of Buffer.from(
    line +
      line +
      "JSON_VERSION=1792980001 TOOL_VERSION=1792980002 python swiftc.py\n",
  ))
    parser.feed(Buffer.from([byte]));
  const result = parser.finish();
  assert.equal(result.lines, 3);
  assert.deepEqual(result.scalars, [
    {
      field: "TOOL_VERSION",
      role: "linker_driver.py",
      value: "1792980000",
      count: 2,
    },
    {
      field: "JSON_VERSION",
      role: "swift_const_gather_protocols.json",
      value: "1792980001",
      count: 1,
    },
    { field: "TOOL_VERSION", role: "swiftc.py", value: "1792980002", count: 1 },
  ]);
  assert(!JSON.stringify(result).includes("command"));
  assert(!JSON.stringify(result).includes("output"));
});

test("malformed values/UTF8 and oversized analysis lines remain strict", () => {
  for (const bytes of [
    Buffer.from("TOOL_VERSION=-1 linker_driver.py\n"),
    Buffer.from([0xff]),
    Buffer.alloc(LIMIT.line + 1, 65),
    Buffer.from("x\0\n"),
  ]) {
    const parser = numericLines();
    assert.throws(() => {
      parser.feed(bytes);
      parser.finish();
    });
  }
});

test("unknown and ambiguous roles retain only closed classification and numeric count", () => {
  const parser = numericLines();
  parser.feed(
    Buffer.from(
      "TOOL_VERSION=1 unknown-private-command\nTOOL_VERSION=2 linker_driver.py filter_libtool.py\nJSON_VERSION=3 unknown-private-command\n",
    ),
  );
  const rows = parser.finish().scalars;
  assert.deepEqual(
    rows.map((r) => r.classification),
    ["unclassified", "ambiguous", "unclassified"],
  );
  assert(rows.every((r) => r.role === null));
  assert(!JSON.stringify(rows).includes("private-command"));
});

test("numeric syntax denial never prevents an independent exact whole-body copy", async () =>
  fixture(async (folder) => {
    for (const [i, raw] of [
      Buffer.from("TOOL_VERSION=bad linker_driver.py\n"),
      Buffer.from([0xff, 0xfe]),
      Buffer.from("TOOL_VERSION=1 variable-only\n"),
    ].entries()) {
      const source = path.join(folder, "source-" + i),
        target = path.join(folder, "copy-" + i);
      await fs.writeFile(source, raw);
      const result = await copyNinja(source, target, () => {}, {});
      assert.equal(result.sha256, sha(raw));
      assert.deepEqual(await fs.readFile(target), raw);
      if (i < 2) assert(result.parseFailure);
      else assert.equal(result.scalars[0].classification, "unclassified");
    }
  }));

test("actual held reader hashes bytes and denies expired/growing/changed owned files", async () =>
  fixture(async (folder) => {
    const file = path.join(folder, "input");
    await fs.writeFile(file, "abc");
    const row = await held(file, 10, () => {}, {});
    assert.equal(row.sha256, sha("abc"));
    assert.equal(row.bytes, 3);
    await assert.rejects(
      held(file, 2, () => {}, {}),
      /MAC_GN_FILE/,
    );
    await assert.rejects(
      held(
        file,
        10,
        () => {
          throw Error("MAC_GN_DEADLINE");
        },
        {},
      ),
      /MAC_GN_DEADLINE/,
    );
    await assert.rejects(
      held(
        file,
        10,
        () => {},
        {},
        async () => {
          await fs.writeFile(file, "abcd");
        },
      ),
      /MAC_GN_(SIZE|CHANGED)/,
    );
  }));

test("real owned hardlink and symlink are refused without following aliases", async (t) =>
  fixture(async (folder) => {
    const source = path.join(folder, "source"),
      hard = path.join(folder, "hard"),
      link = path.join(folder, "link");
    await fs.writeFile(source, "abc");
    await fs.link(source, hard);
    await assert.rejects(
      held(source, 10, () => {}, {}),
      /MAC_GN_FILE/,
    );
    await fs.unlink(hard);
    try {
      await fs.symlink(source, link, "file");
    } catch (error) {
      if (["EPERM", "EACCES"].includes(error.code)) {
        t.skip("Owned symlink privilege unavailable");
        return;
      }
      throw error;
    }
    await assert.rejects(
      held(link, 10, () => {}, {}),
      /MAC_GN_(ALIAS|LINK)/,
    );
  }));

test("exclusive independent whole-body copy and remaining aggregate admission", async () =>
  fixture(async (folder) => {
    const source = path.join(folder, "source"),
      destination = path.join(folder, "copy"),
      raw = "TOOL_VERSION=123 linker_driver.py\n";
    await fs.writeFile(source, raw);
    const result = await copyNinja(source, destination, () => {}, {});
    assert.equal(result.sha256, sha(raw));
    assert.equal(result.scalars[0].value, "123");
    assert.equal(await fs.readFile(destination, "utf8"), raw);
    assert.notEqual(
      (await fs.stat(source)).ino,
      (await fs.stat(destination)).ino,
    );
    await assert.rejects(
      copyNinja(source, destination, () => {}, {}),
      { code: "EEXIST" },
    );
    const capTarget = path.join(folder, "cap");
    await assert.rejects(
      copyNinja(source, capTarget, () => {}, {}, fs, 1),
      /MAC_GN_FILE/,
    );
    assert.equal((await fs.stat(capTarget)).size, 0);
    await assert.rejects(
      copyNinja(source, path.join(folder, "none"), () => {}, {}, fs, 0),
      /MAC_GN_TOTAL_BOUND/,
    );
  }));

test("copy corruption and partial output write failure are retained and deny", async () =>
  fixture(async (folder) => {
    const source = path.join(folder, "source"),
      raw = "TOOL_VERSION=123 linker_driver.py\n";
    await fs.writeFile(source, raw);
    const corruption = path.join(folder, "corrupt"),
      io = {
        ...fs,
        open: async (file, flags, mode) => {
          const fd = await fs.open(file, flags, mode);
          if (file !== corruption || flags !== "wx") return fd;
          return {
            write: (...a) => fd.write(...a),
            sync: () => fd.sync(),
            close: async () => {
              await fd.close();
              await fs.writeFile(
                corruption,
                Buffer.alloc(Buffer.byteLength(raw), 120),
              );
            },
          };
        },
      };
    await assert.rejects(
      copyNinja(source, corruption, () => {}, {}, io),
      /MAC_GN_COPY_PIN/,
    );
    const partial = path.join(folder, "partial"),
      primary = Object.assign(Error("MAC_GN_TEST_WRITE"), {
        cause: Error("synthetic cause"),
      }),
      state = {};
    const bad = {
      ...fs,
      open: async (file, flags, mode) => {
        const fd = await fs.open(file, flags, mode);
        if (file !== partial || flags !== "wx") return fd;
        return {
          write: async () => {
            throw primary;
          },
          close: async () => {
            await fd.close();
            throw Error("close fault");
          },
        };
      },
    };
    await assert.rejects(
      copyNinja(source, partial, () => {}, state, bad),
      (error) => {
        assert.equal(error, primary);
        assert.equal(error.cause, primary.cause);
        return true;
      },
    );
    assert.equal(state.cleanupFailure, "MAC_GN_CLOSE");
    assert.equal((await fs.stat(partial)).size, 0);
  }));

test("read error object/cause survives close failure; close-only fault denies", async () =>
  fixture(async (folder) => {
    const file = path.join(folder, "source");
    await fs.writeFile(file, "abc");
    const primary = Object.assign(Error("MAC_GN_TEST_READ"), {
        cause: Error("cause"),
      }),
      state = {};
    const io = {
      ...fs,
      open: async (...a) => {
        const fd = await fs.open(...a);
        return {
          stat: (...x) => fd.stat(...x),
          read: async () => {
            throw primary;
          },
          close: async () => {
            await fd.close();
            throw Error("secondary");
          },
        };
      },
    };
    await assert.rejects(
      held(file, 10, () => {}, state, undefined, io),
      (error) => {
        assert.equal(error, primary);
        return true;
      },
    );
    assert.equal(state.cleanupFailure, "MAC_GN_CLOSE");
    await assert.rejects(
      closeScope(
        {
          close: async () => {
            throw Error("close");
          },
        },
        async () => true,
        {},
      ),
      /MAC_GN_CLOSE/,
    );
  }));

test("actual afterGn sentinel prevents compiler and package continuation", async () => {
  const calls = [];
  const result = await stopAfterGn(
    async (options) => {
      calls.push("gn-returned");
      await options.engineering.afterGn({ fixture: true });
      calls.push("compile-reached");
      await options.engineering.compile();
    },
    { workspace: "/synthetic" },
    async () => {
      calls.push("captured");
    },
  );
  assert.deepEqual(calls, ["gn-returned", "captured"]);
  assert.deepEqual(result, { observedAfterGn: true, compilerExecuted: false });
  await assert.rejects(
    stopAfterGn(
      async (o) => o.engineering.compile(),
      {},
      async () => {},
    ),
    /MAC_GN_COMPILE_DENIED/,
  );
  await assert.rejects(
    stopAfterGn(
      async (o) => o.engineering.packagingMilliseconds(),
      {},
      async () => {},
    ),
    /MAC_GN_PACKAGE_DENIED/,
  );
});

test("lookalike sentinel, collection errors and missing boundary remain failures", async () => {
  const lookalike = { kind: "private-after-GN-diagnostic-stop" },
    primary = Error("MAC_GN_TEST_CAPTURE");
  await assert.rejects(
    stopAfterGn(
      async () => {
        throw lookalike;
      },
      {},
      async () => {},
    ),
    (e) => e === lookalike,
  );
  await assert.rejects(
    stopAfterGn(
      async (o) => o.engineering.afterGn({}),
      {},
      async () => {
        throw primary;
      },
    ),
    (e) => e === primary,
  );
  await assert.rejects(
    stopAfterGn(
      async () => {},
      {},
      async () => {},
    ),
    /MAC_GN_STOP_NOT_OBSERVED/,
  );
});

test("six actual synthetic Ninja bodies bind graph pins and five supplied scalar observations", async () =>
  fixture(async (folder) => {
    const chromium = path.join(folder, "src"),
      out = path.join(chromium, "out/Release_GN_arm64"),
      output = path.join(folder, "evidence");
    await fs.mkdir(out, { recursive: true });
    await fs.mkdir(output);
    const raw = "TOOL_VERSION=123 linker_driver.py\n",
      pins = [];
    await fs.writeFile(path.join(out, "args.gn"), "synthetic = true\n");
    await fs.writeFile(
      path.join(out, "build.ninja"),
      "# synthetic test graph\n",
    );
    for (const name of NINJAS) {
      await fs.mkdir(path.dirname(path.join(out, name)), { recursive: true });
      await fs.writeFile(path.join(out, name), raw);
      pins.push({
        path: name,
        name: "toolchain.ninja",
        bytes: Buffer.byteLength(raw),
        sha256: sha(raw),
      });
    }
    const times = TOOLS.map(([name, bytes, hash]) => ({
      path: "build/toolchain/apple/" + name,
      role: name,
      bytes,
      sha256: hash,
      mtimeNs: "123000000000",
      integerMtime: "123",
    }));
    let samples = 0;
    // Production is Unix-only. On Windows inject an explicitly synthetic POSIX
    // graph packet; Unix gates exercise the real maintained graphInventory.
    const inventory =
      process.platform === "win32"
        ? async (_out, options) => {
            const rows = [
              ...pins,
              ...[
                ["args.gn", "synthetic = true\n"],
                ["build.ninja", "# synthetic test graph\n"],
              ].map(([name, data]) => ({
                path: name,
                name,
                bytes: Buffer.byteLength(data),
                sha256: sha(data),
              })),
            ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
            const packet = {
              pins: rows,
              files: rows.length,
              bytes: rows.reduce((n, row) => n + row.bytes, 0),
              sha256: sha(canonical(rows)),
            };
            await options.observePins(packet);
            return {
              files: packet.files,
              bytes: packet.bytes,
              sha256: packet.sha256,
            };
          }
        : undefined;
    const result = await capture(
      { chromium },
      output,
      () => {},
      {},
      fs,
      inventory,
      async () => {
        samples++;
        return times;
      },
    );
    assert.equal(result.files.length, 6);
    assert.equal(samples, 2);
    assert(result.comparisons.every((r) => r.matchesObservedSourceMtime));
    assert.equal(result.normalizationApplied, false);
    assert.equal(result.restoreAccepted, false);
    assert.equal(
      (await fs.readdir(output)).filter((name) => name.endsWith(".bin")).length,
      6,
    );
  }));

test("pinned five source roles cannot be replaced with superficially sized fixture bytes", async () =>
  fixture(async (folder) => {
    for (const [name, bytes] of TOOLS) {
      const file = path.join(folder, "build/toolchain/apple", name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, Buffer.alloc(bytes, 120));
    }
    await assert.rejects(
      sourceTimes(folder, () => {}, {}),
      /MAC_GN_TOOL_PIN/,
    );
  }));

test("actual capture keeps graph-observer/report write primary even when maintained observer contract swallows it", async () => {
  for (const filename of ["fresh-graph-pins.json", "gn-evidence.json"])
    await fixture(async (folder) => {
      const chromium = path.join(folder, "src"),
        out = path.join(chromium, "out/Release_GN_arm64"),
        output = path.join(folder, "evidence");
      await fs.mkdir(out, { recursive: true });
      await fs.mkdir(output);
      const raw = "TOOL_VERSION=123 linker_driver.py\n",
        rows = [];
      for (const name of NINJAS) {
        await fs.mkdir(path.dirname(path.join(out, name)), { recursive: true });
        await fs.writeFile(path.join(out, name), raw);
        rows.push({
          path: name,
          name: "toolchain.ninja",
          bytes: Buffer.byteLength(raw),
          sha256: sha(raw),
        });
      }
      rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const packet = {
        pins: rows,
        files: rows.length,
        bytes: rows.reduce((n, r) => n + r.bytes, 0),
        sha256: sha(canonical(rows)),
      };
      const primary = Object.assign(Error("synthetic private I/O"), {
          code: "EIO",
          cause: Error("original cause"),
        }),
        state = {};
      const io = {
        ...fs,
        writeFile: async (file, ...args) => {
          if (path.basename(file) === filename) throw primary;
          return fs.writeFile(file, ...args);
        },
      };
      await assert.rejects(
        capture(
          { chromium },
          output,
          () => {},
          state,
          io,
          async (_out, options) => {
            try {
              await options.observePins(packet);
            } catch {
              /* Actual API treats observer as optional. */
            }
            return { sha256: packet.sha256 };
          },
          async () => [],
        ),
        (e) => {
          assert.equal(e, primary);
          assert.equal(e.cause, primary.cause);
          return true;
        },
      );
      assert.equal(state.reportingFailure, "MAC_GN_REPORT_WRITE");
    });
});

test("early-build errors retain only closed exact code/signal/killed facts, not raw tool text", () => {
  assert.deepEqual(
    errorScalars({
      code: "ETIMEDOUT",
      signal: "SIGKILL",
      killed: true,
      message: "private command/path",
    }),
    { code: "ETIMEDOUT", signal: "SIGKILL", killed: true },
  );
  assert.deepEqual(
    errorScalars({
      code: "PRIVATE_UNKNOWN",
      signal: "PRIVATE",
      killed: "true",
    }),
    { code: null, signal: null, killed: null },
  );
});

test("unclassified numeric commands deny only after all six exact bodies and complete summary exist", async () =>
  fixture(async (folder) => {
    const chromium = path.join(folder, "src"),
      out = path.join(chromium, "out/Release_GN_arm64"),
      output = path.join(folder, "evidence");
    await fs.mkdir(out, { recursive: true });
    await fs.mkdir(output);
    const raw = "TOOL_VERSION=123 unknown-command-variable\n",
      rows = [];
    for (const name of NINJAS) {
      await fs.mkdir(path.dirname(path.join(out, name)), { recursive: true });
      await fs.writeFile(path.join(out, name), raw);
      rows.push({
        path: name,
        name: "toolchain.ninja",
        bytes: Buffer.byteLength(raw),
        sha256: sha(raw),
      });
    }
    rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const packet = {
      pins: rows,
      files: rows.length,
      bytes: rows.reduce((n, r) => n + r.bytes, 0),
      sha256: sha(canonical(rows)),
    };
    await assert.rejects(
      capture(
        { chromium },
        output,
        () => {},
        {},
        fs,
        async (_out, o) => {
          await o.observePins(packet);
          return { sha256: packet.sha256 };
        },
        async () => [],
      ),
      /MAC_GN_CLASSIFICATION_INCOMPLETE/,
    );
    for (let i = 0; i < 6; i++)
      assert.equal(
        sha(await fs.readFile(path.join(output, "ninja-" + i + ".bin"))),
        sha(raw),
      );
    const summary = JSON.parse(
      await fs.readFile(path.join(output, "gn-evidence.json"), "utf8"),
    );
    assert.equal(summary.numericClassificationComplete, false);
    assert.equal(summary.files.length, 6);
    assert(
      summary.files.every(
        (f) => f.scalars[0].classification === "unclassified",
      ),
    );
    assert(!JSON.stringify(summary).includes("unknown-command-variable"));
  }));

test("branch workflow/artifacts/source boundary preserve Main producer and no runtime claim", async () => {
  const workflow = (
      await fs.readFile(path.join(root, OWN[0]), "utf8")
    ).replaceAll("\r\n", "\n"),
    source = await fs.readFile(path.join(root, OWN[1]), "utf8");
  assert(workflow.includes("github.ref == 'refs/heads/" + BRANCH + "'"));
  assert(workflow.includes("github.ref != format('refs/heads/{0}'"));
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /include-hidden-files: true/);
  assert.match(workflow, /node-version-file: "\.node-version"/);
  assert.match(workflow, /GIT_CONFIG_VALUE_0: "false"/);
  assert.equal(
    SOURCE,
    "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
  );
  for (let i = 0; i < 6; i++) assert(workflow.includes("/ninja-" + i + ".bin"));
  assert(!workflow.includes("/source/"));
  assert(!workflow.includes("/bundle/"));
  assert(!workflow.includes("contents: write"));
  assert(!workflow.includes("**"));
  assert(source.includes("c.workerMilliseconds = remaining(c) - 123000"));
  assert(source.includes("milliseconds = remaining(c) - 123000"));
  assert(source.includes("const decision") === false);
  assert(!source.includes("restoreDownload("));
  assert(!source.includes("publish("));
});
