import { availableParallelism, freemem, totalmem } from "node:os";

export const GIB = 1024 ** 3;
export const DEV_BUILD_BUDGET_BYTES = 40 * GIB;
export const DEV_BUILD_SHARED_BYTES = 8 * GIB;
export const DEV_BUILD_JOB_BYTES = GIB;

/** Launch-time observations only; no process monitoring or machine-wide changes. */
export function readDevBuildResources() {
  return {
    parallelism: availableParallelism(),
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
  };
}

function argumentOverrides(argv) {
  // Tauri: arguments after the first -- belong to Cargo; after the second --
  // they belong to the app and must not affect build policy.
  const separator = argv.indexOf("--");
  const appSeparator = separator < 0 ? -1 : argv.indexOf("--", separator + 1);
  const buildArgs = appSeparator < 0 ? argv : argv.slice(0, appSeparator);
  const cargoArgs = separator < 0 ? [] : buildArgs.slice(separator + 1);
  if (
    buildArgs.some(
      (arg) =>
        arg === "--jobs" ||
        arg.startsWith("--jobs=") ||
        /^-j.+$/.test(arg) ||
        arg === "-j",
    )
  )
    return "arguments";
  if (
    cargoArgs.some((arg) => arg === "--config" || arg.startsWith("--config="))
  )
    return "cargo-config";
  if (
    buildArgs.some(
      (arg) =>
        arg === "--release" ||
        arg === "--profile" ||
        arg.startsWith("--profile="),
    )
  )
    return "profile";
  if (
    buildArgs.some(
      (arg) =>
        arg === "--runner" ||
        arg === "-r" ||
        /^-r.+$/.test(arg) ||
        arg.startsWith("--runner="),
    )
  )
    return "runner";
  return null;
}

/** Advisory sizing, not an RSS limit: rustc/linker/native helper peaks vary. */
export function planDevBuildResources({
  argv = [],
  baseEnv = process.env,
  resources = readDevBuildResources(),
} = {}) {
  const parallelism =
    Number.isSafeInteger(resources.parallelism) && resources.parallelism > 0
      ? resources.parallelism
      : 1;
  const validMemory =
    Number.isFinite(resources.totalMemoryBytes) &&
    resources.totalMemoryBytes > 0 &&
    Number.isFinite(resources.freeMemoryBytes) &&
    resources.freeMemoryBytes >= 0;
  const totalMemoryBytes = validMemory ? resources.totalMemoryBytes : 0;
  const freeMemoryBytes = validMemory
    ? Math.min(resources.freeMemoryBytes, totalMemoryBytes)
    : 0;
  const systemReserveBytes = Math.ceil((totalMemoryBytes * 7) / 100);
  const budgetBytes = Math.min(
    DEV_BUILD_BUDGET_BYTES,
    Math.max(0, freeMemoryBytes - systemReserveBytes),
  );
  const jobs = Math.max(
    1,
    Math.min(
      parallelism,
      Math.floor((budgetBytes - DEV_BUILD_SHARED_BYTES) / DEV_BUILD_JOB_BYTES),
    ),
  );
  const source =
    argumentOverrides(argv) ??
    (baseEnv.CARGO_BUILD_JOBS !== undefined ? "environment" : "automatic");
  return {
    source,
    jobs,
    parallelism,
    totalMemoryBytes,
    freeMemoryBytes,
    systemReserveBytes,
    budgetBytes,
    estimatedBuildBytes: DEV_BUILD_SHARED_BYTES + jobs * DEV_BUILD_JOB_BYTES,
    insufficientHeadroom:
      budgetBytes < DEV_BUILD_SHARED_BYTES + DEV_BUILD_JOB_BYTES,
    environment:
      source === "automatic" ? { CARGO_BUILD_JOBS: String(jobs) } : {},
  };
}

export function describeDevBuildResources(plan) {
  const recommendation = `${plan.jobs} Cargo jobs, ${plan.parallelism} process-visible CPUs`;
  const choice =
    plan.source === "automatic"
      ? `Development build sizing: ${recommendation}`
      : `Development build override (${plan.source}) preserved; automatic recommendation would be ${recommendation}`;
  return `${choice}. Advisory allowance ${(plan.budgetBytes / GIB).toFixed(1)} GiB = min(40 GiB, free RAM minus 7% of total RAM); 8 GiB shared reserve + 1 GiB/job estimate. ${
    plan.insufficientHeadroom
      ? "Insufficient observed headroom even for the one-job estimate; the budget and 7% free-RAM reserve cannot be assured. "
      : ""
  }Launch-time estimate only, not a hard RAM cap or live controller; running builds/apps are not changed.`;
}
