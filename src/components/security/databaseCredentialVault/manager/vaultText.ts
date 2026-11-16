import { useCallback } from "react";
import { useTranslation } from "react-i18next";

/**
 * English source for the credential vault manager chrome. The same keys live
 * in en-US.json under `vaultManager`; tests keep the two in step. Values may
 * use `{{name}}` placeholders.
 */
export const VAULT_TEXT = {
  searchLabel: "Search vault credentials",
  searchPlaceholder: "Search names, tags, types or assignments",
  searchOptions: "Search options",
  searchInName: "Name",
  searchInTags: "Category tags",
  searchInTypes: "Credential types",
  searchInAssignments: "Assigned connections",
  searchMatchCase: "Match case",
  searchRegex: "Regular expression",
  searchAllGroups: "Search in all groups",
  searchInvalidRegex: "Invalid regular expression",
  clearSearch: "Clear search",
  toolbarLabel: "Credential list controls",
  actionsLabel: "Credential actions",
  moreActions: "More actions",
  newEntry: "New credential",
  editEntry: "Edit credential",
  deleteEntry: "Delete credential",
  deleteSelected: "Delete {{count}} selected",
  copyUsername: "Copy username",
  copyPassword: "Copy password",
  copyTotp: "Copy 2FA code",
  goToConnection: "Go to connection",
  openConnection: "Open connection",
  generatePassword: "Generate password",
  importArchive: "Import archive",
  exportArchive: "Export archive",
  exportSelected: "Export selected",
  reloadVault: "Reload vault",
  sortMenu: "Sort",
  sortBy: "Sort by",
  sortName: "Name",
  sortSource: "Source",
  sortUpdated: "Last updated",
  sortAscending: "Ascending",
  sortDescending: "Descending",
  viewMenu: "View",
  viewColumns: "Columns",
  viewDensity: "Row density",
  densityCompact: "Compact",
  densityComfortable: "Comfortable",
  viewPaging: "List mode",
  pagingPaged: "Paged",
  pagingInfinite: "Continuous",
  showGroups: "Show groups",
  hideGroups: "Hide groups",
  showDetails: "Show details",
  hideDetails: "Hide details",
  shortcuts: "Keyboard shortcuts",
  needSelection: "Select a credential first",
  needSingle: "Select exactly one credential",
  notAvailable: "Not available for this selection",
  filtersLabel: "Quick filters",
  chipAssigned: "Assigned",
  chipUnassigned: "Unassigned",
  chipRecent: "Updated this week",
  chipStale: "Not updated in 6 months",
  chipHasPassword: "Has password",
  chipHasTotp: "Has 2FA",
  chipHasPrivateKey: "Has private key",
  groupsLabel: "Credential groups",
  groupsTitle: "Groups",
  groupAll: "All credentials",
  groupVault: "Reusable vault",
  groupConnections: "Connections",
  groupUnassigned: "Unassigned",
  groupTags: "Category tags",
  groupNoTags: "No category tags yet",
  selectedCount: "{{count}} selected",
  selectedCountOne: "1 selected",
  clearSelection: "Clear selection",
  bulkActions: "Bulk actions",
  detailsLabel: "Credential details",
  detailsEmpty: "Select a credential to see its details.",
  detailsMultiple: "{{count}} credentials selected.",
  tabGeneral: "General",
  tabUsage: "Usage",
  tabProperties: "Properties",
  fieldName: "Name",
  fieldSource: "Source",
  fieldTypes: "Credential types",
  fieldTags: "Category tags",
  fieldCreated: "Created",
  fieldUpdated: "Last updated",
  fieldId: "Identifier",
  fieldStorage: "Storage",
  fieldProtocol: "Protocol",
  fieldApplication: "Application",
  none: "None",
  notReported: "Not reported",
  noAssignments: "Not assigned to any connection.",
  secretsHidden:
    "Secret values are not shown here. Use Edit to open the private editor.",
  statusEntries: "{{count}} credentials",
  statusShown: "{{count}} shown",
  statusLastUpdated: "Latest change {{when}}",
  clipboardCountdown: "Clipboard clears in {{seconds}}s",
  contextMenu: "Credential menu",
  generatorTitle: "Password generator",
  generatorLength: "Length",
  generatorLowercase: "Lowercase (a-z)",
  generatorUppercase: "Uppercase (A-Z)",
  generatorDigits: "Digits (0-9)",
  generatorSymbols: "Symbols",
  generatorAmbiguous: "Exclude look-alike characters",
  generatorRegenerate: "Generate again",
  generatorCopy: "Copy generated password",
  generatorCopied: "Generated password copied.",
  generatorFailed: "The password could not be copied.",
  generatorOutput: "Generated password",
  generatorQuality: "Password quality",
  generatorBits: "{{bits}} bits",
  qualityVeryWeak: "Very weak",
  qualityWeak: "Weak",
  qualityFair: "Fair",
  qualityGood: "Good",
  qualityStrong: "Strong",
  helpTitle: "Keyboard shortcuts",
  helpClose: "Close shortcuts",
  shortcutSearch: "Focus search",
  shortcutCopyUsername: "Copy username",
  shortcutCopyPassword: "Copy password",
  shortcutCopyTotp: "Copy 2FA code",
  shortcutOpenConnection: "Open connection",
  shortcutEdit: "Edit credential",
  shortcutCreate: "New credential",
  shortcutDelete: "Delete selected",
  shortcutSelectAll: "Select all",
  shortcutGenerator: "Password generator",
  shortcutReload: "Reload vault",
  shortcutHelp: "Show this help",
  shortcutEscape: "Clear selection or close",
} as const;

export type VaultTextKey = keyof typeof VAULT_TEXT;
export type VaultTextVars = Record<string, string | number>;

function interpolate(template: string, vars?: VaultTextVars): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
    String(vars[name] ?? ""),
  );
}

/** `tx(key, vars)` resolves through i18next, falling back to the English source. */
export function useVaultText() {
  const { t } = useTranslation();
  return useCallback(
    (key: VaultTextKey, vars?: VaultTextVars): string => {
      const fallback = VAULT_TEXT[key];
      const resolved = t(`vaultManager.${key}`, {
        defaultValue: fallback,
        ...vars,
        interpolation: { escapeValue: false },
      });
      return typeof resolved === "string" && resolved !== `vaultManager.${key}`
        ? interpolate(resolved, vars)
        : interpolate(fallback, vars);
    },
    [t],
  );
}
export type VaultTx = ReturnType<typeof useVaultText>;
