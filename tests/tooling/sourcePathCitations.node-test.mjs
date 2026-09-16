import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Frontend comments and documentation cite Rust sources by path. Registrar
// splits move those files, so every cited path must still exist. Cite the
// registrar crate and its `commands.json`, or the domain crate, instead of a
// `.rs` path that a later split will move.

const root = fileURLToPath(new URL("../../", import.meta.url));
const scanRoots = [
  { directory: "src", extensions: [".ts", ".tsx"] },
  { directory: "docs", extensions: [".md"] },
];
const skippedDirectories = new Set([
  ".jekyll-cache",
  "_site",
  "node_modules",
  "vendor",
]);
// Dated plans keep change maps that name files to create, split or delete.
const skippedPaths = new Set(["docs/plans"]);

// Stale citations left in files that another task has uncommitted changes to.
// Key `<file>|<cited path>`, value = owning task. Remove an entry once the
// owner fixes the citation.
const allowedStale = new Map([]);

const segment = String.raw`(?:[\w.-]|\{[\w.,-]+\})+`;
// `src-tauri/...` from the repository root, including GitHub blob URLs.
const repositoryPath = new RegExp(
  String.raw`(?<![\w.-])src-tauri/(?:${segment}/)*${segment}\.rs\b`,
  "g",
);
// `sorng-<crate>/...` or `crates/sorng-<crate>/...`, relative to `src-tauri/crates`.
const cratePath = new RegExp(
  String.raw`(?<![\w./-])(?:crates/)?(sorng-[a-z0-9-]+/(?:${segment}/)*${segment}\.rs)\b`,
  "g",
);

function expandBraces(citation) {
  const group = citation.match(/\{([^{}]+)\}/);
  if (!group) return [citation];
  const before = citation.slice(0, group.index);
  const after = citation.slice(group.index + group[0].length);
  return group[1]
    .split(",")
    .flatMap((option) => expandBraces(`${before}${option}${after}`));
}

function extractCitations(text) {
  const citations = [];
  for (const match of text.matchAll(repositoryPath)) {
    citations.push({ cited: match[0], paths: expandBraces(match[0]) });
  }
  for (const match of text.matchAll(cratePath)) {
    citations.push({
      cited: match[0],
      paths: expandBraces(`src-tauri/crates/${match[1]}`),
    });
  }
  return citations;
}

function sourceFiles() {
  const files = [];
  const walk = (relative, extensions) => {
    for (const entry of fs.readdirSync(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name) && !skippedPaths.has(child))
          walk(child, extensions);
      } else if (extensions.some((extension) => entry.name.endsWith(extension)))
        files.push(child);
    }
  };
  for (const { directory, extensions } of scanRoots)
    walk(directory, extensions);
  return files.sort();
}

let scanned;
function scanCitations() {
  if (scanned) return scanned;
  const found = [];
  for (const file of sourceFiles()) {
    const lines = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/);
    lines.forEach((text, index) => {
      for (const citation of extractCitations(text)) {
        for (const cited of citation.paths) {
          found.push({
            file,
            line: index + 1,
            cited,
            exists: fs.existsSync(path.join(root, cited)),
          });
        }
      }
    });
  }
  scanned = found;
  return found;
}

test("citation extraction resolves repository, crate-relative and brace paths", () => {
  const paths = (text) =>
    extractCitations(text).flatMap((entry) => entry.paths);
  assert.deepEqual(
    paths("// Pairs with `src-tauri/crates/sorng-php/src/commands.rs`."),
    ["src-tauri/crates/sorng-php/src/commands.rs"],
  );
  assert.deepEqual(paths("(`sorng-commands-ops/src/ops_handler.rs`)"), [
    "src-tauri/crates/sorng-commands-ops/src/ops_handler.rs",
  ]);
  assert.deepEqual(paths("see crates/sorng-vpn/src/lib.rs:12"), [
    "src-tauri/crates/sorng-vpn/src/lib.rs",
  ]);
  assert.deepEqual(paths("src-tauri/crates/sorng-llm/src/{types,config}.rs"), [
    "src-tauri/crates/sorng-llm/src/types.rs",
    "src-tauri/crates/sorng-llm/src/config.rs",
  ]);
  assert.deepEqual(
    paths(
      "[x](https://github.com/supermarsx/sortOfRemoteNG/blob/main/src-tauri/build.rs)",
    ),
    ["src-tauri/build.rs"],
  );
  for (const unresolvable of [
    "`http_cmds.rs:190`",
    "`src/<module>_commands.rs`",
    "`sorng-<domain>/src/commands.rs`",
    "`src-tauri/src/*_commands.rs`",
    "the crate's `commands.rs`",
  ])
    assert.deepEqual(paths(unresolvable), [], unresolvable);
});

test("every Rust source path cited in src and docs exists", () => {
  const citations = scanCitations();
  assert.ok(citations.length > 0, "no Rust source citations were scanned");
  const stale = citations
    .filter(
      ({ file, cited, exists }) =>
        !exists && !allowedStale.has(`${file}|${cited}`),
    )
    .map(({ file, line, cited }) => `${file}:${line} cites ${cited}`);
  assert.equal(
    stale.length,
    0,
    [
      "Cited Rust paths are missing. Cite the registrar crate and its commands.json, or the domain crate, instead of a moving .rs path:",
      ...stale,
    ].join("\n"),
  );
});

test("allowlisted stale citations are still present and still stale", () => {
  const citations = scanCitations();
  for (const [key, owner] of allowedStale) {
    const [file, cited] = key.split("|");
    const matches = citations.filter(
      (citation) => citation.file === file && citation.cited === cited,
    );
    assert.ok(
      matches.length > 0,
      `${key} (${owner}) is no longer cited; remove it from the allowlist`,
    );
    assert.ok(
      matches.every((citation) => !citation.exists),
      `${key} (${owner}) exists again; remove it from the allowlist`,
    );
  }
});
