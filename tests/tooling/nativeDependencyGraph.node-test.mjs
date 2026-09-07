import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzeNativeGraph,
  parseArgs,
  parseCargoTree,
} from "../../scripts/ci/analyze-native-dependency-graph.mjs";

test("depth parser preserves diamond edges, sources, proc macros and feature variants", () => {
  const graph = parseCargoTree(
    [
      "0app v1.0.0 (C:\\repo)|full",
      "1left v1.0.0|",
      "2shared v1.0.0|alloc,std",
      "1right v1.0.0|",
      "2shared v1.0.0|alloc,std (*)",
      "1shared v1.0.0|std",
      "1derive v1.0.0 (proc-macro)|default",
    ].join("\r\n"),
  );
  assert.equal(graph.nodes.size, 5);
  assert.equal(graph.edges.length, 6);
  assert.equal(graph.nodes.get("derive v1.0.0").procMacro, true);
  assert.equal(graph.nodes.get(graph.root).source, "C:\\repo");
  assert.deepEqual(
    [...graph.nodes.get("shared v1.0.0").featureVariants],
    ["alloc,std", "std"],
  );
  assert.equal(
    graph.edges.filter((edge) => edge.to === "shared v1.0.0").length,
    3,
  );
});

function fixture() {
  const pkg = (name, version = "1.0.0", extra = {}) => ({
    id: `${name}@${version}`,
    name,
    version,
    manifest_path: `/repo/${name}/Cargo.toml`,
    source: "registry+example",
    links: null,
    ...extra,
  });
  const normal =
    "0app v1.0.0|full\n1library v1.0.0|default\n2shared v1.0.0|std\n1derive v1.0.0 (proc-macro)|\n2shared v2.0.0|alloc";
  const release = `${normal}\n1native-sys v1.0.0|dynamic\n2shared v2.0.0|std`;
  return {
    metadata: {
      packages: [
        pkg("app"),
        pkg("unused-workspace"),
        pkg("library"),
        pkg("shared"),
        pkg("shared", "2.0.0"),
        pkg("derive"),
        pkg("native-sys", "1.0.0", { links: "native" }),
        pkg("test-helper"),
      ],
      workspace_members: ["app@1.0.0", "unused-workspace@1.0.0"],
      resolve: {
        nodes: [{ id: "library@1.0.0", features: ["WRONG-workspace-feature"] }],
      },
    },
    trees: {
      normal,
      normalWithoutProcMacros:
        "0app v1.0.0|full\n1library v1.0.0|default\n2shared v1.0.0|std",
      release,
      withDev: `${release}\n1test-helper v1.0.0|`,
    },
  };
}

test("analysis separates inventory, build and dev closures without using metadata features", () => {
  const report = analyzeNativeGraph(fixture());
  assert.equal(report.inventory.workspacePackages, 2);
  assert.equal(report.inventory.reachableReleaseWorkspacePackages, 1);
  assert.deepEqual(report.inventory.unreachableReleaseWorkspacePackages, [
    "unused-workspace@1.0.0",
  ]);
  assert.equal(report.closures.normal.packagesIncludingRoot, 5);
  assert.equal(report.closures.release.packagesIncludingRoot, 6);
  assert.equal(report.closures.withDev.packagesIncludingRoot, 7);
  assert.deepEqual(report.buildOrMacroOnlyPackages, [
    "derive@1.0.0",
    "native-sys@1.0.0",
    "shared@2.0.0",
  ]);
  assert.deepEqual(report.devOnlyPackages, ["test-helper@1.0.0"]);
  assert.deepEqual(
    report.packages.find((node) => node.package === "library@1.0.0").features,
    ["default"],
  );
  assert.equal(report.rootDirectDependencies.length, 3);
  assert.equal(report.duplicateNames, 1);
  assert.equal(report.duplicateExtraPackages, 1);
  assert.equal(report.duplicates[0].versions[1].runtimeCandidate, false);
  assert.equal(report.nativeIntegrations[0].links, "native");
});

