import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Isolated (e2e) profiles must never read or write the user's real ~/.ssh
// (t91). SSH, SFTP and SCP reach their default known_hosts file and default
// private keys only through `sorng_core::ssh_home::home_dir(dirs::home_dir)`,
// which forwards the OS home in production and fails closed in an isolated
// profile that has no installed SSH home. These source scans fail on any
// in-process home resolution that bypasses it. Test-only code (`#[cfg(test)]`
// items, crate `tests/`) is stripped first, so fixtures need no allowlist.

const repoRoot = process.cwd();
const tauriRoot = join(repoRoot, "src-tauri");

// ── Rust lexing ─────────────────────────────────────────────────────────────

interface RustLiteral {
  start: number;
  kind: "char" | "string";
  /** Source text between the quotes; escapes are not processed. */
  value: string;
}

interface RustSource {
  path: string;
  /** Comments blanked; literals kept. Offsets match the original source. */
  code: string;
  /** Comments and literal contents blanked. Offsets match the source. */
  tokens: string;
  literals: RustLiteral[];
}

// Blank per UTF-16 code unit so offsets never shift.
const blank = (text: string): string => text.replace(/[^\n]/g, " ");

const isIdentifierChar = (char: string | undefined): boolean =>
  char !== undefined && /[A-Za-z0-9_]/.test(char);

function charLiteralEnd(source: string, start: number): number {
  if (source[start + 1] === "\\") {
    const close = source.indexOf("'", start + 3);
    return close === -1 || close - start > 12 ? -1 : close + 1;
  }
  if (
    source[start + 1] !== undefined &&
    source[start + 1] !== "'" &&
    source[start + 2] === "'"
  ) {
    return start + 3;
  }
  const high = source.charCodeAt(start + 1);
  if (high >= 0xd800 && high <= 0xdbff && source[start + 3] === "'") {
    return start + 4;
  }
  return -1; // a lifetime or a label
}

function lexRust(
  path: string,
  source: string,
): Omit<RustSource, "literals"> & { literals: RustLiteral[] } {
  const code: string[] = [];
  const tokens: string[] = [];
  const literals: RustLiteral[] = [];
  let copied = 0;
  const copyTo = (to: number) => {
    if (to > copied) {
      const run = source.slice(copied, to);
      code.push(run);
      tokens.push(run);
    }
    copied = to;
  };
  const comment = (start: number, end: number) => {
    copyTo(start);
    const blanked = blank(source.slice(start, end));
    code.push(blanked);
    tokens.push(blanked);
    copied = end;
  };
  const literal = (
    kind: RustLiteral["kind"],
    start: number,
    contentStart: number,
    contentEnd: number,
    end: number,
  ) => {
    copyTo(start);
    code.push(source.slice(start, end));
    tokens.push(
      source.slice(start, contentStart),
      blank(source.slice(contentStart, contentEnd)),
      source.slice(contentEnd, end),
    );
    literals.push({
      start,
      kind,
      value: source.slice(contentStart, contentEnd),
    });
    copied = end;
  };

  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "/" && source[index + 1] === "/") {
      const newline = source.indexOf("\n", index);
      const end = newline === -1 ? source.length : newline;
      comment(index, end);
      index = end;
    } else if (char === "/" && source[index + 1] === "*") {
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
    } else if (char === "'") {
      const end = charLiteralEnd(source, index);
      if (end === -1) {
        index += 1;
      } else {
        literal("char", index, index + 1, end - 1, end);
        index = end;
      }
    } else if (char === '"') {
      let hashes = 0;
      while (source[index - hashes - 1] === "#") hashes += 1;
      const r = index - hashes - 1;
      let rawStart = -1;
      if (source[r] === "r") {
        if (!isIdentifierChar(source[r - 1])) rawStart = r;
        else if (
          (source[r - 1] === "b" || source[r - 1] === "c") &&
          !isIdentifierChar(source[r - 2])
        ) {
          rawStart = r - 1;
        }
      }
      if (rawStart !== -1 && rawStart >= copied) {
        const terminator = `"${"#".repeat(hashes)}`;
        const close = source.indexOf(terminator, index + 1);
        const contentEnd = close === -1 ? source.length : close;
        const end = close === -1 ? source.length : close + terminator.length;
        literal("string", rawStart, index + 1, contentEnd, end);
        index = end;
      } else {
        let cursor = index + 1;
        while (cursor < source.length && source[cursor] !== '"') {
          cursor += source[cursor] === "\\" ? 2 : 1;
        }
        const contentEnd = Math.min(cursor, source.length);
        const end = Math.min(cursor + 1, source.length);
        literal("string", index, index + 1, contentEnd, end);
        index = end;
      }
    } else {
      index += 1;
    }
  }
  copyTo(source.length);
  return { path, code: code.join(""), tokens: tokens.join(""), literals };
}

function matchForward(
  text: string,
  open: number,
  opener: string,
  closer: string,
): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === opener) depth += 1;
    else if (text[index] === closer) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length - 1;
}

// ── Test-only code ──────────────────────────────────────────────────────────

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") depth -= 1;
    else if (text[index] === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.filter((part) => part.length > 0);
}

