import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Isolated (e2e) builds get their own compiled identifier and a namespaced
// keychain (t91). Profile state must only be reached through the app identity
// (`sorng_core::app_identity`) and the `sorng_vault::keychain` plat_*
// chokepoint. These source scans fail on anything that bypasses them: a
// hard-coded production profile path, a direct OS credential backend call, or
// a redirected WebView2 data folder. Test-only code (`#[cfg(test)]` modules,
// crate `tests/`, `benches/`, `examples/`) is excluded structurally, so test
// fixtures need no allowlist entry.

const repoRoot = process.cwd();
const PRODUCTION_IDENTIFIER = "com.sortofremote.ng";

// ── Rust lexing ─────────────────────────────────────────────────────────────

interface RustLiteral {
  start: number;
  value: string;
}

interface RustViews {
  /** Comments blanked; literals kept. Offsets match the source. */
  code: string;
  /** Comments and literal contents blanked. Offsets match the source. */
  tokens: string;
  literals: RustLiteral[];
}

const blank = (text: string): string =>
  text
    .split("\n")
    .map((line) => " ".repeat(line.length))
    .join("\n");

const isIdentifierUnit = (unit: number): boolean =>
  (unit >= 48 && unit <= 57) ||
  (unit >= 65 && unit <= 90) ||
  (unit >= 97 && unit <= 122) ||
  unit === 95;

const isSpaceUnit = (unit: number): boolean =>
  unit === 32 || unit === 9 || unit === 10 || unit === 13;

function charLiteralEnd(source: string, start: number): number {
  if (source[start + 1] === "\\") {
    const close = source.indexOf("'", start + 3);
    return close === -1 || close - start > 12 ? -1 : close + 1;
  }
  if (source[start + 1] !== "'" && source[start + 2] === "'") {
    return start + 3;
  }
  const high = source.charCodeAt(start + 1);
  if (high >= 0xd800 && high <= 0xdbff && source[start + 3] === "'") {
    return start + 4;
  }
  return -1; // a lifetime or label
}

