export const VAULT_COLUMNS = [
  { id: "name", label: "Name", width: 240, min: 120 },
  { id: "source", label: "Source", width: 140, min: 90 },
  { id: "types", label: "Credential types", width: 240, min: 120 },
  { id: "categories", label: "Category tags", width: 200, min: 100 },
  { id: "assigned", label: "Assigned to", width: 160, min: 100 },
  { id: "updated", label: "Last updated", width: 180, min: 120 },
  { id: "actions", label: "Actions", width: 96, min: 80 },
] as const;
export type VaultColumn = (typeof VAULT_COLUMNS)[number]["id"];
export interface CredentialVaultView {
  columns: VaultColumn[];
  widths: Record<VaultColumn, number>;
  pageSize: 25 | 50 | 100 | 250;
  mode: "paged" | "infinite";
}

/** Presence-only inventory fields. No credential values or inferred category tags. */
export interface CredentialInventoryViewMetadata {
  key: string;
  name: string;
  source: "vault" | "connection";
  types: readonly string[];
  tags: readonly string[];
  protocols: readonly string[];
  applications: readonly string[];
  assignment: "assigned" | "unassigned" | "unavailable" | "connection";
  storage: readonly string[];
  updatedAt: string | null;
}

export const EMPTY_CREDENTIAL_FILTERS = {
  type: "",
  tag: "",
  protocol: "",
  application: "",
  assignment: "",
  storage: "",
};
export type CredentialInventoryFilters = typeof EMPTY_CREDENTIAL_FILTERS;
export type CredentialInventorySort = "name" | "source" | "updated";

export function credentialInventoryMatches(
  row: CredentialInventoryViewMetadata,
  filters: CredentialInventoryFilters,
): boolean {
  return (
    (!filters.type || row.types.includes(filters.type)) &&
    (!filters.tag || row.tags.includes(filters.tag)) &&
    (!filters.protocol || row.protocols.includes(filters.protocol)) &&
    (!filters.application || row.applications.includes(filters.application)) &&
    (!filters.assignment || row.assignment === filters.assignment) &&
    (!filters.storage || row.storage.includes(filters.storage))
  );
}

export function compareCredentialInventory(
  a: CredentialInventoryViewMetadata,
  b: CredentialInventoryViewMetadata,
  sort: CredentialInventorySort,
  direction: "asc" | "desc",
): number {
  let compared = 0;
  if (sort === "updated") {
    const left = a.updatedAt === null ? NaN : Date.parse(a.updatedAt);
    const right = b.updatedAt === null ? NaN : Date.parse(b.updatedAt);
    // Unknown connection timestamps stay last in either direction.
    if (Number.isFinite(left) !== Number.isFinite(right))
      return Number.isFinite(left) ? -1 : 1;
    if (Number.isFinite(left)) compared = left - right;
  } else {
    compared = (sort === "name" ? a.name : a.source).localeCompare(
      sort === "name" ? b.name : b.source,
    );
  }
  return (
    (direction === "asc" ? compared : -compared) ||
    a.name.localeCompare(b.name) ||
    a.key.localeCompare(b.key)
  );
}
export function normalizeCredentialVaultView(
  value: unknown,
): CredentialVaultView {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<CredentialVaultView>)
      : {};
  const columns = VAULT_COLUMNS.filter(
    ({ id }) =>
      id === "name" ||
      id === "actions" ||
      !Array.isArray(source.columns) ||
      source.columns.includes(id),
  ).map(({ id }) => id);
  const widths = Object.fromEntries(
    VAULT_COLUMNS.map(({ id, width, min }) => {
      const candidate = source.widths?.[id];
      return [
        id,
        typeof candidate === "number" && Number.isFinite(candidate)
          ? Math.max(min, Math.min(640, Math.round(candidate)))
          : width,
      ];
    }),
  ) as Record<VaultColumn, number>;
  return {
    columns,
    widths,
    pageSize: [25, 50, 100, 250].includes(source.pageSize ?? 0)
      ? source.pageSize!
      : 100,
    mode: source.mode === "infinite" ? "infinite" : "paged",
  };
}