test("source-distinct local packages with the same name and version remain distinct", () => {
  const input = fixture();
  input.metadata.packages.push({
    ...input.metadata.packages[2],
    id: "local-library",
    source: null,
    manifest_path: "/different/Cargo.toml",
  });
  for (const mode of Object.keys(input.trees)) {
    input.trees[mode] = input.trees[mode].replace(
      "library v1.0.0|",
      "library v1.0.0 (/different)|",
    );
  }
  const report = analyzeNativeGraph(input);
  assert.equal(
    report.packages.find((node) => node.package === "library@1.0.0").source,
    "/different",
  );
});

test("malformed or truncated trees fail instead of reporting partial graphs", () => {
  assert.throws(() => parseCargoTree(""), /root/u);
  assert.throws(() => parseCargoTree("0app v1.0.0|\n2child v1.0.0|"), /depth/u);
  assert.throws(() => parseCargoTree("0app v1.0.0|\n0other v1.0.0|"), /roots/u);
  assert.throws(() => parseCargoTree("app v1.0.0"), /Unrecognized/u);
  const input = fixture();
  input.trees.withDev = "0different v1.0.0|";
  assert.throws(() => analyzeNativeGraph(input), /roots differ/u);
});

test("CLI defaults are locked/offline full graphs with explicit target and feature overrides", () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.features, "full");
  assert.equal(defaults.defaultFeatures, false);
  assert.equal(defaults.offline, true);
  const options = parseArgs([
    "--target",
    "aarch64-pc-windows-msvc",
    "--features",
    "full-windows-dynamic",
    "--json",
  ]);
  assert.equal(options.target, "aarch64-pc-windows-msvc");
  assert.equal(options.features, "full-windows-dynamic");
  assert.equal(options.json, true);
  assert.equal(parseArgs(["--features", ""]).features, "");
  assert.throws(() => parseArgs(["--features"]), /Missing value/u);
  assert.throws(() => parseArgs(["--build"]), /Unknown argument/u);
});

test("member-manifest CLI hashes the workspace lockfile and honors package/features", (context) => {
  if (spawnSync("cargo", ["--version"], { windowsHide: true }).status !== 0) {
    context.skip(
      "Cargo is required for the offline CLI integration regression.",
    );
    return;
  }
  const workspace = mkdtempSync(join(tmpdir(), "sorng-native-graph-"));
  try {
    const member = join(workspace, "crates", "graph-member");
    mkdirSync(join(member, "src"), { recursive: true });
    writeFileSync(
      join(workspace, "Cargo.toml"),
      '[workspace]\nmembers = ["crates/graph-member"]\nresolver = "2"\n',
    );
    writeFileSync(
      join(member, "Cargo.toml"),
      '[package]\nname = "graph-member"\nversion = "1.0.0"\nedition = "2021"\n[features]\ngraph-feature = []\n',
    );
    writeFileSync(join(member, "src", "lib.rs"), "");
    const lock = spawnSync("cargo", ["generate-lockfile", "--offline"], {
      cwd: workspace,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    });
    assert.equal(lock.status, 0, lock.error?.message ?? lock.stderr);
    const cli = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../../scripts/ci/analyze-native-dependency-graph.mjs",
            import.meta.url,
          ),
        ),
        "--manifest",
        join(member, "Cargo.toml"),
        "--package",
        "graph-member",
        "--features",
        "graph-feature",
        "--json",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 30_000 },
    );
    assert.equal(cli.status, 0, cli.error?.message ?? cli.stderr);
    const report = JSON.parse(cli.stdout);
    assert.equal(report.selection.package, "graph-member");
    assert.equal(report.selection.features, "graph-feature");
    assert.equal(report.closures.release.packagesIncludingRoot, 1);
    assert.deepEqual(report.packages[0].features, ["graph-feature"]);
    assert.equal(
      report.selection.cargoLockSha256,
      createHash("sha256")
        .update(readFileSync(join(workspace, "Cargo.lock")))
        .digest("hex"),
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
