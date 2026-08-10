import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowsDirectory = join(process.cwd(), ".github", "workflows");
const releaseWorkflow = readFileSync(
  join(workflowsDirectory, "release.yml"),
  "utf8",
);
const nonReleaseWorkflows = readdirSync(workflowsDirectory)
  .filter(
    (name) =>
      name !== "release.yml" &&
      (name.endsWith(".yml") || name.endsWith(".yaml")),
  )
  .map((name) => ({
    name,
    source: readFileSync(join(workflowsDirectory, name), "utf8"),
  }));

describe("GitHub Actions Node runtime contracts", () => {
  it("does not reference first-party action majors that still use Node.js 20", () => {
    const deprecatedReferences = [
      /actions\/checkout@v4\b/u,
      /actions\/setup-node@v4\b/u,
      /actions\/setup-go@v5\b/u,
      /actions\/upload-artifact@v[45]\b/u,
      /actions\/download-artifact@v[4-6]\b/u,
      /actions\/cache@v4\b/u,
      /actions\/configure-pages@v5\b/u,
      /actions\/deploy-pages@v4\b/u,
      /actions\/upload-pages-artifact@v4\b/u,
    ];

    for (const workflow of nonReleaseWorkflows) {
      for (const deprecatedReference of deprecatedReferences) {
        expect(
          workflow.source,
          `${workflow.name} uses deprecated ${deprecatedReference.source}`,
        ).not.toMatch(deprecatedReference);
      }
    }
  });

  it("pins release actions to audited Node.js 24-compatible commits", () => {
    const expectedPins = [
      [
        "actions/checkout",
        "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
        "v5.1.0",
      ],
      [
        "actions/setup-node",
        "820762786026740c76f36085b0efc47a31fe5020",
        "v7.0.0",
      ],
      [
        "actions/setup-go",
        "924ae3a1cded613372ab5595356fb5720e22ba16",
        "v6.5.0",
      ],
      [
        "actions/upload-artifact",
        "b7c566a772e6b6bfb58ed0dc250532a479d7789f",
        "v6.0.0",
      ],
      [
        "actions/download-artifact",
        "37930b1c2abaa49bbe596cd826c3c89aef350131",
        "v7.0.0",
      ],
      [
        "softprops/action-gh-release",
        "3d0d9888cb7fd7b750713d6e236d1fcb99157228",
        "v3.0.2",
      ],
    ] as const;
    const actionLines = releaseWorkflow
      .split(/\r?\n/u)
      .filter((line) => line.includes("uses:"));

    for (const [action, sha, tag] of expectedPins) {
      const matchingLines = actionLines.filter((line) =>
        line.includes(`uses: ${action}@`),
      );
      expect(matchingLines, `${action} must be used`).not.toHaveLength(0);
      for (const line of matchingLines) {
        expect(line.trim()).toBe(`uses: ${action}@${sha} # ${tag}`);
      }
    }
  });

  it("bounds Docker registry and startup retries while limiting pull parallelism", () => {
    const workflow = readFileSync(join(workflowsDirectory, "e2e.yml"), "utf8");

    expect(workflow).toContain('COMPOSE_PARALLEL_LIMIT: "2"');
    expect(workflow).toMatch(
      /for attempt in 1 2 3 4; do[\s\S]*?"\$\{compose\[@\]\}" pull[\s\S]*?failed after 4 attempts/u,
    );
    expect(workflow).toMatch(
      /for attempt in 1 2 3; do[\s\S]*?"\$\{compose\[@\]\}" up -d --pull never[\s\S]*?failed after 3 attempts/u,
    );
  });
});