/** Whether a `cfg(...)` predicate can only hold in test builds. */
function cfgRequiresTest(predicate: string): boolean {
  const expression = predicate.replace(/\s+/g, "");
  if (expression === "test") return true;
  const call = /^(all|any|not)\((.*)\)$/.exec(expression);
  if (!call) return false;
  const operands = splitTopLevel(call[2]);
  if (call[1] === "all") return operands.some(cfgRequiresTest);
  if (call[1] === "any") {
    return operands.length > 0 && operands.every(cfgRequiresTest);
  }
  return false;
}

/** End (exclusive) of the item or statement starting at `from`. */
function itemEnd(tokens: string, from: number): number {
  let depth = 0;
  for (let index = from; index < tokens.length; index += 1) {
    const char = tokens[index];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (depth === 0 && char === ";") return index + 1;
    else if (depth === 0 && char === "{") {
      return matchForward(tokens, index, "{", "}") + 1;
    } else if (depth === 0 && char === "}") return index;
  }
  return tokens.length;
}

/** Skip whitespace and outer attributes; return where the item begins. */
function skipAttributes(tokens: string, from: number): number {
  let cursor = from;
  for (;;) {
    while (/\s/.test(tokens[cursor] ?? "")) cursor += 1;
    if (tokens[cursor] !== "#") return cursor;
    const bracket = tokens.indexOf("[", cursor);
    if (bracket === -1 || tokens.slice(cursor + 1, bracket).trim() !== "") {
      return cursor;
    }
    cursor = matchForward(tokens, bracket, "[", "]") + 1;
  }
}

function testOnlyRanges(tokens: string): Array<[number, number]> {
  for (const match of tokens.matchAll(/#\s*!\s*\[\s*cfg\s*\(/g)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = matchForward(tokens, open, "(", ")");
    if (cfgRequiresTest(tokens.slice(open + 1, close))) {
      return [[0, tokens.length]];
    }
  }
  const ranges: Array<[number, number]> = [];
  for (const match of tokens.matchAll(/#\s*\[\s*cfg\s*\(/g)) {
    const start = match.index ?? 0;
    const open = start + match[0].length - 1;
    const close = matchForward(tokens, open, "(", ")");
    if (!cfgRequiresTest(tokens.slice(open + 1, close))) continue;
    const attributeEnd = tokens.indexOf("]", close) + 1;
    ranges.push([start, itemEnd(tokens, skipAttributes(tokens, attributeEnd))]);
  }
  return ranges;
}

/** Lex a Rust file and blank every item that only exists in test builds. */
function prepareRust(path: string, source: string): RustSource {
  const lexed = lexRust(path, source);
  let { code, tokens } = lexed;
  const ranges = testOnlyRanges(tokens);
  for (const [start, end] of ranges) {
    code =
      code.slice(0, start) + blank(code.slice(start, end)) + code.slice(end);
    tokens =
      tokens.slice(0, start) +
      blank(tokens.slice(start, end)) +
      tokens.slice(end);
  }
  const literals = lexed.literals.filter(
    (literal) =>
      !ranges.some(
        ([start, end]) => start <= literal.start && literal.start < end,
      ),
  );
  return { path, code, tokens, literals };
}

function lineOf(source: RustSource, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.tokens.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

// ── Files ───────────────────────────────────────────────────────────────────

const toPosix = (path: string) => path.split(sep).join("/");

function rustFilesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...rustFilesUnder(full));
    else if (entry.name.endsWith(".rs")) found.push(full);
  }
  return found.sort();
}

const sourceCache = new Map<string, RustSource>();

/** A tauri-root relative path (`crates/x/src/y.rs`), test code stripped. */
function loadRust(path: string): RustSource {
  let source = sourceCache.get(path);
  if (!source) {
    source = prepareRust(path, readFileSync(join(tauriRoot, path), "utf8"));
    sourceCache.set(path, source);
  }
  return source;
}

function crateSources(crate: string): RustSource[] {
  return rustFilesUnder(join(tauriRoot, "crates", crate, "src")).map((file) =>
    loadRust(toPosix(relative(tauriRoot, file))),
  );
}

// ── SSH home rules ──────────────────────────────────────────────────────────

const RESOLVER_CALL = String.raw`\bsorng_core::ssh_home::home_dir\s*\(\s*dirs::home_dir\s*,?\s*\)`;

const HOME_ENV_VARS = new Set(["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH"]);

/**
 * A string literal naming something that lives in the SSH home. Prose (any
 * whitespace) is not a path, so help and error text never matches.
 */
const isSshHomeLiteral = ({ kind, value }: RustLiteral): boolean =>
  kind === "string" &&
  !/\s/.test(value) &&
  (/(^|[/\\])\.ssh([/\\]|$)/.test(value) ||
    /(^|[/\\])known_hosts$/.test(value) ||
    /^~([/\\]|$)/.test(value) ||
    /^(id_ed25519|id_rsa|id_ecdsa|id_dsa)$/.test(value));

interface FunctionSpan {
  name: string;
  nameStart: number;
  bodyStart: number;
  bodyEnd: number;
}