function lexRust(source: string): RustViews {
  const code: string[] = [];
  const tokens: string[] = [];
  const literals: RustLiteral[] = [];
  let copied = 0;
  const flush = (to: number) => {
    if (to > copied) {
      const run = source.slice(copied, to);
      code.push(run);
      tokens.push(run);
    }
    copied = to;
  };
  const comment = (start: number, end: number) => {
    flush(start);
    const blanked = blank(source.slice(start, end));
    code.push(blanked);
    tokens.push(blanked);
    copied = end;
  };
  const literal = (
    start: number,
    contentStart: number,
    contentEnd: number,
    end: number,
  ) => {
    flush(start);
    code.push(source.slice(start, end));
    tokens.push(
      source.slice(start, contentStart),
      blank(source.slice(contentStart, contentEnd)),
      source.slice(contentEnd, end),
    );
    literals.push({ start, value: source.slice(contentStart, contentEnd) });
    copied = end;
  };

  const interesting = /[/"']/gu;
  let index = 0;
  while (index < source.length) {
    interesting.lastIndex = index;
    const match = interesting.exec(source);
    if (!match) break;
    index = match.index;
    const unit = source[index];
    if (unit === "/") {
      const next = source[index + 1];
      if (next === "/") {
        const newline = source.indexOf("\n", index);
        const end = newline === -1 ? source.length : newline;
        comment(index, end);
        index = end;
      } else if (next === "*") {
        let depth = 1;
        let cursor = index + 2;
        while (cursor < source.length && depth > 0) {
          if (source.startsWith("/*", cursor)) {
            depth += 1;
            cursor += 2;
          } else if (source.startsWith("*/", cursor)) {
            depth -= 1;
            cursor += 2;
          } else {
            cursor += 1;
          }
        }
        comment(index, cursor);
        index = cursor;
      } else {
        index += 1;
      }
      continue;
    }
    if (unit === "'") {
      const end = charLiteralEnd(source, index);
      if (end === -1) {
        index += 1;
      } else {
        literal(index, index + 1, end - 1, end);
        index = end;
      }
      continue;
    }
    // A double quote: raw (`r#"…"#`, `br"…"`, `cr"…"`) or escaped string.
    let hashes = 0;
    while (source[index - hashes - 1] === "#") hashes += 1;
    const prefixEnd = index - hashes;
    let rawStart = -1;
    if (source[prefixEnd - 1] === "r") {
      const beforeR = source.charCodeAt(prefixEnd - 2);
      if (Number.isNaN(beforeR) || !isIdentifierUnit(beforeR)) {
        rawStart = prefixEnd - 1;
      } else if (
        (source[prefixEnd - 2] === "b" || source[prefixEnd - 2] === "c") &&
        !isIdentifierUnit(source.charCodeAt(prefixEnd - 3))
      ) {
        rawStart = prefixEnd - 2;
      }
    }
    if (rawStart !== -1) {
      const terminator = `"${"#".repeat(hashes)}`;
      const close = source.indexOf(terminator, index + 1);
      const contentEnd = close === -1 ? source.length : close;
      const end = close === -1 ? source.length : close + terminator.length;
      literal(rawStart, index + 1, contentEnd, end);
      index = end;
      continue;
    }
    let cursor = index + 1;
    while (cursor < source.length && source[cursor] !== '"') {
      cursor += source[cursor] === "\\" ? 2 : 1;
    }
    const contentEnd = Math.min(cursor, source.length);
    const end = Math.min(cursor + 1, source.length);
    literal(index, index + 1, contentEnd, end);
    index = end;
  }
  flush(source.length);
  return { code: code.join(""), tokens: tokens.join(""), literals };
}

// ── Test-only code ──────────────────────────────────────────────────────────

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text[index];
    if (unit === "(") depth += 1;
    else if (unit === ")") depth -= 1;
    else if (unit === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.filter((part) => part.length > 0);
}

/** Whether a `cfg(...)` predicate can only hold in test builds. */
function cfgRequiresTest(predicate: string): boolean {
  const expression = predicate.replace(/\s+/gu, "");
  if (expression === "test") return true;
  const call = /^(all|any|not)\((.*)\)$/u.exec(expression);
  if (!call) return false;
  const operands = splitTopLevel(call[2]);
  if (call[1] === "all") return operands.some(cfgRequiresTest);
  if (call[1] === "any") {
    return operands.length > 0 && operands.every(cfgRequiresTest);
  }
  return false;
}

const attributeRequiresTest = (attribute: string): boolean => {
  const cfg = /^\s*cfg\s*\(([\s\S]*)\)\s*$/u.exec(attribute);
  return cfg !== null && cfgRequiresTest(cfg[1]);
};

function matchBackward(
  text: string,
  close: number,
  open: string,
  shut: string,
): number {
  let depth = 0;
  for (let index = close; index >= 0; index -= 1) {
    if (text[index] === shut) depth += 1;
    else if (text[index] === open) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function matchForward(
  text: string,
  openIndex: number,
  open: string,
  shut: string,
): number {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === open) depth += 1;
    else if (text[index] === shut) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length - 1;
}

/** Outer attributes (and visibility) directly in front of an item. */
function precedingAttributes(
  views: RustViews,
  itemStart: number,
): { start: number; attributes: string[] } {
  const { tokens, code } = views;
  const attributes: string[] = [];
  let start = itemStart;
  for (;;) {
    let probe = start - 1;
    while (probe >= 0 && isSpaceUnit(tokens.charCodeAt(probe))) probe -= 1;
    if (probe < 0) break;
    if (tokens[probe] === "]") {
      const open = matchBackward(tokens, probe, "[", "]");
      let hash = open - 1;
      while (hash >= 0 && isSpaceUnit(tokens.charCodeAt(hash))) hash -= 1;
      if (open < 0 || tokens[hash] !== "#") break;
      attributes.push(code.slice(open + 1, probe));
      start = hash;
      continue;
    }
    if (tokens[probe] === ")") {
      const open = matchBackward(tokens, probe, "(", ")");
      const from = Math.max(open - 16, 0);
      const visibility =
        open < 0 ? null : /\bpub\s*$/u.exec(tokens.slice(from, open));
      if (!visibility) break;
      start = from + visibility.index;
      continue;
    }
    if (
      probe >= 2 &&
      tokens.slice(probe - 2, probe + 1) === "pub" &&
      !isIdentifierUnit(tokens.charCodeAt(probe - 3))
    ) {
      start = probe - 2;
      continue;
    }
    break;
  }
  return { start, attributes };
}

interface ModuleDeclaration {
  from: string;
  candidates: string[];
  testOnly: boolean;
}

interface PreparedFile {
  views: RustViews;
  wholeFileTestOnly: boolean;
  declarations: ModuleDeclaration[];
}

const MOD_RS_NAMES = new Set(["mod.rs", "lib.rs", "main.rs", "build.rs"]);

function childModuleCandidates(
  file: string,
  name: string,
  inlinePath: string[],
  pathAttribute: string | undefined,
): string[] {
  const directory = posix.dirname(file);
  const base = posix.basename(file);
  const modRs = MOD_RS_NAMES.has(base) || posix.basename(directory) === "bin";
  const ownDirectory = modRs
    ? directory
    : posix.join(directory, base.slice(0, -".rs".length));
  if (pathAttribute !== undefined) {
    const root =
      inlinePath.length === 0
        ? directory
        : posix.join(ownDirectory, ...inlinePath);
    return [posix.join(root, pathAttribute.replace(/\\\\?/gu, "/"))];
  }
  const moduleDirectory = posix.join(ownDirectory, ...inlinePath);
  return [
    posix.join(moduleDirectory, `${name}.rs`),
    posix.join(moduleDirectory, name, "mod.rs"),
  ];
}

/** Lex a file, blank its test-only modules and list its `mod x;` children. */
function prepareFile(path: string, source: string): PreparedFile {
  const lexed = lexRust(source);
  const stripped: Array<[number, number]> = [];
  const inlineModules: Array<{ name: string; open: number; close: number }> =
    [];
  const pending: Array<{
    name: string;
    offset: number;
    testOnly: boolean;
    pathAttribute: string | undefined;
  }> = [];

  const declaration = /\bmod\s+([A-Za-z_][A-Za-z0-9_]*)\s*([;{])/gu;
  for (const match of lexed.tokens.matchAll(declaration)) {
    const offset = match.index ?? 0;
    if (isIdentifierUnit(lexed.tokens.charCodeAt(offset - 1))) continue;
    const { start, attributes } = precedingAttributes(lexed, offset);
    const testOnly = attributes.some(attributeRequiresTest);
    if (match[2] === "{") {
      const open = offset + match[0].length - 1;
      const close = matchForward(lexed.tokens, open, "{", "}");
      inlineModules.push({ name: match[1], open, close });
      if (testOnly) stripped.push([start, close + 1]);
    } else {
      const pathAttribute = attributes
        .map((attribute) =>
          /^\s*path\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/u.exec(attribute),
        )
        .find((found) => found !== null)?.[1];
      pending.push({ name: match[1], offset, testOnly, pathAttribute });
    }
  }

  let wholeFileTestOnly = false;
  for (const match of lexed.tokens.matchAll(/#\s*!\s*\[\s*cfg\s*\(/gu)) {
    const offset = match.index ?? 0;
    const insideInline = inlineModules.some(
      (declared) => declared.open < offset && offset < declared.close,
    );
    const open = offset + match[0].length - 1;
    const close = matchForward(lexed.tokens, open, "(", ")");
    if (!insideInline && cfgRequiresTest(lexed.tokens.slice(open + 1, close))) {
      wholeFileTestOnly = true;
    }
  }

  const within = (offset: number) =>
    stripped.some(([start, end]) => start <= offset && offset < end);
  const declarations = pending.map((declared) => ({
    from: path,
    candidates: childModuleCandidates(
      path,
      declared.name,
      inlineModules
        .filter(
          (inline) =>
            inline.open < declared.offset && declared.offset < inline.close,
        )
        .sort((left, right) => left.open - right.open)
        .map((inline) => inline.name),
      declared.pathAttribute,
    ),
    testOnly: declared.testOnly || within(declared.offset),
  }));

  let { code, tokens } = lexed;
  for (const [start, end] of stripped) {
    code =
      code.slice(0, start) + blank(code.slice(start, end)) + code.slice(end);
    tokens =
      tokens.slice(0, start) +
      blank(tokens.slice(start, end)) +
      tokens.slice(end);
  }
  const literals = lexed.literals.filter((literal) => !within(literal.start));
  return {
    views: { code, tokens, literals },
    wholeFileTestOnly,
    declarations,
  };
}

// ── Rules ───────────────────────────────────────────────────────────────────

interface RustRule {
  id: string;
  summary: string;
  offsets(views: RustViews): number[];
  /** Exact file or directory prefix (ending in `/`) with the reason it may match. */
  allowed: Array<{ path: string; reason: string }>;
}

const regexOffsets = (text: string, pattern: RegExp): number[] =>
  Array.from(
    text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`)),
    (match) => match.index ?? 0,
  );

const literalOffsets = (
  literals: RustLiteral[],
  predicate: (value: string) => boolean,
): number[] =>
  literals.filter((literal) => predicate(literal.value)).map((l) => l.start);

const RULES: RustRule[] = [
  {
    id: "production-profile-path",
    summary:
      'builds a path from the production identifier (`join("com.sortofremote.ng")`); resolve it with sorng_core::app_identity::current_identifier()',
    offsets: ({ code, literals }) => [
      ...regexOffsets(
        code,
        /\b(?:join|push)\s*\(\s*(?:[bc]?r#*)?"com\.sortofremote\.ng"/u,
      ),
      ...literalOffsets(literals, (value) =>
        /(?:^|[\\/])com\.sortofremote\.ng[\\/]|[\\/]com\.sortofremote\.ng$/u.test(
          value,
        ),
      ),
    ],
    // No exceptions: production keeps its path through current_identifier().
    allowed: [],
  },
  {
    id: "production-identifier-literal",
    summary:
      "spells the production identifier; use sorng_core::app_identity::PRODUCTION_IDENTIFIER or current_identifier()",
    offsets: ({ literals }) =>
      literalOffsets(literals, (value) => value === PRODUCTION_IDENTIFIER),
    allowed: [
      {
        path: "src-tauri/crates/sorng-core/src/app_identity.rs",
        reason: "defines PRODUCTION_IDENTIFIER, the single source of truth",
      },
      {
        path: "src-tauri/crates/sorng-vault/src/keychain.rs",
        reason:
          "vault-local copy that refuses to namespace production (sorng-vault does not depend on sorng-core)",
      },
      {
        path: "src-tauri/crates/sorng-about/src/service.rs",
        reason: "display-only About metadata; never resolves a path",
      },
    ],
  },
  {
    id: "keychain-backend-bypass",
    summary:
      "reaches the Windows vault backend outside the namespaced sorng_vault::keychain plat_* chokepoint",
    offsets: ({ tokens }) => regexOffsets(tokens, /\bsorng_vault_windows\b/u),
    allowed: [
      {
        path: "src-tauri/crates/sorng-vault/src/keychain.rs",
        reason: "plat_* apply physical_service() before every backend call",
      },
    ],
  },
  {
    id: "windows-credential-api",
    summary:
      "calls Windows Credential Manager / DPAPI directly instead of going through sorng_vault::keychain",
    offsets: ({ tokens }) =>
      regexOffsets(
        tokens,
        /\b(?:CredWriteW|CredReadW|CredDeleteW|CredEnumerateW|CryptProtectData|CryptUnprotectData)\b/u,
      ),
    allowed: [
      {
        path: "src-tauri/crates/sorng-vault-windows/",
        reason:
          "the Windows leaf backend, reached only from sorng_vault::keychain",
      },
    ],
  },
  {
    id: "macos-keychain-api",
    summary:
      "uses security_framework keychain passwords outside the vault and biometrics macOS backends",
    offsets: ({ tokens }) =>
      regexOffsets(
        tokens,
        /\bsecurity_framework\s*::\s*(?:passwords\b|\{[^}]*\bpasswords\b)|\b(?:set|get|delete)_generic_password\b/u,
      ),
    allowed: [
      {
        path: "src-tauri/crates/sorng-vault/src/platform/macos.rs",
        reason:
          "the macOS vault backend, reached only from sorng_vault::keychain",
      },
      {
        path: "src-tauri/crates/sorng-biometrics/src/platform/macos/",
        reason:
          "Secure Enclave / biometric keychain items (not on the vault DEK path)",
      },
    ],
  },
  {
    id: "webview2-user-data-folder",
    summary:
      "redirects the WebView2 user data folder outside app_profile.rs, bypassing the per-run folder guard",
    offsets: ({ tokens, literals }) => [
      ...literalOffsets(
        literals,
        (value) => value.trim() === "WEBVIEW2_USER_DATA_FOLDER",
      ),
      ...regexOffsets(tokens, /\.\s*data_directory\s*\(/u),
    ],
    allowed: [
      {
        path: "src-tauri/src/app_profile.rs",
        reason:
          "the only place that validates and sets the per-run WebView2 folder",
      },
    ],
  },
  {
    id: "app-profile-shared",
    summary:
      "path-includes app_profile.rs into another crate; the app crate must own the process profile",
    offsets: ({ literals }) =>
      literalOffsets(literals, (value) =>
        /(?:^|[\\/])app_profile\.rs$/u.test(value),
      ),
    allowed: [],
  },
];

// ── Scanning ────────────────────────────────────────────────────────────────

interface Finding {
  rule: string;
  file: string;
  line: number;
  excerpt: string;
}

interface ScanResult {
  scanned: number;
  testOnlyFiles: Set<string>;
  findings: Finding[];
}

const INTEGRATION_TARGET_DIRECTORY =
  /^src-tauri\/crates\/[^/]+\/(?:tests|benches|examples)\//u;

function scanRustSources(
  paths: readonly string[],
  read: (path: string) => string,
): ScanResult {
  const known = new Set(paths);
  const findings: Finding[] = [];
  const declarations: ModuleDeclaration[] = [];
  const wholeFileTestOnly = new Set<string>();
  let scanned = 0;

  for (const path of paths) {
    if (INTEGRATION_TARGET_DIRECTORY.test(path)) continue;
    scanned += 1;
    const source = read(path);
    const prepared = prepareFile(path, source);
    declarations.push(...prepared.declarations);
    if (prepared.wholeFileTestOnly) wholeFileTestOnly.add(path);
    let lineStarts: number[] | undefined;
    for (const rule of RULES) {
      for (const offset of new Set(rule.offsets(prepared.views))) {
        lineStarts ??= [
          0,
          ...Array.from(source.matchAll(/\n/gu), (m) => (m.index ?? 0) + 1),
        ];
        const line = lineStarts.filter((start) => start <= offset).length;
        const excerpt = source
          .slice(lineStarts[line - 1], lineStarts[line] ?? source.length)
          .trim()
          .slice(0, 160);
        findings.push({ rule: rule.id, file: path, line, excerpt });
      }
    }
  }

  // Out-of-line `#[cfg(test)] mod x;` files (and their children) are test-only
  // unless some production module declaration also loads them.
  let testOnlyFiles = new Set(wholeFileTestOnly);
  for (;;) {
    const testDeclared = new Set<string>();
    const productionDeclared = new Set<string>();
    for (const declared of declarations) {
      const target = declared.candidates.find((candidate) =>
        known.has(candidate),
      );
      if (target === undefined) continue;
      if (declared.testOnly || testOnlyFiles.has(declared.from)) {
        testDeclared.add(target);
      } else {
        productionDeclared.add(target);
      }
    }
    const next = new Set(wholeFileTestOnly);
    for (const file of testDeclared) {
      if (!productionDeclared.has(file)) next.add(file);
    }
    if (next.size === testOnlyFiles.size) break;
    testOnlyFiles = next;
  }

  return {
    scanned,
    testOnlyFiles,
    findings: findings.filter((finding) => !testOnlyFiles.has(finding.file)),
  };
}

const isAllowed = (rule: RustRule, file: string) =>
  rule.allowed.find((entry) =>
    entry.path.endsWith("/")
      ? file.startsWith(entry.path)
      : file === entry.path,
  );

function listRustSources(): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "target" || entry.name === "node_modules") continue;
        if (entry.name.startsWith(".")) continue;
        walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".rs")) {
        files.push(relative(repoRoot, absolute).split(sep).join("/"));
      }
    }
  };
  walk(join(repoRoot, "src-tauri", "src"));
  walk(join(repoRoot, "src-tauri", "crates"));
  return files.sort();
}

