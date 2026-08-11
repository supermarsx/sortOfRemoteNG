import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflowRoot = fileURLToPath(
  new URL("../../.github/workflows/", import.meta.url),
);

const NODE_LTS_MAJOR = 24;
const NODE_VERSION = "24.19.0";
const NODE_TYPES_VERSION = "24.13.3";
const SETUP_NODE_REF = "820762786026740c76f36085b0efc47a31fe5020";
const SETUP_NODE_TAG = "v7.0.0";
const BUN_VERSION = "1.3.11";
const SETUP_BUN_REF = "0c5077e51419868618aeaa5fe8019c62421857d6";
const SETUP_BUN_TAG = "v2.2.0";

const EXPECTED_SETUP_NODE_COUNTS = {
  "audit.yml": 1,
  "cargo-update.yml": 2,
  "ci.yml": 7,
  "docs-pages.yml": 1,
  "e2e.yml": 1,
  "frontend-build.yml": 1,
  "npm-update.yml": 1,
  "release.yml": 3,
};

async function readRepoFile(relativePath) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

async function readRepoJson(relativePath) {
  return JSON.parse(await readRepoFile(relativePath));
}

function majorOf(version) {
  return Number.parseInt(version.replace(/^[^0-9]*/, "").split(".")[0], 10);
}

test("declares one supported Node 24 LTS across runtime and typings", async () => {
  const [nodeVersionText, packageJson, packageLock] = await Promise.all([
    readRepoFile(".node-version"),
    readRepoJson("package.json"),
    readRepoJson("package-lock.json"),
  ]);

  const nodeVersion = nodeVersionText.trim();
  const lockRoot = packageLock.packages[""];
  const lockedNodeTypes = packageLock.packages["node_modules/@types/node"];

  assert.equal(nodeVersion, NODE_VERSION);
  assert.match(nodeVersion, /^24\.\d+\.\d+$/);
  assert.equal(packageJson.engines?.node, "24.x");
  assert.equal(lockRoot.engines?.node, packageJson.engines.node);
  assert.equal(
    packageJson.devDependencies?.["@types/node"],
    NODE_TYPES_VERSION,
  );
  assert.equal(
    lockRoot.devDependencies?.["@types/node"],
    packageJson.devDependencies["@types/node"],
  );
  assert.equal(lockedNodeTypes.version, NODE_TYPES_VERSION);
  assert.deepEqual(
    new Set([
      majorOf(nodeVersion),
      majorOf(packageJson.engines.node),
      majorOf(packageJson.devDependencies["@types/node"]),
      majorOf(lockedNodeTypes.version),
    ]),
    new Set([NODE_LTS_MAJOR]),
  );
});

test("runs the toolchain contract under the supported Node LTS", () => {
  assert.equal(
    majorOf(process.versions.node),
    NODE_LTS_MAJOR,
    `toolchain tests require Node ${NODE_LTS_MAJOR}.x; received ${process.versions.node}`,
  );
});

test("regenerates Next.js declarations instead of tracking generated state", async () => {
  const [gitignore, packageJson, tsconfig] = await Promise.all([
    readRepoFile(".gitignore"),
    readRepoJson("package.json"),
    readRepoJson("tsconfig.json"),
  ]);

  assert.match(gitignore, /^\/next-env\.d\.ts$/m);
  assert.equal(
    packageJson.scripts?.typecheck,
    "next typegen && tsc --noEmit --pretty false",
  );
  assert.ok(tsconfig.include?.includes("next-env.d.ts"));
  assert.ok(tsconfig.include?.includes(".next/types/**/*.ts"));
  assert.ok(tsconfig.include?.includes(".next/dev/types/**/*.ts"));
  assert.ok(tsconfig.include?.includes(".next-tauri-dev/types/**/*.ts"));
  assert.ok(tsconfig.include?.includes(".next-tauri-dev/dev/types/**/*.ts"));
});

test("pins the canonical Bun lock writer for dependency automation", async () => {
  const [bunVersionText, workflow] = await Promise.all([
    readRepoFile(".bun-version"),
    readRepoFile(".github/workflows/npm-update.yml"),
  ]);

  assert.equal(bunVersionText.trim(), BUN_VERSION);
  assert.match(
    workflow,
    new RegExp(
      `uses: oven-sh/setup-bun@${SETUP_BUN_REF.replaceAll("$", "\\$")} # ${SETUP_BUN_TAG.replaceAll("$", "\\$")}`,
    ),
  );
  assert.match(workflow, /bun-version-file: ["']\.bun-version["']/);
  assert.doesNotMatch(workflow, /^\s+bun-version:/m);
});

test("pins every workflow setup-node step to one immutable v7 release", async () => {
  const workflowFiles = (await readdir(workflowRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const actualCounts = {};

  for (const workflowFile of workflowFiles) {
    const contents = await readFile(join(workflowRoot, workflowFile), "utf8");
    const lines = contents.split(/\r?\n/);
    const setupNodeSteps = [];

    for (const [lineIndex, line] of lines.entries()) {
      const match = line.match(
        /^\s*(?:-\s*)?uses:\s*actions\/setup-node@([^\s#]+)\s+#\s*(\S+)\s*$/,
      );
      if (!match) continue;

      setupNodeSteps.push({ lineIndex, ref: match[1], tag: match[2] });
    }

    const rawSetupNodeCount =
      contents.match(/actions\/setup-node@/g)?.length ?? 0;
    assert.equal(
      setupNodeSteps.length,
      rawSetupNodeCount,
      `${workflowFile} contains an unparseable setup-node reference`,
    );

    if (setupNodeSteps.length === 0) continue;
    actualCounts[workflowFile] = setupNodeSteps.length;

    const versionFileFields =
      contents.match(/^\s+node-version-file:\s*["']\.node-version["']\s*$/gm) ??
      [];
    assert.equal(
      versionFileFields.length,
      setupNodeSteps.length,
      `${workflowFile} must use .node-version once per setup-node step`,
    );
    assert.doesNotMatch(
      contents,
      /^\s+node-version:/m,
      `${workflowFile} must not duplicate the Node version inline`,
    );

    for (const step of setupNodeSteps) {
      assert.equal(step.ref, SETUP_NODE_REF, `${workflowFile} setup-node SHA`);
      assert.equal(step.tag, SETUP_NODE_TAG, `${workflowFile} setup-node tag`);
      assert.match(
        lines.slice(step.lineIndex + 1, step.lineIndex + 8).join("\n"),
        /^\s+node-version-file:\s*["']\.node-version["']\s*$/m,
        `${workflowFile} setup-node step on line ${step.lineIndex + 1} must read .node-version`,
      );
    }
  }

  assert.deepEqual(actualCounts, EXPECTED_SETUP_NODE_COUNTS);
});
