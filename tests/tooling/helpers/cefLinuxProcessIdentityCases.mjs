import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { types as utilTypes } from "node:util";
import ts from "typescript";
import {
  linuxProcessRow,
  observedLineage,
  validateCompile,
} from "../../../scripts/lib/cef-engineering-checkpoint.mjs";

const BOOT = "f4c1744f-c6fe-4de8-a3bd-9b733a978cbb";
const OTHER_BOOT = "11111111-2222-4333-a444-555555555555";
function procStat(pid, parent, ticks, comm = "worker ) (") {
  const fields = Array(50).fill("0");
  fields[0] = "S";
  fields[1] = String(parent);
  fields[2] = String(pid);
  fields[3] = String(pid);
  fields[19] = String(ticks);
  return `${pid} (${comm}) ${fields.join(" ")}\n`;
}
// Actual production bodies in a closed lexical model; filesystem, clock and owner I/O
// below are MODELED. These tests issue no process, source or SDK authority.
const source = readFileSync(
  new URL(
    "../../../scripts/lib/cef-engineering-checkpoint.mjs",
    import.meta.url,
  ),
  "utf8",
);
const ast = ts.createSourceFile("core.mjs", source, 99, true, ts.ScriptKind.JS);
const names = [
  "compileMonitorGuard",
  "compileMonitorRecord",
  "compileMonitorDetails",
  "linuxProcessRow",
  "linuxProcessSnapshot",
];
const variables = [
  "assert",
  "LINUX_BOOT_ID",
  "LINUX_START_ID",
  "compileMonitorCodes",
  "compileMonitorMetadata",
];
const statements = ast.statements.filter((s) =>
  ts.isFunctionDeclaration(s)
    ? names.includes(s.name?.text)
    : ts.isVariableStatement(s) &&
      s.declarationList.declarations.some((d) =>
        variables.includes(d.name.getText(ast)),
      ),
);
assert.equal(statements.length, names.length + variables.length);
const body = statements
  .map((s) => s.getText(ast).replace(/^export /, ""))
  .join("\n");

