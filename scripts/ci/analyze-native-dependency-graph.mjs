#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MANIFEST = fileURLToPath(
  new URL("../../src-tauri/Cargo.toml", import.meta.url),
);
const EDGE_MODES = Object.freeze({
  normal: "normal",
  normalWithoutProcMacros: "normal,no-proc-macro",
  release: "normal,build",
  withDev: "normal,build,dev",
});
const sorted = (values) => [...values].sort();
const packageLabel = (node) => `${node.name}@${node.version}`;

// Cargo's depth prefix keeps repeated (*) nodes, so their inbound edges survive
// without the exponential output produced by --no-dedupe. Preserve distinct
// feature sets: resolver v2 can compile one package for both host and target.
export function parseCargoTree(output) {
  const nodes = new Map();
  const edges = new Map();
  const stack = [];
  let root;
  for (const rawLine of output.split(/\r?\n/u)) {
    if (!rawLine.trim()) continue;
    const line = rawLine.replace(/ \(\*\)$/u, "");
    const match = /^(\d+)([^|]+)\|(.*)$/u.exec(line);
    if (!match) throw new Error(`Unrecognized cargo tree line: ${rawLine}`);
    const depth = Number(match[1]);
    const identity = match[2].replace(/ \(proc-macro\)/u, "");
    const fields = /^([^ ]+) v([^ ]+)(?: \((.*)\))?$/u.exec(identity);
    if (!fields) throw new Error(`Unrecognized Cargo package: ${identity}`);
    if (depth > stack.length || (depth === 0 && root)) {
      throw new Error(`Invalid cargo tree depth or multiple roots: ${rawLine}`);
    }
    let node = nodes.get(identity);
    if (!node) {
      node = {
        key: identity,
        name: fields[1],
        version: fields[2],
        source: fields[3] ?? null,
        procMacro: match[2].includes(" (proc-macro)"),
        features: new Set(),
        featureVariants: new Set(),
      };
      nodes.set(identity, node);
    }
    const features = sorted(match[3].split(",").filter(Boolean));
    features.forEach((feature) => node.features.add(feature));
    node.featureVariants.add(features.join(","));
    if (depth === 0) root = identity;
    else {
      const from = stack[depth - 1];
      const edge = { from, to: identity };
      edges.set(JSON.stringify([from, identity]), edge);
    }
    stack[depth] = identity;
    stack.length = depth + 1;
  }
  if (!root) throw new Error("Cargo tree did not contain a root package.");
  return { root, nodes, edges: [...edges.values()] };
}

function matchMetadata(node, packages) {
  const candidates = packages.filter(
    (pkg) => pkg.name === node.name && pkg.version === node.version,
  );
  if (candidates.length === 1) return candidates[0];
  const normalize = (value) => value.replaceAll("\\", "/");
  const local = candidates.filter(
    (pkg) =>
      !pkg.source &&
      normalize(dirname(pkg.manifest_path)) === normalize(node.source ?? ""),
  );
  if (local.length === 1) return local[0];
  throw new Error(`Missing or ambiguous metadata for ${node.key}`);
}

