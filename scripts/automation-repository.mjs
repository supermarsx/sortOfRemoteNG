#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Local authoring only. Source is read as data; never imported or executed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MAX_SOURCE_BYTES = 65536;
export const MAX_INDEX_BYTES = 2 * 1024 * 1024;
export const PLATFORMS = [
  "windows",
  "linux",
  "macos",
  "agnostic",
  "multiplatform",
  "cisco-ios",
  "arista-eos",
  "hpe-comware",
  "aruba-cx",
  "android",
  "debian",
  "ubuntu",
  "centos",
  "fedora",
  "rhel",
  "rocky-linux",
  "almalinux",
  "opensuse",
  "alpine",
  "arch-linux",
  "freebsd",
  "openbsd",
  "pfsense",
  "opnsense",
  "openwrt",
  "junos",
  "routeros",
  "fortios",
];
const FAMILIES = [
  "terminal-script",
  "terminal-macro",
  "website-script",
  "website-macro",
];
const POSITIONAL =
  /^html > body(?: > [a-z][a-z0-9-]{0,30}:nth-of-type\([1-9][0-9]{0,3}\)){1,24}$/;
const SECRET_PATTERNS = [
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i,
  /PuTTY-User-Key-File-[\s\S]*?Private-Lines:/i,
  /\btskey-(?:auth|client|api)-[A-Za-z0-9_-]+/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=-]{8,}/i,
  /(?:--password|--passphrase|--token|--api-key)(?:=|\s+)(?![$%]|\{\{)[^\s]+/i,
  /\b(?:password|passwd|passphrase|client_secret|api_key)\s*[:=]\s*["'][^"'$%{][^"']{3,}["']/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i,
];
const fail = (message) => {
  throw new Error(`Automation repository: ${message}`);
};
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
function record(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail("Unexpected or invalid descriptor fields.");
  return value;
}
function text(value, max, empty = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    [...value].some(
      (char) =>
        char.charCodeAt(0) === 127 ||
        (char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0))),
    )
  )
    fail("Missing, oversized or invalid text.");
  return value;
}
function date(value) {
  const result = text(value, 40);
  if (!Number.isFinite(Date.parse(result))) fail("Invalid timestamp.");
  return result;
}
function list(value) {
  if (!Array.isArray(value) || value.length > 32)
    fail("Metadata lists are limited to 32 values.");
  const result = value.map((item) => text(item, 128));
  if (new Set(result).size !== result.length)
    fail("Duplicate metadata values.");
  return result;
}
function sourceText(value, empty = false) {
  text(value, MAX_SOURCE_BYTES, empty);
  if (Buffer.byteLength(value, "utf8") > MAX_SOURCE_BYTES)
    fail("Source is limited to 64 KiB UTF-8.");
  if (SECRET_PATTERNS.some((pattern) => pattern.test(value)))
    fail(
      "Source appears to contain literal credentials. Remove them before publishing.",
    );
  return value;
}
function relativeName(value) {
  text(value, 512);
  if (
    !/^[a-zA-Z0-9_./-]+$/.test(value) ||
    path.isAbsolute(value) ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          part.endsWith(".") ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    fail(
      "Use a contained relative path without traversal or special device names.",
    );
  return value;
}
/** Check every existing component, including a symlinked repository root. */
function noLinks(absolute, allowMissing = false) {
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    let info;
    try {
      info = fs.lstatSync(current);
    } catch (error) {
      if (allowMissing && error.code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink())
      fail("Symbolic links and directory junctions are not allowed.");
  }
}
function rootPath(directory) {
  const root = path.resolve(directory);
  noLinks(root);
  if (!fs.statSync(root).isDirectory())
    fail("Repository root must be a directory.");
  return root;
}
function contained(root, name) {
  const target = path.resolve(root, relativeName(name));
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !relative)
    fail("Path must stay inside the repository.");
  return target;
}
function readData(root, name, limit) {
  const target = contained(root, name);
  noLinks(target);
  if (!fs.lstatSync(target).isFile()) fail("Source must be a regular file.");
  const handle = fs.openSync(
    target,
    fs.constants.O_RDONLY |
      (fs.constants.O_NOFOLLOW ?? 0) |
      (fs.constants.O_NONBLOCK ?? 0),
  );
  try {
    const info = fs.fstatSync(handle);
    if (!info.isFile() || info.size > limit)
      fail("Source must be a bounded regular file.");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = fs.readSync(
        handle,
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!read) break;
      length += read;
    }
    if (length > limit) fail("File exceeds its byte limit.");
    noLinks(target);
    return new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, length),
    );
  } finally {
    fs.closeSync(handle);
  }
}
function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail("Descriptor or macro source must be valid JSON.");
  }
}
function steps(value, website) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 200 ||
    Buffer.byteLength(JSON.stringify(value)) > MAX_SOURCE_BYTES
  )
    fail("Macro sources need 1–200 steps within 64 KiB.");
  return value.map((step) => {
    if (website) {
      record(step, ["kind", "selector", "checked"]);
      if (!POSITIONAL.test(text(step.selector, 512)))
        fail(
          "Website steps require bounded structural selectors, never page text or credentials.",
        );
      if (step.kind === "check" && typeof step.checked === "boolean")
        return {
          kind: step.kind,
          selector: step.selector,
          checked: step.checked,
        };
      if (["click", "fill"].includes(step.kind) && step.checked === undefined)
        return { kind: step.kind, selector: step.selector };
      fail("Invalid website step; recorded input values are prohibited.");
    }
    record(step, ["command", "delayMs", "sendNewline"]);
    if (
      !Number.isSafeInteger(step.delayMs) ||
      step.delayMs < 0 ||
      step.delayMs > 3600000 ||
      typeof step.sendNewline !== "boolean"
    )
      fail("Invalid terminal macro delay/newline setting.");
    return {
      command: sourceText(step.command, true),
      delayMs: step.delayMs,
      sendNewline: step.sendNewline,
    };
  });
}

