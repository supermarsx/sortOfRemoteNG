#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_RELEASE_WORKFLOWS = Object.freeze([
  Object.freeze({ name: "Audit", path: ".github/workflows/audit.yml" }),
  Object.freeze({
    name: "Backend Coverage",
    path: ".github/workflows/coverage.yml",
  }),
  Object.freeze({
    name: "Frontend Build",
    path: ".github/workflows/frontend-build.yml",
  }),
  Object.freeze({
    name: "Docker e2e (nightly)",
    path: ".github/workflows/e2e.yml",
  }),
]);

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DEFAULT_TIMEOUT_SECONDS = 90 * 60;
const DEFAULT_POLL_SECONDS = 15;
const ACTIVE_WORKFLOW_STATUSES = new Set([
  "in_progress",
  "pending",
  "queued",
  "requested",
  "waiting",
]);

function normalizeSourceSha(sourceSha) {
  if (typeof sourceSha !== "string" || !COMMIT_SHA_PATTERN.test(sourceSha)) {
    throw new Error(
      `Invalid source SHA ${JSON.stringify(sourceSha)}; expected a full 40-character commit SHA`,
    );
  }
  return sourceSha.toLowerCase();
}

function uniqueWorkflowRequirements(requiredWorkflows) {
  if (!Array.isArray(requiredWorkflows) || requiredWorkflows.length === 0) {
    throw new Error("At least one required workflow is required.");
  }
  const requirements = requiredWorkflows.map((requirement) => {
    if (typeof requirement === "string") {
      const builtIn = REQUIRED_RELEASE_WORKFLOWS.find(
        (candidate) => candidate.name === requirement,
      );
      if (!builtIn) {
        throw new Error(
          `Required workflow ${JSON.stringify(requirement)} must include its exact path`,
        );
      }
      return builtIn;
    }
    if (!requirement || typeof requirement !== "object") {
      throw new Error(
        `Invalid required workflow ${JSON.stringify(requirement)}`,
      );
    }
    const { name, path: workflowPath } = requirement;
    if (typeof name !== "string" || name.trim() !== name || !name) {
      throw new Error(`Invalid required workflow name ${JSON.stringify(name)}`);
    }
    if (
      typeof workflowPath !== "string" ||
      !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(workflowPath)
    ) {
      throw new Error(
        `Invalid required workflow path ${JSON.stringify(workflowPath)} for ${name}`,
      );
    }
    return { name, path: workflowPath };
  });
  const names = requirements.map((requirement) => requirement.name);
  const paths = requirements.map((requirement) => requirement.path);
  if (new Set(names).size !== names.length) {
    throw new Error("Required workflow names must be unique.");
  }
  if (new Set(paths).size !== paths.length) {
    throw new Error("Required workflow paths must be unique.");
  }
  return requirements;
}

function runDescription(run) {
  const url = typeof run.html_url === "string" ? ` (${run.html_url})` : "";
  return `${run.name} run ${run.id ?? "unknown"}: ${run.status ?? "unknown"}/${run.conclusion ?? "pending"}${url}`;
}

function newestRun(runs) {
  return [...runs].sort((left, right) => {
    const idOrder = right.id - left.id;
    if (idOrder !== 0) return idOrder;
    return (right.run_attempt ?? 1) - (left.run_attempt ?? 1);
  })[0];
}

/**
 * Classify exact-source, push-triggered workflow runs bound to their expected
 * workflow file paths. A successful run is sufficient when it is the newest
 * completed invocation. Any active matching invocation keeps readiness
 * pending, including when an older run succeeded. With no active invocation,
 * the newest completed run decides success/failure.
 */
