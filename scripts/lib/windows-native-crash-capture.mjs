import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const CRASH_MARKER = "SORNG_NATIVE_FATAL_V1";
const MAIN_MARKER = "SORNG_NATIVE_MAIN_V1=";
const MAX_LOG_BYTES = 32 * 1024 * 1024;

function setting(env, key) {
  return Object.entries(env).find(
    ([name]) => name.toLowerCase() === key.toLowerCase(),
  )?.[1];
}

function safePath(value, name) {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    /[";\r\n\0]/u.test(value)
  ) {
    throw new Error(
      `Native crash capture requires a valid absolute ${name} path`,
    );
  }
  return value;
}

async function debuggerPath(env) {
  const candidates = [];
  for (const key of ["ProgramFiles(x86)", "ProgramFiles"]) {
    const base = setting(env, key);
    if (base) {
      for (const arch of [
        process.arch === "arm64"
          ? "arm64"
          : process.arch === "ia32"
            ? "x86"
            : "x64",
      ]) {
        candidates.push(
          path.join(base, "Windows Kits", "10", "Debuggers", arch, "cdb.exe"),
        );
      }
    }
  }
  for (const directory of (setting(env, "PATH") ?? "")
    .split(";")
    .slice(0, 128)) {
    if (
      directory &&
      path.isAbsolute(directory) &&
      !/["\r\n\0]/u.test(directory)
    ) {
      candidates.push(path.join(directory, "cdb.exe"));
    }
  }
  for (const candidate of candidates) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
      const file = await open(candidate, "r");
      try {
        const header = Buffer.alloc(4096);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        const pe = bytesRead >= 64 ? header.readUInt32LE(60) : 0;
        const machine =
          process.arch === "arm64"
            ? 0xaa64
            : process.arch === "ia32"
              ? 0x14c
              : 0x8664;
        if (
          header.toString("ascii", 0, 2) === "MZ" &&
          pe >= 64 &&
          pe + 6 <= bytesRead &&
          header.readUInt32LE(pe) === 0x4550 &&
          header.readUInt16LE(pe + 4) === machine
        )
          return candidate;
      } finally {
        await file.close();
      }
    } catch {
      /* Try only the next local candidate. Never download a debugger. */
    }
  }
  throw new Error(
    "Native crash capture is enabled, but local CDB was not found. Install Windows Debugging Tools or add its directory to PATH.",
  );
}

