/**
 * SSH secret-state guard.
 *
 * This replaces the `no-restricted-syntax` rule that `eslint.config.js` scoped
 * to `src/hooks/ssh/**` before the oxlint migration. oxlint has no equivalent
 * rule, and its JS-plugin API is alpha and does not document esquery selector
 * support, so the guard is reimplemented here as a `node --test` suite instead
 * of being dropped.
 *
 * The banned shape is:
 *
 *   const [<name>, ...] = useState(...)
 *
 * where `<name>` contains `password`, `passphrase`, or `secret`
 * (case-insensitively) and does not start with `has`. The `has` prefix marks a
 * boolean presence flag rather than the secret itself, which is what the
 * original rule's `(?!has)` lookahead was written to permit — see
 * `useSSHAgentManager.ts` and `useSSHKeyManager.ts`.
 *
 * Deliberately line/text-oriented rather than AST-based: TypeScript 7 ships no
 * JavaScript compiler API, so an AST guard would need a new parser dependency
 * purely to serve this one rule. Prettier already normalises formatting in this
 * tree, and this is a defence-in-depth naming guard, not a security boundary.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The directory the original ESLint rule was scoped to. */
export const GUARDED_DIRECTORY = path.join(REPOSITORY_ROOT, "src/hooks/ssh");

/** Verbatim message from the rule this guard replaces. */
export const SECRET_STATE_MESSAGE =
  "Do not store SSH secrets in React state. Use refs and explicit scrubbing instead.";

/**
 * Verbatim from the `no-restricted-syntax` esquery selector. The `i` flag
 * applies inside the lookahead too, so `Has…` and `HAS…` are exempt exactly as
 * they were under ESLint.
 */
export const SECRET_STATE_NAME =
  /^(?!has)[A-Za-z0-9_]*(password|passphrase|secret)[A-Za-z0-9_]*$/i;

/**
 * `const|let|var [<name>, ...] = useState(...)`, tolerating the line break
 * prettier inserts before `useState` on long declarations and an optional
 * generic argument list.
 *
 * The span between the captured name and `]` forbids `[]{};=` so a match can
 * never run past the end of one destructuring pattern and pair an unrelated
 * name with a distant `useState` call.
 *
 * `React.useState` is accepted as well. The original selector matched only a
 * bare `useState` callee; covering the member form makes the guard a strict
 * superset rather than leaving an obvious way around it.
 */
const SECRET_STATE_DECLARATION =
  /\b(?:const|let|var)\s*\[\s*([A-Za-z0-9_$]+)[^\][{};=]*\]\s*=\s*(?:React\s*\.\s*)?useState\s*(?:<[^{};()]*>\s*)?\(/gu;

/**
 * Blanks everything that is not executable code — comment bodies and the
 * contents of string and template literals — replacing each character with a
 * space so byte offsets, and therefore reported line numbers, are unchanged.
 *
 * Blanking string bodies matches the original AST rule, which could never match
 * inside a string. It cannot hide a real violation: a string literal holds no
 * declarations, and a template interpolation can only hold an expression, never
 * a `const [...] = useState(...)` declaration.
 *
 * Template literals are treated as opaque from backtick to backtick, which is
 * what keeps `` `"${e.command.replace(/"/g, '""')}"` `` in
 * `useSSHCommandHistory.ts` from desyncing the scanner.
 *
 * Throws if the scan ends mid-string or mid-comment. A desynced scanner could
 * blank real code and hide a genuine violation, so it fails closed and loudly
 * rather than silently returning a clean result.
 */
export function stripNonCode(source, label = "<source>") {
  let output = "";
  let state = "code";
  let index = 0;

  const blank = (text) => text.replace(/[^\n]/gu, " ");

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "code") {
      if (character === "/" && next === "/") {
        state = "line-comment";
        continue;
      }
      if (character === "/" && next === "*") {
        state = "block-comment";
        output += "  ";
        index += 2;
        continue;
      }
      if (character === "'" || character === '"' || character === "`") {
        state = character;
      }
      output += character;
      index += 1;
      continue;
    }

    if (state === "line-comment") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      output += blank(source.slice(index, stop));
      index = stop;
      state = "code";
      continue;
    }

    if (state === "block-comment") {
      const end = source.indexOf("*/", index);
      if (end === -1) {
        throw new Error(`${label}: unterminated block comment`);
      }
      output += blank(source.slice(index, end));
      output += "  ";
      index = end + 2;
      state = "code";
      continue;
    }

    // Inside a string or template literal: blank the body, honouring escapes
    // and keeping the delimiters so the surrounding code still parses.
    if (character === "\\") {
      output += blank(source.slice(index, index + 2));
      index += 2;
      continue;
    }
    if (character === state) {
      state = "code";
      output += character;
      index += 1;
      continue;
    }
    output += blank(character);
    index += 1;
  }

  if (state !== "code") {
    throw new Error(
      `${label}: scan ended in state "${state}" — the comment stripper desynced, ` +
        "so this file cannot be scanned safely",
    );
  }

  return output;
}

