import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { evaluateNpmAuditPolicy } from "../../scripts/ci/check-npm-audit.mjs";

const fixtureDirectory = join(process.cwd(), "tests", "tooling", "fixtures");

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(fixtureDirectory, name), "utf8")) as T;

const cleanReport = () =>
  fixture<Record<string, any>>("npm-audit-production-clean.json");

const cleanInputs = () => ({
  productionAudit: cleanReport(),
  fullAudit: cleanReport(),
  manifest: fixture<Record<string, any>>("npm-audit-manifest.json"),
  lock: fixture<Record<string, any>>("npm-audit-package-lock.json"),
});

const addVulnerability = (
  report: Record<string, any>,
  name: string,
  severity: "moderate" | "high" | "critical",
) => {
  report.vulnerabilities[name] = {
    name,
    severity,
    isDirect: false,
    via: [],
    effects: [],
    range: "<1.0.1",
    nodes: [`node_modules/${name}`],
    fixAvailable: false,
  };
  report.metadata.vulnerabilities[severity] += 1;
  report.metadata.vulnerabilities.total += 1;
};

describe("strict npm audit policy", () => {
  it("accepts only reports with no high or critical vulnerabilities", () => {
    const result = evaluateNpmAuditPolicy(cleanInputs());

    expect(result).toEqual({
      ok: true,
      policy: "strict-high-critical",
      productionHighOrCritical: 0,
      fullHighOrCritical: 0,
    });
  });

  it("continues to permit non-blocking severities", () => {
    const inputs = cleanInputs();
    addVulnerability(inputs.fullAudit, "moderate-package", "moderate");

    expect(evaluateNpmAuditPolicy(inputs).ok).toBe(true);
  });

  it.each(["high", "critical"] as const)(
    "rejects %s production vulnerabilities",
    (severity) => {
      const inputs = cleanInputs();
      addVulnerability(inputs.productionAudit, "production-package", severity);

      expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
        "Production npm audit contains high or critical vulnerabilities.",
      );
    },
  );

  it.each(["high", "critical"] as const)(
    "rejects %s dev-only vulnerabilities from the full graph",
    (severity) => {
      const inputs = cleanInputs();
      addVulnerability(inputs.fullAudit, "dev-package", severity);

      expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
        "Full npm audit contains high or critical vulnerabilities.",
      );
    },
  );

  it.each([registerInvalidReport(), [], null])(
    "rejects a structurally invalid report %#",
    (report) => {
      const production = cleanInputs();
      production.productionAudit = report as unknown as Record<string, any>;
      expect(() => evaluateNpmAuditPolicy(production)).toThrow(/audit report/u);

      const full = cleanInputs();
      full.fullAudit = report as unknown as Record<string, any>;
      expect(() => evaluateNpmAuditPolicy(full)).toThrow(/audit report/u);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, undefined])(
    "rejects invalid severity count %s",
    (count) => {
      const inputs = cleanInputs();
      inputs.fullAudit.metadata.vulnerabilities.high = count;

      expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
        /invalid severity count/u,
      );
    },
  );

  it("requires metadata counts to match vulnerability entries", () => {
    const inputs = cleanInputs();
    inputs.fullAudit.metadata.vulnerabilities.high = 1;
    inputs.fullAudit.metadata.vulnerabilities.total = 1;

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(/does not match/u);
  });

  it.each(["dependencies", "devDependencies"])(
    "requires package.json %s to be an object",
    (field) => {
      const inputs = cleanInputs();
      inputs.manifest[field] = [];

      expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
        /dependency maps are malformed/u,
      );
    },
  );

  it("requires a package-lock packages map", () => {
    const inputs = cleanInputs();
    inputs.lock.packages = [];

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
      /package-lock.json has a malformed packages object/u,
    );
  });

  it.each(["HIGH", null, "unknown"])(
    "rejects invalid vulnerability severity %s",
    (severity) => {
      const inputs = cleanInputs();
      addVulnerability(inputs.fullAudit, "invalid-package", "high");
      inputs.fullAudit.vulnerabilities["invalid-package"].severity = severity;

      expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
        /invalid vulnerability severity/u,
      );
    },
  );

  it.each([
    ["name", "different-name"],
    ["isDirect", undefined],
    ["isDirect", "yes"],
    ["nodes", "node_modules/package"],
    ["via", "dependency"],
    ["range", undefined],
    ["range", ""],
    ["fixAvailable", undefined],
    ["fixAvailable", []],
    ["fixAvailable", {}],
    [
      "fixAvailable",
      { name: "package", version: "2.0.0", isSemVerMajor: "yes" },
    ],
  ])("rejects malformed blocking field %s=%j", (field, value) => {
    const inputs = cleanInputs();
    addVulnerability(inputs.fullAudit, "package", "high");
    inputs.fullAudit.vulnerabilities.package[field] = value;

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
      /malformed blocking entry/u,
    );
  });
});

function registerInvalidReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: [],
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 0,
      },
    },
  };
}
