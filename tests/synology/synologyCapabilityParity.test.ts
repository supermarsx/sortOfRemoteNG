import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADMIN_READS,
  emptyAdminData,
} from "../../src/hooks/synology/synologyAdminData";
import {
  SYNOLOGY_ADMINISTRATOR_READS,
  SYNOLOGY_SECTION_READS,
} from "../../src/utils/synology/synologyAccess";

/**
 * Cross-language parity for the NAS API access contract (plan t84 §4.2/§4.3).
 * Rust `api_access.rs` decides what `syn_get_section_access` probes; the
 * frontend tables decide what the loader invokes and which snapshot reads the
 * validator accepts. Rust compares its table with a copy of the TS one, so this
 * suite reads the Rust source to fail on drift from the frontend side too.
 */
const API_ACCESS_SOURCE = "src-tauri/crates/sorng-synology/src/api_access.rs";
// Resolved from this file, not `new URL(…, import.meta.url)`, which Vite rewrites.
const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

type Privilege = "any" | "administrator" | "package" | "application";
const PRIVILEGE_HELPERS: Record<string, Privilege> = {
  any: "any",
  admin: "administrator",
  admin_package: "package",
  app: "application",
  app_package: "application",
};
const CLOSING: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** End (exclusive) of the string or raw string literal starting at `start`, or -1. */
function literalEnd(source: string, start: number) {
  if (source[start] === "r" && !/\w/.test(source[start - 1] ?? "")) {
    const raw = /^r(#*)"/.exec(source.slice(start, start + 260));
    if (raw) {
      const end = source.indexOf(`"${raw[1]}`, start + raw[0].length);
      return end < 0 ? source.length : end + 1 + raw[1].length;
    }
  }
  if (source[start] !== '"') return -1;
  let index = start + 1;
  while (index < source.length && source[index] !== '"')
    index += source[index] === "\\" ? 2 : 1;
  return index + 1;
}

/** End (exclusive) of the line or (nested) block comment starting at `start`, or -1. */
function commentEnd(source: string, start: number) {
  if (source.startsWith("//", start)) {
    const newline = source.indexOf("\n", start);
    return newline < 0 ? source.length : newline;
  }
  if (!source.startsWith("/*", start)) return -1;
  let depth = 0;
  let index = start;
  do {
    if (source.startsWith("/*", index)) depth += 1;
    else if (source.startsWith("*/", index)) depth -= 1;
    else {
      index += 1;
      continue;
    }
    index += 2;
  } while (depth > 0 && index < source.length);
  return index;
}

/** Rust source with comments blanked (newlines kept); literals stay verbatim. */
function stripRustComments(source: string) {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const literal = literalEnd(source, index);
    const comment = literal < 0 ? commentEnd(source, index) : -1;
    const end = literal > 0 ? literal : comment > 0 ? comment : index + 1;
    const text = source.slice(index, end);
    out += comment > 0 ? text.replace(/./g, " ") : text;
    index = end;
  }
  return out;
}