/** Every `.ts`/`.tsx` file under `directory`, recursively, sorted. */
export function collectGuardedFiles(directory) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (/\.tsx?$/u.test(entry.name)) {
        found.push(absolute);
      }
    }
  };
  walk(directory);
  return found.sort();
}

/**
 * Violations in one file's source, as `{ line, name }`, ordered by position.
 */
export function findSecretStateViolations(source, label = "<source>") {
  const scannable = stripNonCode(source, label);
  const violations = [];

  SECRET_STATE_DECLARATION.lastIndex = 0;
  let match = SECRET_STATE_DECLARATION.exec(scannable);
  while (match !== null) {
    const name = match[1];
    if (SECRET_STATE_NAME.test(name)) {
      const line = scannable.slice(0, match.index).split("\n").length;
      violations.push({ line, name });
    }
    match = SECRET_STATE_DECLARATION.exec(scannable);
  }

  return violations;
}

/** Scans a directory, returning `{ file, line, name }` for every violation. */
export function scanDirectory(directory) {
  return collectGuardedFiles(directory).flatMap((file) => {
    const relative = path.relative(REPOSITORY_ROOT, file).replaceAll("\\", "/");
    return findSecretStateViolations(
      fs.readFileSync(file, "utf8"),
      relative,
    ).map((violation) => ({ file: relative, ...violation }));
  });
}

const formatViolations = (violations) =>
  violations
    .map(({ file, line, name }) => `  ${file}:${line} — ${name}`)
    .join("\n");

// ---------------------------------------------------------------------------
// The guard itself
// ---------------------------------------------------------------------------

test("no SSH hook holds a secret in React state", () => {
  const violations = scanDirectory(GUARDED_DIRECTORY);
  assert.deepEqual(
    violations,
    [],
    `${SECRET_STATE_MESSAGE}\n${formatViolations(violations)}`,
  );
});

test("the scan is not vacuous — it reaches the real SSH hooks", () => {
  const files = collectGuardedFiles(GUARDED_DIRECTORY).map((file) =>
    path.relative(REPOSITORY_ROOT, file).replaceAll("\\", "/"),
  );

  // A guard that scans nothing passes trivially. Pin the two files whose
  // `has`-prefixed presence flags are the reason the exemption exists, so a
  // moved or renamed directory fails here instead of silently reporting clean.
  assert.ok(files.length >= 20, `scanned only ${files.length} files`);
  assert.ok(files.includes("src/hooks/ssh/useSSHAgentManager.ts"));
  assert.ok(files.includes("src/hooks/ssh/useSSHKeyManager.ts"));
});

