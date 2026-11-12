// Read-only accounting. Neither a carrier nor a matching projection grants
// source, compiler, SDK, publication, or native qualification authority.
export const WORKFLOW_CLOCK_ENV = "SORNG_FULLSDK_FIRST_CLOCK";
export const WORKFLOW_WHOLE_MS = 21600000;
const RESERVE_MS = 150000;
const WORKFLOW =
  "supermarsx/sortOfRemoteNG/.github/workflows/windows-arm-full-sdk.yml@refs/heads/main";
const FIELDS = [
  "schemaVersion",
  "kind",
  "clock",
  "dotnetMajor",
  "wallStartMs",
  "tickStartMs",
  "wallEndMs",
  "tickEndMs",
  "repository",
  "repositoryId",
  "ref",
  "event",
  "runId",
  "attempt",
  "head",
  "workflowSha",
  "workflowRef",
  "job",
  "image",
];
function need(value, code) {
  if (!value) throw new Error("FULL_SDK_WORKFLOW_CLOCK_" + code);
}
function integer(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
export function readWorkflowClock(raw, env, wallNow) {
  need(
    typeof raw === "string" &&
      raw.length > 0 &&
      raw.length <= 4096 &&
      /^[\x20-\x7e]+$/.test(raw),
    "RAW",
  );
  const value = JSON.parse(raw);
  need(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).sort().join() === [...FIELDS].sort().join(),
    "FIELDS",
  );
  need(
    value.schemaVersion === 1 &&
      value.kind === "windows-arm-first-workflow-clock" &&
      value.clock === "windows-gettickcount64" &&
      [8, 9, 10].includes(value.dotnetMajor),
    "KIND",
  );
  for (const field of ["wallStartMs", "tickStartMs", "wallEndMs", "tickEndMs"])
    need(integer(value[field]), "INTEGER");
  need(
    value.wallEndMs - value.wallStartMs === WORKFLOW_WHOLE_MS &&
      value.tickEndMs - value.tickStartMs === WORKFLOW_WHOLE_MS &&
      integer(wallNow) &&
      value.wallStartMs <= wallNow &&
      value.wallEndMs - wallNow > RESERVE_MS,
    "WALL_DEADLINE",
  );
  const fixed = {
    repository: "supermarsx/sortOfRemoteNG",
    repositoryId: "1010282954",
    ref: "refs/heads/main",
    event: "workflow_dispatch",
    workflowRef: WORKFLOW,
    job: "sdk",
  };
  const keys = {
    repository: "GITHUB_REPOSITORY",
    repositoryId: "GITHUB_REPOSITORY_ID",
    ref: "GITHUB_REF",
    event: "GITHUB_EVENT_NAME",
    workflowRef: "GITHUB_WORKFLOW_REF",
    job: "GITHUB_JOB",
    runId: "GITHUB_RUN_ID",
    attempt: "GITHUB_RUN_ATTEMPT",
    head: "GITHUB_SHA",
    workflowSha: "GITHUB_WORKFLOW_SHA",
    image: "ImageVersion",
  };
  need(
    Object.entries(fixed).every(([key, expected]) => value[key] === expected),
    "SCOPE",
  );
  need(
    Object.entries(keys).every(([key, name]) => value[key] === env[name]),
    "EXECUTION",
  );
  need(
    env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public" &&
      env.CEF_DEFAULT_BRANCH === "main" &&
      ["20261021.278.1", "20261103.298.1"].includes(value.image) &&
      /^[1-9][0-9]*$/.test(value.runId) &&
      /^[1-9][0-9]*$/.test(value.attempt) &&
      /^[a-f0-9]{40}$/.test(value.head) &&
      value.workflowSha === value.head,
    "HOST",
  );
  return Object.freeze(value);
}
export function intersectWorkflowClock(
  carrier,
  monotonicSeconds,
  probeMonoStart,
  lease,
  wallNow,
  monoNow,
) {
  // CPython3.12.10 time.monotonic() uses GetTickCount64. Convert its
  // millisecond-granularity double conservatively; no QPC/Stopwatch mixing.
  const tick = Math.round(monotonicSeconds * 1000);
  need(
    Number.isFinite(monotonicSeconds) &&
      integer(tick) &&
      Math.abs(monotonicSeconds * 1000 - tick) < 0.001 &&
      tick >= carrier.tickStartMs &&
      carrier.tickEndMs - tick > RESERVE_MS,
    "TICK_DEADLINE",
  );
  need(
    Number.isFinite(probeMonoStart) &&
      probeMonoStart >= 0 &&
      Number.isFinite(monoNow) &&
      probeMonoStart <= monoNow &&
      integer(wallNow) &&
      wallNow >= carrier.wallStartMs &&
      Number.isFinite(lease.wallEnd) &&
      Number.isFinite(lease.monoEnd),
    "PROJECTION",
  );
  const result = Object.freeze({
    wallEnd: Math.min(lease.wallEnd, carrier.wallEndMs),
    // The sample occurs AFTER this pre-launch Node instant. Using it as the
    // anchor subtracts probe latency rather than granting that latency again.
    monoEnd: Math.min(lease.monoEnd, probeMonoStart + carrier.tickEndMs - tick),
  });
  need(
    Math.min(result.wallEnd - wallNow, result.monoEnd - monoNow) > RESERVE_MS,
    "EXPIRED",
  );
  return result;
}

