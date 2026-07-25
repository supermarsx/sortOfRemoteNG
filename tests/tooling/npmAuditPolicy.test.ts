import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { evaluateNpmAuditPolicy } from "../../scripts/ci/check-npm-audit.mjs";

const fixtureDirectory = join(process.cwd(), "tests", "tooling", "fixtures");

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(fixtureDirectory, name), "utf8")) as T;

const allowedInputs = () => ({
  productionAudit: fixture<Record<string, any>>(
    "npm-audit-production-clean.json",
  ),
  fullAudit: fixture<Record<string, any>>("npm-audit-full-allowed.json"),
  manifest: fixture<Record<string, any>>("npm-audit-manifest.json"),
  lock: fixture<Record<string, any>>("npm-audit-package-lock.json"),
});

const addAffectedPackage = (
  inputs: ReturnType<typeof allowedInputs>,
  name: string,
  via: unknown[],
) => {
  const path = `node_modules/${name}`;
  inputs.fullAudit.vulnerabilities[name] = {
    name,
    severity: "high",
    isDirect: false,
    via,
    effects: [],
    range: "*",
    nodes: [path],
    fixAvailable: false,
  };
  inputs.fullAudit.metadata.vulnerabilities.high += 1;
  inputs.fullAudit.metadata.vulnerabilities.total += 1;
  inputs.lock.packages[path] = { version: "1.0.0", dev: true };
};

const addProductionBlockingPackage = (
  inputs: ReturnType<typeof allowedInputs>,
) => {
  inputs.productionAudit.vulnerabilities.production = {
    name: "production",
    severity: "high",
    isDirect: true,
    via: [],
    effects: [],
    range: "*",
    nodes: ["node_modules/production"],
    fixAvailable: false,
  };
  inputs.productionAudit.metadata.vulnerabilities.high = 1;
  inputs.productionAudit.metadata.vulnerabilities.total = 1;
};

