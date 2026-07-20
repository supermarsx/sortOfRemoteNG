import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  join(process.cwd(), ".github", "workflows", "ci.yml"),
  "utf8",
);

const indentedBlock = (source: string, key: string, indent: number): string => {
  const lines = source.split(/\r?\n/);
  const prefix = `${" ".repeat(indent)}${key}:`;
  const start = lines.indexOf(prefix);
  expect(start, `expected ${key} block`).not.toBe(-1);
  const next = lines.findIndex(
    (line, index) =>
      index > start &&
      new RegExp(`^ {${indent}}[A-Za-z0-9_-]+:$`, "u").test(line),
  );
  return lines.slice(start, next === -1 ? undefined : next).join("\n");
};

const actionStep = (job: string, action: string): string => {
  const lines = job.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `- uses: ${action}`);
  expect(start, `expected ${action} step`).not.toBe(-1);
  const indentation = lines[start].search(/\S/u);
  const next = lines.findIndex(
    (line, index) =>
      index > start && line.startsWith(`${" ".repeat(indentation)}- `),
  );
  return lines.slice(start, next === -1 ? undefined : next).join("\n");
};

const scalar = (block: string, key: string): string => {
  const match = block.match(new RegExp(`^\\s+${key}:\\s*([^\\s]+)\\s*$`, "mu"));
  expect(match, `expected ${key} in workflow block`).not.toBeNull();
  return match![1].replace(/^['"]|['"]$/gu, "");
};

describe("CI coverage artifact contract", () => {
  it("downloads the uploaded coverage tree where the reporter reads it", () => {
    const testJob = indentedBlock(workflow, "test", 2);
    const coverageJob = indentedBlock(workflow, "coverage", 2);
    const upload = actionStep(testJob, "actions/upload-artifact@v4");
    const download = actionStep(coverageJob, "actions/download-artifact@v4");
    const uploadName = scalar(upload, "name");
    const downloadName = scalar(download, "name");
    const uploadPath = scalar(upload, "path");
    const downloadPath = scalar(download, "path");
    const reporter = coverageJob.match(/node -e "([^"]+)"/u);
    expect(reporter, "expected inline coverage reporter").not.toBeNull();
    const reporterPath = reporter![1].match(/readFileSync\('([^']+)'/u);
    expect(reporterPath, "expected reporter input path").not.toBeNull();

    expect(downloadName).toBe(uploadName);
    expect(uploadPath).toBe("coverage");
    expect(downloadPath).toBe(uploadPath);
    expect(reporterPath![1]).toBe(`${downloadPath}/coverage-final.json`);

    const fixtureRoot = mkdtempSync(join(tmpdir(), "sorng-coverage-contract-"));
    try {
      mkdirSync(join(fixtureRoot, downloadPath));
      writeFileSync(
        join(fixtureRoot, reporterPath![1]),
        JSON.stringify({
          "src/example.ts": {
            statementMap: { 0: {}, 1: {} },
            s: { 0: 1, 1: 0 },
          },
        }),
      );
      const result = spawnSync(process.execPath, ["-e", reporter![1]], {
        cwd: fixtureRoot,
        encoding: "utf8",
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("Coverage: 50.00%");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
