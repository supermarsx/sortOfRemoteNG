import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareWindowsNativeCrashCapture } from "../../scripts/lib/windows-native-crash-capture.mjs";

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sorng-crash-test-"));
  try {
    const debuggerDirectory = path.join(
      root,
      "Windows Kits",
      "10",
      "Debuggers",
      process.arch === "arm64"
        ? "arm64"
        : process.arch === "ia32"
          ? "x86"
          : "x64",
    );
    await mkdir(debuggerDirectory, { recursive: true });
    const header = Buffer.alloc(128);
    header.write("MZ");
    header.writeUInt32LE(64, 60);
    header.writeUInt32LE(0x4550, 64);
    header.writeUInt16LE(
      process.arch === "arm64"
        ? 0xaa64
        : process.arch === "ia32"
          ? 0x14c
          : 0x8664,
      68,
    );
    await writeFile(path.join(debuggerDirectory, "cdb.exe"), header);
    const executable = path.join(root, "target.exe");
    await writeFile(executable, "fake target; never executed");
    const options = {
      executable,
      args: [],
      env: { SORNG_NATIVE_CRASH_CAPTURE: "1", "ProgramFiles(x86)": root },
      cwd: root,
      outputRoot: path.join(root, "reports with space"),
      platform: "win32",
    };
    await run(options);
  } finally {
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await rm(root, { recursive: true, force: true });
  }
}

const normalExit = (code = "0", child = "") =>
  `SORNG_NATIVE_MAIN_V1=abc\r\n${child}Last event: abc.123: Exit process 0:abc, code ${code}\r\n`;

test("capture is off by default and does not validate paths or touch disk", async () => {
  assert.equal(await prepareWindowsNativeCrashCapture({ env: {} }), null);
  assert.equal(
    await prepareWindowsNativeCrashCapture({
      env: { SORNG_NATIVE_CRASH_CAPTURE: "true" },
    }),
    null,
  );
});

test("explicit capture on another platform fails clearly", async () => {
  await assert.rejects(
    prepareWindowsNativeCrashCapture({
      env: { SORNG_NATIVE_CRASH_CAPTURE: "1" },
      platform: "linux",
    }),
    /only on Windows/,
  );
});

test("missing local debugger fails without creating a report or downloading", async () =>
  fixture(async (options) => {
    await assert.rejects(
      prepareWindowsNativeCrashCapture({
        ...options,
        env: { SORNG_NATIVE_CRASH_CAPTURE: "1" },
      }),
      /local CDB was not found/,
    );
    await assert.rejects(readdir(options.outputRoot), { code: "ENOENT" });
  }));

test("a debugger for another architecture is rejected instead of falling back", async () =>
  fixture(async (options) => {
    const architecture =
      process.arch === "arm64"
        ? "arm64"
        : process.arch === "ia32"
          ? "x86"
          : "x64";
    const candidate = path.join(
      options.cwd,
      "Windows Kits",
      "10",
      "Debuggers",
      architecture,
      "cdb.exe",
    );
    const header = await readFile(candidate);
    header.writeUInt16LE(process.arch === "ia32" ? 0x8664 : 0x14c, 68);
    await writeFile(candidate, header);
    await assert.rejects(
      prepareWindowsNativeCrashCapture(options),
      /local CDB was not found/,
    );
  }));