test("the two known presence flags are still the `has`-prefixed shape", () => {
  // If either of these is ever renamed to drop the `has` prefix, it becomes a
  // violation — this asserts the exemption is still doing real work.
  const agent = fs.readFileSync(
    path.join(GUARDED_DIRECTORY, "useSSHAgentManager.ts"),
    "utf8",
  );
  const keys = fs.readFileSync(
    path.join(GUARDED_DIRECTORY, "useSSHKeyManager.ts"),
    "utf8",
  );
  assert.match(agent, /const \[hasLockPassphrase,/u);
  assert.match(keys, /const \[hasNewKeyPassphrase,/u);
});

// ---------------------------------------------------------------------------
// Fixtures — proof the guard can actually fail
// ---------------------------------------------------------------------------

const positives = {
  "plain secret in state":
    'const [sshPassword, setSshPassword] = useState("");',
  "bare passphrase": 'const [passphrase, setPassphrase] = useState("");',
  "secret substring": "const [vaultSecret, setVaultSecret] = useState(null);",
  "generic argument":
    'const [keyPassword, setKeyPassword] = useState<string>("");',
  "prettier line break":
    "const [tunnelPassphraseValue, setTunnelPassphraseValue] =\n  useState<string | null>(null);",
  "let binding": 'let [password, setPassword] = useState("");',
  "member call": 'const [sudoPassword, setSudoPassword] = React.useState("");',
  "uppercase spelling": 'const [SSHPassword, setSSHPassword] = useState("");',
  "underscore prefix": 'const [_password, set_password] = useState("");',
  "extra whitespace": 'const [  hostSecret , setHostSecret ] = useState( "" );',
};

for (const [description, source] of Object.entries(positives)) {
  test(`fires: ${description}`, () => {
    const violations = findSecretStateViolations(source, description);
    assert.equal(
      violations.length,
      1,
      `expected 1 violation, got ${JSON.stringify(violations)}`,
    );
  });
}

const negatives = {
  "has-prefixed presence flag":
    "const [hasLockPassphrase, setHasLockPassphrase] = useState(false);",
  "has-prefixed, other spelling":
    "const [hasNewKeyPassphrase, setHasNewKeyPassphrase] = useState(false);",
  "has prefix is case-insensitive, matching the original `i` flag":
    "const [HasPassword, setHasPassword] = useState(false);",
  "unrelated state": 'const [connectionName, setName] = useState("");',
  "secret in a ref, not state": 'const passwordRef = useRef("");',
  "secret in a plain const": "const password = readPassword();",
  "not useState": "const [password, dispatch] = useReducer(reducer, null);",
  "not a destructuring pattern": 'const password = useState("")[0];',
  "commented-out violation":
    '// const [sshPassword, setSshPassword] = useState("");',
  "block-commented violation":
    '/* const [sshPassword, setSshPassword] = useState(""); */',
  "violation inside a string literal":
    "const example = 'const [sshPassword, s] = useState(\"\")';",
  "unrelated array pattern before a clean useState":
    "const [passwordFields] = usePasswordFields();\nconst [count, setCount] = useState(0);",
};

for (const [description, source] of Object.entries(negatives)) {
  test(`does not fire: ${description}`, () => {
    assert.deepEqual(findSecretStateViolations(source, description), []);
  });
}

test("reports the line number of the violation", () => {
  const source = [
    "import { useState } from 'react';",
    "",
    "export function useThing() {",
    '  const [sshPassword, setSshPassword] = useState("");',
    "  return sshPassword;",
    "}",
  ].join("\n");
  assert.deepEqual(findSecretStateViolations(source, "thing.ts"), [
    { line: 4, name: "sshPassword" },
  ]);
});

test("reports every violation in a file, not just the first", () => {
  const source = [
    'const [sshPassword, setSshPassword] = useState("");',
    "const [hasLockPassphrase, setHas] = useState(false);",
    'const [keySecret, setKeySecret] = useState("");',
  ].join("\n");
  assert.deepEqual(findSecretStateViolations(source, "many.ts"), [
    { line: 1, name: "sshPassword" },
    { line: 3, name: "keySecret" },
  ]);
});

test("comment stripping preserves line numbers", () => {
  const stripped = stripNonCode("// a\n/* b\n c */\nconst x = 1;\n", "t.ts");
  assert.equal(stripped.split("\n").length, 5);
  assert.equal(stripped.split("\n")[3], "const x = 1;");
});

test("string and template bodies are blanked, delimiters kept", () => {
  const source = 'const a = "// not a comment";';
  const stripped = stripNonCode(source, "t.ts");
  assert.equal(stripped, 'const a = "                ";');
  assert.equal(stripped.length, source.length);
});

test("a quote inside a regex inside a template does not desync the scanner", () => {
  // The exact shape at src/hooks/ssh/useSSHCommandHistory.ts:317, which is what
  // makes treating templates as opaque necessary.
  const source =
    'const row = `"${e.command.replace(/"/g, \'""\')}"`;\nconst after = 1;';
  const stripped = stripNonCode(source, "t.ts");
  assert.equal(stripped.length, source.length);
  // Code after the template survives, proving the scanner resynced.
  assert.match(stripped, /const after = 1;/u);
});

test("comment stripping fails closed when it desyncs", () => {
  assert.throws(
    () => stripNonCode('const a = "unterminated', "t.ts"),
    /desynced/u,
  );
  assert.throws(
    () => stripNonCode("/* unterminated", "t.ts"),
    /unterminated block comment/u,
  );
});

test("every real SSH hook survives the comment stripper", () => {
  // stripNonCode throws on desync; this proves it stays in sync across all of
  // the real files, so a clean scan above is a real result and not a swallowed
  // one.
  for (const file of collectGuardedFiles(GUARDED_DIRECTORY)) {
    const source = fs.readFileSync(file, "utf8");
    const stripped = stripNonCode(source, file);
    assert.equal(stripped.length, source.length);
  }
});

// ---------------------------------------------------------------------------
// End-to-end: the directory scanner must catch an injected violation
// ---------------------------------------------------------------------------

test("scanDirectory catches a violation injected into a copy of the real hooks", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-secret-guard-"));
  try {
    const mirror = path.join(scratch, "ssh");
    fs.cpSync(GUARDED_DIRECTORY, mirror, { recursive: true });

    // Clean copy of the real tree scans clean.
    assert.deepEqual(scanDirectory(mirror), []);

    fs.writeFileSync(
      path.join(mirror, "useInjectedViolation.ts"),
      [
        'import { useState } from "react";',
        "",
        "export function useInjectedViolation() {",
        '  const [sshPassword, setSshPassword] = useState("");',
        "  return { sshPassword, setSshPassword };",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const violations = scanDirectory(mirror);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].name, "sshPassword");
    assert.equal(violations[0].line, 4);
    assert.match(violations[0].file, /useInjectedViolation\.ts$/u);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