export function analyzeNativeGraph({ metadata, trees, selection = {} }) {
  if (!Array.isArray(metadata?.packages) || !metadata.resolve) {
    throw new Error(
      "Complete Cargo metadata with dependency resolution is required.",
    );
  }
  const graphs = Object.fromEntries(
    Object.keys(EDGE_MODES).map((mode) => [mode, parseCargoTree(trees[mode])]),
  );
  const release = graphs.release;
  if (Object.values(graphs).some((graph) => graph.root !== release.root)) {
    throw new Error("Cargo tree roots differ across edge selections.");
  }
  const workspace = new Set(metadata.workspace_members);
  const details = new Map(
    [...release.nodes.values()].map((node) => [
      node.key,
      matchMetadata(node, metadata.packages),
    ]),
  );
  const isWorkspace = (node) =>
    workspace.has(matchMetadata(node, metadata.packages).id);
  const describe = (key) => {
    const node = release.nodes.get(key);
    return {
      package: packageLabel(node),
      source: node.source,
      workspace: workspace.has(details.get(key).id),
      procMacro: node.procMacro,
    };
  };
  const incoming = new Map();
  const outgoing = new Map();
  for (const edge of release.edges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, new Set());
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, new Set());
    incoming.get(edge.to).add(edge.from);
    outgoing.get(edge.from).add(edge.to);
  }
  const rank = (nodes, metric) =>
    nodes
      .map((node) => ({ ...describe(node.key), [metric]: node[metric] }))
      .sort(
        (a, b) => b[metric] - a[metric] || a.package.localeCompare(b.package),
      );
  const nodes = [...release.nodes.values()].map((node) => ({
    ...node,
    directDependencies: outgoing.get(node.key)?.size ?? 0,
    directDependents: incoming.get(node.key)?.size ?? 0,
    enabledFeatureCount: node.features.size,
  }));
  const groups = new Map();
  for (const node of nodes) {
    if (!groups.has(node.name)) groups.set(node.name, []);
    groups.get(node.name).push(node);
  }
  const duplicates = [...groups.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([name, entries]) => ({
      name,
      versions: entries
        .map((node) => ({
          ...describe(node.key),
          directDependents: node.directDependents,
          runtimeCandidate: graphs.normalWithoutProcMacros.nodes.has(node.key),
        }))
        .sort((a, b) => a.package.localeCompare(b.package)),
    }))
    .sort(
      (a, b) =>
        b.versions.length - a.versions.length || a.name.localeCompare(b.name),
    );
  const closure = (graph) => {
    const graphNodes = [...graph.nodes.values()];
    const workspacePackages = graphNodes.filter(isWorkspace).length;
    return {
      packagesIncludingRoot: graphNodes.length,
      dependencyPackages: graphNodes.length - 1,
      workspacePackages,
      externalPackages: graphNodes.length - workspacePackages,
      packageEdges: graph.edges.length,
      procMacroPackages: graphNodes.filter((node) => node.procMacro).length,
    };
  };
  const difference = (left, right) =>
    sorted(
      [...left.nodes.values()]
        .filter((node) => !right.nodes.has(node.key))
        .map(packageLabel),
    );
  const describeFeatures = (node) => ({
    ...describe(node.key),
    features: sorted(node.features),
    featureVariants: sorted(node.featureVariants).map((variant) =>
      variant.split(",").filter(Boolean),
    ),
  });
  return {
    schemaVersion: 1,
    selection,
    semantics: [
      "Cargo tree selects the package, target and features; metadata supplies inventory and package annotations only.",
      "Counts include the root. Release means normal and build edges with no dev edges; it does not select a Cargo optimization profile.",
      "Normal edges include procedural macros. Normal without proc macros is a runtime candidate closure, not proof of linked or loaded code.",
      "Package identities collapse repeated host/target compilations. Feature variants are retained; these are not compilation-unit or monomorphization counts.",
      "Metadata inventory includes unrelated workspace and dev packages. Its resolve features are intentionally not used.",
      "Cargo links and -sys names identify native/build integrations, not proof of static or dynamic linkage. Binary size, compiler RSS and runtime RSS require separate measurements.",
    ],
    inventory: {
      metadataPackages: metadata.packages.length,
      workspacePackages: workspace.size,
      reachableReleaseWorkspacePackages: nodes.filter(isWorkspace).length,
      unreachableReleaseWorkspacePackages: metadata.packages
        .filter((pkg) => workspace.has(pkg.id))
        .filter(
          (pkg) =>
            ![...details.values()].some((detail) => detail.id === pkg.id),
        )
        .map((pkg) => `${pkg.name}@${pkg.version}`)
        .sort(),
    },
    closures: Object.fromEntries(
      Object.entries(graphs).map(([mode, graph]) => [mode, closure(graph)]),
    ),
    buildOrMacroOnlyPackages: difference(
      release,
      graphs.normalWithoutProcMacros,
    ),
    devOnlyPackages: difference(graphs.withDev, release),
    rootDirectDependencies: sorted(outgoing.get(release.root) ?? []).map(
      describe,
    ),
    workspaceHubs: rank(nodes.filter(isWorkspace), "directDependencies"),
    sharedDependencies: rank(nodes, "directDependents").slice(0, 25),
    featureFanout: rank(nodes, "enabledFeatureCount").slice(0, 25),
    duplicateNames: duplicates.length,
    duplicateExtraPackages: duplicates.reduce(
      (sum, group) => sum + group.versions.length - 1,
      0,
    ),
    duplicates,
    nativeIntegrations: nodes
      .filter(
        (node) =>
          details.get(node.key).links ||
          /(?:-sys\d*$|openh264|rquickjs)/u.test(node.name),
      )
      .map((node) => ({
        ...describeFeatures(node),
        links: details.get(node.key).links,
        runtimeCandidate: graphs.normalWithoutProcMacros.nodes.has(node.key),
      }))
      .sort((a, b) => a.package.localeCompare(b.package)),
    packages: nodes
      .map((node) => ({
        ...describeFeatures(node),
        directDependencies: node.directDependencies,
        directDependents: node.directDependents,
        runtimeCandidate: graphs.normalWithoutProcMacros.nodes.has(node.key),
        dependencyPackages: sorted(outgoing.get(node.key) ?? []).map((key) =>
          packageLabel(release.nodes.get(key)),
        ),
      }))
      .sort((a, b) => a.package.localeCompare(b.package)),
  };
}

