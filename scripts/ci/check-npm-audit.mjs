#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_ADVISORY = Object.freeze({
  source: 1124334,
  package: "brace-expansion",
  url: "https://github.com/advisories/GHSA-mh99-v99m-4gvg",
  severity: "high",
  range: "<=5.0.7",
  patchedRootVersion: "5.0.8",
});

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

const parseStrictVersion = (version) => {
  if (typeof version !== "string") return null;
  const match = version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number.parseInt(part, 10));
  return parts.every(Number.isSafeInteger) ? parts : null;
};

const isValidFixAvailable = (value) =>
  typeof value === "boolean" ||
  (isPlainObject(value) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.version === "string" &&
    value.version.length > 0 &&
    typeof value.isSemVerMajor === "boolean");

const nodePathMatchesPackage = (path, name) =>
  typeof path === "string" &&
  (path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));

const compareVersions = (left, right) => {
  const leftParts = parseStrictVersion(left);
  const rightParts = parseStrictVersion(right);
  if (!leftParts || !rightParts) {
    fail("A dependency version is not strict three-component SemVer.", {
      left,
      right,
    });
  }

  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
};

const auditVulnerabilities = (audit) => audit.vulnerabilities ?? {};

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
  }

  const enumerated = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };
  for (const vulnerability of Object.values(audit.vulnerabilities)) {
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

const assertProductionAuditClean = (audit) => {
  const vulnerabilities = auditVulnerabilities(audit);
  const blocking = Object.entries(vulnerabilities)
    .filter(([, vulnerability]) => highOrCritical(vulnerability.severity))
    .map(([name]) => name);
  const counts = audit.metadata?.vulnerabilities ?? {};

  if (
    blocking.length > 0 ||
    Number(counts.high ?? 0) > 0 ||
    Number(counts.critical ?? 0) > 0
  ) {
    fail("Production npm audit contains high or critical vulnerabilities.", {
      blocking,
      counts,
    });
  }
};

const assertAllowedRootAdvisory = (vulnerability, lock) => {
  if (!vulnerability) {
    fail(
      "The temporary brace-expansion advisory exception is no longer needed; remove it.",
    );
  }
  if (
    !Array.isArray(vulnerability.via) ||
    !Array.isArray(vulnerability.nodes) ||
    vulnerability.name !== ALLOWED_ADVISORY.package ||
    vulnerability.severity !== ALLOWED_ADVISORY.severity ||
    vulnerability.range !== ALLOWED_ADVISORY.range ||
    vulnerability.isDirect !== false ||
    vulnerability.fixAvailable !== false
  ) {
    fail("The brace-expansion advisory shape changed; review it manually.", {
      vulnerability,
    });
  }

  const advisoryObjects = vulnerability.via.filter(
    (entry) => typeof entry === "object" && entry !== null,
  );
  if (
    vulnerability.via.length !== 1 ||
    advisoryObjects.length !== 1 ||
    advisoryObjects[0].source !== ALLOWED_ADVISORY.source ||
    advisoryObjects[0].name !== ALLOWED_ADVISORY.package ||
    advisoryObjects[0].dependency !== ALLOWED_ADVISORY.package ||
    advisoryObjects[0].url !== ALLOWED_ADVISORY.url ||
    advisoryObjects[0].severity !== ALLOWED_ADVISORY.severity ||
    advisoryObjects[0].range !== ALLOWED_ADVISORY.range
  ) {
    fail("The allowed brace-expansion advisory identity changed.", {
      via: vulnerability.via,
    });
  }

  const packages = lock.packages ?? {};
  const patchedRoot = packages["node_modules/brace-expansion"];
  if (patchedRoot?.version !== ALLOWED_ADVISORY.patchedRootVersion) {
    fail("The compatible root brace-expansion path must remain patched.", {
      actual: patchedRoot?.version,
      expected: ALLOWED_ADVISORY.patchedRootVersion,
    });
  }
  if (vulnerability.nodes.includes("node_modules/brace-expansion")) {
    fail("The patched root brace-expansion path cannot use the exception.");
  }
  if (vulnerability.nodes.length === 0) {
    fail("The allowed advisory did not identify any vulnerable nested nodes.");
  }

  for (const path of vulnerability.nodes) {
    if (!nodePathMatchesPackage(path, ALLOWED_ADVISORY.package)) {
      fail(
        "A brace-expansion advisory node path does not match its reported package name.",
        { path },
      );
    }
    const dependency = packages[path];
    if (!dependency) {
      fail("An allowed advisory node is missing from package-lock.json.", {
        path,
      });
    }
    if (dependency.dev !== true) {
      fail("The brace-expansion exception is restricted to dev-only nodes.", {
        path,
        dev: dependency.dev,
      });
    }
    if (
      !parseStrictVersion(dependency.version) ||
      compareVersions(dependency.version, "5.0.7") > 0
    ) {
      fail(
        "The exception included a malformed, prerelease, or non-vulnerable package node.",
        {
          path,
          version: dependency.version,
        },
      );
    }
  }
};

const hasSimplePathToAllowedRoot = (
  name,
  vulnerabilities,
  visiting = new Set(),
) => {
  if (name === ALLOWED_ADVISORY.package) return true;
  // npm can report real strongly connected components among affected WDIO
  // packages. A recurrence is never accepted as proof; another simple branch
  // must still reach the exact validated brace-expansion root.
  if (visiting.has(name)) return false;

  const vulnerability = vulnerabilities[name];
  if (!vulnerability || !Array.isArray(vulnerability.via)) return false;

  const nextVisiting = new Set(visiting);
  nextVisiting.add(name);
  return vulnerability.via.some(
    (entry) =>
      typeof entry === "string" &&
      hasSimplePathToAllowedRoot(entry, vulnerabilities, nextVisiting),
  );
};

const assertViaGraphShape = (blockingEntries, vulnerabilities) => {
  for (const [name, vulnerability] of blockingEntries) {
    if (!Array.isArray(vulnerability.via) || vulnerability.via.length === 0) {
      fail("An allowed-chain package has no vulnerability path.", { name });
    }
    if (name === ALLOWED_ADVISORY.package) continue;

    for (const entry of vulnerability.via) {
      if (typeof entry !== "string") {
        fail(
          "Only the exact brace-expansion root may contain an advisory object.",
          { name, entry },
        );
      }
      if (
        !Object.hasOwn(vulnerabilities, entry) ||
        !highOrCritical(vulnerabilities[entry]?.severity)
      ) {
        fail("An allowed-chain package has a dangling vulnerability edge.", {
          name,
          edge: entry,
        });
      }
    }
  }
};

const assertDevOnlyAffectedPackages = (blockingEntries, manifest, lock) => {
  const packages = lock.packages ?? {};

  for (const [name, vulnerability] of blockingEntries) {
    if (vulnerability.severity !== "high") {
      fail("The temporary policy cannot allow critical vulnerabilities.", {
        name,
        severity: vulnerability.severity,
      });
    }

    if (
      !Array.isArray(vulnerability.nodes) ||
      vulnerability.nodes.length === 0
    ) {
      fail("Every allowed-chain package must identify lockfile nodes.", {
        name,
      });
    }

    for (const path of vulnerability.nodes) {
      if (!nodePathMatchesPackage(path, name)) {
        fail(
          "An affected package node path does not match its reported package name.",
          { name, path },
        );
      }
      if (!isPlainObject(packages[path]) || packages[path].dev !== true) {
        fail("An affected package is not dev-only in package-lock.json.", {
          name,
          path,
          dev: packages[path]?.dev,
        });
      }
    }

    if (Object.hasOwn(manifest.dependencies, name)) {
      fail("A production dependency cannot use the temporary exception.", {
        name,
      });
    }
    if (vulnerability.isDirect) {
      if (!Object.hasOwn(manifest.devDependencies, name)) {
        fail("A direct affected package is not declared as a dev dependency.", {
          name,
        });
      }
    }
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
  assertProductionAuditClean(productionAudit);

  const vulnerabilities = auditVulnerabilities(fullAudit);
  const blockingEntries = Object.entries(vulnerabilities).filter(
    ([, vulnerability]) => highOrCritical(vulnerability.severity),
  );
  assertAllowedRootAdvisory(vulnerabilities[ALLOWED_ADVISORY.package], lock);
  assertViaGraphShape(blockingEntries, vulnerabilities);

  const unexpected = blockingEntries
    .filter(([name]) => !hasSimplePathToAllowedRoot(name, vulnerabilities))
    .map(([name]) => name);
  if (unexpected.length > 0) {
    fail("Full npm audit contains an unapproved high or critical advisory.", {
      unexpected,
    });
  }

  assertDevOnlyAffectedPackages(blockingEntries, manifest, lock);

  return {
    ok: true,
    policy: "temporary-upstream-blocked-dev-only-exception",
    allowedAdvisory: ALLOWED_ADVISORY.url,
    allowedPackage: ALLOWED_ADVISORY.package,
    affectedPackages: blockingEntries.map(([name]) => name).sort(),
    vulnerableNestedNodes: vulnerabilities[ALLOWED_ADVISORY.package].nodes
      .slice()
      .sort(),
    productionHighOrCritical: 0,
    action:
      "Remove this exception as soon as npm reports a fix or upstream consumers accept the patched major.",
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