/** Opt-in development diagnostic only. All reports remain in outputRoot. */
export async function prepareWindowsNativeCrashCapture({
  executable,
  args = [],
  env = process.env,
  cwd,
  outputRoot,
  platform = process.platform,
}) {
  if (env.SORNG_NATIVE_CRASH_CAPTURE !== "1") return null;
  if (platform !== "win32")
    throw new Error("SORNG_NATIVE_CRASH_CAPTURE is supported only on Windows");
  safePath(executable, "executable");
  safePath(cwd, "working directory");
  safePath(outputRoot, "output root");
  if (
    !Array.isArray(args) ||
    args.some((value) => typeof value !== "string" || value.includes("\0"))
  ) {
    throw new Error(
      "Native crash capture target arguments must be strings without NUL",
    );
  }
  await access(executable);
  const command = await debuggerPath(env);
  await mkdir(outputRoot, { recursive: true });
  const directory = await mkdtemp(path.join(outputRoot, "native-crash-"));
  const logPath = path.join(directory, "debugger.log");
  const dumpPath = path.join(directory, "exception.dmp");
  const handlerPath = path.join(directory, "fatal.txt");
  const firstOverflowPath = path.join(directory, "first-overflow.txt");
  const firstOverflowDump = path.join(directory, "first-stack-overflow.dmp");
  const firstBreakpointPath = path.join(directory, "first-breakpoint.txt");
  const firstBreakpointDump = path.join(directory, "first-breakpoint.dmp");
  const commandPath = path.join(directory, "commands.txt");
  // Keep nested command quoting out of the exception action: CDB reads a
  // separate script, and that script quotes the local minidump destination.
  // Execute lines separately: condensed scripts can lose the command after
  // a quoted dump path. Plain k also avoids a stray b on thread iteration.
  const escapedHandler = handlerPath.replaceAll("\\", "/");
  const escapedFirstOverflow = firstOverflowPath.replaceAll("\\", "/");
  const escapedFirstBreakpoint = firstBreakpointPath.replaceAll("\\", "/");
  await writeFile(
    handlerPath,
    `.echo ${CRASH_MARKER}\n.exr -1\n.ecxr\n~*k\n.dump /m "${dumpPath}"\nq\n`,
  );
  // Save only the first observed overflow before Chromium's own exception
  // handler can consume it. Passing it through preserves target behavior;
  // recovery with main exit zero is not labelled a fatal crash.
  await writeFile(
    firstOverflowPath,
    `.echo SORNG_NATIVE_FIRST_STACK_OVERFLOW_V1\n.exr -1\n.ecxr\n~*k\n.dump /m "${firstOverflowDump}"\nsxd -c "" -c2 "$<${escapedHandler}" sov\ngn\n`,
  );
  // Numeric exception filters and gn preserve the application's own handler.
  // STATUS_BREAKPOINT is distinct from the ignored debugger initial breakpoint.
  // https://learn.microsoft.com/windows-hardware/drivers/debugger/controlling-exceptions-and-events
  // Capture once before Chromium can consume a fatal CHECK; recovered breaks
  // remain evidence only and do not turn a successful target exit into failure.
  await writeFile(
    firstBreakpointPath,
    `.echo SORNG_NATIVE_FIRST_BREAKPOINT_V1\n.exr -1\n.ecxr\n~*k\n.dump /m "${firstBreakpointDump}"\nsxd -c "" -c2 "$<${escapedHandler}" 0x80000003\ngn\n`,
  );
  await writeFile(
    commandPath,
    `r @$t0 = @$tpid\n.printf "${MAIN_MARKER}%x\\n", @$tpid\nsxi ibp\nsxd -c2 "$<${escapedHandler}" av\nsxe -c "$<${escapedFirstOverflow}" -c2 "$<${escapedHandler}" sov\nsxe -c "$<${escapedFirstBreakpoint}" -c2 "$<${escapedHandler}" 0x80000003\nsxe -c ".lastevent; .if (@$tpid == @$t0) {q} .else {g}" epr\ng\n`,
  );
  return {
    command,
    args: [
      "-o",
      "-G",
      "-sins",
      "-netsyms:no",
      "-y",
      cwd,
      "-cf",
      commandPath,
      "-logo",
      logPath,
      executable,
      ...args,
    ],
    env: { ...env },
    cwd,
    directory,
    logPath,
    async afterRun() {
      let text;
      try {
        if ((await stat(logPath)).size > MAX_LOG_BYTES)
          throw new Error("oversized");
        text = await readFile(logPath, "utf8");
      } catch {
        throw new Error(
          `Native debugger report is missing or exceeds its read limit. Review local files in ${directory}`,
        );
      }
      const fatal = new RegExp(`^${CRASH_MARKER}\\r?$`, "m").test(text);
      const dumped = await stat(dumpPath)
        .then((entry) => entry.isFile())
        .catch(() => false);
      if (fatal || dumped)
        throw new Error(
          `Native process crashed. Local exception stack and minidump: ${directory}`,
        );
      const main = new RegExp(`^${MAIN_MARKER}([0-9a-f]+)\\r?$`, "im")
        .exec(text)?.[1]
        ?.toLowerCase();
      const exits = [
        ...text.matchAll(
          /^Last event: ([0-9a-f]+)\.[0-9a-f]+: Exit process \d+:([0-9a-f]+), code (?:0x)?([0-9a-f]+)\r?$/gim,
        ),
      ];
      const exit = exits.findLast(
        (match) =>
          match[1].toLowerCase() === main && match[2].toLowerCase() === main,
      );
      if (!main || !exit)
        throw new Error(
          `Native target exit was not confirmed. Review local debugger report: ${directory}`,
        );
      const code = Number.parseInt(exit[3], 16);
      if (code !== 0)
        throw new Error(
          `Native target exited ${code}. Local debugger report: ${directory}`,
        );
    },
  };
}