function functionSpans(source: RustSource): FunctionSpan[] {
  const spans: FunctionSpan[] = [];
  for (const match of source.tokens.matchAll(
    /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  )) {
    const nameStart = (match.index ?? 0) + match[0].length - match[1].length;
    let depth = 0;
    for (let index = nameStart; index < source.tokens.length; index += 1) {
      const char = source.tokens[index];
      if (char === "(" || char === "[") depth += 1;
      else if (char === ")" || char === "]") depth -= 1;
      else if (depth === 0 && char === ";") break;
      else if (depth === 0 && char === "{") {
        spans.push({
          name: match[1],
          nameStart,
          bodyStart: index,
          bodyEnd: matchForward(source.tokens, index, "{", "}"),
        });
        break;
      }
    }
  }
  return spans;
}

function enclosingFunction(
  source: RustSource,
  offset: number,
): FunctionSpan | undefined {
  return functionSpans(source)
    .filter((span) => span.bodyStart < offset && offset < span.bodyEnd)
    .sort((left, right) => right.bodyStart - left.bodyStart)[0];
}

/**
 * A function may build SSH-home paths when its own body calls the resolver,
 * or when every use of it in the crate is a direct call whose arguments call
 * the resolver (a pure seam that tests can feed explicitly).
 */
function isResolverFed(
  span: FunctionSpan,
  owner: RustSource,
  crate: RustSource[],
  resolverCall: string,
): boolean {
  const resolver = new RegExp(resolverCall);
  if (resolver.test(owner.tokens.slice(span.bodyStart, span.bodyEnd + 1))) {
    return true;
  }
  let calls = 0;
  for (const source of crate) {
    for (const use of source.tokens.matchAll(
      new RegExp(`\\b${span.name}\\b`, "g"),
    )) {
      const at = use.index ?? 0;
      if (source === owner && at === span.nameStart) continue;
      let open = at + span.name.length;
      while (/\s/.test(source.tokens[open] ?? "")) open += 1;
      if (source.tokens[open] !== "(") return false;
      const close = matchForward(source.tokens, open, "(", ")");
      if (!resolver.test(source.tokens.slice(open, close + 1))) return false;
      calls += 1;
    }
  }
  return calls > 0;
}

/** Violations of the SSH-home rules for one crate's non-test sources. */
function sshHomeViolations(crate: RustSource[]): string[] {
  const violations: string[] = [];
  const resolver = new RegExp(RESOLVER_CALL, "g");
  for (const source of crate) {
    const where = (offset: number) =>
      `${source.path}:${lineOf(source, offset)}`;
    const outsideResolver = source.tokens.replace(resolver, (call) =>
      blank(call),
    );
    for (const match of outsideResolver.matchAll(/\bhome_dir\b/g)) {
      violations.push(
        `${where(match.index ?? 0)}: home_dir outside sorng_core::ssh_home::home_dir(dirs::home_dir)`,
      );
    }
    for (const literal of source.literals) {
      if (HOME_ENV_VARS.has(literal.value)) {
        violations.push(
          `${where(literal.start)}: reads the ${literal.value} environment variable`,
        );
      } else if (isSshHomeLiteral(literal)) {
        const span = enclosingFunction(source, literal.start);
        if (!span || !isResolverFed(span, source, crate, RESOLVER_CALL)) {
          violations.push(
            `${where(literal.start)}: "${literal.value}" is built outside a function fed by sorng_core::ssh_home::home_dir`,
          );
        }
      }
    }
  }
  return violations;
}

// ── Workspace pairing ───────────────────────────────────────────────────────

/** Crates held to the strict per-crate rules instead of the pairing rule. */
const RESOLVER_CRATES = ["sorng-ssh", "sorng-sftp", "sorng-scp"] as const;

const isWorkspaceSshLiteral = ({ kind, value }: RustLiteral): boolean =>
  kind === "string" &&
  !/\s/.test(value) &&
  (/(^|[/\\])\.(ssh|opk)([/\\]|$)/.test(value) ||
    /(^|[/\\])known_hosts$/.test(value));

const resolvesHomeInProcess = (source: RustSource): boolean =>
  /\bhome_dir\b/.test(source.tokens) ||
  source.literals.some((literal) => HOME_ENV_VARS.has(literal.value));

const buildsSshHomePath = (source: RustSource): boolean =>
  resolvesHomeInProcess(source) && source.literals.some(isWorkspaceSshLiteral);

function workspaceRustSources(): RustSource[] {
  const files = rustFilesUnder(join(tauriRoot, "src"));
  for (const crate of readdirSync(join(tauriRoot, "crates")).sort()) {
    files.push(...rustFilesUnder(join(tauriRoot, "crates", crate, "src")));
  }
  return files.map((file) => loadRust(toPosix(relative(tauriRoot, file))));
}

/**
 * Out-of-process OpenSSH clients (addendum §1.2, risk R-S4). The child
 * resolves its own `~/.ssh`; the app never builds that path itself. The
 * scans below prove each still does not, so the residual stays documented.
 */
const EXTERNAL_OPENSSH_TOOLS = [
  { file: "crates/sorng-fail2ban/src/client.rs", runs: "ssh" },
  { file: "crates/sorng-remote-backup/src/scp.rs", runs: "scp" },
  { file: "crates/sorng-remote-backup/src/sftp.rs", runs: "sftp" },
  { file: "crates/sorng-ansible/src/client.rs", runs: "ansible over ssh" },
  { file: "crates/sorng-x2go/src/x2go/session.rs", runs: "x2go client" },
  { file: "crates/sorng-nx/src/nx/proxy.rs", runs: "nxproxy over ssh" },
] as const;

// ── opkssh home rules ───────────────────────────────────────────────────────