function fixture(options = {}) {
  let bootReads = 0,
    current = 0;
  const opened = new Set(),
    calls = [],
    openedPerPath = new Map();
  const info = (directory, ino) => ({
    dev: 1n,
    ino: BigInt(ino),
    mode: directory ? 0o40555n : 0o100444n,
    uid: 0n,
    gid: 0n,
    nlink: directory ? 2n : 1n,
    isDirectory: () => directory,
    isFile: () => !directory,
    isSymbolicLink: () => false,
  });
  const inode = (file) =>
    file === "/proc"
      ? 1
      : file.includes("boot_id")
        ? 2
        : Number(/\/([0-9]+)\/stat$/.exec(file)[1]) + 100;
  const gone = () =>
    Object.assign(new Error("modeled vanished process"), { code: "ENOENT" });
  const open = async (file, flags) => {
    calls.push(file);
    assert(flags & 0x20000, "actual no-follow flag retained");
    await options.beforeOpen?.(file);
    if (options.missing && /\/(?:102)\/stat$/.test(file)) throw gone();
    if (options.allMissing && /\/[0-9]+\/stat$/.test(file)) throw gone();
    if (options.missingBoot && file.includes("boot_id")) throw gone();
    const directory = file === "/proc",
      ordinal = (openedPerPath.get(file) ?? 0) + 1;
    openedPerPath.set(file, ordinal);
    let text = "";
    if (file.includes("boot_id")) {
      bootReads++;
      text =
        (options.badBoot
          ? "not-a-uuid"
          : options.bootChange && bootReads > 1
            ? OTHER_BOOT
            : BOOT) + (options.bootWhitespace ? " \n" : "\n");
    } else if (!directory) {
      const pid = Number(/\/([0-9]+)\/stat$/.exec(file)[1]);
      text = procStat(
        options.foreign ? pid + 1 : pid,
        pid === 101 ? 100 : 101,
        BigInt(pid) + (options.reused && pid === 101 && ordinal > 1 ? 1n : 0n),
      );
      if (options.malformed) text = text.replace(" S ", " invalid ");
      if (options.oversize) text += " ".repeat(8193);
    }
    const raw = Buffer.from(text);
    const fd = {
      stat: async () => info(directory, inode(file)),
      read: async (buffer, offset, length, position) => {
        if (options.readFailure !== undefined && file.endsWith("/101/stat"))
          throw options.readFailure;
        if (options.missingDuringRead && file.endsWith("/102/stat"))
          throw gone();
        await options.beforeRead?.(file);
        const size = Math.max(0, Math.min(length, raw.length - position));
        raw.copy(buffer, offset, position, position + size);
        if (options.inodeRace && file.endsWith("/101/stat"))
          options.changedInode = true;
        return { bytesRead: size };
      },
      close: async () => {
        await options.beforeClose?.(file);
        if (options.closeFailure && file.endsWith("/101/stat"))
          throw new Error("modeled close failure");
        opened.delete(fd);
      },
    };
    opened.add(fd);
    return fd;
  };
  const lstat = async (file) => {
    const value = info(
      file === "/proc",
      inode(file) +
        (options.rootRace && file === "/proc" ? 1 : 0) +
        (options.changedInode && file.endsWith("/101/stat") ? 1 : 0),
    );
    if (
      (options.taskOwnerChange && /\/[0-9]+\/stat$/.test(file)) ||
      (options.rootOwnerChange && file === "/proc") ||
      (options.bootOwnerChange && file.includes("boot_id"))
    )
      value.uid = value.gid = 1000n;
    return value;
  };
  const opendir = async (file) => {
    assert.equal(file, "/proc");
    const values = options.entries ?? ["self", "sys", "101", "102"];
    let index = 0;
    const directory = {
      read: async () =>
        index === values.length
          ? null
          : {
              name: values[index++],
              isDirectory: () => !options.symbolic,
              isSymbolicLink: () => !!options.symbolic,
            },
      close: async () => opened.delete(directory),
    };
    opened.add(directory);
    return directory;
  };
  const api = new Function(
    "open",
    "lstat",
    "opendir",
    "fsConstants",
    "utilTypes",
    "performance",
    "setTimeout",
    "clearTimeout",
    body +
      "\nreturn { snapshot:linuxProcessSnapshot, details:compileMonitorDetails };",
  )(
    open,
    lstat,
    opendir,
    { O_RDONLY: 0, O_DIRECTORY: 0x10000, O_NOFOLLOW: 0x20000 },
    utilTypes,
    options.clock ? { now: () => current } : performance,
    setTimeout,
    clearTimeout,
  );
  const probeJoins = new Set();
  const run = (extra) =>
    api.snapshot({
      deadline: options.clock ? 2000 : performance.now() + 2000,
      probeJoins,
      ...extra,
    });
  return {
    ...api,
    run,
    opened,
    calls,
    probeJoins,
    setClock: (value) => (current = value),
  };
}

