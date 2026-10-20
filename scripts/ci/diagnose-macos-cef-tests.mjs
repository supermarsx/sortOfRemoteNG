#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  throw new Error("CEF crash diagnostics require the macOS test runner");
}
const artifacts = readFileSync(process.argv[2], "utf8")
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const executable = artifacts.find(
  (entry) =>
    entry.reason === "compiler-artifact" &&
    entry.target?.name === "sorng_browser_host" &&
    entry.profile?.test === true &&
    entry.executable,
)?.executable;
if (!executable)
  throw new Error("CEF test executable was not reported by Cargo");

// Preserve the original failed gate. These bounded reruns only collect the
// failing test name and native stacks; neither can turn the job green.
for (const mode of ["serial", "parallel"]) {
  const result = spawnSync(
    "lldb",
    [
      "--batch",
      "--no-lldbinit",
      "-o",
      "settings set target.disable-aslr false",
      "-o",
      "run",
      "--one-line-on-crash",
      "thread backtrace all",
      "--",
      executable,
      ...(mode === "serial" ? ["--test-threads=1"] : []),
      "--nocapture",
    ],
    { encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const report = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\nLLDB exit: ${result.status}; signal: ${result.signal}\n`;
  writeFileSync(`.artifacts/macos-cef-${mode}-lldb.log`, report);
  process.stdout.write(report);
}