test("wrapper preserves target arguments, environment and working directory", async () =>
  fixture(async (options) => {
    options.args = ["--name", "space ; $value", 'literal"quote', "--other=one"];
    options.env.PRIVATE_VALUE = "fixture-only";
    const before = structuredClone(options);
    const prepared = await prepareWindowsNativeCrashCapture(options);
    assert.deepEqual(options, before);
    assert.deepEqual(prepared.args.slice(-5), [
      options.executable,
      ...options.args,
    ]);
    assert.deepEqual(prepared.env, options.env);
    assert.notEqual(prepared.env, options.env);
    assert.equal(prepared.cwd, options.cwd);
    assert.ok(prepared.args.includes("-o"));
    assert.ok(
      !prepared.args.includes("-g"),
      "initial breakpoint must execute capture commands",
    );
    for (const argument of ["-sins", "-netsyms:no", "-y"])
      assert.ok(prepared.args.includes(argument));
    assert.equal(prepared.args[prepared.args.indexOf("-y") + 1], options.cwd);
    assert.ok(prepared.logPath.startsWith(prepared.directory + path.sep));
    const script = await readFile(
      path.join(prepared.directory, "commands.txt"),
      "utf8",
    );
    assert.match(script, /sxd -c2 .* av/);
    assert.match(script, /sxe -c .* -c2 .* sov/);
    assert.match(script, /sxe -c .* -c2 .* 0x80000003/);
    assert.match(script, /\.lastevent/);
    assert.match(script, /sxi ibp/);
    assert.ok(!script.includes("$><"));
    assert.equal((script.match(/\$</g) ?? []).length, 5);
    const handler = await readFile(
      path.join(prepared.directory, "fatal.txt"),
      "utf8",
    );
    assert.match(handler, /\.ecxr\n~\*k\n/);
    assert.match(handler, /\.dump \/m /);
    assert.ok(!handler.includes("/ma"));
    assert.match(handler, /\nq\n$/);
    const firstOverflow = await readFile(
      path.join(prepared.directory, "first-overflow.txt"),
      "utf8",
    );
    assert.match(firstOverflow, /sxd -c "" -c2 .* sov/);
    assert.ok(!firstOverflow.includes("$><"));
    assert.match(firstOverflow, /-c2 "\$</);
    assert.match(firstOverflow, /\.ecxr\n~\*k\n/);
    assert.match(firstOverflow, /\ngn\n$/);
    const firstBreakpoint = await readFile(
      path.join(prepared.directory, "first-breakpoint.txt"),
      "utf8",
    );
    assert.match(firstBreakpoint, /^\.echo SORNG_NATIVE_FIRST_BREAKPOINT_V1\n/);
    assert.match(firstBreakpoint, /\.exr -1\n\.ecxr\n~\*k\n/);
    assert.match(firstBreakpoint, /\.dump \/m .*first-breakpoint\.dmp/);
    assert.match(firstBreakpoint, /sxd -c "" -c2 .* 0x80000003\ngn\n$/);
  }));

test("each capture has a unique report directory", async () =>
  fixture(async (options) => {
    const first = await prepareWindowsNativeCrashCapture(options);
    const second = await prepareWindowsNativeCrashCapture(options);
    assert.notEqual(first.directory, second.directory);
  }));

test("debugger script paths reject command-breaking characters before writing", async () =>
  fixture(async (options) => {
    for (const suffix of ['"injected', ";q", "\nq", "\0bad"]) {
      await assert.rejects(
        prepareWindowsNativeCrashCapture({
          ...options,
          outputRoot: options.outputRoot + suffix,
        }),
        /valid absolute output root/,
      );
    }
  }));

test("confirmed main exit zero succeeds even if a child exited nonzero", async () =>
  fixture(async (options) => {
    const prepared = await prepareWindowsNativeCrashCapture(options);
    await writeFile(
      prepared.logPath,
      normalExit("0", "Last event: def.456: Exit process 1:def, code 7\r\n"),
    );
    await prepared.afterRun();
  }));

test("nonzero main target exit is not masked by successful debugger completion", async () =>
  fixture(async (options) => {
    const prepared = await prepareWindowsNativeCrashCapture(options);
    await writeFile(prepared.logPath, normalExit("7"));
    await assert.rejects(prepared.afterRun(), /Native target exited 7/);
  }));

test("fatal child marker rejects even if main and debugger exits would succeed", async () =>
  fixture(async (options) => {
    const prepared = await prepareWindowsNativeCrashCapture(options);
    await writeFile(
      prepared.logPath,
      "SORNG_NATIVE_FATAL_V1\r\n" + normalExit(),
    );
    await assert.rejects(prepared.afterRun(), /Native process crashed/);
  }));

test("minidump independently proves capture even if log marker was lost", async () =>
  fixture(async (options) => {
    const prepared = await prepareWindowsNativeCrashCapture(options);
    await writeFile(prepared.logPath, normalExit());
    await writeFile(
      path.join(prepared.directory, "exception.dmp"),
      "fixture dump",
    );
    await assert.rejects(prepared.afterRun(), /Native process crashed/);
  }));

test("first-chance overflow evidence does not falsely fail a recovered target", async () =>
  fixture(async (options) => {
    const prepared = await prepareWindowsNativeCrashCapture(options);
    await writeFile(
      prepared.logPath,
      "SORNG_NATIVE_FIRST_STACK_OVERFLOW_V1\n" + normalExit(),
    );
    await writeFile(
      path.join(prepared.directory, "first-stack-overflow.dmp"),
      "fixture first-chance dump",
    );
    await prepared.afterRun();
    await writeFile(
      prepared.logPath,
      "SORNG_NATIVE_FIRST_STACK_OVERFLOW_V1\n" + normalExit("7"),
    );
    await assert.rejects(prepared.afterRun(), /Native target exited 7/);
  }));

test("first-chance breakpoint evidence preserves recovered success and nonzero failure", async () =>
  fixture(async (options) => {
    const prepared = await prepareWindowsNativeCrashCapture(options);
    await writeFile(
      path.join(prepared.directory, "first-breakpoint.dmp"),
      "fixture first-chance breakpoint dump",
    );
    await writeFile(
      prepared.logPath,
      "SORNG_NATIVE_FIRST_BREAKPOINT_V1\n" + normalExit(),
    );
    await prepared.afterRun();
    await writeFile(
      prepared.logPath,
      "SORNG_NATIVE_FIRST_BREAKPOINT_V1\n" + normalExit("80000003"),
    );
    await assert.rejects(
      prepared.afterRun(),
      /Native target exited 2147483651/,
    );
    await writeFile(
      prepared.logPath,
      "SORNG_NATIVE_FIRST_BREAKPOINT_V1\nSORNG_NATIVE_FATAL_V1\n" +
        normalExit(),
    );
    await assert.rejects(prepared.afterRun(), /Native process crashed/);
  }));

test("echoed filter text cannot fake a fatal record", async () =>
  fixture(async (options) => {
    const prepared = await prepareWindowsNativeCrashCapture(options);
    await writeFile(
      prepared.logPath,
      "0:000> .echo SORNG_NATIVE_FATAL_V1\r\n" + normalExit(),
    );
    await prepared.afterRun();
  }));

test("missing or unconfirmed main exit fails closed", async () =>
  fixture(async (options) => {
    const prepared = await prepareWindowsNativeCrashCapture(options);
    await assert.rejects(prepared.afterRun(), /report is missing/);
    await writeFile(
      prepared.logPath,
      "SORNG_NATIVE_MAIN_V1=abc\nLast event: def.456: Exit process 1:def, code 0\n",
    );
    await assert.rejects(prepared.afterRun(), /exit was not confirmed/);
  }));