export function classifyWorkflowReadiness(
  runs,
  { sourceSha, requiredWorkflows = REQUIRED_RELEASE_WORKFLOWS },
) {
  if (!Array.isArray(runs))
    throw new TypeError("Workflow runs must be an array.");
  const normalizedSourceSha = normalizeSourceSha(sourceSha);
  const required = uniqueWorkflowRequirements(requiredWorkflows);
  const requiredNames = new Set(
    required.map((requirement) => requirement.name),
  );
  const matching = runs.filter((run) => {
    return (
      run &&
      requiredNames.has(run.name) &&
      typeof run.head_sha === "string" &&
      run.head_sha.toLowerCase() === normalizedSourceSha &&
      run.event === "push"
    );
  });

  const ready = [];
  const pending = [];
  const failed = [];

  for (const requirement of required) {
    const workflowName = requirement.name;
    const namedCandidates = matching.filter((run) => run.name === workflowName);
    const wrongPath = namedCandidates.find(
      (run) => run.path !== requirement.path,
    );
    if (wrongPath) {
      failed.push({
        name: workflowName,
        reason: `${workflowName} run ${wrongPath.id ?? "unknown"} came from ${JSON.stringify(wrongPath.path)}, expected ${requirement.path}`,
      });
      continue;
    }
    const candidates = namedCandidates;
    const malformed = candidates.find((run) => {
      return (
        !Number.isSafeInteger(run.id) ||
        (run.run_attempt !== undefined &&
          (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1)) ||
        typeof run.status !== "string" ||
        (!ACTIVE_WORKFLOW_STATUSES.has(run.status) &&
          run.status !== "completed") ||
        (run.status === "completed" && typeof run.conclusion !== "string") ||
        (run.status !== "completed" && run.conclusion !== null)
      );
    });
    if (malformed) {
      failed.push({
        name: workflowName,
        reason: `${workflowName}: malformed workflow-run state`,
      });
      continue;
    }

    const active = candidates.filter((run) => run.status !== "completed");
    if (active.length > 0) {
      const latestActive = newestRun(active);
      pending.push({
        name: workflowName,
        reason: runDescription(latestActive),
      });
      continue;
    }

    if (candidates.length === 0) {
      pending.push({
        name: workflowName,
        reason: `${workflowName}: no exact-SHA push run found`,
      });
      continue;
    }

    const latestCompleted = newestRun(candidates);
    if (latestCompleted.conclusion === "success") {
      ready.push({ name: workflowName, run: latestCompleted });
    } else {
      failed.push({
        name: workflowName,
        reason: runDescription(latestCompleted),
      });
    }
  }

  return {
    state:
      failed.length > 0 ? "failed" : pending.length > 0 ? "pending" : "ready",
    sourceSha: normalizedSourceSha,
    ready,
    pending,
    failed,
  };
}

function readinessDetails(classification) {
  if (classification.state === "failed") {
    return classification.failed.map((item) => item.reason).join(" | ");
  }
  if (classification.state === "pending") {
    return classification.pending.map((item) => item.reason).join(" | ");
  }
  return classification.ready
    .map((item) => runDescription(item.run))
    .join(" | ");
}

export async function waitForWorkflowReadiness({
  loadRuns,
  sourceSha,
  requiredWorkflows = REQUIRED_RELEASE_WORKFLOWS,
  timeoutMs,
  pollMs,
  now = () => Date.now(),
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  onPoll = () => {},
}) {
  if (typeof loadRuns !== "function")
    throw new TypeError("loadRuns is required.");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error("timeoutMs must be a non-negative finite number.");
  }
  if (!Number.isFinite(pollMs) || pollMs <= 0) {
    throw new Error("pollMs must be a positive finite number.");
  }

  const startedAt = now();
  let attempt = 0;
  while (true) {
    attempt += 1;
    const classification = classifyWorkflowReadiness(await loadRuns(), {
      sourceSha,
      requiredWorkflows,
    });
    onPoll({ attempt, classification });

    if (classification.state === "ready") return classification;
    if (classification.state === "failed") {
      throw new Error(
        `Required workflow failed for source ${classification.sourceSha}: ${readinessDetails(classification)}`,
      );
    }

    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) {
      throw new Error(
        `Timed out waiting for required workflows for source ${classification.sourceSha}: ${readinessDetails(classification)}`,
      );
    }
    await sleep(Math.min(pollMs, timeoutMs - elapsed));
  }
}

