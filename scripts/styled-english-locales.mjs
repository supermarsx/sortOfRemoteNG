import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

const glossary = JSON.parse(
  readFileSync(
    path.join(REPOSITORY_ROOT, "src", "i18n", "glossary.json"),
    "utf8",
  ),
);

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `glossary.terms` is the repository-wide source of truth for product names,
// protocols, acronyms, and other literals that translations must not alter.
// Longest-first ordering is essential for overlapping entries such as
// "SSH (Secure Shell)" / "SSH" and "HTTPS" / "HTTP".
const GLOSSARY_TERMS = glossary.terms
  .slice()
  .sort((left, right) => right.length - left.length)
  .map(escapeRegExp)
  .join("|");

const LEET_MAP = new Map(
  Object.entries({
    a: "4",
    b: "8",
    e: "3",
    g: "6",
    i: "1",
    l: "1",
    o: "0",
    s: "5",
    t: "7",
    z: "2",
  }),
);

const PIRATE_PHRASES = {
  "are you sure": "be ye sure",
  "connection failed": "voyage failed",
  "connection successful": "voyage successful",
  "connect to": "sail to",
  "new connection": "new voyage",
  "sign in": "come aboard",
  "sign out": "leave ship",
  "log in": "come aboard",
  "log out": "leave ship",
  "welcome to": "ahoy, welcome aboard",
  "you are": "ye be",
  "add remote": "add faraway port",
  "remote server": "faraway server",
  "try again": "make another attempt",
  "not found": "lost at sea",
  "read only": "look but touch naught",
  settings: "ship's settings",
  connection: "voyage",
  connections: "voyages",
  connect: "set sail",
  disconnect: "drop anchor",
  connected: "underway",
  disconnected: "anchored",
  delete: "scuttle",
  remove: "heave overboard",
  save: "stow",
  cancel: "belay",
  close: "batten down",
  open: "unfurl",
  search: "seek",
  select: "choose",
  selected: "chosen",
  create: "build",
  edit: "refit",
  update: "refit",
  error: "trouble",
  warning: "heed this",
  password: "secret code",
  username: "crew name",
  server: "ship's server",
  network: "sea lane",
  folder: "chest",
  file: "chart",
  files: "charts",
  download: "haul aboard",
  upload: "send ashore",
  retry: "try anew",
  yes: "aye",
  no: "nay",
  your: "yer",
  yours: "yers",
  you: "ye",
  my: "me",
  friend: "matey",
  administrator: "captain",
  users: "crew",
  user: "crewmate",
  home: "home port",
  help: "guidance",
  enabled: "shipshape",
  disabled: "scuttled",
};

const PROTECTED_SEGMENT = new RegExp(
  [
    // Runtime/template syntax.
    String.raw`\{\{[\s\S]*?\}\}`,
    String.raw`\$t\([^\r\n)]*\)`,
    String.raw`\$\{[A-Za-z_][A-Za-z0-9_]*\}`,
    String.raw`\$[A-Za-z_][A-Za-z0-9_]*`,
    String.raw`%[A-Za-z_][A-Za-z0-9_]*%`,
    String.raw`%(?:\d+\$)?[A-Za-z]`,
    String.raw`\`[^\`\r\n]*\``,
    String.raw`<\/?[A-Za-z][^>]*>`,
    String.raw`&(?:[A-Za-z][A-Za-z0-9]+|#\d+|#x[\dA-Fa-f]+);`,

    // Network locations and addresses. These precede glossary matching so a
    // leading term such as "HTTP" cannot split and expose the rest of a URL.
    String.raw`[Hh][Tt][Tt][Pp][Ss]?:\/\/[^\s<>]+`,
    String.raw`[Mm][Aa][Ii][Ll][Tt][Oo]:[^\s<>]+`,
    String.raw`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`,
    String.raw`\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b`,
    String.raw`(?<![A-Za-z0-9])\[?(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}\]?(?::\d{1,5})?(?![A-Za-z0-9])`,
    String.raw`\b(?:localhost|(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59}))(?::\d{1,5})?\b`,

    // Paths, filenames, command switches, and code-like identifiers shown to
    // users as copyable examples. Keep the path patterns token-bounded rather
    // than consuming all prose after a Windows path.
    String.raw`\\\\(?:[?.]|[A-Za-z0-9._$@-]+)\\[^\s,;:!?()[\]{}<>"']+`,
    String.raw`\b[A-Za-z]:\\[^\s,;:!?()[\]{}<>"']+`,
    String.raw`(?<![A-Za-z0-9])\/{1,2}(?:[A-Za-z0-9._~@%+-]+\/)*[A-Za-z0-9._~@%+-]+`,
    String.raw`\b[A-Za-z0-9._$@-]+\\[A-Za-z0-9._$@-]+\b`,
    String.raw`(?<![A-Za-z0-9_-])--?[A-Za-z][A-Za-z0-9-]*(?:=[^\s]+)?`,
    String.raw`(?<![A-Za-z0-9._-])[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]{0,63})+(?![A-Za-z0-9._-])`,
    String.raw`(?<![A-Za-z0-9])(?:\.[A-Za-z0-9][A-Za-z0-9]{0,11})+(?![A-Za-z0-9])`,
    String.raw`\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b`,
    String.raw`\b(?:[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+)\b`,
    String.raw`(?<![A-Za-z0-9_])[a-z][a-z0-9]*(?:_[A-Za-z0-9*]+)+(?![A-Za-z0-9_*])`,
    String.raw`\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b`,
    String.raw`\b[A-Za-z_][A-Za-z0-9_.-]*=[^\s,;]+`,
    String.raw`\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}\b`,

    // Authoritative repository glossary (case-sensitive by design).
    String.raw`(?<![A-Za-z0-9])(?:${GLOSSARY_TERMS})(?![A-Za-z0-9])`,
  ].join("|"),
  "g",
);