// The fixed workflow must use this exact body as its FIRST step, before
// checkout/setup. The final workflow itself is independently pinned by the
// origin policy; this string is not an execution or provenance grant.
export const FIRST_WORKFLOW_CLOCK_STEP = String.raw`$fullSdkTickStart = [Environment]::TickCount64
$fullSdkWallStart = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -cne 'Core' -or [Environment]::Version.Major -lt 8 -or [Environment]::Version.Major -gt 10) { throw 'FULL_SDK_FIRST_CLOCK_RUNTIME' }
if ($env:GITHUB_REPOSITORY -cne 'supermarsx/sortOfRemoteNG' -or $env:GITHUB_REPOSITORY_ID -cne '1010282954' -or $env:GITHUB_REF -cne 'refs/heads/main' -or $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or $env:GITHUB_WORKFLOW_REF -cne 'supermarsx/sortOfRemoteNG/.github/workflows/windows-arm-full-sdk.yml@refs/heads/main' -or $env:GITHUB_JOB -cne 'sdk' -or $env:GITHUB_SHA -cne $env:GITHUB_WORKFLOW_SHA) { throw 'FULL_SDK_FIRST_CLOCK_SCOPE' }
$fullSdkClock = [ordered]@{ schemaVersion=1; kind='windows-arm-first-workflow-clock'; clock='windows-gettickcount64'; dotnetMajor=[Environment]::Version.Major; wallStartMs=$fullSdkWallStart; tickStartMs=$fullSdkTickStart; wallEndMs=($fullSdkWallStart+21600000); tickEndMs=($fullSdkTickStart+21600000); repository=$env:GITHUB_REPOSITORY; repositoryId=$env:GITHUB_REPOSITORY_ID; ref=$env:GITHUB_REF; event=$env:GITHUB_EVENT_NAME; runId=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT; head=$env:GITHUB_SHA; workflowSha=$env:GITHUB_WORKFLOW_SHA; workflowRef=$env:GITHUB_WORKFLOW_REF; job=$env:GITHUB_JOB; image=$env:ImageVersion }
$fullSdkClockRaw = $fullSdkClock | ConvertTo-Json -Compress -Depth 3
if ($fullSdkClockRaw.Length -gt 4096 -or $fullSdkClockRaw -match '[^\x20-\x7e]') { throw 'FULL_SDK_FIRST_CLOCK_BOUND' }
[IO.File]::AppendAllText($env:GITHUB_ENV, 'SORNG_FULLSDK_FIRST_CLOCK='+$fullSdkClockRaw+[Environment]::NewLine, [Text.UTF8Encoding]::new($false))
`;
