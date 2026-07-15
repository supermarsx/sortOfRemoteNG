import type {
  ConnectionEditorSearchDescriptor,
  ConnectionEditorSearchFieldDescriptor,
  ConnectionEditorTabDescriptor,
  ConnectionEditorTabId,
} from "./editorRegistry";

export type ConnectionEditorSearchFormData = Readonly<Record<string, unknown>>;

export type ConnectionEditorSearchDynamicValues = Readonly<
  Record<string, readonly string[] | undefined>
>;

export interface ConnectionEditorSearchIndexEntry {
  id: string;
  tabId: ConnectionEditorTabId;
  tabLabel: string;
  sectionId: string;
  sectionLabel: string;
  fieldId: string;
  focusId: string;
  fieldLabel: string;
  breadcrumb: string;
  segments: readonly string[];
}

export interface ConnectionEditorSearchResult extends ConnectionEditorSearchIndexEntry {
  snippet: string;
  matchedText: string;
}

const SENSITIVE_PATH_PARTS = new Set([
  "accesskey",
  "accesstoken",
  "answer",
  "answers",
  "apikey",
  "authkey",
  "authtoken",
  "backupcode",
  "backupcodes",
  "clientsecret",
  "key",
  "keys",
  "passphrase",
  "password",
  "passwords",
  "presharedkey",
  "privatekey",
  "providesecrets",
  "providersecrets",
  "publickey",
  "recoverycode",
  "recoverycodes",
  "secret",
  "secrets",
  "seedphrase",
  "serviceaccountkey",
  "totpsecret",
  "token",
  "tokens",
]);

const normalizePathPart = (part: string): string =>
  part.replace(/[^a-z0-9]/gi, "").toLowerCase();

export function isSensitiveConnectionEditorSearchPath(path: string): boolean {
  return path
    .split(".")
    .some((part) => SENSITIVE_PATH_PARTS.has(normalizePathPart(part)));
}

function valueAtPath(root: ConnectionEditorSearchFormData, path: string) {
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function collectSafeStrings(
  value: unknown,
  path: string,
  output: string[],
): void {
  if (isSensitiveConnectionEditorSearchPath(path)) return;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) output.push(trimmed);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectSafeStrings(item, `${path}.${index}`, output),
    );
    return;
  }

  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    collectSafeStrings(child, `${path}.${key}`, output);
  }
}

export function getSafeConnectionEditorSearchValues(
  formData: ConnectionEditorSearchFormData,
  paths: readonly string[] = [],
): readonly string[] {
  const values: string[] = [];
  for (const path of paths) {
    if (isSensitiveConnectionEditorSearchPath(path)) continue;
    collectSafeStrings(valueAtPath(formData, path), path, values);
  }
  return [...new Set(values)];
}

function matchesProtocol(
  field: ConnectionEditorSearchFieldDescriptor,
  protocol: string,
): boolean {
  if (field.protocols && !field.protocols.includes(protocol)) return false;
  if (
    field.protocolPrefixes &&
    !field.protocolPrefixes.some((prefix) => protocol.startsWith(prefix))
  ) {
    return false;
  }
  if (field.excludedProtocols?.includes(protocol)) return false;
  return true;
}

export function isConnectionEditorSearchFieldApplicable(
  field: ConnectionEditorSearchFieldDescriptor,
  formData: ConnectionEditorSearchFormData,
): boolean {
  const isGroup = formData.isGroup === true;
  if (field.connectionOnly && isGroup) return false;
  if (field.groupOnly && !isGroup) return false;

  const protocol =
    typeof formData.protocol === "string" ? formData.protocol : "";
  if (!matchesProtocol(field, protocol)) return false;

  if (field.visibleWhen) return field.visibleWhen(formData);
  return true;
}

const uniqueNonEmpty = (values: readonly (string | undefined)[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

export function buildConnectionEditorSearchIndex({
  descriptors,
  tabs,
  formData,
  dynamicValues = {},
}: {
  descriptors: readonly ConnectionEditorSearchDescriptor[];
  tabs: readonly ConnectionEditorTabDescriptor[];
  formData: ConnectionEditorSearchFormData;
  dynamicValues?: ConnectionEditorSearchDynamicValues;
}): readonly ConnectionEditorSearchIndexEntry[] {
  const tabLabels = new Map(tabs.map((tab) => [tab.id, tab.label]));
  const entries: ConnectionEditorSearchIndexEntry[] = [];

  for (const descriptor of descriptors) {
    const tabLabel = tabLabels.get(descriptor.tabId);
    if (!tabLabel) continue;

    const fields = [
      ...descriptor.fields,
      ...(descriptor.dynamicFields?.(formData) ?? []),
    ];
    for (const field of fields) {
      if (!isConnectionEditorSearchFieldApplicable(field, formData)) continue;

      const values = getSafeConnectionEditorSearchValues(
        formData,
        field.valuePaths,
      );
      const dynamic =
        dynamicValues[`${descriptor.id}:${field.id}`] ??
        dynamicValues[field.id] ??
        [];
      const segments = uniqueNonEmpty([
        field.label,
        ...(field.keywords ?? []),
        ...(field.copy ?? []),
        ...(field.optionText ?? []),
        ...dynamic,
        ...values,
        descriptor.label,
        ...descriptor.keywords,
        ...(descriptor.copy ?? []),
        tabLabel,
      ]);

      entries.push({
        id: `${descriptor.id}:${field.id}`,
        tabId: descriptor.tabId,
        tabLabel,
        sectionId: descriptor.id,
        sectionLabel: descriptor.label,
        fieldId: field.id,
        focusId: field.focusId ?? field.id,
        fieldLabel: field.label,
        breadcrumb: `${tabLabel} / ${descriptor.label}`,
        segments,
      });
    }
  }

  return entries;
}

function createSnippet(text: string, matchIndex: number, queryLength: number) {
  const radius = 44;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + queryLength + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${
    end < text.length ? "…" : ""
  }`;
}

export function searchConnectionEditorIndex(
  index: readonly ConnectionEditorSearchIndexEntry[],
  query: string,
): readonly ConnectionEditorSearchResult[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];

  const results: ConnectionEditorSearchResult[] = [];
  for (const entry of index) {
    const matchedText = entry.segments.find((segment) =>
      segment.toLocaleLowerCase().includes(normalizedQuery),
    );
    if (!matchedText) continue;

    const matchIndex = matchedText.toLocaleLowerCase().indexOf(normalizedQuery);
    results.push({
      ...entry,
      matchedText,
      snippet: createSnippet(matchedText, matchIndex, query.trim().length),
    });
  }

  return results;
}