function parsePositiveInteger(value, name, { allowZero = false } = {}) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new Error(`${name} is outside the supported range.`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const options = {
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
    githubOutput: null,
    pollSeconds: DEFAULT_POLL_SECONDS,
    repo: null,
    requiredWorkflows: [],
    runsFile: null,
    sourceSha: null,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = (name) => {
      const value = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : argv[++index];
      if (!value) throw new Error(`${name} requires a value.`);
      return value;
    };

    if (arg === "--help") {
      options.help = true;
    } else if (arg === "--repo" || arg.startsWith("--repo=")) {
      options.repo = readValue("--repo");
    } else if (arg === "--source-sha" || arg.startsWith("--source-sha=")) {
      options.sourceSha = readValue("--source-sha");
    } else if (
      arg === "--github-output" ||
      arg.startsWith("--github-output=")
    ) {
      options.githubOutput = readValue("--github-output");
    } else if (
      arg === "--timeout-seconds" ||
      arg.startsWith("--timeout-seconds=")
    ) {
      options.timeoutSeconds = parsePositiveInteger(
        readValue("--timeout-seconds"),
        "--timeout-seconds",
        { allowZero: true },
      );
    } else if (arg === "--poll-seconds" || arg.startsWith("--poll-seconds=")) {
      options.pollSeconds = parsePositiveInteger(
        readValue("--poll-seconds"),
        "--poll-seconds",
      );
    } else if (
      arg === "--required-workflow" ||
      arg.startsWith("--required-workflow=")
    ) {
      const value = readValue("--required-workflow");
      const separator = value.indexOf("=");
      if (separator <= 0 || separator === value.length - 1) {
        throw new Error(
          "--required-workflow requires Name=.github/workflows/file.yml",
        );
      }
      options.requiredWorkflows.push({
        name: value.slice(0, separator),
        path: value.slice(separator + 1),
      });
    } else if (arg === "--runs-file" || arg.startsWith("--runs-file=")) {
      options.runsFile = readValue("--runs-file");
    } else if (arg === "--api-url" || arg.startsWith("--api-url=")) {
      options.apiUrl = readValue("--api-url");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.requiredWorkflows.length === 0) {
    options.requiredWorkflows = [...REQUIRED_RELEASE_WORKFLOWS];
  } else {
    uniqueWorkflowRequirements(options.requiredWorkflows);
  }
  return options;
}

function validateRepo(repo) {
  if (
    typeof repo !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)
  ) {
    throw new Error(
      `Invalid GitHub repository ${JSON.stringify(repo)}; expected owner/name`,
    );
  }
  return repo;
}

export async function fetchWorkflowRuns({
  apiUrl,
  repo,
  sourceSha,
  token,
  fetchImpl = fetch,
  requestTimeoutMs = 30_000,
}) {
  if (!token)
    throw new Error("GITHUB_TOKEN is required to query workflow runs.");
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("requestTimeoutMs must be a positive finite number.");
  }
  const repository = validateRepo(repo);
  const normalizedSourceSha = normalizeSourceSha(sourceSha);
  const allRuns = [];

  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(
      `${apiUrl.replace(/\/$/, "")}/repos/${repository}/actions/runs`,
    );
    url.searchParams.set("head_sha", normalizedSourceSha);
    url.searchParams.set("event", "push");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        `GitHub workflow-runs request failed with HTTP ${response.status}`,
      );
    }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.workflow_runs)) {
      throw new Error("GitHub workflow-runs response is malformed.");
    }
    allRuns.push(...payload.workflow_runs);
    if (payload.workflow_runs.length < 100) return allRuns;
  }

  throw new Error(
    "GitHub returned more than 1000 exact-SHA workflow runs; refusing ambiguous readiness state.",
  );
}

const USAGE = `Usage: node scripts/ci/wait-for-release-readiness.mjs --repo <owner/name> --source-sha <sha> [options]

Options:
  --github-output <path>       Append ready and source_sha outputs.
  --timeout-seconds <n>        Bounded wait (default: ${DEFAULT_TIMEOUT_SECONDS}).
  --poll-seconds <n>           Poll interval (default: ${DEFAULT_POLL_SECONDS}).
  --required-workflow <n=p>    Override exact Name=.github/workflows/file.yml; repeatable.
  --runs-file <path>           Classify one fixture/API payload without network.
  --api-url <url>              GitHub API base (default: GITHUB_API_URL).
  --help                       Show this help text.

GITHUB_TOKEN is read from the environment and never accepted as an argument.
`;

function runsFromFile(filePath) {
  const payload = JSON.parse(readFileSync(filePath, "utf8"));
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.workflow_runs)) return payload.workflow_runs;
  throw new Error("Runs fixture must be an array or contain workflow_runs.");
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
      return;
    }
    if (!options.repo) throw new Error("--repo is required.");
    if (!options.sourceSha) throw new Error("--source-sha is required.");

    const loadRuns = options.runsFile
      ? async () => runsFromFile(options.runsFile)
      : async () =>
          fetchWorkflowRuns({
            apiUrl: options.apiUrl,
            repo: options.repo,
            sourceSha: options.sourceSha,
            token: process.env.GITHUB_TOKEN,
          });

    const classification = await waitForWorkflowReadiness({
      loadRuns,
      sourceSha: options.sourceSha,
      requiredWorkflows: options.requiredWorkflows,
      timeoutMs: options.runsFile ? 0 : options.timeoutSeconds * 1000,
      pollMs: options.pollSeconds * 1000,
      onPoll: ({ attempt, classification: state }) => {
        console.log(
          `Readiness poll ${attempt}: ${state.state} - ${readinessDetails(state)}`,
        );
      },
    });

    const output = `ready=true\nsource_sha=${classification.sourceSha}`;
    if (options.githubOutput) {
      appendFileSync(options.githubOutput, `${output}\n`, "utf8");
    }
    console.log(output);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exitCode = 1;
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  await main();
}
