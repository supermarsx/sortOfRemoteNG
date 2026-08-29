import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  JAVASCRIPT_COMPATIBLE_UPDATE_HOLDS,
  inspectJsLockParity,
  parseBunLock,
  stripJsonTrailingCommas,
} from "../../scripts/ci/check-js-lock-parity.mjs";
import {
  assertCompatibleLockUpdate,
  assertCompatibleManifestUpdate,
  buildCompatibleUpdatePolicy,
  dryRunCompatibleUpdate,
  writeCompatibleUpdate,
} from "../../scripts/ci/update-npm-compatible.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ARTIFACTS = [
  "package.json",
  "package-lock.json",
  "bun.lock",
  "src-tauri/crates/sorng-about/src/js_deps.rs",
];

function fixtureManifest() {
  return {
    name: "fixture",
    version: "26.26.0",
    private: true,
    scripts: { test: "node --test" },
    engines: { node: "24.x" },
    dependencies: {
      "@tauri-apps/api": "^2.11.1",
      react: "^19.2.8",
    },
    devDependencies: {
      "@types/node": "24.13.3",
      "@types/react": "^19.2.18",
      "@vitest/coverage-v8": "4.1.11",
      "@wdio/cli": "^9.27.1",
      "@wdio/local-runner": "^9.27.1",
      "@wdio/mocha-framework": "^9.27.1",
      "@wdio/spec-reporter": "^9.27.1",
      "@wdio/tauri-service": "^1.0.0",
      "@wdio/types": "^9.27.1",
      "@webgpu/types": "^0.1.71",
      "expect-webdriverio": "^5.6.5",
      prettier: "^3.8.3",
      vitest: "4.1.11",
      webdriverio: "^9.27.1",
    },
    overrides: { nanoid: "3.3.17" },
  };
}

function fixtureVersions() {
  return {
    "@tauri-apps/api": "2.11.1",
    react: "19.2.8",
    "@types/node": "24.13.3",
    "@types/react": "19.2.18",
    "@vitest/coverage-v8": "4.1.11",
    "@wdio/cli": "9.27.1",
    "@wdio/local-runner": "9.27.1",
    "@wdio/mocha-framework": "9.29.1",
    "@wdio/spec-reporter": "9.27.1",
    "@wdio/tauri-service": "1.2.0",
    "@wdio/types": "9.27.1",
    "@webgpu/types": "0.1.71",
    "expect-webdriverio": "5.6.5",
    prettier: "3.8.3",
    vitest: "4.1.11",
    webdriverio: "9.27.1",
  };
}