function transformUnprotected(input, transform) {
  let result = "";
  let cursor = 0;
  for (const match of input.matchAll(PROTECTED_SEGMENT)) {
    const index = match.index ?? 0;
    result += transform(input.slice(cursor, index));
    result += match[0];
    cursor = index + match[0].length;
  }
  return result + transform(input.slice(cursor));
}

function applyCaseShape(source, replacement) {
  if (source === source.toUpperCase() && /[A-Z]/.test(source)) {
    return replacement.toUpperCase();
  }
  if (/^[A-Z]/.test(source)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

const PIRATE_PATTERN = new RegExp(
  `\\b(${Object.keys(PIRATE_PHRASES)
    .sort((left, right) => right.length - left.length)
    .map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})\\b`,
  "gi",
);

export function toLeetspeak(value) {
  return transformUnprotected(value, (plain) =>
    [...plain]
      .map((character) => LEET_MAP.get(character.toLowerCase()) ?? character)
      .join(""),
  );
}

export function toPirateSpeak(value) {
  return transformUnprotected(value, (plain) =>
    plain.replace(PIRATE_PATTERN, (matched) =>
      applyCaseShape(matched, PIRATE_PHRASES[matched.toLowerCase()]),
    ),
  );
}

export function transformCatalog(value, transform) {
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value)) {
    return value.map((item) => transformCatalog(item, transform));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        transformCatalog(child, transform),
      ]),
    );
  }
  return value;
}

export function generateStyledEnglishCatalogs(source) {
  return {
    "en-x-leet": transformCatalog(source, toLeetspeak),
    "en-x-pirate": transformCatalog(source, toPirateSpeak),
  };
}

export function styledCatalogTextMatches(actual, expected) {
  const normalizeLineEndings = (value) => value.replace(/\r\n?/g, "\n");
  return normalizeLineEndings(actual) === normalizeLineEndings(expected);
}

async function main() {
  const localesDirectory = path.join(REPOSITORY_ROOT, "src", "i18n", "locales");
  const source = JSON.parse(
    await readFile(path.join(localesDirectory, "en-US.json"), "utf8"),
  );
  const catalogs = generateStyledEnglishCatalogs(source);
  const check = process.argv.includes("--check");
  const stale = [];

  for (const [locale, catalog] of Object.entries(catalogs)) {
    const destination = path.join(localesDirectory, `${locale}.json`);
    const expected = `${JSON.stringify(catalog, null, 2)}\n`;
    if (check) {
      const actual = await readFile(destination, "utf8").catch(() => "");
      if (!styledCatalogTextMatches(actual, expected))
        stale.push(path.relative(REPOSITORY_ROOT, destination));
    } else {
      await writeFile(destination, expected, "utf8");
    }
  }

  if (stale.length > 0) {
    throw new Error(
      `Styled English locale catalogs are stale: ${stale.join(", ")}. Run node scripts/styled-english-locales.mjs.`,
    );
  }
}

if (process.argv[1] === SCRIPT_PATH) {
  await main();
}
