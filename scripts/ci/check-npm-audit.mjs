#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SEVERITY_COUNT_KEYS = Object.freeze([
  "info",
  "low",
  "moderate",
  "high",
  "critical",
  "total",
]);
const VALID_SEVERITIES = new Set([
  "info",
  "low",
  "moderate",
  "high",
  "critical",
]);

const fail = (message, details = {}) => {
  const error = new Error(message);
  error.details = details;
  throw error;
};

const highOrCritical = (severity) =>
  severity === "high" || severity === "critical";

const isPlainObject = (value) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

const isValidFixAvailable = (value) =>
  typeof value === "boolean" ||
  (isPlainObject(value) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.version === "string" &&
    value.version.length > 0 &&
    typeof value.isSemVerMajor === "boolean");

const assertAuditReportStructure = (audit, label) => {
  if (!isPlainObject(audit) || audit.auditReportVersion !== 2) {
    fail(`${label} npm audit report has an unsupported or missing version.`, {
      auditReportVersion: audit?.auditReportVersion,
    });
  }
  if (!isPlainObject(audit.vulnerabilities)) {
    fail(`${label} npm audit report has a malformed vulnerabilities object.`);
  }
  if (
    !isPlainObject(audit.metadata) ||
    !isPlainObject(audit.metadata.vulnerabilities)
  ) {
    fail(`${label} npm audit report has malformed vulnerability metadata.`);
  }

  const counts = audit.metadata.vulnerabilities;
  for (const key of SEVERITY_COUNT_KEYS) {
    if (
      !Number.isFinite(counts[key]) ||
      !Number.isInteger(counts[key]) ||
      counts[key] < 0
    ) {
      fail(`${label} npm audit report has an invalid severity count.`, {
        key,
        value: counts[key],
      });
    }
  }
  if (
    counts.total !==
    counts.info + counts.low + counts.moderate + counts.high + counts.critical
  ) {
    fail(`${label} npm audit severity totals are inconsistent.`, { counts });
  }

  const enumerated = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };
  for (const [name, vulnerability] of Object.entries(audit.vulnerabilities)) {
    if (!isPlainObject(vulnerability)) {
      fail(`${label} npm audit contains a malformed vulnerability entry.`, {
        name,
      });
    }
    if (!VALID_SEVERITIES.has(vulnerability.severity)) {
      fail(`${label} npm audit contains an invalid vulnerability severity.`, {
        name,
        severity: vulnerability.severity,
      });
    }
    if (
      highOrCritical(vulnerability.severity) &&
      (vulnerability.name !== name ||
        typeof vulnerability.isDirect !== "boolean" ||
        !Array.isArray(vulnerability.nodes) ||
        !Array.isArray(vulnerability.via) ||
        typeof vulnerability.range !== "string" ||
        vulnerability.range.length === 0 ||
        !Object.hasOwn(vulnerability, "fixAvailable") ||
        !isValidFixAvailable(vulnerability.fixAvailable))
    ) {
      fail(`${label} npm audit contains a malformed blocking entry.`, {
        name,
        vulnerability,
      });
    }
    enumerated[vulnerability.severity] += 1;
  }

  for (const severity of VALID_SEVERITIES) {
    if (counts[severity] !== enumerated[severity]) {
      fail(
        `${label} npm audit metadata does not match its vulnerability entries.`,
        {
          severity,
          metadata: counts[severity],
          enumerated: enumerated[severity],
        },
      );
    }
  }
};

const assertAuditClean = (audit, label) => {
  const blocking = Object.entries(audit.vulnerabilities)
    .filter(([, vulnerability]) => highOrCritical(vulnerability.severity))
    .map(([name]) => name)
    .sort();
  const counts = audit.metadata.vulnerabilities;

  if (blocking.length > 0 || counts.high > 0 || counts.critical > 0) {
    fail(`${label} npm audit contains high or critical vulnerabilities.`, {
      blocking,
      counts,
    });
  }
};

export const evaluateNpmAuditPolicy = ({
  productionAudit,
  fullAudit,
  manifest,
  lock,
}) => {
  assertAuditReportStructure(productionAudit, "Production");
  assertAuditReportStructure(fullAudit, "Full");
  if (!isPlainObject(manifest)) {
    fail("package.json is malformed.");
  }
  if (
    !isPlainObject(manifest.dependencies) ||
    !isPlainObject(manifest.devDependencies)
  ) {
    fail("package.json dependency maps are malformed.");
  }
  if (!isPlainObject(lock) || !isPlainObject(lock.packages)) {
    fail("package-lock.json has a malformed packages object.");
  }

  assertAuditClean(productionAudit, "Production");
  assertAuditClean(fullAudit, "Full");

  return {
    ok: true,
    policy: "strict-high-critical",
    productionHighOrCritical: 0,
    fullHighOrCritical: 0,
  };
};

const resolveNpmCli = () => {
  const configured = process.env.npm_execpath;
  if (configured && existsSync(configured)) return configured;

  const shell =
    process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
  const shellArguments =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npm root --global"]
      : ["-c", "npm root --global"];
  const rootResult = spawnSync(shell, shellArguments, {
    encoding: "utf8",
  });
  const npmCli = join(
    String(rootResult.stdout ?? "").trim(),
    "npm",
    "bin",
    "npm-cli.js",
  );
  if (rootResult.status !== 0 || !existsSync(npmCli)) {
    fail("Unable to locate npm-cli.js for the audit policy.", {
      status: rootResult.status,
      stderr: String(rootResult.stderr ?? "").trim(),
      npmCli,
    });
  }
  return npmCli;
};

const runNpmAudit = (arguments_, label) => {
  const result = spawnSync(
    process.execPath,
    [resolveNpmCli(), "audit", ...arguments_, "--json"],
    {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  let audit;
  try {
    audit = JSON.parse(String(result.stdout));
  } catch {
    fail("npm audit did not return valid JSON.", {
      status: result.status,
      stderr: String(result.stderr ?? "").trim(),
      stdout: String(result.stdout ?? "").slice(0, 2_000),
    });
  }
  assertAuditReportStructure(audit, label);
  if (result.status !== 0 && result.status !== 1) {
    fail("npm audit did not complete normally.", {
      status: result.status,
      stderr: String(result.stderr ?? "").trim(),
      error: result.error?.message,
    });
  }
  return audit;
};

const main = () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const productionAudit = runNpmAudit(
    ["--omit=dev", "--audit-level=high"],
    "Production",
  );
  const fullAudit = runNpmAudit(["--audit-level=high"], "Full");

  const result = evaluateNpmAuditPolicy({
    productionAudit,
    fullAudit,
    manifest,
    lock,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          details: error?.details ?? {},
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}