function expectedCompatibleHolds() {
  return Object.entries(JAVASCRIPT_COMPATIBLE_UPDATE_HOLDS)
    .map(([name, hold]) => ({
      name,
      spec: hold.spec,
      allowedVersions: [...hold.allowedVersions],
      reason: hold.reason,
      sources: [...hold.sources],
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function fixtureNpmLock(
  manifest = fixtureManifest(),
  versions = fixtureVersions(),
) {
  const packages = {
    "": {
      name: manifest.name,
      version: manifest.version,
      dependencies: { ...manifest.dependencies },
      devDependencies: { ...manifest.devDependencies },
      engines: { ...manifest.engines },
    },
  };
  for (const [name, version] of Object.entries(versions)) {
    packages[`node_modules/${name}`] = { version, license: "MIT" };
  }
  return {
    name: manifest.name,
    version: manifest.version,
    lockfileVersion: 3,
    packages,
  };
}

function fixtureBunLock(
  manifest = fixtureManifest(),
  versions = fixtureVersions(),
) {
  return {
    lockfileVersion: 1,
    configVersion: 0,
    workspaces: {
      "": {
        name: manifest.name,
        dependencies: { ...manifest.dependencies },
        devDependencies: { ...manifest.devDependencies },
      },
    },
    packages: Object.fromEntries(
      Object.entries(versions).map(([name, version]) => [
        name,
        [`${name}@${version}`, "", {}, `fixture-${name}`],
      ]),
    ),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hash(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function artifactHashes() {
  return Object.fromEntries(
    await Promise.all(
      ARTIFACTS.map(async (name) => [
        name,
        hash(await readFile(new URL(`../../${name}`, import.meta.url))),
      ]),
    ),
  );
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function runGit(repositoryRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
  );
  return String(result.stdout ?? "").trim();
}

function createHermeticRepository() {
  const repositoryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "sorng-npm-update-test-"),
  );
  writeJson(path.join(repositoryRoot, "package.json"), fixtureManifest());
  writeJson(path.join(repositoryRoot, "package-lock.json"), fixtureNpmLock());
  writeJson(path.join(repositoryRoot, "bun.lock"), fixtureBunLock());
  fs.writeFileSync(path.join(repositoryRoot, ".node-version"), "24.19.0\n");
  fs.writeFileSync(path.join(repositoryRoot, ".bun-version"), "1.3.11\n");
  const aboutFile = path.join(
    repositoryRoot,
    "src-tauri",
    "crates",
    "sorng-about",
    "src",
    "js_deps.rs",
  );
  fs.mkdirSync(path.dirname(aboutFile), { recursive: true });
  fs.writeFileSync(aboutFile, "// stale fixture catalog\n");

  runGit(repositoryRoot, ["init", "--quiet", "--initial-branch=main"]);
  runGit(repositoryRoot, ["config", "user.name", "Updater fixture"]);
  runGit(repositoryRoot, [
    "config",
    "user.email",
    "updater-fixture@invalid.local",
  ]);
  runGit(repositoryRoot, ["add", "--all"]);
  runGit(repositoryRoot, ["commit", "--quiet", "-m", "fixture baseline"]);
  assert.equal(runGit(repositoryRoot, ["status", "--porcelain=v1"]), "");
  return repositoryRoot;
}

function directVersions(manifest, packageLock) {
  const names = [
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.devDependencies),
  ];
  return Object.fromEntries(
    names.map((name) => [
      name,
      packageLock.packages[`node_modules/${name}`].version,
    ]),
  );
}

function createHermeticOperations({ escapeBoundary = false } = {}) {
  const bunRoots = [];
  const bunArguments = [];
  const desired = {
    react: { spec: "^19.2.9", version: "19.2.9" },
    "@types/react": { spec: "^19.2.19", version: "19.2.19" },
    "@webgpu/types": { spec: "^0.1.72", version: "0.1.72" },
    prettier: { spec: "^3.9.6", version: "3.9.6" },
  };

  const operations = {
    updateNpm({ repositoryRoot, eligible }) {
      assert.deepEqual(eligible, [
        "@types/react",
        "@wdio/cli",
        "@wdio/local-runner",
        "@wdio/mocha-framework",
        "@wdio/spec-reporter",
        "@wdio/types",
        "@webgpu/types",
        "expect-webdriverio",
        "prettier",
        "react",
        "webdriverio",
      ]);
      const manifestFile = path.join(repositoryRoot, "package.json");
      const lockFile = path.join(repositoryRoot, "package-lock.json");
      const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      const packageLock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      for (const [name, update] of Object.entries(desired)) {
        const group = Object.hasOwn(manifest.dependencies, name)
          ? "dependencies"
          : "devDependencies";
        manifest[group][name] = update.spec;
        packageLock.packages[""][group][name] = update.spec;
        packageLock.packages[`node_modules/${name}`].version = update.version;
      }
      writeJson(manifestFile, manifest);
      writeJson(lockFile, packageLock);
      return { status: 0, stdout: "", stderr: "" };
    },
    installBun({ cwd, args }) {
      bunRoots.push(cwd);
      bunArguments.push([...args]);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
      );
      const packageLock = JSON.parse(
        fs.readFileSync(path.join(cwd, "package-lock.json"), "utf8"),
      );
      const canonical = fixtureBunLock(
        manifest,
        directVersions(manifest, packageLock),
      );
      if (args.includes("--lockfile-only")) {
        writeJson(path.join(cwd, "bun.lock"), canonical);
      } else {
        assert.ok(args.includes("--frozen-lockfile"));
        assert.deepEqual(
          parseBunLock(fs.readFileSync(path.join(cwd, "bun.lock"), "utf8")),
          canonical,
        );
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    syncAbout({ repositoryRoot }) {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
      );
      const packageLock = JSON.parse(
        fs.readFileSync(path.join(repositoryRoot, "package-lock.json"), "utf8"),
      );
      const versions = directVersions(manifest, packageLock);
      const catalog = Object.entries(versions)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, version]) => `${name}=${version}`)
        .join("\n");
      fs.writeFileSync(
        path.join(
          repositoryRoot,
          "src-tauri",
          "crates",
          "sorng-about",
          "src",
          "js_deps.rs",
        ),
        `// hermetic direct dependency catalog\n${catalog}\n`,
      );
      if (escapeBoundary) {
        fs.writeFileSync(
          path.join(repositoryRoot, "escaped-update-artifact.txt"),
          "must be rejected\n",
        );
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  };

  return { operations, bunRoots, bunArguments };
}

test("parses canonical Bun text locks without treating string commas as syntax", () => {
  const source = `{
    "workspaces": {"": {"dependencies": {"example": "^1.0.0",},},},
    "packages": {"example": ["example@1.0.1", "comma,}] stays", {}, "hash",],},
  }`;
  const parsed = parseBunLock(source);
  const stripped = stripJsonTrailingCommas(source);
  assert.equal(parsed.workspaces[""].dependencies.example, "^1.0.0");
  assert.equal(parsed.packages.example[1], "comma,}] stays");
  assert.match(stripped, /"comma,\}\] stays"/);
  assert.doesNotMatch(stripped, /"example": "\^1\.0\.0",\s*}/);
});

test("proves exact npm/Bun direct parity and all explicit holds", () => {
  const result = inspectJsLockParity({
    packageJson: fixtureManifest(),
    packageLock: fixtureNpmLock(),
    bunLock: fixtureBunLock(),
    bunVersion: "1.3.11\n",
  });
  assert.deepEqual(
    {
      production: result.production,
      development: result.development,
      total: result.total,
    },
    { production: 2, development: 14, total: 16 },
  );
  assert.deepEqual(result.holds, {
    "@types/node": "24.13.3",
    "@vitest/coverage-v8": "4.1.11",
    vitest: "4.1.11",
  });
  assert.deepEqual(
    Object.entries(result.compatibleHolds)
      .map(([name, hold]) => ({ name, ...hold }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    expectedCompatibleHolds(),
  );
  assert.equal(
    Object.hasOwn(result.compatibleHolds, "prettier"),
    false,
    "prettier is no longer held: 3.9.6 formats Markdown/Liquid identically to 3.8.3",
  );
  // The wdio runner stack was unheld once webdriverio#15476 shipped fixed in
  // 9.31.0; only @wdio/tauri-service still carries the desktop-e2e hold.
  for (const name of [
    "@wdio/cli",
    "@wdio/local-runner",
    "@wdio/mocha-framework",
    "@wdio/spec-reporter",
    "@wdio/types",
    "expect-webdriverio",
    "webdriverio",
  ]) {
    assert.equal(
      Object.hasOwn(result.compatibleHolds, name),
      false,
      `${name} is no longer held`,
    );
  }
  for (const name of ["@wdio/tauri-service"]) {
    assert.equal(result.compatibleHolds[name].reason, "desktop-e2e-required");
  }
});

test("fails closed on npm/Bun drift and moved exact or compatible holds", () => {
  const bun = fixtureBunLock();
  bun.packages.react[0] = "react@19.2.9";
  assert.throws(
    () =>
      inspectJsLockParity({
        packageJson: fixtureManifest(),
        packageLock: fixtureNpmLock(),
        bunLock: bun,
        bunVersion: "1.3.11",
      }),
    /react resolves differently/,
  );

  const manifest = fixtureManifest();
  manifest.devDependencies.vitest = "4.1.10";
  assert.throws(
    () =>
      inspectJsLockParity({
        packageJson: manifest,
        packageLock: fixtureNpmLock(manifest, {
          ...fixtureVersions(),
          vitest: "4.1.10",
        }),
        bunLock: fixtureBunLock(manifest, {
          ...fixtureVersions(),
          vitest: "4.1.10",
        }),
        bunVersion: "1.3.11",
      }),
    /vitest hold moved/,
  );

  const tauriServiceManifest = fixtureManifest();
  tauriServiceManifest.devDependencies["@wdio/tauri-service"] = "^1.3.0";
  const tauriServiceVersions = {
    ...fixtureVersions(),
    "@wdio/tauri-service": "1.3.0",
  };
  assert.throws(
    () =>
      inspectJsLockParity({
        packageJson: tauriServiceManifest,
        packageLock: fixtureNpmLock(tauriServiceManifest, tauriServiceVersions),
        bunLock: fixtureBunLock(tauriServiceManifest, tauriServiceVersions),
        bunVersion: "1.3.11",
      }),
    /@wdio\/tauri-service compatible hold moved/,
  );

  const wdioVersions = { ...fixtureVersions(), "@wdio/tauri-service": "1.3.0" };
  assert.throws(
    () =>
      inspectJsLockParity({
        packageJson: fixtureManifest(),
        packageLock: fixtureNpmLock(fixtureManifest(), wdioVersions),
        bunLock: fixtureBunLock(fixtureManifest(), wdioVersions),
        bunVersion: "1.3.11",
      }),
    /@wdio\/tauri-service compatible hold moved/,
  );
});

test("selects only compatible ranges and reports every explicit hold reason", () => {
  assert.deepEqual(buildCompatibleUpdatePolicy(fixtureManifest()), {
    eligible: [
      "@types/react",
      "@wdio/cli",
      "@wdio/local-runner",
      "@wdio/mocha-framework",
      "@wdio/spec-reporter",
      "@wdio/types",
      "@webgpu/types",
      "expect-webdriverio",
      "prettier",
      "react",
      "webdriverio",
    ],
    exactHolds: ["@types/node", "@vitest/coverage-v8", "vitest"],
    crossGraphHolds: ["@tauri-apps/api"],
    explicitHolds: expectedCompatibleHolds(),
  });
});

test("accepts monotonic compatible manifest floors without changing policy metadata", () => {
  const before = fixtureManifest();
  const after = clone(before);
  after.dependencies.react = "^19.2.9";
  after.devDependencies["@types/react"] = "^19.2.19";
  after.devDependencies["@webgpu/types"] = "^0.1.72";
  assert.deepEqual(
    assertCompatibleManifestUpdate(before, after).map(({ name }) => name),
    ["react", "@types/react", "@webgpu/types"],
  );
});

test("rejects majors, range-boundary crossings, every hold class, and metadata drift", () => {
  const cases = [
    [
      "major",
      (value) => (value.dependencies.react = "^20.0.0"),
      /compatible manifest boundary/,
    ],
    [
      "zero-major",
      (value) => (value.devDependencies["@webgpu/types"] = "^0.2.0"),
      /compatible manifest boundary/,
    ],
    ["exact", (value) => (value.devDependencies.vitest = "4.1.10"), /held/],
    [
      "explicit compatible",
      (value) => (value.devDependencies["@wdio/tauri-service"] = "^1.3.0"),
      /@wdio\/tauri-service is held/,
    ],
    [
      "tauri",
      (value) => (value.dependencies["@tauri-apps/api"] = "^2.11.2"),
      /held/,
    ],
    [
      "override",
      (value) => (value.overrides.nanoid = "3.3.18"),
      /outside dependency specs/,
    ],
    [
      "version",
      (value) => (value.version = "26.27.0"),
      /outside dependency specs/,
    ],
  ];
  for (const [label, mutate, pattern] of cases) {
    const before = fixtureManifest();
    const after = clone(before);
    mutate(after);
    assert.throws(
      () => assertCompatibleManifestUpdate(before, after),
      pattern,
      label,
    );
  }
});

test("accepts compatible resolved movement but rejects held or major resolution drift", () => {
  const beforeManifest = fixtureManifest();
  const beforeLock = fixtureNpmLock(beforeManifest);
  const afterManifest = clone(beforeManifest);
  afterManifest.dependencies.react = "^19.2.9";
  const compatibleVersions = { ...fixtureVersions(), react: "19.2.9" };
  const compatibleLock = fixtureNpmLock(afterManifest, compatibleVersions);
  assert.deepEqual(
    assertCompatibleLockUpdate({
      beforeManifest,
      beforeLock,
      afterManifest,
      afterLock: compatibleLock,
    }).map(({ name }) => name),
    ["react"],
  );

  const heldVersions = { ...fixtureVersions(), "@tauri-apps/api": "2.11.2" };
  assert.throws(
    () =>
      assertCompatibleLockUpdate({
        beforeManifest,
        beforeLock,
        afterManifest: beforeManifest,
        afterLock: fixtureNpmLock(beforeManifest, heldVersions),
      }),
    /@tauri-apps\/api is held/,
  );

  const explicitHeldVersions = {
    ...fixtureVersions(),
    "@wdio/tauri-service": "1.3.0",
  };
  assert.throws(
    () =>
      assertCompatibleLockUpdate({
        beforeManifest,
        beforeLock,
        afterManifest: beforeManifest,
        afterLock: fixtureNpmLock(beforeManifest, explicitHeldVersions),
      }),
    /@wdio\/tauri-service explicit compatible hold resolution is not allowed/,
  );

  const majorVersions = { ...fixtureVersions(), react: "20.0.0" };
  assert.throws(
    () =>
      assertCompatibleLockUpdate({
        beforeManifest,
        beforeLock,
        afterManifest: beforeManifest,
        afterLock: fixtureNpmLock(beforeManifest, majorVersions),
      }),
    /compatible resolved boundary/,
  );
});

test("real-repository dry-run is read-only and reports the complete direct graph", async () => {
  const before = await artifactHashes();
  const result = dryRunCompatibleUpdate(REPOSITORY_ROOT);
  const after = await artifactHashes();
  assert.deepEqual(after, before);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.parity.total, 57);
  assert.equal(result.parity.bunVersion, "1.3.11");
  assert.ok(result.policy.eligible.length > 0);
  assert.deepEqual(result.policy.exactHolds, [
    "@types/node",
    "@vitest/coverage-v8",
    "vitest",
  ]);
  assert.deepEqual(result.policy.explicitHolds, expectedCompatibleHolds());
  assert.deepEqual(
    Object.keys(result.parity.compatibleHolds).sort(),
    expectedCompatibleHolds().map(({ name }) => name),
  );
});

test("hermetic write path updates only the atomic files, is idempotent, and cleans Bun roots", (t) => {
  const repositoryRoot = createHermeticRepository();
  t.after(() => fs.rmSync(repositoryRoot, { force: true, recursive: true }));
  const harness = createHermeticOperations();

  const first = writeCompatibleUpdate(repositoryRoot, {
    operations: harness.operations,
  });
  assert.equal(first.changed, true);
  assert.deepEqual(first.files, [...ARTIFACTS].sort());
  assert.deepEqual(
    runGit(repositoryRoot, ["diff", "--name-only"]).split(/\r?\n/).sort(),
    [...ARTIFACTS].sort(),
  );
  assert.equal(
    harness.bunArguments.filter((args) => args.includes("--lockfile-only"))
      .length,
    6,
  );
  assert.equal(
    harness.bunArguments.filter((args) => args.includes("--frozen-lockfile"))
      .length,
    1,
  );
  assert.ok(
    [...new Set(harness.bunRoots)].every(
      (temporaryRoot) => fs.existsSync(temporaryRoot) === false,
    ),
    "every updater-owned Bun directory is removed",
  );

  runGit(repositoryRoot, ["add", "--", ...ARTIFACTS]);
  runGit(repositoryRoot, [
    "commit",
    "--quiet",
    "-m",
    "accept hermetic candidate",
  ]);
  const second = writeCompatibleUpdate(repositoryRoot, {
    operations: harness.operations,
  });
  assert.equal(second.changed, false);
  assert.deepEqual(second.files, []);
  assert.equal(runGit(repositoryRoot, ["status", "--porcelain=v1"]), "");
  assert.equal(
    harness.bunArguments.filter((args) => args.includes("--lockfile-only"))
      .length,
    12,
  );
  assert.equal(
    harness.bunArguments.filter((args) => args.includes("--frozen-lockfile"))
      .length,
    2,
  );
  assert.ok(
    [...new Set(harness.bunRoots)].every(
      (temporaryRoot) => fs.existsSync(temporaryRoot) === false,
    ),
    "no updater-owned Bun directory survives the no-change rerun",
  );
});

test("hermetic write path rejects an escaped file and still cleans its Bun root", (t) => {
  const repositoryRoot = createHermeticRepository();
  t.after(() => fs.rmSync(repositoryRoot, { force: true, recursive: true }));
  const harness = createHermeticOperations({ escapeBoundary: true });

  assert.throws(
    () =>
      writeCompatibleUpdate(repositoryRoot, {
        operations: harness.operations,
      }),
    /update touched files outside the atomic package set.*escaped-update-artifact\.txt/,
  );
  assert.ok(
    [...new Set(harness.bunRoots)].every(
      (temporaryRoot) => fs.existsSync(temporaryRoot) === false,
    ),
    "boundary failure does not leak an updater-owned Bun directory",
  );
});

test("workflow pins actions, implements dual auth, and reuses one draft PR", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/npm-update.yml", import.meta.url),
    "utf8",
  );
  const refs = {
    "actions/checkout": "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
    "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020",
    "oven-sh/setup-bun": "0c5077e51419868618aeaa5fe8019c62421857d6",
    "peter-evans/create-pull-request":
      "5f6978faf089d4d20b00c7766989d076bb2fc7f1",
  };
  for (const [action, ref] of Object.entries(refs)) {
    assert.match(workflow, new RegExp(`${action.replace("/", "\\/")}@${ref}`));
  }
  const checkoutBlock = workflow.match(
    /      - name: Checkout main\r?\n([\s\S]*?)\r?\n      - name: Set up Node 24 LTS/,
  )?.[1];
  assert.ok(checkoutBlock, "checkout block");
  assert.match(checkoutBlock, /persist-credentials: false/);
  assert.doesNotMatch(
    workflow,
    /(?:actions\/checkout|actions\/setup-node|oven-sh\/setup-bun|peter-evans\/create-pull-request)@v\d/,
  );
  assert.match(
    workflow,
    /NPM_UPDATE_TOKEN: \$\{\{ secrets\.NPM_UPDATE_TOKEN \}\}/,
  );
  assert.match(workflow, /if \[\[ -z "\$\{NPM_UPDATE_TOKEN:-\}" \]\]/);
  assert.match(workflow, /actions\/permissions\/workflow/);
  assert.match(
    workflow,
    /setting is not introspectable with workflow-granted permissions/,
  );
  assert.match(
    workflow,
    /Administration: read, Contents: write, and Pull requests: write/,
  );
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /Settings > Actions > General > Workflow permissions/);
  assert.match(workflow, /branch: automation\/npm-compatible-update/);
  assert.match(workflow, /draft: always-true/);
  assert.match(workflow, /delete-branch: true/);
  assert.doesNotMatch(workflow, /gh pr merge|enable-pull-request-automerge/);

  const addPaths = workflow.match(
    /          add-paths: \|\r?\n([\s\S]*?)          body:/,
  )?.[1];
  assert.ok(addPaths, "create-pull-request add-paths block");
  assert.deepEqual(
    addPaths
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    ARTIFACTS,
  );
  assert.doesNotMatch(workflow, /^          labels:/m);
});