/** Returns the existing portable v1 manifest; authoring descriptors are local only. */
export function buildRepository(directory) {
  const root = rootPath(directory);
  const project = record(
    parseJson(readData(root, "catalog.project.json", MAX_INDEX_BYTES)),
    ["version", "id", "name", "description", "entries"],
  );
  if (
    project.version !== 1 ||
    !Array.isArray(project.entries) ||
    !project.entries.length ||
    project.entries.length > 128
  )
    fail("Project version must be 1 with 1–128 entries.");
  const ids = new Set();
  const entries = project.entries.map((raw) => {
    const item = record(raw, [
      "id",
      "kind",
      "name",
      "description",
      "source",
      "language",
      "category",
      "platforms",
      "tags",
      "createdAt",
      "updatedAt",
    ]);
    if (!FAMILIES.includes(item.kind)) fail("Unknown automation family.");
    const id = text(item.id, 128);
    if (id.startsWith("default-") || ids.has(`${item.kind}:${id}`))
      fail("Use unique publisher IDs, not reserved default-* IDs.");
    ids.add(`${item.kind}:${id}`);
    const metadata = {
      id,
      name: text(item.name, 100),
      description: text(item.description, 1000, true),
      createdAt: date(item.createdAt),
      updatedAt: date(item.updatedAt),
    };
    const platforms = list(item.platforms);
    if (platforms.some((tag) => !PLATFORMS.includes(tag)))
      fail("Unknown platform tag.");
    const tags = item.tags === undefined ? [] : list(item.tags);
    const filename = relativeName(item.source),
      extension = path.extname(filename).toLowerCase();
    const source = readData(root, filename, MAX_SOURCE_BYTES);
    let payload;
    if (item.kind === "terminal-script") {
      const extensions = {
        sh: [".sh"],
        bash: [".sh", ".bash"],
        powershell: [".ps1"],
        batch: [".bat", ".cmd"],
      };
      if (
        !Object.hasOwn(extensions, item.language) ||
        !extensions[item.language].includes(extension)
      )
        fail(
          "Terminal language must match its source extension; no implicit CLI/Bash conversion.",
        );
      payload = {
        ...metadata,
        language: item.language,
        script: sourceText(source),
        category: text(item.category ?? "Custom", 256, true),
        osTags: platforms,
      };
    } else if (item.kind === "website-script") {
      const language =
        extension === ".js"
          ? "javascript"
          : extension === ".ts"
            ? "typescript"
            : null;
      if (
        !language ||
        (item.language !== undefined && item.language !== language) ||
        item.category !== undefined
      )
        fail(
          "Website scripts require matching .js/.ts source and no terminal category.",
        );
      payload = {
        ...metadata,
        kind: "script",
        language,
        code: sourceText(source),
      };
    } else {
      if (extension !== ".json" || item.language !== undefined)
        fail("Macros require native step JSON, not a script language.");
      const website = item.kind === "website-macro";
      if (website && item.category !== undefined)
        fail("Website macros do not have a terminal category.");
      payload = {
        ...metadata,
        ...(website
          ? { kind: "macro" }
          : { category: text(item.category ?? "Custom", 256, true), tags }),
        steps: steps(parseJson(source), website),
      };
    }
    return {
      id,
      kind: item.kind,
      description: metadata.description,
      platforms,
      tags,
      payload,
    };
  });
  const body = json({
    format: "sorng-automation-index",
    version: 1,
    id: text(project.id, 128),
    name: text(project.name, 256),
    description: text(project.description, 4096, true),
    entries,
  });
  if (Buffer.byteLength(body) > MAX_INDEX_BYTES)
    fail("Built manifest exceeds 2 MiB.");
  return body;
}