// sorng-opkssh does not depend on sorng-core, so it carries its own set-once
// home (`sorng_opkssh::service`). Its `~/.opk` and `~/.ssh` paths start only
// from `opk_home(dirs::home_dir)`, `opk_home_with(<OpkHome>, dirs::home_dir)`
// or, for the library login's explicit paths, `wrapper_home_override(<OpkHome>,
// override_home_dir)`, where an installed isolated home beats HOME/USERPROFILE.
const OPK_RESOLVER_CALL = String.raw`\b(?:crate::service::)?(?:opk_home\s*\(\s*dirs::home_dir|opk_home_with\s*\(\s*[A-Za-z_]\w*(?:\s*\(\s*\))?\s*,\s*dirs::home_dir|wrapper_home_override\s*\(\s*[A-Za-z_]\w*(?:\s*\(\s*\))?\s*,\s*override_home_dir)\s*,?\s*\)`;

const isOpkHomeLiteral = ({ kind, value }: RustLiteral): boolean =>
  kind === "string" &&
  !/\s/.test(value) &&
  /(^|[/\\])\.(ssh|opk)([/\\]|$)/.test(value);

/** Documented exceptions: `file` + function, with why no home is built. */
const OPKSSH_ALLOWED = {
  osHome: [
    {
      file: "crates/sorng-opkssh/src/binary.rs",
      fn: "find_binary",
      why: "read-only discovery of opkssh.exe; writes no state",
    },
  ],
  sshLiteral: [
    {
      file: "crates/sorng-opkssh/src/login.rs",
      fn: "extract_path_from_line",
      why: "recognises a key path the CLI printed; builds no path",
    },
  ],
} as const;

const allowedIn = (
  entries: ReadonlyArray<{ file: string; fn: string }>,
  source: RustSource,
  span: FunctionSpan | undefined,
): boolean =>
  span !== undefined &&
  entries.some((entry) => entry.file === source.path && entry.fn === span.name);