test("workflow and package scripts enforce atomic generation and the CI parity gate", async () => {
  const [workflow, updater, packageJson, ciWorkflow] = await Promise.all([
    readFile(
      new URL("../../.github/workflows/npm-update.yml", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../scripts/ci/update-npm-compatible.mjs", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../package.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
    readFile(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ),
  ]);

  assert.equal(
    packageJson.scripts["deps:npm:update:compatible"],
    "node ./scripts/ci/update-npm-compatible.mjs --write",
  );
  assert.equal(
    packageJson.scripts["deps:npm:update:dry-run"],
    "node ./scripts/ci/update-npm-compatible.mjs --dry-run",
  );
  assert.equal(
    packageJson.scripts["deps:lock-parity:check"],
    "node ./scripts/ci/check-js-lock-parity.mjs",
  );
  assert.equal(
    packageJson.scripts["deps:npm:tree:check"],
    "npm ls --package-lock-only --all",
  );
  assert.equal(packageJson.packageManager, "npm@11.11.0");
  assert.match(ciWorkflow, /run: npm run deps:npm:tree:check/);
  assert.match(ciWorkflow, /run: npm run deps:lock-parity:check/);
  assert.match(ciWorkflow, /run: npm run deps:npm:update:test/);
  assert.match(updater, /"update",[\s\S]*"--save"[\s\S]*"--package-lock-only"/);
  assert.match(updater, /process\.execPath[\s\S]*npm-cli\.js/);
  assert.doesNotMatch(updater, /npm\.cmd|bun\.cmd/);
  assert.match(updater, /pass <= 3/);
  assert.match(updater, /passHashes\[1\] !== passHashes\[2\]/);
  assert.match(updater, /"--frozen-lockfile"/);
  assert.match(updater, /scripts\/sync-js-deps\.mjs/);
  assert.match(workflow, /npm run test:coverage/);
  assert.match(workflow, /npm ls --all/);
  assert.match(workflow, /npm run deps:npm:tree:check/);
  assert.match(workflow, /node scripts\/ci\/check-npm-audit\.mjs/);
  assert.match(workflow, /npm run build:cold:check/);
  assert.match(
    workflow,
    /candidate_root="\$\(mktemp -d "\$\{RUNNER_TEMP:\?\}\/sorng-bun-XXXXXX"\)"[\s\S]*bun install --frozen-lockfile --ignore-scripts/,
  );
  assert.match(workflow, /trap cleanup_candidate EXIT/);
  assert.match(
    workflow,
    /! -d "\$\{candidate_root\}" \|\| -L "\$\{candidate_root\}"/,
  );
  assert.match(
    workflow,
    /dirname -- "\$\{resolved_candidate\}"[\s\S]*resolved_runner/,
  );
  assert.match(workflow, /rm -rf -- "\$\{resolved_candidate\}"/);
  assert.match(
    workflow,
    /repository_before="\$\(sha256sum package\.json package-lock\.json bun\.lock\)"/,
  );
  assert.match(
    workflow,
    /test "\$\{temporary_after\}" = "\$\{temporary_before\}"/,
  );
  assert.match(
    workflow,
    /test "\$\{repository_after\}" = "\$\{repository_before\}"/,
  );
  assert.match(
    workflow,
    /A no-change run must close an obsolete fixed-branch PR or no-op/,
  );
  assert.match(workflow, /closed\|none/);
  assert.match(workflow, /created\|updated/);

  const aggregatePattern =
    /sha256sum package\.json package-lock\.json bun\.lock src-tauri\/crates\/sorng-about\/src\/js_deps\.rs/g;
  assert.equal([...workflow.matchAll(aggregatePattern)].length, 2);
  const generationStart = workflow.indexOf(
    "      - name: Generate one compatible atomic candidate",
  );
  const generationEnd = workflow.indexOf(
    "\n      - name:",
    generationStart + 1,
  );
  const sealStart = workflow.indexOf(
    "      - name: Verify the sealed candidate before pull-request delivery",
  );
  const createPullRequestStart = workflow.indexOf(
    "      - name: Create or refresh the single update pull request",
  );
  assert.ok(
    generationStart >= 0 &&
      generationEnd > generationStart &&
      sealStart > generationEnd &&
      createPullRequestStart > sealStart,
    "candidate generation, seal verification, and PR delivery ordering",
  );
  const generationBlock = workflow.slice(generationStart, generationEnd);
  assert.ok(
    generationBlock.indexOf("npm run deps:npm:update:compatible") <
      generationBlock.indexOf('candidate_sha256="$('),
  );
  assert.match(
    generationBlock,
    /echo "candidate-sha256=\$\{candidate_sha256\}" >> "\$\{GITHUB_OUTPUT\}"/,
  );
  const preDeliverySealBlock = workflow.slice(
    sealStart,
    createPullRequestStart,
  );
  assert.equal(
    [...preDeliverySealBlock.matchAll(/^      - name:/gm)].length,
    1,
    "seal verification is immediately before create-pull-request",
  );
  assert.match(
    preDeliverySealBlock,
    /EXPECTED_CANDIDATE_SHA256: \$\{\{ steps\.update\.outputs\.candidate-sha256 \}\}/,
  );
  assert.match(
    preDeliverySealBlock,
    /actual_candidate_sha256[\s\S]*actual_candidate_sha256\}" != "\$\{EXPECTED_CANDIDATE_SHA256\}"/,
  );
  assert.doesNotMatch(
    workflow,
    /candidate-sha256=.*>>.*(?:RUNNER_TEMP|GITHUB_WORKSPACE|\/tmp)/,
  );
});