/** Top-level comma-separated items of a list body, trimmed. */
function listItems(body: string) {
  const items: string[] = [];
  const closers: string[] = [];
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const literal = literalEnd(body, index);
    const char = body[index];
    if (literal > 0) index = literal - 1;
    else if (CLOSING[char]) closers.push(CLOSING[char]);
    else if (")]}".includes(char)) {
      if (closers.pop() !== char) throw new Error(`Unbalanced "${char}"`);
    } else if (char === "," && closers.length === 0) {
      items.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (closers.length) throw new Error("Unclosed list");
  items.push(body.slice(start).trim());
  return items.filter(Boolean);
}

/** Body of `pub static <name>: … = &[ … ];` in comment-free Rust source. */
function staticListBody(source: string, name: string) {
  const header = new RegExp(`pub static ${name}\\s*:[^=]*=\\s*&\\[`).exec(
    source,
  );
  if (!header) throw new Error(`pub static ${name} not found`);
  const start = header.index + header[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    const literal = literalEnd(source, index);
    if (literal > 0) index = literal - 1;
    else if (source[index] === "[") depth += 1;
    else if (source[index] === "]" && --depth === 0)
      return source.slice(start, index);
  }
  throw new Error(`pub static ${name} is not closed`);
}

const unrecognized = (table: string, item: string): never => {
  throw new Error(`Unrecognized ${table} entry: ${item}`);
};
const fieldNames = (body: string, table: string) =>
  listItems(body).map(
    (item) => /^"([A-Za-z]\w*)"$/.exec(item)?.[1] ?? unrecognized(table, item),
  );

/** `SECTION_READS`, `READS` (field → probed APIs) and `API_PRIVILEGES` from `api_access.rs`. */
function parseRustAccessTables(rust: string) {
  const source = stripRustComments(rust);
  const sections = listItems(staticListBody(source, "SECTION_READS")).map(
    (item) => {
      const tuple =
        /^\(\s*"([A-Za-z]\w*)"\s*,\s*&\[([\s\S]*)\]\s*,?\s*\)$/.exec(item);
      return tuple
        ? ([tuple[1], fieldNames(tuple[2], "SECTION_READS")] as const)
        : unrecognized("SECTION_READS", item);
    },
  );
  const calls = new Map(
    Array.from(
      source.matchAll(
        /const ([A-Z][A-Z0-9_]*): ReadCall = (?:call|page)\(\s*"(SYNO\.[\w.]+)"/g,
      ),
      (match) => [match[1], match[2]] as const,
    ),
  );
  const reads = listItems(staticListBody(source, "READS")).map((item) => {
    const spec =
      /^read\(\s*"([A-Za-z]\w*)"\s*,\s*&\[([\s\S]*)\]\s*,?\s*\)$/.exec(item);
    if (!spec) return unrecognized("READS", item);
    const apis = listItems(spec[2]).map(
      (call) =>
        /^(?:call|page)\(\s*"(SYNO\.[\w.]+)"/.exec(call)?.[1] ??
        calls.get(call) ??
        unrecognized("READS alternative", call),
    );
    return { field: spec[1], apis };
  });
  const privileges = new Map(
    listItems(staticListBody(source, "API_PRIVILEGES")).map((item) => {
      const spec = /^(\w+)\(\s*"(SYNO\.[\w.]+)"/.exec(item);
      const privilege = spec ? PRIVILEGE_HELPERS[spec[1]] : undefined;
      return spec && privilege
        ? ([spec[2], privilege] as const)
        : unrecognized("API_PRIVILEGES", item);
    }),
  );
  return { sections, reads, privileges };
}

const sorted = (values: Iterable<string>) => [...values].sort();

describe(`capability parity with ${API_ACCESS_SOURCE}`, () => {
  const rust = parseRustAccessTables(
    readFileSync(resolve(REPOSITORY_ROOT, API_ACCESS_SOURCE), "utf8"),
  );
  const probedApis = new Map(
    rust.reads.map(({ field, apis }) => [field, apis]),
  );

  it("has the same sections and read fields as SYNOLOGY_SECTION_READS", () => {
    expect(rust.sections).toEqual(
      Object.entries(SYNOLOGY_SECTION_READS).map(([section, fields]) => [
        section,
        [...fields],
      ]),
    );
  });

  it("declares one read for every panel data field plus File Station information", () => {
    const fields = rust.reads.map(({ field }) => field);
    expect(new Set(fields).size).toBe(fields.length);
    const panelFields = Object.keys(emptyAdminData()).filter(
      (field) => field !== "dashboard" && field !== "selectedDiskSmart",
    );
    expect(sorted(fields)).toEqual(sorted([...panelFields, "fileStationInfo"]));
    const { dashboard: _dashboard, ...tabs } = ADMIN_READS;
    expect(sorted(fields)).toEqual(
      sorted([
        ...Object.values(tabs).flatMap((reads) => Object.keys(reads)),
        "fileStationInfo",
      ]),
    );
    expect(
      sorted(new Set(rust.sections.flatMap(([, reads]) => reads))),
    ).toEqual(sorted(fields));
  });

  it("maps every ADMIN_READS command to fields the access check probes", () => {
    const commands = Object.values(ADMIN_READS).flatMap((reads) =>
      Object.values(reads),
    );
    expect(new Set(commands).size).toBe(commands.length);
    const sections = new Map<string, readonly string[]>(rust.sections);
    for (const [tab, reads] of Object.entries(ADMIN_READS)) {
      const probed = sections.get(tab) ?? [];
      expect(probed, tab).not.toHaveLength(0);
      // The overview is one command over the dashboard section's reads.
      const loads: [string, readonly string[]][] =
        tab === "dashboard"
          ? [[ADMIN_READS.dashboard.dashboard, probed]]
          : Object.entries(reads).map(([field, command]) => [command, [field]]);
      if (tab !== "dashboard")
        expect(sorted(Object.keys(reads)), tab).toEqual(sorted(probed));
      for (const [command, fields] of loads) {
        expect(command).toMatch(/^syn_(?:get|list)_\w+$/);
        for (const field of fields)
          expect(
            probedApis.get(field) ?? [],
            `${command} → ${field}`,
          ).not.toHaveLength(0);
      }
    }
  });

  it("probes only APIs with a declared DSM privilege", () => {
    for (const { field, apis } of rust.reads)
      for (const api of apis)
        expect(rust.privileges.has(api), `${field} → ${api}`).toBe(true);
  });

  it("treats as administrator-only exactly the reads DSM defines that way", () => {
    const administratorOnly = rust.reads
      .filter(({ apis }) =>
        apis.every((api) => rust.privileges.get(api) === "administrator"),
      )
      .map(({ field }) => field);
    // SYNO.Core.Notification.Setting is in no DSM catalog, so that read is only
    // ever "not provided" and never evidence of the account's role.
    expect(sorted(SYNOLOGY_ADMINISTRATOR_READS)).toEqual(
      sorted(
        administratorOnly.filter((field) => field !== "notificationConfig"),
      ),
    );
  });
});

describe("Rust access table reader", () => {
  const source = (sectionReads: string) =>
    `const DSM_INFO: ReadCall = call("SYNO.DSM.Info", 2, "getinfo");
pub static API_PRIVILEGES: &[ApiSpec] = &[any("SYNO.DSM.Info"), admin_package(
    "SYNO.Docker.Image", CONTAINER_MANAGER,
)];
pub static READS: &[ReadSpec] = &[
    read("systemInfo", &[DSM_INFO]), // read("ghost", &[DSM_INFO]),
    read("dockerImages", &[page("SYNO.Docker.Image", 1, "list").with_strings(&[("type", "a]//b")])]),
];
pub static SECTION_READS: &[(&str, &[&str])] = &[${sectionReads}];`;

  it("ignores comments, keeps literals and follows rustfmt layouts", () => {
    const parsed = parseRustAccessTables(
      source(`
    /* ("ghost", &["x"]), /* nested */ */
    (
        "system",
        &[
            "systemInfo", // "utilization",
        ],
    ),
    ("docker", &["dockerImages"]),`),
    );
    expect(parsed.sections).toEqual([
      ["system", ["systemInfo"]],
      ["docker", ["dockerImages"]],
    ]);
    expect(parsed.reads).toEqual([
      { field: "systemInfo", apis: ["SYNO.DSM.Info"] },
      { field: "dockerImages", apis: ["SYNO.Docker.Image"] },
    ]);
    expect([...parsed.privileges]).toEqual([
      ["SYNO.DSM.Info", "any"],
      ["SYNO.Docker.Image", "package"],
    ]);
  });

  it("rejects entries it cannot read instead of skipping them", () => {
    expect(() =>
      parseRustAccessTables(source(`("system", SYSTEM_FIELDS)`)),
    ).toThrow(/Unrecognized SECTION_READS entry/);
    expect(() =>
      parseRustAccessTables(source(`("system", &["systemInfo", field])`)),
    ).toThrow(/Unrecognized SECTION_READS entry: field/);
    expect(() =>
      parseRustAccessTables(source("").replace("[DSM_INFO]", "[OTHER_CALL]")),
    ).toThrow(/Unrecognized READS alternative entry: OTHER_CALL/);
    expect(() =>
      parseRustAccessTables(source("").replace("any(", "anyone(")),
    ).toThrow(/Unrecognized API_PRIVILEGES entry/);
    expect(() =>
      parseRustAccessTables(source("").replace("pub static READS", "static X")),
    ).toThrow(/pub static READS not found/);
  });
});