export function parseArgs(args) {
  const options = {
    manifest: DEFAULT_MANIFEST,
    package: "app",
    features: "full",
    defaultFeatures: false,
    offline: true,
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      ["--manifest", "--package", "--features", "--target"].includes(argument)
    ) {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}`);
      }
      options[argument.slice(2)] = value;
    } else if (argument === "--default-features")
      options.defaultFeatures = true;
    else if (argument === "--online") options.offline = false;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export function collectNativeGraph(options) {
  const manifest = resolve(options.manifest ?? DEFAULT_MANIFEST);
  const cwd = dirname(manifest);
  const commands = [];
  const run = (command, args) => {
    commands.push({ command, args });
    const result = spawnSync(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `${command} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr}`,
      );
    }
    return result.stdout;
  };
  const rustcVersion = run("rustc", ["-vV"]).trim();
  const target = options.target ?? /^host: (.+)$/mu.exec(rustcVersion)?.[1];
  if (!target || target === "all")
    throw new Error("One concrete Cargo target is required.");
  const common = ["--manifest-path", manifest, "--locked"];
  if (options.offline !== false) common.push("--offline");
  if (!options.defaultFeatures) common.push("--no-default-features");
  if (options.features) common.push("--features", options.features);
  const metadata = JSON.parse(
    run("cargo", [
      "metadata",
      ...common,
      "--format-version",
      "1",
      "--filter-platform",
      target,
    ]),
  );
  const trees = Object.fromEntries(
    Object.entries(EDGE_MODES).map(([mode, edges]) => [
      mode,
      run("cargo", [
        "tree",
        ...common,
        "-p",
        options.package ?? "app",
        "--target",
        target,
        "--edges",
        edges,
        "--prefix",
        "depth",
        "--format",
        "{p}|{f}",
      ]),
    ]),
  );
  return analyzeNativeGraph({
    metadata,
    trees,
    selection: {
      manifest,
      package: options.package ?? "app",
      features: options.features ?? "",
      defaultFeatures: Boolean(options.defaultFeatures),
      offline: options.offline !== false,
      locked: true,
      target,
      rustcVersion,
      cargoVersion: run("cargo", ["--version"]).trim(),
      cargoLockSha256: createHash("sha256")
        .update(readFileSync(resolve(metadata.workspace_root, "Cargo.lock")))
        .digest("hex"),
      commands,
    },
  });
}

export function formatSummary(report) {
  const { selection, inventory, closures } = report;
  return [
    `Native dependency graph: ${selection.package}, target=${selection.target}, features=${selection.features || "(none)"}, default-features=${selection.defaultFeatures}`,
    `Workspace inventory: ${inventory.workspacePackages}; reachable release workspace: ${inventory.reachableReleaseWorkspacePackages}; metadata inventory: ${inventory.metadataPackages}`,
    ...Object.entries(closures).map(
      ([mode, counts]) =>
        `${mode}: ${counts.packagesIncludingRoot} packages including root, ${counts.packageEdges} edges, ${counts.procMacroPackages} proc macros`,
    ),
    `Root direct dependencies: ${report.rootDirectDependencies.length}`,
    `Duplicate names: ${report.duplicateNames}; additional versions/sources: ${report.duplicateExtraPackages}`,
    "Workspace hubs (direct dependencies):",
    ...report.workspaceHubs
      .slice(0, 12)
      .map((node) => `  ${node.package}: ${node.directDependencies}`),
    "Shared dependencies (direct dependents):",
    ...report.sharedDependencies
      .slice(0, 12)
      .map((node) => `  ${node.package}: ${node.directDependents}`),
    "Use --json for package edges, features, duplicates, native integrations and exact Cargo commands.",
    "Graph counts are not binary size, compilation-unit counts or compiler/runtime memory measurements.",
  ].join("\n");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(
        "Usage: node scripts/ci/analyze-native-dependency-graph.mjs [--target TRIPLE] [--features LIST] [--package NAME] [--manifest PATH] [--default-features] [--online] [--json]\nDefaults: app, host target, full, no default features, locked and offline. Runs metadata/tree only; performs no build or file writes.",
      );
    } else {
      const report = collectNativeGraph(options);
      console.log(
        options.json ? JSON.stringify(report, null, 2) : formatSummary(report),
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