// ── lib.rs ordering contract ────────────────────────────────────────────────

function blockBody(
  tokens: string,
  openBrace: number,
): { start: number; end: number } {
  return {
    start: openBrace + 1,
    end: matchForward(tokens, openBrace, "{", "}"),
  };
}

/**
 * Statements of a block with whitespace removed, split at top-level `;` and
 * skipping `use` items.
 */
function statements(tokens: string, start: number, end: number): string[] {
  const found: string[] = [];
  let depth = 0;
  let from = start;
  for (let index = start; index < end; index += 1) {
    const unit = tokens[index];
    if (unit === "(" || unit === "[" || unit === "{") depth += 1;
    else if (unit === ")" || unit === "]" || unit === "}") depth -= 1;
    else if (unit === ";" && depth === 0) {
      found.push(tokens.slice(from, index));
      from = index + 1;
    }
  }
  return found
    .filter(
      (statement) => !/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s/u.test(statement),
    )
    .map((statement) => statement.replace(/\s+/gu, ""));
}

function runOrderingProblems(source: string): string[] {
  const { tokens } = lexRust(source);
  const problems: string[] = [];
  const runs = Array.from(tokens.matchAll(/\bpub\s+fn\s+run\s*\(\s*\)\s*\{/gu));
  if (runs.length !== 1) {
    return [`expected exactly one \`pub fn run()\`, found ${runs.length}`];
  }
  const run = blockBody(tokens, (runs[0].index ?? 0) + runs[0][0].length - 1);
  const body = tokens.slice(run.start, run.end);
  const first = statements(tokens, run.start, run.end)[0] ?? "";
  if (
    !/(?:^|[=:])(?:app_profile::)?install_process_profile\(\)$/u.test(first)
  ) {
    problems.push(
      `the first statement of run() must call install_process_profile(), found \`${first.slice(0, 80)}\``,
    );
  }
  const installs = regexOffsets(body, /\binstall_process_profile\s*\(\s*\)/u);
  if (installs.length !== 1) {
    problems.push(
      `run() must call install_process_profile() exactly once, found ${installs.length}`,
    );
  }
  for (const [label, pattern] of [
    ["init_tracing()", /\binit_tracing\s*\(\s*\)/u],
    [
      "tauri::Builder::default()",
      /\btauri\s*::\s*Builder\s*::\s*default\s*\(/u,
    ],
    ["the rustls crypto provider", /\brustls\s*::\s*crypto\b/u],
  ] as const) {
    const at = regexOffsets(body, pattern)[0];
    if (at === undefined) {
      problems.push(`run() no longer calls ${label}; update this contract`);
    } else if (installs[0] === undefined || installs[0] > at) {
      problems.push(`install_process_profile() must run before ${label}`);
    }
  }

  const setups = Array.from(body.matchAll(/\.\s*setup\s*\(/gu));
  if (setups.length !== 1) {
    problems.push(
      `run() must register exactly one .setup() hook (a later one replaces the guard), found ${setups.length}`,
    );
    return problems;
  }
  const afterSetup = run.start + (setups[0].index ?? 0) + setups[0][0].length;
  const closure = /^\s*(?:move\s*)?\|\s*app\s*\|\s*\{/u.exec(
    tokens.slice(afterSetup),
  );
  if (!closure) {
    problems.push("the .setup() hook must be a `|app| { … }` closure");
    return problems;
  }
  const setup = blockBody(tokens, afterSetup + closure[0].length - 1);
  const setupFirst = statements(tokens, setup.start, setup.end)[0] ?? "";
  if (!/^(?:app_profile::)?verify_runtime\(app\)\?$/u.test(setupFirst)) {
    problems.push(
      `the first setup statement must be \`app_profile::verify_runtime(app)?\`, found \`${setupFirst.slice(0, 80)}\``,
    );
  }
  return problems;
}

// ── Tests ───────────────────────────────────────────────────────────────────

const formatFinding = (finding: Finding) => {
  const rule = RULES.find((candidate) => candidate.id === finding.rule);
  return `${finding.file}:${finding.line} [${finding.rule}] ${rule?.summary ?? ""}\n    ${finding.excerpt}`;
};

const scanFixture = (files: Record<string, string>) =>
  scanRustSources(Object.keys(files), (path) => files[path]);

const ruleLines = (findings: Finding[]) =>
  findings
    .map((finding) => [finding.rule, finding.line] as const)
    .sort(
      ([leftRule, leftLine], [rightRule, rightLine]) =>
        leftLine - rightLine || leftRule.localeCompare(rightRule),
    );

describe("profile state resolution source scan", () => {
  const result = scanRustSources(listRustSources(), (path) =>
    readFileSync(join(repoRoot, path), "utf8"),
  );

  it("scans the Rust workspace sources", () => {
    expect(result.scanned).toBeGreaterThan(1000);
    expect(result.testOnlyFiles.size).toBeGreaterThan(0);
  });

  it("never resolves profile state or secrets around the app identity and keychain chokepoint", () => {
    const violations = result.findings
      .filter((finding) => {
        const rule = RULES.find((candidate) => candidate.id === finding.rule);
        return rule === undefined || !isAllowed(rule, finding.file);
      })
      .map(formatFinding);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("would flag the pre-isolation print-jobs spool path in the real rdpdr module", () => {
    const rdpdr = "src-tauri/crates/sorng-rdp/src/rdp/rdpdr/mod.rs";
    const legacy = [
      "fn legacy_print_jobs_dir() -> PathBuf {",
      "    dirs::data_dir()",
      '        .unwrap_or_else(|| PathBuf::from("."))',
      '        .join("com.sortofremote.ng")',
      '        .join("print-jobs")',
      "}",
    ].join("\n");
    const source = readFileSync(join(repoRoot, rdpdr), "utf8");
    const mutated = scanRustSources(
      [rdpdr],
      () => `${source}\n${legacy}\n`,
    ).findings.map((finding) => [finding.rule, finding.excerpt]);
    expect(mutated).toEqual([
      ["production-profile-path", '.join("com.sortofremote.ng")'],
      ["production-identifier-literal", '.join("com.sortofremote.ng")'],
    ]);
  });

  it("keeps every allowlist entry in use", () => {
    const stale = RULES.flatMap((rule) =>
      rule.allowed
        .filter(
          (entry) =>
            !result.findings.some(
              (finding) =>
                finding.rule === rule.id &&
                isAllowed({ ...rule, allowed: [entry] }, finding.file),
            ),
        )
        .map((entry) => `[${rule.id}] ${entry.path}: ${entry.reason}`),
    );
    expect(
      stale,
      `remove stale allowlist entries:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("installs the process profile first and verifies it first in setup (src-tauri/src/lib.rs)", () => {
    const problems = runOrderingProblems(
      readFileSync(join(repoRoot, "src-tauri", "src", "lib.rs"), "utf8"),
    );
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

describe("profile state resolution scanner", () => {
  const violation = 'let dir = base.join("com.sortofremote.ng");';

  it("flags production code but not comments, literals or test-only modules", () => {
    const { findings } = scanFixture({
      "src-tauri/crates/demo/src/lib.rs": [
        '// base.join("com.sortofremote.ng")',
        "/* outer /* nested */ sorng_vault_windows::read_secret */",
        "/// CredWriteW in a doc comment",
        'const MESSAGE: &str = "CredReadW and sorng_vault_windows:: are only words here";',
        "#[cfg(test)]",
        "mod tests {",
        '    fn fixture() { base.join("com.sortofremote.ng"); }',
        "}",
        "#[cfg(all(test, windows))]",
        "pub(crate) mod windows_tests { fn f() { CredDeleteW(); } }",
        '#[cfg(any(test, feature = "x"))]',
        "mod maybe_production { fn f() { CryptProtectData(); } }",
        "#[cfg(not(test))]",
        "mod production { fn f() { sorng_vault_windows::store_secret(); } }",
        `fn run() { ${violation} }`,
      ].join("\n"),
    });
    expect(ruleLines(findings)).toEqual([
      ["windows-credential-api", 12],
      ["keychain-backend-bypass", 14],
      ["production-identifier-literal", 15],
      ["production-profile-path", 15],
    ]);
  });

  it("keeps lexing through raw strings, char literals and lifetimes", () => {
    const { findings } = scanFixture({
      "src-tauri/src/lib.rs": [
        "fn quote<'a>(value: &'a str) -> char { let _ = r#\"a \" // not a comment\"#; '\"' }",
        "fn escaped() -> [char; 3] { ['\\'', '\\\\', '\\u{1F600}'] }",
        'fn bytes() -> &\'static [u8] { br##"/* "# "## }',
        `fn run() { ${violation} }`,
        'fn spooled() -> &\'static str { "C:\\\\Users\\\\x\\\\com.sortofremote.ng\\\\print-jobs" }',
      ].join("\n"),
    });
    expect(ruleLines(findings)).toEqual([
      ["production-identifier-literal", 4],
      ["production-profile-path", 4],
      ["production-profile-path", 5],
    ]);
  });

  it("excludes out-of-line test modules, their children and crate test targets", () => {
    const leak = "pub fn leak() { sorng_vault_windows::read_secret(); }";
    const { findings, testOnlyFiles } = scanFixture({
      "src-tauri/crates/demo/src/lib.rs": [
        "mod service;",
        "#[cfg(test)]",
        "mod lib_tests;",
        "#[cfg(test)]",
        '#[path = "../fixtures/shared_tests.rs"]',
        "mod shared;",
        "mod nested {",
        '    #[cfg(all(test, feature = "x"))]',
        "    mod deep;",
        "}",
      ].join("\n"),
      "src-tauri/crates/demo/src/service.rs": [
        "#[cfg(test)]",
        "mod helpers;",
        "mod production_child;",
      ].join("\n"),
      "src-tauri/crates/demo/src/service/helpers.rs": `mod more;\n${leak}`,
      "src-tauri/crates/demo/src/service/helpers/more.rs": leak,
      "src-tauri/crates/demo/src/service/production_child.rs": leak,
      "src-tauri/crates/demo/src/lib_tests/mod.rs": leak,
      "src-tauri/crates/demo/fixtures/shared_tests.rs": leak,
      "src-tauri/crates/demo/src/nested/deep.rs": leak,
      "src-tauri/crates/demo/src/whole.rs": `#![cfg(test)]\n${leak}`,
      "src-tauri/crates/demo/tests/integration.rs": leak,
    });
    expect([...testOnlyFiles].sort()).toEqual([
      "src-tauri/crates/demo/fixtures/shared_tests.rs",
      "src-tauri/crates/demo/src/lib_tests/mod.rs",
      "src-tauri/crates/demo/src/nested/deep.rs",
      "src-tauri/crates/demo/src/service/helpers.rs",
      "src-tauri/crates/demo/src/service/helpers/more.rs",
      "src-tauri/crates/demo/src/whole.rs",
    ]);
    expect(findings.map((finding) => finding.file)).toEqual([
      "src-tauri/crates/demo/src/service/production_child.rs",
    ]);
  });

  it("detects every rule outside its allowlist", () => {
    const { findings } = scanFixture({
      "src-tauri/crates/demo/src/lib.rs": [
        'fn a() { dirs::data_dir().unwrap().push("com.sortofremote.ng"); }',
        'const ID: &str = "com.sortofremote.ng";',
        "use sorng_vault_windows as backend;",
        "fn b() { unsafe { CredEnumerateW(None, 0, &mut 0, &mut ptr) }; }",
        "use security_framework::{item, passwords};",
        'fn c() { set_generic_password("s", "a", b"x"); }',
        'fn d() { std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", "x"); }',
        "fn e() { builder.data_directory(path); }",
        '#[path = "../../../src/app_profile.rs"]',
        "mod app_profile;",
      ].join("\n"),
    });
    const byRule = new Map<string, number[]>();
    for (const finding of findings) {
      byRule.set(finding.rule, [
        ...(byRule.get(finding.rule) ?? []),
        finding.line,
      ]);
    }
    expect(Object.fromEntries(byRule)).toEqual({
      "production-profile-path": [1],
      "production-identifier-literal": [1, 2],
      "keychain-backend-bypass": [3],
      "windows-credential-api": [4],
      "macos-keychain-api": [5, 6],
      "webview2-user-data-folder": [7, 8],
      "app-profile-shared": [9],
    });
    for (const rule of RULES) {
      expect(
        isAllowed(rule, "src-tauri/crates/demo/src/lib.rs"),
      ).toBeUndefined();
    }
  });

  it("allows exact files and directory prefixes only", () => {
    const credentials = RULES.find(
      (rule) => rule.id === "windows-credential-api",
    )!;
    expect(
      isAllowed(credentials, "src-tauri/crates/sorng-vault-windows/src/lib.rs"),
    ).toBeDefined();
    expect(
      isAllowed(
        credentials,
        "src-tauri/crates/sorng-vault-windows-extra/src/lib.rs",
      ),
    ).toBeUndefined();
    const keychain = RULES.find(
      (rule) => rule.id === "keychain-backend-bypass",
    )!;
    expect(
      isAllowed(keychain, "src-tauri/crates/sorng-vault/src/keychain.rs"),
    ).toBeDefined();
    expect(
      isAllowed(keychain, "src-tauri/crates/sorng-vault/src/commands.rs"),
    ).toBeUndefined();
  });
});

describe("lib.rs ordering contract checker", () => {
  const entry = (runBody: string) =>
    [
      "fn init_tracing() {}",
      "#[cfg_attr(mobile, tauri::mobile_entry_point)]",
      "pub fn run() {",
      runBody,
      "}",
    ].join("\n");
  const builder = (setupBody: string) =>
    [
      "    init_tracing();",
      '    rustls::crypto::ring::default_provider().install_default().expect("x");',
      "    let app = tauri::Builder::default()",
      "        .plugin(app_profile::autostart_plugin(&profile))",
      "        .setup(|app| {",
      setupBody,
      "            Ok(())",
      "        })",
      "        .build(tauri::generate_context!())",
      '        .expect("error while building tauri application");',
    ].join("\n");
  const guardedSetup = [
    "            app_profile::verify_runtime(app)?;",
    "            web_network_guard::install(app);",
    "            state_registry::register(app)?;",
  ].join("\n");

  it("accepts the guarded entry point", () => {
    expect(
      runOrderingProblems(
        entry(
          [
            "    // Must be first: everything below reads the installed identity.",
            "    let profile = app_profile::install_process_profile();",
            builder(guardedSetup),
          ].join("\n"),
        ),
      ),
    ).toEqual([]);
  });

  it("rejects an unguarded entry point", () => {
    expect(
      runOrderingProblems(
        entry(builder("            state_registry::register(app)?;")),
      ),
    ).toEqual([
      "the first statement of run() must call install_process_profile(), found `init_tracing()`",
      "run() must call install_process_profile() exactly once, found 0",
      "install_process_profile() must run before init_tracing()",
      "install_process_profile() must run before tauri::Builder::default()",
      "install_process_profile() must run before the rustls crypto provider",
      "the first setup statement must be `app_profile::verify_runtime(app)?`, found `state_registry::register(app)?`",
    ]);
  });

  it("rejects a late profile install, a late runtime check and a second setup hook", () => {
    const late = entry(
      [
        builder(
          [
            "            web_network_guard::install(app);",
            "            app_profile::verify_runtime(app)?;",
          ].join("\n"),
        ),
        "    let profile = app_profile::install_process_profile();",
      ].join("\n"),
    );
    expect(runOrderingProblems(late)).toEqual([
      "the first statement of run() must call install_process_profile(), found `init_tracing()`",
      "install_process_profile() must run before init_tracing()",
      "install_process_profile() must run before tauri::Builder::default()",
      "install_process_profile() must run before the rustls crypto provider",
      "the first setup statement must be `app_profile::verify_runtime(app)?`, found `web_network_guard::install(app)`",
    ]);

    const twoHooks = entry(
      [
        "    let profile = app_profile::install_process_profile();",
        builder(guardedSetup).replace(
          ".build(",
          ".setup(|app| { Ok(()) })\n        .build(",
        ),
      ].join("\n"),
    );
    expect(runOrderingProblems(twoHooks)).toEqual([
      "run() must register exactly one .setup() hook (a later one replaces the guard), found 2",
    ]);
  });
});
