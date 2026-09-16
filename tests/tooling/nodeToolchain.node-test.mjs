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
  "ci.yml": 9,
  "coverage.yml": 1,
  "docs-pages.yml": 1,
  "e2e.yml": 1,
  "frontend-build.yml": 1,
  "npm-update.yml": 1,
  "release.yml": 3,
};

// Workflow toolchains that may differ from the rust-toolchain.toml channel.
// Counts are exact, so a stale exception fails once its workflow drops it.
const RUST_TOOLCHAIN_EXCEPTIONS = [
  {
    workflow: "release.yml",
    toolchain: "1.95.0",
    count: 2,
    reason:
      "Windows release matrix: hosted 1.97.1 produced an app archive MSVC rejected with LNK4003 (6d9c7c43)",
  },
  {
    workflow: "ci.yml",
    toolchain: "stable-x86_64-pc-windows-gnu",
    count: 1,
    reason:
      "OPKSSH GNU bridge toolchain named by scripts/opkssh-vendor-artifact.mjs",
  },
  {
    workflow: "release.yml",
    toolchain: "stable-x86_64-pc-windows-gnu",
    count: 1,
    reason:
      "OPKSSH GNU bridge toolchain named by scripts/opkssh-vendor-artifact.mjs",
  },
];

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

async function listWorkflowFiles() {
  return (await readdir(workflowRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function unquote(value) {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

function isCommentOrBlank(line) {
  return /^\s*(?:#.*)?$/.test(line);
}

// Returns every toolchain a workflow line selects, with where it came from.
function toolchainReferences(line) {
  const references = [];
  const patterns = [
    ["matrix", /^\s*(?:-\s*)?rust_toolchain:\s*(.+?)\s*$/],
    ["RUSTUP_TOOLCHAIN", /^\s*RUSTUP_TOOLCHAIN:\s*(.+?)\s*$/],
    ["rust-version", /^\s*rust-version:\s*(.+?)\s*$/],
  ];
  for (const [source, pattern] of patterns) {
    const match = line.match(pattern);
    if (match) references.push({ source, toolchain: unquote(match[1]) });
  }
  for (const match of line.matchAll(
    /\brustup\s+(?:toolchain\s+install|install|default|override\s+set|run)\s+([^\s;|&]+)/g,
  )) {
    references.push({ source: "rustup", toolchain: unquote(match[1]) });
  }
  for (const match of line.matchAll(/\b(?:cargo|rustc|rustdoc)\s+\+(\S+)/g)) {
    references.push({ source: "+toolchain", toolchain: match[1] });
  }
  return references;
}

test("pins every workflow Rust toolchain to the rust-toolchain.toml channel", async () => {
  const toolchainFile = await readRepoFile("rust-toolchain.toml");
  const channel = toolchainFile.match(/^\s*channel\s*=\s*"([^"]+)"\s*$/m)?.[1];
  assert.match(
    channel ?? "",
    /^\d+\.\d+\.\d+$/,
    "rust-toolchain.toml must pin an exact Rust release, not a floating channel",
  );
  // The channel itself, or the channel for an explicit host triple.
  const isPinnedToolchain = (toolchain) =>
    toolchain === channel ||
    (toolchain.startsWith(`${channel}-`) &&
      /^-[a-z0-9_]+(?:-[a-z0-9_]+){2,3}$/.test(
        toolchain.slice(channel.length),
      ));

  const exceptionCounts = {};
  const installingJobs = [];

  for (const workflowFile of await listWorkflowFiles()) {
    const contents = await readFile(join(workflowRoot, workflowFile), "utf8");
    const lines = contents
      .split(/\r?\n/)
      .map((line) => (isCommentOrBlank(line) ? "" : line));
    const where = (lineIndex) => `${workflowFile}:${lineIndex + 1}`;
    const checkToolchain = (toolchain, source, lineIndex) => {
      if (isPinnedToolchain(toolchain)) return;
      if (source !== "matrix" && toolchain === "${{ matrix.rust_toolchain }}") {
        return;
      }
      const exception = RUST_TOOLCHAIN_EXCEPTIONS.find(
        (entry) =>
          entry.workflow === workflowFile && entry.toolchain === toolchain,
      );
      assert.ok(
        exception,
        `${where(lineIndex)} ${source} selects Rust toolchain "${toolchain}"; use the rust-toolchain.toml channel "${channel}"`,
      );
      const key = `${workflowFile} ${toolchain}`;
      exceptionCounts[key] = (exceptionCounts[key] ?? 0) + 1;
    };

    const actionSteps = [];
    for (const [lineIndex, line] of lines.entries()) {
      const match = line.match(
        /^(\s*(?:-\s*)?)uses:\s*dtolnay\/rust-toolchain@([^\s#]+)(?:\s+#\s*(\S.*))?$/,
      );
      if (match) {
        actionSteps.push({
          lineIndex,
          keyIndent: match[1].length,
          ref: match[2],
          tag: match[3],
        });
      }
      for (const { source, toolchain } of toolchainReferences(line)) {
        checkToolchain(toolchain, source, lineIndex);
      }
    }
    assert.equal(
      actionSteps.length,
      lines.join("\n").match(/dtolnay\/rust-toolchain@/g)?.length ?? 0,
      `${workflowFile} contains an unparseable dtolnay/rust-toolchain reference`,
    );

    for (const step of actionSteps) {
      assert.match(
        step.ref,
        /^[0-9a-f]{40}$/,
        `${where(step.lineIndex)} must pin dtolnay/rust-toolchain to a commit SHA`,
      );
      assert.ok(step.tag, `${where(step.lineIndex)} must label the pinned SHA`);

      const stepLines = [];
      for (const line of lines.slice(step.lineIndex + 1)) {
        if (line === "") continue;
        if (indentOf(line) < step.keyIndent) break;
        stepLines.push(line);
      }
      const toolchainInputs = stepLines.filter((line) =>
        /^\s+toolchain:/.test(line),
      );
      assert.equal(
        toolchainInputs.length,
        1,
        `${where(step.lineIndex)} must pass the rust-toolchain.toml channel as the toolchain input`,
      );
      checkToolchain(
        unquote(toolchainInputs[0].replace(/^\s+toolchain:/, "")),
        "toolchain input",
        step.lineIndex,
      );
    }

    const jobsStart = lines.findIndex((line) => /^jobs:\s*$/.test(line));
    if (jobsStart === -1) continue;
    const jobStarts = [];
    for (const [lineIndex, line] of lines.entries()) {
      const match = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
      if (lineIndex > jobsStart && match) {
        jobStarts.push({ name: match[1], lineIndex });
      }
    }
    for (const [jobIndex, job] of jobStarts.entries()) {
      const end = jobStarts[jobIndex + 1]?.lineIndex ?? lines.length;
      // Command position only: a line start, a `run:` value, or after a shell
      // operator. Step names and prose such as PR titles do not count.
      const runsRust = lines
        .slice(job.lineIndex, end)
        .some((line) =>
          /(?:^\s*(?:(?:-\s*)?run:\s*)?|[;&|(]\s*)(?:cargo|rustc|rustup)\s/.test(
            line,
          ),
        );
      if (!runsRust) continue;
      installingJobs.push(`${workflowFile} ${job.name}`);
      assert.ok(
        actionSteps.some(
          (step) => step.lineIndex > job.lineIndex && step.lineIndex < end,
        ),
        `${workflowFile} job ${job.name} runs Rust tools without a pinned dtolnay/rust-toolchain step`,
      );
    }
  }

  assert.deepEqual(
    exceptionCounts,
    Object.fromEntries(
      RUST_TOOLCHAIN_EXCEPTIONS.map((entry) => [
        `${entry.workflow} ${entry.toolchain}`,
        entry.count,
      ]),
    ),
  );
  assert.ok(
    installingJobs.length > 0,
    "expected at least one workflow job that installs Rust",
  );
});