export function registerLinuxProcessIdentityTests() {
  test("Linux kernel birth identity ignores comm delimiters and all wall-clock fields", () => {
    const first = linuxProcessRow(procStat(101, 100, 232516400n), 101, BOOT);
    assert.equal(first.start, `linux-v1:${BOOT}:000000000ddbeb30`);
    assert(first.start.length <= 64);
    assert.deepEqual(
      first,
      linuxProcessRow(
        procStat(101, 100, 232516400n, ") newline\n("),
        101,
        BOOT,
      ),
    );
    for (const [text, pid, boot] of [
      [procStat(102, 100, 1n), 101, BOOT],
      [procStat(101, 100, 18446744073709551616n), 101, BOOT],
      [procStat(101, 100, 1n), 101, "bad"],
      ["101 (bad) S", 101, BOOT],
      [procStat(101, -1, 1n), 101, BOOT],
      [procStat(101, 100, 1n) + "a".repeat(8193), 101, BOOT],
    ])
      assert.throws(() => linuxProcessRow(text, pid, boot));
    let touched = false;
    assert.throws(() =>
      linuxProcessRow(procStat(101, 100, 1n), 101, {
        toString() {
          touched = true;
          return BOOT;
        },
      }),
    );
    assert.equal(touched, false);
  });
  test("Linux kernel reader double-checks actual paths and closes every modeled handle before success", async () => {
    const f = fixture(),
      rows = await f.run({
        rows: [{ pid: 9, start: "caller" }],
        bootId: "caller",
      });
    assert.deepEqual(
      rows.map((x) => x.pid),
      [101, 102],
    );
    assert(rows.every((x) => x.start.startsWith(`linux-v1:${BOOT}:`)));
    assert.equal(f.calls.filter((x) => x === "/proc/101/stat").length, 2);
    assert.equal(f.calls.filter((x) => x.includes("boot_id")).length, 2);
    assert(!f.calls.some((x) => x.includes("btime") || x.endsWith("/uptime")));
    assert.equal(f.opened.size, 0);
    assert.equal(f.probeJoins.size, 0);
    assert.deepEqual(
      observedLineage(rows, [{ pid: 101, start: rows[0].start }]),
      [
        { pid: 101, start: rows[0].start },
        { pid: 102, start: rows[1].start },
      ],
    );
    assert.throws(
      () =>
        observedLineage(
          [{ ...rows[0], start: rows[0].start.slice(0, -1) + "f" }],
          [{ pid: 101, start: rows[0].start }],
        ),
      /identity changed/,
    );
  });
  for (const [label, options, code] of [
    ["PID reuse during paired reads", { reused: true }, "PROC_ROW_REPLACED"],
    ["boot identity change", { bootChange: true }, "PROC_BOOT_ID"],
    ["malformed boot identity", { badBoot: true }, "PROC_BOOT_ID"],
    ["noncanonical boot bytes", { bootWhitespace: true }, "PROC_BOOT_ID"],
    ["missing boot source", { missingBoot: true }, "PROC_READ"],
    ["kernel mount replacement", { rootRace: true }, "PROC_ROOT"],
    ["proc mount owner change", { rootOwnerChange: true }, "PROC_ROOT"],
    [
      "boot record owner change",
      { bootOwnerChange: true },
      "PROC_FILE_IDENTITY",
    ],
    [
      "task owner with birth replacement",
      { taskOwnerChange: true, reused: true },
      "PROC_ROW_REPLACED",
    ],
    [
      "task owner with inode replacement",
      { taskOwnerChange: true, inodeRace: true },
      "PROC_FILE_IDENTITY",
    ],
    ["foreign PID record", { foreign: true }, "PROC_ROWS_SYNTAX"],
    ["malformed record", { malformed: true }, "PROC_ROWS_SYNTAX"],
    ["oversized record", { oversize: true }, "PROC_READ_BOUND"],
    ["read inode replacement", { inodeRace: true }, "PROC_FILE_IDENTITY"],
    [
      "duplicate process entry",
      { entries: ["101", "101"] },
      "PROC_ROWS_IDENTITY",
    ],
    [
      "ambiguous numeric process entry",
      { entries: ["0101"] },
      "PROC_ROWS_IDENTITY",
    ],
    [
      "symbolic process entry",
      { entries: ["101"], symbolic: true },
      "PROC_ROWS_IDENTITY",
    ],
    ["empty kernel snapshot", { allMissing: true }, "PROC_ROWS_COUNT"],
  ])
    test(
      "Linux kernel reader denies " + label + " with joined resources",
      async () => {
        const f = fixture(options);
        await assert.rejects(
          f.run(),
          (error) => f.details(error).code === code,
        );
        await Promise.allSettled([...f.probeJoins]);
        assert.equal(f.opened.size, 0);
        assert.equal(f.probeJoins.size, 0);
      },
    );
  test("Linux kernel reader treats a disappeared nonroot process as absent, never as caller data", async () => {
    for (const options of [{ missing: true }, { missingDuringRead: true }]) {
      const f = fixture(options),
        rows = await f.run();
      assert.deepEqual(
        rows.map((x) => x.pid),
        [101],
      );
      assert.equal(f.opened.size, 0);
    }
  });
  test("Linux kernel reader preserves the original deadline and joins a late opened descriptor", async () => {
    let release, reached;
    const entered = new Promise((resolve) => (reached = resolve)),
      held = new Promise((resolve) => (release = resolve));
    const controller = new AbortController();
    const f = fixture({
      beforeOpen: async (file) => {
        if (file === "/proc") {
          reached();
          await held;
        }
      },
    });
    const running = f.run({ signal: controller.signal });
    await entered;
    controller.abort();
    await assert.rejects(
      running,
      (error) => f.details(error).code === "PS_ABORT",
    );
    assert.equal(f.probeJoins.size, 1);
    release();
    await Promise.allSettled([...f.probeJoins]);
    assert.equal(f.opened.size, 0);
    assert.equal(f.probeJoins.size, 0);
    let clocked;
    clocked = fixture({
      clock: true,
      beforeRead: async () => clocked.setClock(2001),
    });
    await assert.rejects(
      clocked.run(),
      (error) => clocked.details(error).code === "PS_DEADLINE",
    );
    await Promise.allSettled([...clocked.probeJoins]);
    assert.equal(clocked.opened.size, 0);
  });
  test("Linux kernel reader retains a falsy first failure and never confirms an unclosed resource", async () => {
    const f = fixture({ readFailure: false, closeFailure: true });
    await assert.rejects(f.run(), (value) => value === false);
    const joined = await Promise.allSettled([...f.probeJoins]);
    assert(joined.some((x) => x.status === "rejected" && x.reason === false));
    assert.equal(f.probeJoins.size, 1);
    assert(f.opened.size > 0); // MODELED failed close, never an actual leaked OS descriptor.
  });
  test("Linux per-task inode ownership is presentation while kernel birth and physical inode remain bound", async () => {
    const f = fixture({ taskOwnerChange: true }),
      rows = await f.run();
    assert.equal(rows.length, 2);
    assert.equal(f.probeJoins.size, 0);
    assert.equal(f.opened.size, 0);
  });
  test("Linux live quiescence refuses legacy and mixed identities before kernel I/O", async () => {
    const quietSource = ast.statements
      .find(
        (s) => ts.isFunctionDeclaration(s) && s.name?.text === "observedQuiet",
      )
      .getText(ast)
      .replace(/^export /, "");
    const { quiet, details } = new Function(
      "process",
      body +
        "\n" +
        quietSource +
        ";return {quiet:observedQuiet,details:compileMonitorDetails};",
    )({ platform: "linux" });
    const current = {
      pid: 101,
      start: linuxProcessRow(procStat(101, 100, 1n), 101, BOOT).start,
    };
    const legacy = { pid: 102, start: "Sat Nov 14 23:38:31 2026" };
    for (const records of [[], [legacy], [current, legacy]])
      await assert.rejects(
        quiet(records, 101),
        (error) => details(error).code === "PROC_ROWS_IDENTITY",
      );
  });
  test("Linux compile receipts admit the exact stable kind and preserve legacy DATA without mixing identities", () => {
    const row = linuxProcessRow(procStat(101, 100, 1n), 101, BOOT);
    const value = {
      outcome: "slice-ended",
      exitCode: null,
      quiescent: true,
      groupId: 101,
      quiescence: "observed-lineage-and-root-group",
      observed: [{ pid: row.pid, start: row.start }],
    };
    assert.equal(validateCompile(value), value);
    const legacy = structuredClone(value);
    legacy.observed[0].start = "Sat Nov 14 23:38:31 2026";
    assert.equal(validateCompile(legacy), legacy);
    for (const start of [
      row.start.toUpperCase(),
      row.start + "0",
      "linux-v1:bad:0000000000000001",
      "darwin-v1:1:0",
      legacy.observed[0].start,
    ]) {
      const mixed = structuredClone(value);
      mixed.observed.push({ pid: 102, start });
      assert.throws(() => validateCompile(mixed));
    }
  });
}
