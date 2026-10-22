export const VAULT_COLUMNS = [
  { id: "name", label: "Name", width: 240, min: 120 },
  { id: "source", label: "Source", width: 140, min: 90 },
  { id: "categories", label: "Category tags", width: 200, min: 100 },
  { id: "assigned", label: "Assigned to", width: 160, min: 100 },
  { id: "actions", label: "Actions", width: 96, min: 80 },
] as const;
export type VaultColumn = (typeof VAULT_COLUMNS)[number]["id"];
export interface CredentialVaultView {
  columns: VaultColumn[];
  widths: Record<VaultColumn, number>;
  pageSize: 25 | 50 | 100 | 250;
  mode: "paged" | "infinite";
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
