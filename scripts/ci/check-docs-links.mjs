#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const docsRoot = path.join(root, "docs");
const navigationPath = path.join(docsRoot, "_data", "navigation.yml");
const siteFlagIndex = process.argv.indexOf("--site");
const builtSiteRoot =
  siteFlagIndex >= 0 && process.argv[siteFlagIndex + 1]
    ? path.resolve(root, process.argv[siteFlagIndex + 1])
    : null;
const ignoredDirectories = new Set([
  ".jekyll-cache",
  "_site",
  "cedar-reference",
  "node_modules",
  "plans",
  "vendor",
]);
const contentExtensions = new Set([".htm", ".html", ".markdown", ".md"]);
const skippedSchemes = /^(?:data|https?|javascript|mailto|tel):/i;

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function normalizeRoute(value) {
  let route = value.trim().replace(/^['"]|['"]$/g, "");
  if (!route.startsWith("/")) route = `/${route}`;
  route = path.posix.normalize(route);
  if (route !== "/" && !path.posix.extname(route) && !route.endsWith("/")) {
    route += "/";
  }
  return route;
}

function parseFrontMatter(source) {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    return { body: source, data: {}, hasFrontMatter: false };
  }

  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { body: source, data: {}, hasFrontMatter: false };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const entry = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (entry) data[entry[1]] = entry[2].replace(/^['"]|['"]$/g, "");
  }
  return { body: source.slice(match[0].length), data, hasFrontMatter: true };
}

function slugify(heading) {
  return heading
    .replace(/\{#[^}]+\}\s*$/, "")
    .replace(/<[^>]*>/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&(?:amp|lt|gt|quot|#39);/g, "")
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

function stripCode(source) {
  return source
    .replace(
      /^(?: {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1\s*$/gm,
      (block) => block.replace(/[^\r\n]/g, ""),
    )
    .replace(/`[^`\n]*`/g, "");
}

function extractAnchors(body) {
  const anchors = new Set();
  const seenSlugs = new Map();
  const withoutFences = body.replace(
    /^(?: {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1\s*$/gm,
    "",
  );

  for (const match of withoutFences.matchAll(
    /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm,
  )) {
    const explicit = match[1].match(/\{#([^}]+)\}\s*$/);
    const base = explicit?.[1] ?? slugify(match[1]);
    if (!base) continue;
    const duplicate = seenSlugs.get(base) ?? 0;
    const anchor = duplicate === 0 ? base : `${base}-${duplicate}`;
    seenSlugs.set(base, duplicate + 1);
    anchors.add(anchor);
  }

  for (const match of withoutFences.matchAll(/\bid=["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }
  return anchors;
}

function lineAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function normalizeLiquidTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1).trim();
  }

  const relativeUrl = target.match(
    /^\{\{\s*['"]([^'"]+)['"]\s*\|\s*relative_url\s*\}\}(.*)$/,
  );
  if (relativeUrl) return `${relativeUrl[1]}${relativeUrl[2]}`;

  const baseUrl = target.match(/^\{\{\s*site\.baseurl\s*\}\}(.*)$/);
  if (baseUrl) return baseUrl[1] || "/";

  if (/\{\{\s*site\.repository_url\s*\}\}/.test(target)) return null;
  if (target.includes("{{") || target.includes("{%")) return null;

  const title = target.match(/^(\S+)(?:\s+["'][\s\S]*["'])$/);
  return title ? title[1] : target;
}

function extractLinks(source) {
  const links = [];
  const searchable = stripCode(source);

  for (const match of searchable.matchAll(/!?\[[^\]]*\]\((.*?)\)/g)) {
    links.push({ target: match[1], line: lineAt(searchable, match.index) });
  }
  for (const match of searchable.matchAll(
    /\b(?:href|src)=["']([^"']+)["']/gi,
  )) {
    links.push({ target: match[1], line: lineAt(searchable, match.index) });
  }
  return links;
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else if (contentExtensions.has(path.extname(entry.name).toLowerCase()))
      files.push(absolute);
  }
  return files;
}

function deriveRoute(file, frontMatter) {
  if (frontMatter.data.permalink)
    return normalizeRoute(frontMatter.data.permalink);
  const relative = toPosix(path.relative(docsRoot, file));
  if (relative.startsWith("_")) return null;
  const extension = path.posix.extname(relative);
  const stem = relative.slice(0, -extension.length);
  if (extension === ".htm" || extension === ".html")
    return normalizeRoute(`/${relative}`);
  if (path.posix.basename(stem) === "index") {
    return normalizeRoute(`/${path.posix.dirname(stem)}/`);
  }
  return normalizeRoute(`/${stem}/`);
}

function resolveRelativeRoute(baseRoute, target) {
  const base = baseRoute.endsWith("/")
    ? baseRoute
    : `${path.posix.dirname(baseRoute)}/`;
  let result = path.posix.resolve(base, target);
  if (target.endsWith("/") && !result.endsWith("/")) result += "/";
  return normalizeRoute(result);
}

const errors = [];
const files = await walk(docsRoot);
const documents = new Map();
const routes = new Map();

for (const file of files) {
  const source = await readFile(file, "utf8");
  const frontMatter = parseFrontMatter(source);
  const route = deriveRoute(file, frontMatter);
  const document = {
    anchors: extractAnchors(frontMatter.body),
    file,
    frontMatter,
    route,
    source,
  };
  documents.set(path.resolve(file), document);

  const relative = toPosix(path.relative(docsRoot, file));
  if (
    !relative.startsWith("_") &&
    path.extname(file).toLowerCase().startsWith(".m")
  ) {
    if (!frontMatter.hasFrontMatter) {
      errors.push(`${relative}:1: published Markdown is missing front matter`);
    }
  }

  if (route) {
    const existing = routes.get(route);
    if (existing) {
      errors.push(
        `${relative}:1: duplicate route ${route} (also ${toPosix(path.relative(docsRoot, existing.file))})`,
      );
    } else {
      routes.set(route, document);
    }
  }
}

function markdownTableRow(source, label) {
  return source.split(/\r?\n/).find((line) => {
    if (!line.startsWith("|")) return false;
    const cells = line.split("|").map((cell) => cell.trim());
    return cells[1]?.toLowerCase() === label.toLowerCase();
  });
}

function projectStatusCell(row) {
  return row?.split("|").map((cell) => cell.trim())[2] ?? "";
}

async function checkProtocolSupportDocumentation() {
  const architecturePath = path.join(root, "architecture.md");
  const protocolsPath = path.join(docsRoot, "protocols.md");
  const availabilityPath = path.join(
    root,
    "src",
    "utils",
    "session",
    "protocolAvailability.ts",
  );
  const portabilityPath = path.join(
    root,
    "src",
    "components",
    "ImportExport",
    "advancedProtocolPortability.ts",
  );
  const rustImporterPath = path.join(
    root,
    "src-tauri",
    "crates",
    "sorng-mremoteng",
    "src",
    "mremoteng",
    "converter.rs",
  );

  const requiredFiles = [
    architecturePath,
    protocolsPath,
    availabilityPath,
    portabilityPath,
    rustImporterPath,
  ];
  const missingFiles = requiredFiles.filter((file) => !existsSync(file));
  if (missingFiles.length > 0) {
    for (const file of missingFiles) {
      errors.push(
        `${toPosix(path.relative(root, file))}:1: protocol support assertion input is missing`,
      );
    }
    return;
  }

  const [architecture, protocols, availability, portability, rustImporter] =
    await Promise.all(requiredFiles.map((file) => readFile(file, "utf8")));

  if (/^\|\s*Telnet\s*\/\s*rlogin\b/im.test(architecture)) {
    errors.push(
      "architecture.md:1: Telnet and RLogin must have separate support rows",
    );
  }

  const architectureStatuses = [
    ["Telnet", "●"],
    ["RLogin", "●"],
    ["Raw Socket", "●"],
    ["PowerShell Remoting", "●"],
    ["Apple Remote Desktop", "●"],
    ["Serial console", "●"],
    ["SFTP", "●"],
    ["VNC", "◐"],
    ["AnyDesk", "◐"],
    ["RustDesk", "◐"],
    ["FTP / FTPS", "●"],
    ["SCP", "●"],
    ["PostgreSQL", "●"],
    ["Spice / NX / x2go / XDMCP", "○"],
  ];
  for (const [label, status] of architectureStatuses) {
    const row = markdownTableRow(architecture, label);
    if (!projectStatusCell(row).startsWith(status)) {
      const line = row ? lineAt(architecture, architecture.indexOf(row)) : 1;
      errors.push(
        `architecture.md:${line}: ${label} must match the current ${status} product boundary`,
      );
    }
  }

  const protocolStatuses = [
    ["Apple Remote Desktop (ARD)", "Interactive client"],
    ["Serial", "Interactive client"],
    ["Telnet", "Interactive client"],
    ["Raw Socket", "Interactive client"],
    ["RLogin", "Interactive client"],
    ["MySQL / MariaDB", "Interactive client"],
    ["SFTP", "Interactive client"],
    ["PowerShell Remoting (`winrm`)", "Interactive client"],
    ["SMB", "Interactive client"],
    ["VNC", "Interactive client, constrained transport"],
    ["AnyDesk", "External handoff"],
    ["RustDesk", "External handoff"],
    ["FTP / FTPS", "Interactive client, direct-route only"],
    ["SCP", "Interactive client, direct-route only"],
    ["PostgreSQL", "Interactive client, direct-route only"],
  ];
  for (const [label, status] of protocolStatuses) {
    const row = markdownTableRow(protocols, label);
    if (projectStatusCell(row) !== status) {
      errors.push(`docs/protocols.md:1: ${label} must be labelled ${status}`);
    }
  }

  const capabilityContracts = [
    ["ard", "fully-interactive"],
    ["serial", "fully-interactive"],
    ["telnet", "fully-interactive"],
    ["raw", "fully-interactive"],
    ["rlogin", "fully-interactive"],
    ["mysql", "fully-interactive"],
    ["sftp", "fully-interactive"],
    ["winrm", "fully-interactive"],
    ["smb", "fully-interactive"],
    ["vnc", "fully-interactive"],
    ["anydesk", "external-native-handoff"],
    ["rustdesk", "external-native-handoff"],
    ["ftp", "fully-interactive"],
    ["scp", "fully-interactive"],
    ["postgresql", "fully-interactive"],
  ];
  for (const [protocol, classification] of capabilityContracts) {
    const marker = `  ${protocol}: capability({`;
    const start = availability.indexOf(marker);
    const end = start < 0 ? -1 : availability.indexOf("\n  }),", start);
    const declaration =
      start < 0 || end < 0 ? "" : availability.slice(start, end);
    if (!declaration.includes(`classification: "${classification}"`)) {
      errors.push(
        `src/utils/session/protocolAvailability.ts:1: ${protocol} must remain ${classification}; review the public protocol docs`,
      );
    }
  }

  const importerMappingsCurrent =
    portability.includes('return { protocol: "raw", rawTransport: "tcp" };') &&
    portability.includes('return { protocol: "raw", rawTransport: "udp" };') &&
    portability.includes('return { protocol: "winrm" };') &&
    portability.includes('return { protocol: "rlogin" };') &&
    rustImporter.includes('MrngProtocol::PowerShell => "winrm"');
  const normalizedProtocols = protocols.replaceAll("`", "").toLowerCase();
  const importerDocsCurrent =
    normalizedProtocols.includes("raw variants map to raw") &&
    normalizedProtocols.includes("rlogin maps to rlogin") &&
    normalizedProtocols.includes("powershell-like entries map to winrm") &&
    normalizedProtocols.includes(
      "legacy postgres alias to canonical postgresql",
    ) &&
    normalizedProtocols.includes(
      "imported ftp remains passive/epsv and direct-route only",
    ) &&
    normalizedProtocols.includes(
      "imported scp retains its explicit host-key policy and direct-route boundary",
    );
  if (!importerMappingsCurrent || !importerDocsCurrent) {
    errors.push(
      "docs/protocols.md:1: importer mappings and runtime boundaries must remain source-backed",
    );
  }

  if (
    !/reachable targets, credentials, local applications, devices, or drivers/i.test(
      protocols,
    )
  ) {
    errors.push(
      "docs/protocols.md:1: environment-dependent live-target limits must remain explicit",
    );
  }
}

await checkProtocolSupportDocumentation();

function checkAnchor(document, fragment, context) {
  if (!fragment) return;
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    errors.push(`${context}: invalid encoded fragment #${fragment}`);
    return;
  }
  if (!document.anchors.has(decoded)) {
    errors.push(
      `${context}: missing anchor #${decoded} on ${document.route ?? "target document"}`,
    );
  }
}

function checkLink(document, link) {
  const relativeSource = toPosix(path.relative(root, document.file));
  const context = `${relativeSource}:${link.line}`;
  const normalized = normalizeLiquidTarget(link.target);
  if (!normalized || !normalized.trim()) return;

  const target = normalized.replace(/&amp;/g, "&").trim();
  if (skippedSchemes.test(target) || target.startsWith("//")) return;

  const hashIndex = target.indexOf("#");
  const fragment = hashIndex >= 0 ? target.slice(hashIndex + 1) : "";
  const withoutHash = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const pathPart = withoutHash.split("?", 1)[0];

  if (!pathPart) {
    checkAnchor(document, fragment, context);
    return;
  }

  if (pathPart.startsWith("/")) {
    const route = normalizeRoute(pathPart);
    const routeTarget = routes.get(route);
    if (routeTarget) {
      checkAnchor(routeTarget, fragment, context);
      return;
    }

    const asset = path.join(docsRoot, pathPart.replace(/^\/+/, ""));
    if (existsSync(asset)) return;
    errors.push(`${context}: unresolved site route or asset ${pathPart}`);
    return;
  }

  const sourceTarget = path.resolve(path.dirname(document.file), pathPart);
  const docsRelative = path.relative(docsRoot, sourceTarget);
  const isInsideDocs =
    docsRelative === "" ||
    (!docsRelative.startsWith("..") && !path.isAbsolute(docsRelative));
  const extension = path.extname(pathPart).toLowerCase();

  if (existsSync(sourceTarget)) {
    if (!isInsideDocs) {
      errors.push(
        `${context}: ${pathPart} escapes the published docs tree; use a repository URL`,
      );
      return;
    }
    if (contentExtensions.has(extension)) {
      const targetDocument = documents.get(path.resolve(sourceTarget));
      if (!targetDocument?.route) {
        errors.push(
          `${context}: ${pathPart} targets an excluded or unpublished document`,
        );
        return;
      }
      checkAnchor(targetDocument, fragment, context);
    }
    return;
  }

  if (!extension || pathPart.endsWith("/")) {
    const resolvedRoute = resolveRelativeRoute(document.route ?? "/", pathPart);
    const routeTarget = routes.get(resolvedRoute);
    if (routeTarget) {
      checkAnchor(routeTarget, fragment, context);
      return;
    }
  }

  errors.push(`${context}: unresolved link ${pathPart}`);
}

let linkCount = 0;
for (const document of documents.values()) {
  for (const link of extractLinks(document.source)) {
    linkCount += 1;
    checkLink(document, link);
  }
}

if (!existsSync(navigationPath)) {
  errors.push("docs/_data/navigation.yml:1: navigation data is missing");
} else {
  const navigation = await readFile(navigationPath, "utf8");
  for (const match of navigation.matchAll(/^\s+url:\s*([^#\s]+)\s*$/gm)) {
    linkCount += 1;
    const route = normalizeRoute(match[1]);
    if (!routes.has(route)) {
      errors.push(
        `docs/_data/navigation.yml:${lineAt(navigation, match.index)}: unresolved navigation route ${route}`,
      );
    }
  }
}

const anchorCount = [...documents.values()].reduce(
  (total, document) => total + document.anchors.size,
  0,
);

let builtFileCount = 0;
let builtLinkCount = 0;
let builtAnchorCount = 0;

if (siteFlagIndex >= 0 && !builtSiteRoot) {
  errors.push("--site requires a generated site directory");
} else if (builtSiteRoot) {
  if (!existsSync(builtSiteRoot)) {
    errors.push(
      `${toPosix(path.relative(root, builtSiteRoot))}: generated site directory is missing`,
    );
  } else {
    const config = await readFile(path.join(docsRoot, "_config.yml"), "utf8");
    const baseUrlMatch = config.match(/^baseurl:\s*([^#\s]+)\s*$/m);
    const baseUrl = (baseUrlMatch?.[1] ?? "")
      .replace(/^['"]|['"]$/g, "")
      .replace(/\/$/, "");

    async function walkBuilt(directory) {
      const output = [];
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) output.push(...(await walkBuilt(absolute)));
        else output.push(absolute);
      }
      return output;
    }

    function builtRoute(file) {
      const relative = toPosix(path.relative(builtSiteRoot, file));
      if (relative === "index.html") return "/";
      if (relative.endsWith("/index.html")) {
        return normalizeRoute(`/${relative.slice(0, -"index.html".length)}`);
      }
      return normalizeRoute(`/${relative}`);
    }

    function resolveBuiltPath(route, target) {
      if (target.startsWith("/")) return normalizeRoute(target);
      const base = route.endsWith("/")
        ? route
        : `${path.posix.dirname(route)}/`;
      let resolved = path.posix.resolve(base, target);
      if (target.endsWith("/") && !resolved.endsWith("/")) resolved += "/";
      return normalizeRoute(resolved);
    }

    function physicalBuiltTarget(route) {
      if (route === "/") return path.join(builtSiteRoot, "index.html");
      const relative = route.replace(/^\/+/, "");
      return route.endsWith("/")
        ? path.join(builtSiteRoot, relative, "index.html")
        : path.join(builtSiteRoot, relative);
    }

    const builtDocuments = new Map();
    for (const file of await walkBuilt(builtSiteRoot)) {
      if (path.extname(file).toLowerCase() !== ".html") continue;
      const source = await readFile(file, "utf8");
      const route = builtRoute(file);
      const anchors = new Set(
        [...source.matchAll(/\bid=["']([^"']+)["']/gi)].map(
          (match) => match[1],
        ),
      );
      builtDocuments.set(route, { anchors, file, route, source });
      builtFileCount += 1;
      builtAnchorCount += anchors.size;
    }

    for (const document of builtDocuments.values()) {
      for (const match of document.source.matchAll(
        /\b(?:href|src)=["']([^"']+)["']/gi,
      )) {
        builtLinkCount += 1;
        const target = match[1].replace(/&amp;/g, "&").trim();
        if (!target || skippedSchemes.test(target) || target.startsWith("//"))
          continue;
        const context = `${toPosix(path.relative(root, document.file))}:${lineAt(document.source, match.index)}`;
        const hashIndex = target.indexOf("#");
        const fragment = hashIndex >= 0 ? target.slice(hashIndex + 1) : "";
        const withoutHash =
          hashIndex >= 0 ? target.slice(0, hashIndex) : target;
        let pathPart = withoutHash.split("?", 1)[0];

        if (!pathPart) {
          if (fragment && !document.anchors.has(decodeURIComponent(fragment))) {
            errors.push(`${context}: missing generated anchor #${fragment}`);
          }
          continue;
        }

        if (pathPart.startsWith("/")) {
          if (
            baseUrl &&
            pathPart !== baseUrl &&
            !pathPart.startsWith(`${baseUrl}/`)
          ) {
            errors.push(
              `${context}: generated link escapes configured baseurl: ${pathPart}`,
            );
            continue;
          }
          pathPart = baseUrl ? pathPart.slice(baseUrl.length) || "/" : pathPart;
        }

        const route = resolveBuiltPath(document.route, pathPart);
        const routeDocument = builtDocuments.get(route);
        if (routeDocument) {
          if (
            fragment &&
            !routeDocument.anchors.has(decodeURIComponent(fragment))
          ) {
            errors.push(
              `${context}: missing generated anchor #${fragment} on ${route}`,
            );
          }
          continue;
        }
        if (!existsSync(physicalBuiltTarget(route))) {
          errors.push(`${context}: unresolved generated link ${target}`);
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error(
    `Documentation validation failed with ${errors.length} error(s):`,
  );
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${documents.size} documentation files, ${linkCount} links, and ${anchorCount} anchors.`,
  );
  if (builtSiteRoot) {
    console.log(
      `Checked ${builtFileCount} generated pages, ${builtLinkCount} links, and ${builtAnchorCount} anchors.`,
    );
  }
}