function writeNew(root, name, content) {
  const target = contained(root, name);
  noLinks(target, true);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  noLinks(path.dirname(target));
  fs.writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
}
export function writeRepositoryIndex(
  directory,
  output = "automation-index.json",
) {
  const root = rootPath(directory);
  const body = buildRepository(root);
  writeNew(root, output, body);
  return body;
}

export function scaffoldRepository(directory, kind = "mixed") {
  if (!["scripts", "macros", "mixed"].includes(kind))
    fail("Kind must be scripts, macros or mixed.");
  const root = path.resolve(directory);
  noLinks(root, true);
  if (
    fs.existsSync(root) &&
    (!fs.statSync(root).isDirectory() || fs.readdirSync(root).length)
  )
    fail(
      "Destination must be new or an empty directory. Nothing was overwritten.",
    );
  fs.mkdirSync(root, { recursive: true });
  rootPath(root);
  const stamp = new Date().toISOString();
  const examples = [
    {
      id: "example-shell",
      kind: "terminal-script",
      name: "Shell example",
      source: "sources/example.sh",
      language: "sh",
      platforms: ["linux", "macos"],
      code: "printf '%s\\n' 'Repository example'\n",
    },
    {
      id: "example-powershell",
      kind: "terminal-script",
      name: "PowerShell example",
      source: "sources/example.ps1",
      language: "powershell",
      platforms: ["windows"],
      code: "Write-Output 'Repository example'\n",
    },
    {
      id: "example-javascript",
      kind: "website-script",
      name: "Page title JavaScript",
      source: "sources/example.js",
      language: "javascript",
      platforms: [],
      code: "console.info(document.title);\n",
    },
    {
      id: "example-typescript",
      kind: "website-script",
      name: "Page title TypeScript",
      source: "sources/example.ts",
      language: "typescript",
      platforms: [],
      code: "const title: string = document.title;\nconsole.info(title);\n",
    },
    {
      id: "example-terminal-macro",
      kind: "terminal-macro",
      name: "Terminal location",
      source: "sources/terminal.steps.json",
      platforms: ["linux", "macos"],
      code: json([{ command: "pwd", delayMs: 0, sendNewline: true }]),
    },
    {
      id: "example-website-macro",
      kind: "website-macro",
      name: "Website field placeholder",
      source: "sources/website.steps.json",
      platforms: [],
      code: json([
        { kind: "fill", selector: "html > body > input:nth-of-type(1)" },
      ]),
    },
  ].filter(
    (item) =>
      kind === "mixed" ||
      item.kind.endsWith(kind === "scripts" ? "-script" : "-macro"),
  );
  const entries = examples.map(({ code, ...item }) => {
    writeNew(root, item.source, code);
    return {
      ...item,
      description:
        "Synthetic example only. Review source and target before manual execution.",
      createdAt: stamp,
      updatedAt: stamp,
    };
  });
  writeNew(
    root,
    "catalog.project.json",
    json({
      version: 1,
      id: "my-automation-catalog",
      name: "My automation catalog",
      description:
        "Unverified publisher content. Import never executes entries.",
      entries,
    }),
  );
  writeNew(
    root,
    "tooling/automation-repository.mjs",
    fs.readFileSync(fileURLToPath(import.meta.url), "utf8"),
  );
  writeNew(root, ".gitignore", ".catalog-build/\n");
  writeNew(
    root,
    ".github/workflows/validate.yml",
    "name: Validate automation catalog\non: [push, pull_request]\npermissions:\n  contents: read\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0\n      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n        with:\n          node-version: '24'\n      - run: node tooling/automation-repository.mjs check .\n      - run: node tooling/automation-repository.mjs build . --out .catalog-build/automation-index.json\n",
  );
  writeNew(
    root,
    "README.md",
    `# Automation repository\n\nThis ${kind} repository contains synthetic authoring examples, not audited or automatically executed automation. Review every source and target before use. No Git repository, network call, install or script execution was performed by scaffolding.\n\n## Author and validate\n\nUse Node.js 24 or later. Edit catalog.project.json metadata and the sources/ files. Keep IDs stable, update updatedAt when changing content, and assign platform tags only after your own review. Website macro JSON contains structural selectors only; fill values are prompted at replay and must never be committed. Record a real public-form layout in the app instead of assuming the placeholder targets your page. TypeScript must be standalone; the app checks supported syntax at explicit execution.\n\n\`\`\`sh\nnode tooling/automation-repository.mjs check .\nnode tooling/automation-repository.mjs build . --out automation-index.json\n\`\`\`\n\nBuild creates a NEW file and refuses to overwrite one. For another revision, choose a new relative output filename, or manually remove an obsolete generated index after reviewing it. Validation is structural and performs conservative credential checks, not a security audit or language execution. CI validates and builds into ignored .catalog-build/ without installing dependencies or running source.\n\n## Publish and import\n\nReview the generated v1 JSON, then upload it yourself to a public Git host. In the app select Browse scripts/macros, the correct family and destination, paste the raw HTTPS JSON link, and Refresh source. Publisher identity is unverified; imports require explicit conflict review. Remote URLs cannot use auth, query strings, custom ports, redirects, or private addresses. Local package import works without public hosting. Do not publish passwords, tokens, private keys, device details or other sensitive values.\n\nLimits: 128 entries; 2 MiB index; 64 KiB UTF-8 per source; 200 macro steps. Sources and output must be regular contained paths, not symlinks. Never convert network device CLI into a Bash script implicitly. The local authoring descriptor is not an import format; only the built sorng-automation-index v1 JSON is imported.\n`,
  );
  buildRepository(root);
  return root;
}

export function main(argv = process.argv.slice(2)) {
  const [command, directory, ...options] = argv;
  if (!directory || !["scaffold", "build", "check"].includes(command))
    fail(
      "Usage: scaffold <new-dir> [--kind scripts|macros|mixed] | check <dir> | build <dir> [--out new-relative.json]",
    );
  const flag =
    command === "scaffold" ? "--kind" : command === "build" ? "--out" : null;
  if (options.length && (options.length !== 2 || options[0] !== flag))
    fail("Unexpected command options.");
  if (command === "scaffold")
    scaffoldRepository(directory, options[1] ?? "mixed");
  else if (command === "build")
    writeRepositoryIndex(directory, options[1] ?? "automation-index.json");
  else buildRepository(directory);
  process.stdout.write(`${command} complete. No automation was executed.\n`);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Repository operation failed."}\n`,
    );
    process.exitCode = 1;
  }
}
