/** Metadata-only search. Nothing here ever sees a secret value. */
export type VaultSearchScope = "name" | "tags" | "types" | "assignments";

export const VAULT_SEARCH_SCOPES: readonly VaultSearchScope[] = [
  "name",
  "tags",
  "types",
  "assignments",
];

export interface VaultSearchOptions {
  query: string;
  scopes: readonly VaultSearchScope[];
  caseSensitive: boolean;
  regex: boolean;
}

export const DEFAULT_VAULT_SEARCH: Readonly<VaultSearchOptions> = Object.freeze(
  {
    query: "",
    scopes: VAULT_SEARCH_SCOPES,
    caseSensitive: false,
    regex: false,
  },
);

export interface VaultSearchFields {
  name: string;
  tags: readonly string[];
  types: readonly string[];
  assignments: string;
}

export interface CompiledVaultSearch {
  /** True when the query is a pattern the engine rejected. */
  invalid: boolean;
  /** True when the query is empty, so every row matches. */
  empty: boolean;
  test(fields: VaultSearchFields): boolean;
}

/** The legacy behaviour: trimmed, case-insensitive, every scope, no pattern. */
export function isDefaultSearch(options: VaultSearchOptions): boolean {
  return (
    !options.regex &&
    !options.caseSensitive &&
    VAULT_SEARCH_SCOPES.every((scope) => options.scopes.includes(scope))
  );
}

export function compileVaultSearch(
  options: VaultSearchOptions,
): CompiledVaultSearch {
  const query = options.query.trim();
  if (!query) return { invalid: false, empty: true, test: () => true };
  const scopes = new Set(options.scopes);
  const pick = (fields: VaultSearchFields) => {
    const parts: string[] = [];
    if (scopes.has("name")) parts.push(fields.name);
    if (scopes.has("types")) parts.push(...fields.types);
    if (scopes.has("tags")) parts.push(...fields.tags);
    if (scopes.has("assignments")) parts.push(fields.assignments);
    return parts;
  };
  if (options.regex) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(query, options.caseSensitive ? "" : "i");
    } catch {
      return { invalid: true, empty: false, test: () => false };
    }
    return {
      invalid: false,
      empty: false,
      test: (fields) => pick(fields).some((part) => pattern.test(part)),
    };
  }
  const fold = (value: string) =>
    options.caseSensitive ? value : value.toLocaleLowerCase();
  const needle = fold(query);
  return {
    invalid: false,
    empty: false,
    test: (fields) => fold(pick(fields).join(" ")).includes(needle),
  };
}