describe("temporary npm audit policy", () => {
  it("allows only the exact upstream-blocked dev advisory chain", () => {
    const result = evaluateNpmAuditPolicy(allowedInputs());

    expect(result.ok).toBe(true);
    expect(result.allowedAdvisory).toBe(
      "https://github.com/advisories/GHSA-mh99-v99m-4gvg",
    );
    expect(result.affectedPackages).toEqual([
      "brace-expansion",
      "eslint-config-next",
      "minimatch",
      "webdriverio",
    ]);
    expect(result.vulnerableNestedNodes).not.toContain(
      "node_modules/brace-expansion",
    );
  });

  it.each([
    ["missing report", {}],
    [
      "array vulnerabilities",
      {
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
      },
    ],
    [
      "missing metadata",
      {
        auditReportVersion: 2,
        vulnerabilities: {},
      },
    ],
  ])("rejects a structurally invalid %s", (_label, report) => {
    const production = allowedInputs();
    production.productionAudit = report;
    expect(() => evaluateNpmAuditPolicy(production)).toThrow(/audit report/u);

    const full = allowedInputs();
    full.fullAudit = report;
    expect(() => evaluateNpmAuditPolicy(full)).toThrow(/audit report/u);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, undefined])(
    "rejects an invalid severity count %s",
    (count) => {
      const inputs = allowedInputs();
      inputs.fullAudit.metadata.vulnerabilities.high = count;

      expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
        /invalid severity count/u,
      );
    },
  );

  it.each(["info", "low", "moderate", "high", "critical"])(
    "requires %s metadata to match enumerated vulnerability entries",
    (severity) => {
      const inputs = allowedInputs();
      inputs.productionAudit.metadata.vulnerabilities[severity] = 1;
      inputs.productionAudit.metadata.vulnerabilities.total = 1;

      expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(/does not match/u);
    },
  );

  it("requires full-audit metadata to match enumerated entries", () => {
    const full = allowedInputs();
    full.fullAudit.metadata.vulnerabilities.high -= 1;
    full.fullAudit.metadata.vulnerabilities.total -= 1;
    expect(() => evaluateNpmAuditPolicy(full)).toThrow(/does not match/u);
  });

  it.each(["dependencies", "devDependencies"])(
    "requires package.json %s to be an object",
    (field) => {
      const inputs = allowedInputs();
      inputs.manifest[field] = [];

      expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
        /dependency maps are malformed/u,
      );
    },
  );

  it.each(["HIGH", null, "unknown"])(
    "rejects invalid vulnerability severity %s in production and full reports",
    (severity) => {
      const production = allowedInputs();
      addProductionBlockingPackage(production);
      production.productionAudit.vulnerabilities.production.severity = severity;
      expect(() => evaluateNpmAuditPolicy(production)).toThrow(
        /invalid vulnerability severity/u,
      );

      const full = allowedInputs();
      full.fullAudit.vulnerabilities.webdriverio.severity = severity;
      expect(() => evaluateNpmAuditPolicy(full)).toThrow(
        /invalid vulnerability severity/u,
      );
    },
  );

  it.each([
    ["name", "different-name"],
    ["isDirect", undefined],
    ["isDirect", "yes"],
    ["nodes", "node_modules/package"],
    ["via", "minimatch"],
    ["range", undefined],
    ["range", ""],
    ["fixAvailable", undefined],
    ["fixAvailable", []],
    ["fixAvailable", {}],
    [
      "fixAvailable",
      { name: "package", version: "2.0.0", isSemVerMajor: "yes" },
    ],
  ])(
    "rejects malformed blocking field %s=%j in production and full reports",
    (field, value) => {
      const production = allowedInputs();
      addProductionBlockingPackage(production);
      production.productionAudit.vulnerabilities.production[field] = value;
      expect(() => evaluateNpmAuditPolicy(production)).toThrow(
        /malformed blocking entry/u,
      );

      const full = allowedInputs();
      full.fullAudit.vulnerabilities.webdriverio[field] = value;
      expect(() => evaluateNpmAuditPolicy(full)).toThrow(
        /malformed blocking entry/u,
      );
    },
  );

  it("fails for any additional high-severity advisory", () => {
    const inputs = allowedInputs();
    inputs.fullAudit.vulnerabilities["unexpected-package"] = {
      name: "unexpected-package",
      severity: "high",
      isDirect: false,
      via: [
        {
          source: 9999999,
          name: "unexpected-package",
          dependency: "unexpected-package",
          url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
          severity: "high",
          range: "<1.0.1",
        },
      ],
      range: "<1.0.1",
      nodes: ["node_modules/unexpected-package"],
      fixAvailable: false,
    };
    inputs.fullAudit.metadata.vulnerabilities.high += 1;
    inputs.fullAudit.metadata.vulnerabilities.total += 1;
    inputs.lock.packages["node_modules/unexpected-package"] = {
      version: "1.0.0",
      dev: true,
    };

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
      /Only the exact brace-expansion root/u,
    );
  });

  it("rejects a pure cycle with no simple path to the allowed root", () => {
    const inputs = allowedInputs();
    addAffectedPackage(inputs, "cycle-a", ["cycle-b"]);
    addAffectedPackage(inputs, "cycle-b", ["cycle-a"]);

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
      /unapproved high or critical advisory/u,
    );
  });

  it("tolerates a real SCC only when every member has a simple root path", () => {
    const inputs = allowedInputs();
    inputs.fullAudit.vulnerabilities["eslint-config-next"].via = [
      "webdriverio",
      "minimatch",
    ];
    inputs.fullAudit.vulnerabilities.webdriverio.via = [
      "eslint-config-next",
      "minimatch",
    ];

    expect(evaluateNpmAuditPolicy(inputs).ok).toBe(true);
  });

  it("rejects an advisory object hidden beside a valid root path", () => {
    const inputs = allowedInputs();
    inputs.fullAudit.vulnerabilities.minimatch.via.push({
      source: 9999999,
      name: "hidden-advisory",
      dependency: "minimatch",
      url: "https://github.com/advisories/GHSA-hidden-advisory",
      severity: "high",
      range: "*",
    });

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
      /Only the exact brace-expansion root/u,
    );
  });

  it("rejects a dangling vulnerability edge", () => {
    const inputs = allowedInputs();
    inputs.fullAudit.vulnerabilities.minimatch.via.push("missing-edge");

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(/dangling/u);
  });

  it.each([
    ["url", "https://github.com/advisories/GHSA-changed"],
    ["severity", "critical"],
    ["range", "<=6.0.0"],
    ["isDirect", true],
    ["fixAvailable", { name: "brace-expansion", version: "5.0.8" }],
  ])("fails when the allowed advisory %s changes", (field, value) => {
    const inputs = allowedInputs();
    const advisory = inputs.fullAudit.vulnerabilities["brace-expansion"];
    if (field === "url") advisory.via[0].url = value;
    else advisory[field] = value;

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow();
  });

  it("fails when a vulnerable node becomes a production dependency", () => {
    const inputs = allowedInputs();
    const path = "node_modules/eslint-config-next/node_modules/brace-expansion";
    inputs.lock.packages[path].dev = false;

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(/dev-only/u);
  });

  it("requires nonempty existing lock nodes for every affected package", () => {
    const empty = allowedInputs();
    empty.fullAudit.vulnerabilities.webdriverio.nodes = [];
    expect(() => evaluateNpmAuditPolicy(empty)).toThrow(
      /must identify lockfile nodes/u,
    );

    const missing = allowedInputs();
    delete missing.lock.packages["node_modules/webdriverio"];
    expect(() => evaluateNpmAuditPolicy(missing)).toThrow(/dev-only/u);
  });

  it("requires brace-expansion nodes to identify brace-expansion packages", () => {
    const inputs = allowedInputs();
    inputs.fullAudit.vulnerabilities["brace-expansion"].nodes = [
      "node_modules/webdriverio",
    ];

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
      /does not match its reported package name/u,
    );
  });

  it("requires every propagated node to identify its reported package", () => {
    const inputs = allowedInputs();
    inputs.fullAudit.vulnerabilities.webdriverio.nodes = [
      "node_modules/eslint-config-next",
    ];

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
      /does not match its reported package name/u,
    );
  });

  it.each(["5.0.7-beta.1", "5.0", "5.0.7.1", "5.x.7", "05.0.7", "NaN.0.0"])(
    "rejects malformed or prerelease vulnerable version %s",
    (version) => {
      const inputs = allowedInputs();
      const path =
        "node_modules/eslint-config-next/node_modules/brace-expansion";
      inputs.lock.packages[path].version = version;

      expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
        /malformed, prerelease, or non-vulnerable/u,
      );
    },
  );

  it("rejects a node outside the exact vulnerable range", () => {
    const inputs = allowedInputs();
    const path = "node_modules/eslint-config-next/node_modules/brace-expansion";
    inputs.lock.packages[path].version = "5.0.8";

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
      /malformed, prerelease, or non-vulnerable/u,
    );
  });

  it("fails when a direct affected package moves to production", () => {
    const inputs = allowedInputs();
    inputs.manifest.dependencies.webdriverio = "9.27.1";
    delete inputs.manifest.devDependencies.webdriverio;

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
      /production dependency/u,
    );
  });

  it("trusts package.json over an inaccurate indirect audit flag", () => {
    const inputs = allowedInputs();
    inputs.fullAudit.vulnerabilities.webdriverio.isDirect = false;
    inputs.manifest.dependencies.webdriverio = "9.27.1";
    delete inputs.manifest.devDependencies.webdriverio;

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
      /production dependency/u,
    );
  });

  it("requires the compatible root path to stay patched and excluded", () => {
    const downgraded = allowedInputs();
    downgraded.lock.packages["node_modules/brace-expansion"].version = "5.0.7";
    expect(() => evaluateNpmAuditPolicy(downgraded)).toThrow(
      /must remain patched/u,
    );

    const included = allowedInputs();
    included.fullAudit.vulnerabilities["brace-expansion"].nodes.push(
      "node_modules/brace-expansion",
    );
    expect(() => evaluateNpmAuditPolicy(included)).toThrow(
      /cannot use the exception/u,
    );
  });

  it("fails when the exception becomes stale", () => {
    const inputs = allowedInputs();
    delete inputs.fullAudit.vulnerabilities["brace-expansion"];
    inputs.fullAudit.metadata.vulnerabilities.high -= 1;
    inputs.fullAudit.metadata.vulnerabilities.total -= 1;

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(/no longer needed/u);
  });

  it("always fails when production audit contains high severity", () => {
    const inputs = allowedInputs();
    addProductionBlockingPackage(inputs);

    expect(() => evaluateNpmAuditPolicy(inputs)).toThrow(
      "Production npm audit contains high or critical vulnerabilities.",
    );
  });
});