function opksshHomeViolations(crate: RustSource[]): string[] {
  const violations: string[] = [];
  const resolver = new RegExp(OPK_RESOLVER_CALL, "g");
  const service = "crates/sorng-opkssh/src/service.rs";
  for (const source of crate) {
    const where = (offset: number) =>
      `${source.path}:${lineOf(source, offset)}`;
    const outsideResolver = source.tokens.replace(resolver, (call) =>
      blank(call),
    );
    for (const match of outsideResolver.matchAll(
      /\b(?:dirs|env)::home_dir\b|(?<![\w:])home_dir\s*\(/g,
    )) {
      const span = enclosingFunction(source, match.index ?? 0);
      const builds =
        span !== undefined &&
        source.literals.some(
          (literal) =>
            isOpkHomeLiteral(literal) &&
            span.bodyStart < literal.start &&
            literal.start < span.bodyEnd,
        );
      if (!allowedIn(OPKSSH_ALLOWED.osHome, source, span) || builds) {
        violations.push(
          `${where(match.index ?? 0)}: OS home outside opk_home(dirs::home_dir)`,
        );
      }
    }
    for (const literal of source.literals) {
      const span = enclosingFunction(source, literal.start);
      if (HOME_ENV_VARS.has(literal.value)) {
        const readsEnvHome =
          source.path === service && span?.name === "override_home_dir";
        const setsChildEnv =
          source.path === "crates/sorng-opkssh/src/login.rs" &&
          span?.name === "login_command" &&
          /\.env(?:_remove)?\s*\(\s*$/.test(
            source.tokens.slice(0, literal.start),
          );
        if (!readsEnvHome && !setsChildEnv) {
          violations.push(
            `${where(literal.start)}: ${literal.value} is only read by override_home_dir or set on the login child`,
          );
        }
      } else if (
        isOpkHomeLiteral(literal) &&
        !allowedIn(OPKSSH_ALLOWED.sshLiteral, source, span) &&
        (!span || !isResolverFed(span, source, crate, OPK_RESOLVER_CALL))
      ) {
        violations.push(
          `${where(literal.start)}: "${literal.value}" is built outside a function fed by the opkssh home`,
        );
      }
    }
    // The environment home is only ever an input to wrapper_home_override,
    // after an installed isolated home.
    const envHomeUses = [...source.tokens.matchAll(/\boverride_home_dir\b/g)];
    const guardedUses = [...source.tokens.matchAll(resolver)].filter((call) =>
      /override_home_dir/.test(call[0]),
    ).length;
    const definitions = /\bfn\s+override_home_dir\b/.test(source.tokens)
      ? 1
      : 0;
    if (envHomeUses.length - definitions !== guardedUses) {
      violations.push(
        `${source.path}: override_home_dir used outside wrapper_home_override`,
      );
    }
    // Only the service's set-once slot decides which home is in effect.
    if (source.path !== service) {
      for (const match of source.tokens.matchAll(
        /\bOpkHome::(?:Os|Isolated)\b/g,
      )) {
        violations.push(
          `${where(match.index ?? 0)}: OpkHome is constructed outside the service slot`,
        );
      }
    }
  }
  return violations;
}

// ── Tests ───────────────────────────────────────────────────────────────────

function fixtureCrate(files: Record<string, string>): RustSource[] {
  return Object.entries(files).map(([path, source]) =>
    prepareRust(path, source),
  );
}

describe("Rust source preparation", () => {
  it("blanks comments and literal contents without shifting offsets", () => {
    const source = [
      '// dirs::home_dir().join(".ssh")',
      "/* nested /* dirs::home_dir() */ still comment */",
      'fn f<\'a>(x: &\'a str) -> char { let _ = r#"quote " home_dir"#; let _ = b"\\"home_dir"; \'"\' }',
      "fn g() { let c = '\\''; home_dir(); }",
    ].join("\n");
    const prepared = prepareRust("fixture.rs", source);
    expect(prepared.tokens).toHaveLength(source.length);
    expect(prepared.code).toHaveLength(source.length);
    const homeDirs = [...prepared.tokens.matchAll(/\bhome_dir\b/g)];
    expect(homeDirs).toHaveLength(1);
    expect(lineOf(prepared, homeDirs[0].index ?? 0)).toBe(4);
    expect(prepared.literals.map((literal) => literal.value)).toEqual([
      'quote " home_dir',
      '\\"home_dir',
      '"',
      "\\'",
    ]);
  });

  it("strips test-only items and keeps everything else", () => {
    const source = [
      "#[cfg(test)]",
      "mod tests { fn t() { dirs::home_dir(); } }",
      "#[cfg(all(test, windows))]",
      "#[allow(dead_code)]",
      'fn helper() { let _ = ".ssh"; }',
      "#[cfg(test)] use dirs::home_dir;",
      "#[cfg(not(test))]",
      "fn production() { dirs::home_dir(); }",
      "#[cfg(any(test, windows))]",
      "fn sometimes() { dirs::home_dir(); }",
    ].join("\n");
    const prepared = prepareRust("fixture.rs", source);
    const lines = [...prepared.tokens.matchAll(/\bhome_dir\b/g)].map((match) =>
      lineOf(prepared, match.index ?? 0),
    );
    expect(lines).toEqual([8, 10]);
    expect(prepared.literals).toEqual([]);
    expect(
      prepareRust("whole.rs", "#![cfg(test)]\nfn f() { home_dir(); }").tokens,
    ).not.toMatch(/home_dir/);
  });
});

describe("SSH home rule engine", () => {
  const resolverFed = {
    "crates/fixture/src/lib.rs": `
      fn default_path() -> Result<String, String> {
          path_in(sorng_core::ssh_home::home_dir(dirs::home_dir)?)
      }
      fn path_in(home: Option<PathBuf>) -> Result<String, String> {
          Ok(home.ok_or("none")?.join(".ssh").join("known_hosts").display().to_string())
      }
      fn keys() {
          for name in ["id_rsa"] {
              let _ = sorng_core::ssh_home::home_dir(
                  dirs::home_dir,
              ).map(|home| home.map(|home| home.join(".ssh").join(name)));
          }
      }
      fn tilde(config: &str) -> bool { config.starts_with("~/") }
      fn tilde_caller(config: &str) { let _ = sorng_core::ssh_home::home_dir(dirs::home_dir); tilde(config); }
    `,
  };

  it("accepts paths built only from the resolver", () => {
    const crate = fixtureCrate(resolverFed);
    const violations = sshHomeViolations(crate);
    // `tilde` is called without the resolver in its arguments.
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/lib\.rs:15: "~\/" is built outside/);
  });

  it.each([
    [
      "a direct OS home",
      'fn bad() { dirs::home_dir().map(|h| h.join(".ssh")); }',
      2,
    ],
    ["std::env::home_dir", "fn bad() { let _ = std::env::home_dir(); }", 1],
    [
      "an environment home",
      'fn bad() { std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".ssh")); }',
      2,
    ],
    [
      "a seam also fed from elsewhere",
      'fn bad() { path_in(Some(PathBuf::from("C:/Users/me"))); }',
      1,
    ],
    [
      "a resolver wrapped in a closure",
      "fn bad() { sorng_core::ssh_home::home_dir(|| dirs::home_dir()); }",
      1,
    ],
    [
      "a known_hosts literal at module scope",
      'const P: &str = ".ssh/known_hosts";',
      1,
    ],
    ["a function reference to a seam", "fn bad() { let f = path_in; }", 1],
  ])("rejects %s", (_, bypass, count) => {
    const crate = fixtureCrate({
      ...resolverFed,
      "crates/fixture/src/lib.rs": resolverFed[
        "crates/fixture/src/lib.rs"
      ].replace(
        "fn tilde_caller(config: &str) {",
        "fn tilde_caller(config: &str) { tilde(sorng_core::ssh_home::home_dir(dirs::home_dir)); ",
      ),
      "crates/fixture/src/bypass.rs": bypass,
    });
    const bypassViolations = sshHomeViolations(crate).filter((violation) =>
      /bypass\.rs|lib\.rs:6:/.test(violation),
    );
    expect(bypassViolations.length).toBeGreaterThanOrEqual(count);
  });

  it("ignores bypasses that only exist in comments, strings or tests", () => {
    const crate = fixtureCrate({
      "crates/fixture/src/lib.rs": [
        '// dirs::home_dir().unwrap().join(".ssh")',
        'const HELP: &str = "defaults to ~/.ssh/known_hosts via dirs::home_dir()";',
        "fn unreserved(b: u8) -> bool { b == b'~' || b == '~' as u8 }",
        "#[cfg(test)]",
        'mod tests { fn t() { std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".ssh")); } }',
      ].join("\n"),
    });
    expect(sshHomeViolations(crate)).toEqual([]);
  });
});

describe("SSH, SFTP and SCP resolve SSH-home paths only through sorng_core::ssh_home", () => {
  it.each(RESOLVER_CRATES)("%s has no bypass", (crate) => {
    expect(sshHomeViolations(crateSources(crate))).toEqual([]);
  });

  it("every resolver crate still resolves its defaults through the resolver", () => {
    const expected: Record<string, number> = {
      // default_known_hosts_path, verify_host_key's default
      "crates/sorng-ssh/src/ssh/service.rs": 2,
      // known_hosts_path, default key discovery
      "crates/sorng-sftp/src/sftp/service.rs": 2,
      "crates/sorng-scp/src/scp/service.rs": 2,
    };
    for (const [path, count] of Object.entries(expected)) {
      const calls =
        loadRust(path).tokens.match(new RegExp(RESOLVER_CALL, "g")) ?? [];
      expect(calls, path).toHaveLength(count);
    }
  });

  const mutate = (
    crate: string,
    path: string,
    edit: (source: string) => string,
  ): string[] => {
    const original = readFileSync(join(tauriRoot, path), "utf8");
    const mutated = edit(original);
    expect(mutated, `${path} mutation must apply`).not.toBe(original);
    return sshHomeViolations(
      crateSources(crate).map((source) =>
        source.path === path ? prepareRust(path, mutated) : source,
      ),
    );
  };

  it.each([
    [
      "SSH import/preview default reads the OS home",
      "sorng-ssh",
      "crates/sorng-ssh/src/ssh/service.rs",
      (source: string) =>
        source.replace(
          "default_known_hosts_path_in(sorng_core::ssh_home::home_dir(dirs::home_dir)?)",
          "default_known_hosts_path_in(dirs::home_dir())",
        ),
    ],
    [
      "SSH verification default is fed a hand-built home",
      "sorng-ssh",
      "crates/sorng-ssh/src/ssh/service.rs",
      (source: string) =>
        source.replace(
          /verification_known_hosts_path_in\(sorng_core::ssh_home::home_dir\(dirs::home_dir\)\?\)/,
          'verification_known_hosts_path_in(std::env::var_os("USERPROFILE").map(std::path::PathBuf::from))',
        ),
    ],
    [
      "SFTP key discovery reads the OS home",
      "sorng-sftp",
      "crates/sorng-sftp/src/sftp/service.rs",
      (source: string) =>
        source.replace(
          "Self::default_key_files(sorng_core::ssh_home::home_dir(dirs::home_dir), |path| {",
          "Self::default_key_files(Ok(dirs::home_dir()), |path| {",
        ),
    ],
    [
      "SFTP known_hosts is fed a fixed home",
      "sorng-sftp",
      "crates/sorng-sftp/src/sftp/service.rs",
      (source: string) =>
        source.replace(
          /Self::known_hosts_path_in\(sorng_core::ssh_home::home_dir\(\s*dirs::home_dir,?\s*\)\?\)/,
          'Self::known_hosts_path_in(Some(PathBuf::from("C:/Users/operator")))',
        ),
    ],
    [
      "SCP gains a second, unresolved caller of its known_hosts seam",
      "sorng-scp",
      "crates/sorng-scp/src/scp/service.rs",
      (source: string) =>
        `${source}\nfn bypass(config: &ScpConnectionConfig) {\n    let _ = ScpService::known_hosts_path_in(config, || Ok(std::env::current_dir().ok()));\n}\n`,
    ],
    [
      "SCP expands ~ from the environment",
      "sorng-scp",
      "crates/sorng-scp/src/scp/service.rs",
      (source: string) =>
        `${source}\nfn expand(path: &str) -> Option<PathBuf> {\n    path.strip_prefix("~/").map(|rest| PathBuf::from(std::env::var_os("HOME")?).join(rest))\n}\n`,
    ],
    [
      "a new default key probe outside the seam",
      "sorng-scp",
      "crates/sorng-scp/src/scp/service.rs",
      (source: string) =>
        `${source}\n#[cfg(not(test))]\nfn probe(home: &Path) -> bool {\n    home.join("id_ed25519").exists()\n}\n`,
    ],
  ])("detects a regression: %s", (_, crate, path, edit) => {
    expect(mutate(crate, path, edit)).not.toEqual([]);
  });
});

describe("no other crate builds an SSH-home path in process", () => {
  it("pairs an in-process home with .ssh, .opk or known_hosts only in the resolver crates and opkssh", () => {
    const exempt = [...RESOLVER_CRATES, "sorng-opkssh"].map(
      (crate) => `crates/${crate}/`,
    );
    const offenders = workspaceRustSources()
      .filter(
        (source) => !exempt.some((prefix) => source.path.startsWith(prefix)),
      )
      .filter(buildsSshHomePath)
      .map((source) => source.path);
    expect(offenders).toEqual([]);
  }, 30_000);

  it("detects a new pairing", () => {
    const source = prepareRust(
      "crates/sorng-new/src/lib.rs",
      'fn f() -> Option<PathBuf> { dirs::home_dir().map(|h| h.join(".ssh").join("config")) }',
    );
    expect(buildsSshHomePath(source)).toBe(true);
  });

  it.each(EXTERNAL_OPENSSH_TOOLS)(
    "$file leaves ~/.ssh to the $runs child process",
    ({ file }) => {
      expect(existsSync(join(tauriRoot, file)), file).toBe(true);
      expect(statSync(join(tauriRoot, file)).isFile()).toBe(true);
      expect(buildsSshHomePath(loadRust(file))).toBe(false);
    },
  );
});

describe("opkssh resolves ~/.opk and ~/.ssh only through its installed home", () => {
  const opksshCrate = () => crateSources("sorng-opkssh");

  it("has no bypass", () => {
    expect(opksshHomeViolations(opksshCrate())).toEqual([]);
  });

  it("every documented exception still exists", () => {
    const entries = [...OPKSSH_ALLOWED.osHome, ...OPKSSH_ALLOWED.sshLiteral];
    for (const entry of entries) {
      const names = functionSpans(loadRust(entry.file)).map(
        (span) => span.name,
      );
      expect(names, `${entry.file}: ${entry.why}`).toContain(entry.fn);
    }
  });

  it("exposes the install and getter the app glue calls", () => {
    const service = loadRust("crates/sorng-opkssh/src/service.rs").tokens;
    expect(service).toMatch(
      /\bpub\s+fn\s+install_isolated_home\s*\(\s*path\s*:\s*PathBuf\s*\)\s*->\s*Result<\(\),\s*String>/,
    );
    expect(service).toMatch(
      /\bpub\s+fn\s+isolated_home\s*\(\s*\)\s*->\s*Option<&'static\s+Path>/,
    );
  });

  const mutate = (path: string, edit: (source: string) => string) => {
    const original = readFileSync(join(tauriRoot, path), "utf8");
    const mutated = edit(original);
    expect(mutated, `${path} mutation must apply`).not.toBe(original);
    return opksshHomeViolations(
      opksshCrate().map((source) =>
        source.path === path ? prepareRust(path, mutated) : source,
      ),
    );
  };

  it.each([
    [
      "the key scan reads the OS home",
      "crates/sorng-opkssh/src/keys.rs",
      (source: string) =>
        source.replace(
          "ssh_dir_in(crate::service::opk_home(dirs::home_dir))",
          "ssh_dir_in(dirs::home_dir())",
        ),
    ],
    [
      "the client config reads the OS home",
      "crates/sorng-opkssh/src/providers.rs",
      (source: string) =>
        source.replace(
          "config_dir_in(crate::service::opk_home(dirs::home_dir))",
          "config_dir_in(dirs::home_dir())",
        ),
    ],
    [
      "the library login prefers the environment home again",
      "crates/sorng-opkssh/src/service.rs",
      (source: string) =>
        source.replace(
          /wrapper_home_override\(opk_home_state\(\), override_home_dir\)\?/,
          "override_home_dir()",
        ),
    ],
    [
      "a new function reads USERPROFILE",
      "crates/sorng-opkssh/src/keys.rs",
      (source: string) =>
        `${source}\nfn profile_ssh_dir() -> Option<PathBuf> {\n    std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".ssh"))\n}\n`,
    ],
    [
      "another module picks the OS home itself",
      "crates/sorng-opkssh/src/login.rs",
      (source: string) =>
        `${source}\nfn force_os_home() -> Option<PathBuf> {\n    crate::service::opk_home_with(crate::service::OpkHome::Os, dirs::home_dir)\n}\n`,
    ],
  ])("detects a regression: %s", (_, path, edit) => {
    expect(mutate(path, edit)).not.toEqual([]);
  });
});

describe("the vendored opkssh bridge never configures ~/.ssh/config", () => {
  // Go's `LoginCmd.ConfigureArg` writes `~/.ssh/config` through
  // `os.UserHomeDir()`, which no Rust-side home can redirect.
  const bridge = () =>
    readFileSync(
      join(tauriRoot, "crates/sorng-opkssh-vendor/build.rs"),
      "utf8",
    );

  it("has no request field or login construction that sets ConfigureArg", () => {
    const source = bridge();
    const request = /type loginRequestModel struct \{([^}]*)\}/.exec(source);
    expect(request).not.toBeNull();
    expect(request?.[1]).not.toMatch(/configure/i);

    const constructions = [...source.matchAll(/&LoginCmd\{([^}]*)\}/g)];
    expect(constructions.length).toBeGreaterThan(0);
    const setters = constructions.filter((match) =>
      /\bConfigureArg\s*:/.test(match[1]),
    );
    // Only the upstream `NewLogin` constructor, which the bridge never calls.
    expect(setters).toHaveLength(1);
    expect(source.slice(0, setters[0].index)).toMatch(
      /func NewLogin\([^{]*\{\s*return\s*$/,
    );
    expect([...source.matchAll(/\bNewLogin\(/g)]).toHaveLength(1);
  });

  it("no Rust source names the configure flag", () => {
    for (const crate of ["sorng-opkssh", "sorng-opkssh-vendor"]) {
      for (const source of crateSources(crate)) {
        const named = source.literals.filter((literal) =>
          /^(--)?configure(Arg)?$/i.test(literal.value),
        );
        expect(named, source.path).toEqual([]);
      }
    }
  });
});

/** Where the app glue installs and verifies the SSH homes (addendum §2.4). */
function appGlueViolations(profile: RustSource): string[] {
  const violations: string[] = [];
  const offsetOf = (pattern: RegExp): number => profile.tokens.search(pattern);
  const sameSpan = (left?: FunctionSpan, right?: FunctionSpan) =>
    left !== undefined &&
    right !== undefined &&
    left.bodyStart === right.bodyStart;

  const identity = offsetOf(/\bapp_identity::install\s*\(/);
  const namespace = offsetOf(/\binstall_service_namespace\s*\(/);
  const startup =
    identity < 0 ? undefined : enclosingFunction(profile, identity);
  if (
    !startup ||
    namespace <= identity ||
    !sameSpan(startup, enclosingFunction(profile, namespace))
  ) {
    return [
      "startup must install the app identity, then the keychain namespace",
    ];
  }

  const installs = {
    "sorng_core::ssh_home::install_isolated_home":
      /\bsorng_core::ssh_home::install_isolated_home\s*\(/,
    "sorng_opkssh::service::install_isolated_home":
      /\bsorng_opkssh::service::install_isolated_home\s*\(/,
  };
  for (const [name, pattern] of Object.entries(installs)) {
    const at = offsetOf(pattern);
    const owner = at < 0 ? undefined : enclosingFunction(profile, at);
    if (!owner) {
      violations.push(`${name} is never called`);
    } else if (sameSpan(owner, startup)) {
      if (at < namespace) {
        violations.push(`${name} runs before the keychain namespace`);
      }
    } else {
      // Installed by a helper that startup calls after the namespace.
      const afterNamespace = profile.tokens.slice(namespace, startup.bodyEnd);
      if (!new RegExp(String.raw`\b${owner.name}\s*\(`).test(afterNamespace)) {
        violations.push(
          `${name} is in ${owner.name}, which startup does not call after the keychain namespace`,
        );
      }
    }
  }

  const opkssh = offsetOf(
    installs["sorng_opkssh::service::install_isolated_home"],
  );
  const gated =
    opkssh >= 0 &&
    [
      ...profile.code.matchAll(
        /#\s*\[\s*cfg\s*\(\s*feature\s*=\s*"opkssh"\s*\)\s*\]/g,
      ),
    ].some((gate) => {
      const end = (gate.index ?? 0) + gate[0].length;
      return (
        end <= opkssh &&
        itemEnd(profile.tokens, skipAttributes(profile.tokens, end)) > opkssh
      );
    });
  if (opkssh >= 0 && !gated) {
    violations.push(
      'sorng_opkssh::service::install_isolated_home is not gated on #[cfg(feature = "opkssh")]',
    );
  }

  for (const getter of [
    /\bsorng_core::ssh_home::isolated_home\s*\(\s*\)/,
    /\bsorng_opkssh::service::isolated_home\s*\(\s*\)/,
  ]) {
    if (!getter.test(profile.tokens)) {
      violations.push(`verify_runtime never reads ${getter.source}`);
    }
  }
  return violations;
}

describe("the app installs the SSH homes before anything connects", () => {
  const glue = (install: string, verify = true) =>
    prepareRust(
      "src/app_profile.rs",
      `fn start_process_profile() -> Result<(), String> {
         app_identity::install(identifier)?;
         sorng_vault::keychain::install_service_namespace(ns)?;
         ${install}
         Ok(())
       }
       fn install_ssh_homes(home: PathBuf) -> Result<(), String> {
         sorng_core::ssh_home::install_isolated_home(home.clone())?;
         #[cfg(feature = "opkssh")]
         sorng_opkssh::service::install_isolated_home(home)?;
         Ok(())
       }
       fn verify_runtime() {
         ${verify ? 'sorng_core::ssh_home::isolated_home(); #[cfg(feature = "opkssh")] sorng_opkssh::service::isolated_home();' : ""}
       }`,
    );

  it("accepts installs in a helper that startup calls last", () => {
    expect(appGlueViolations(glue("install_ssh_homes(home)?;"))).toEqual([]);
  });

  it("rejects glue that is missing, early, ungated or unverified", () => {
    expect(appGlueViolations(glue(""))).toHaveLength(2);
    expect(
      appGlueViolations(
        prepareRust(
          "src/app_profile.rs",
          glue("install_ssh_homes(home)?;")
            .code.replace(
              "app_identity::install(identifier)?;",
              "install_ssh_homes(home)?; app_identity::install(identifier)?;",
            )
            .replace(/\n\s*install_ssh_homes\(home\)\?;\n\s*Ok/, "\nOk"),
        ),
      ),
    ).not.toEqual([]);
    expect(
      appGlueViolations(
        prepareRust(
          "src/app_profile.rs",
          glue("install_ssh_homes(home)?;").code.replace(
            '#[cfg(feature = "opkssh")]\n         sorng_opkssh',
            "sorng_opkssh",
          ),
        ),
      ),
    ).toEqual([
      'sorng_opkssh::service::install_isolated_home is not gated on #[cfg(feature = "opkssh")]',
    ]);
    expect(
      appGlueViolations(glue("install_ssh_homes(home)?;", false)),
    ).toHaveLength(2);
  });

  it("src/app_profile.rs installs and verifies both SSH homes", () => {
    expect(appGlueViolations(loadRust("src/app_profile.rs"))).toEqual([]);
  });
});
