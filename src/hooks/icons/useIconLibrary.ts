import { createElement, useSyncExternalStore } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { getConnectionIconDefinition } from "../../utils/icons/connectionIconCatalog";
import {
  assertKnownBuiltInReferences,
  entryForCustom,
  getIconLibrarySnapshot,
  getRuntimeIconEntry,
  subscribeIconLibrary,
  type IconLibraryEntry,
} from "../../utils/icons/iconLibraryRuntime";
import {
  MAX_ICON_IMPORT_BYTES,
  parseIconPack,
  parsePassiveSvg,
  serializePassiveSvg,
  validateIconLibrary,
  validateIconMetadata,
  type IconLibraryData,
  type CustomLibraryIcon,
  type IconMetadata,
} from "../../utils/icons/iconLibrary";
export { MAX_ICON_IMPORT_BYTES };
export { MAX_ICON_SVG_BYTES } from "../../utils/icons/iconLibrary";
export type { IconLibraryEntry };
export interface IconImportPreview {
  id: string;
  entries: IconLibraryEntry[];
  conflicts: Array<{
    key: string;
    existingLabel: string;
    incomingLabel: string;
  }>;
  warnings: string[];
}
let queue: Promise<void> = Promise.resolve();
const previews = new Map<
  string,
  { revision: number; candidate: IconLibraryData; conflicts: string[] }
>();
subscribeIconLibrary(() => previews.clear());
export function discardIconImport(preview: IconImportPreview): void {
  previews.delete(preview.id);
}
function current() {
  const state = getIconLibrarySnapshot();
  if (!state.ready || state.locked || state.error)
    throw new Error(
      state.error ??
        "Icon settings are not ready. Unlock or reload settings first.",
    );
  return state;
}
function mutate(
  revision: number,
  transform: (data: IconLibraryData) => IconLibraryData,
): Promise<void> {
  const pending = queue
    .catch(() => {})
    .then(async () => {
      const state = current();
      if (state.revision !== revision)
        throw new Error("The icon library changed. Review your changes again.");
      const data = validateIconLibrary(transform(structuredClone(state.data)));
      assertKnownBuiltInReferences(data);
      await SettingsManager.getInstance().saveIconLibrary(data, state.data);
    });
  queue = pending;
  return pending;
}
export function previewIconImport(
  text: string,
  format: "svg" | "json",
  label = "Imported icon",
): IconImportPreview {
  const state = current();
  let candidate: IconLibraryData;
  if (format === "svg") {
    const icon: CustomLibraryIcon = {
      key: `custom:${crypto.randomUUID()}`,
      ...validateIconMetadata({ label, notes: "" }),
      svg: parsePassiveSvg(text),
    };
    candidate = { version: 1, customIcons: [icon], builtInOverrides: {} };
  } else {
    const pack = parseIconPack(text);
    candidate = {
      version: 1,
      customIcons: pack.customIcons,
      builtInOverrides: Object.fromEntries(
        pack.builtInIcons.map(({ key, ...metadata }) => [key, metadata]),
      ),
    };
    assertKnownBuiltInReferences(candidate);
  }
  if (
    !candidate.customIcons.length &&
    !Object.keys(candidate.builtInOverrides).length
  )
    throw new Error("The icon pack is empty.");
  const entries: IconLibraryEntry[] = [
    ...candidate.customIcons.map(entryForCustom),
    ...Object.entries(candidate.builtInOverrides).map(([key, metadata]) => ({
      ...getRuntimeIconEntry(key)!,
      ...metadata,
    })),
  ];
  const conflicts = entries.flatMap((entry) => {
    const existing = getRuntimeIconEntry(entry.key);
    // Importing a built-in reference is an explicit metadata operation, even if currently default.
    return existing
      ? [
          {
            key: entry.key,
            existingLabel: existing.label,
            incomingLabel: entry.label,
          },
        ]
      : [];
  });
  const id = crypto.randomUUID();
  previews.clear();
  previews.set(id, {
    revision: state.revision,
    candidate,
    conflicts: conflicts.map((conflict) => conflict.key),
  });
  return {
    id,
    entries,
    conflicts,
    warnings: [
      "Built-in entries reference this app's catalog; only custom entries bundle vector artwork. JSON packs and SVG exports are plaintext files.",
    ],
  };
}
export async function applyIconImport(
  preview: IconImportPreview,
  resolutions: Record<string, "replace" | "skip">,
): Promise<void> {
  const held = previews.get(preview.id);
  if (!held) throw new Error("Import review expired. Preview the file again.");
  if (
    held.conflicts.some(
      (key) => !["replace", "skip"].includes(resolutions[key]),
    ) ||
    Object.keys(resolutions).some((key) => !held.conflicts.includes(key))
  )
    throw new Error("Review every conflicting icon before importing.");
  await mutate(held.revision, (data) => {
    for (const icon of held.candidate.customIcons) {
      if (resolutions[icon.key] === "skip") continue;
      data.customIcons = data.customIcons.filter(
        (existing) => existing.key !== icon.key,
      );
      data.customIcons.push(icon);
    }
    for (const [key, metadata] of Object.entries(
      held.candidate.builtInOverrides,
    ))
      if (resolutions[key] !== "skip") data.builtInOverrides[key] = metadata;
    return data;
  });
  previews.delete(preview.id);
}
export function exportIconPack(keys: string[]): string {
  const state = current();
  if (!keys.length || new Set(keys).size !== keys.length)
    throw new Error("Select distinct icons to export.");
  const entries = keys.map((key) => {
    const entry = getRuntimeIconEntry(key);
    if (!entry) throw new Error("A selected icon is no longer available.");
    return entry;
  });
  const pack = {
    format: "sorng-icon-library",
    version: 1,
    customIcons: state.data.customIcons.filter((icon) =>
      keys.includes(icon.key),
    ),
    builtInIcons: entries
      .filter((entry) => entry.kind === "builtin")
      .map(({ key, label, notes }) => ({ key, label, notes })),
  };
  const compact = JSON.stringify(pack);
  parseIconPack(compact);
  const pretty = JSON.stringify(pack, null, 2);
  return new TextEncoder().encode(pretty).byteLength <= MAX_ICON_IMPORT_BYTES
    ? pretty
    : compact;
}
export function exportLibrarySvg(key: string): string {
  const state = current();
  const entry = getRuntimeIconEntry(key);
  if (!entry) throw new Error("The selected icon is unavailable.");
  const custom = state.data.customIcons.find((icon) => icon.key === key);
  if (custom)
    return serializePassiveSvg({
      ...custom.svg,
      attrs: { ...custom.svg.attrs, xmlns: "http://www.w3.org/2000/svg" },
    });
  // Only our trusted catalog reaches this normalization. Untrusted imports
  // never receive an attribute-stripping bypass around strict validation.
  const doc = new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(entry.icon, {
        size: 24,
        xmlns: "http://www.w3.org/2000/svg",
      }),
    ),
    "image/svg+xml",
  );
  for (const element of [
    doc.documentElement,
    ...Array.from(doc.documentElement.getElementsByTagName("*")),
  ]) {
    for (const attr of Array.from(element.attributes)) {
      if (
        ["class", "color", "focusable"].includes(attr.name) ||
        attr.name.startsWith("aria-") ||
        attr.name.startsWith("data-")
      )
        element.removeAttribute(attr.name);
    }
  }
  return serializePassiveSvg(
    parsePassiveSvg(new XMLSerializer().serializeToString(doc.documentElement)),
  );
}
export function useIconLibrary() {
  const snapshot = useSyncExternalStore(
    subscribeIconLibrary,
    getIconLibrarySnapshot,
    getIconLibrarySnapshot,
  );
  return {
    entries: snapshot.entries,
    ready: snapshot.ready,
    locked: snapshot.locked,
    error: snapshot.error,
    accessEpoch: snapshot.revision,
    updateMetadata: (key: string, metadata: IconMetadata) =>
      mutate(snapshot.revision, (data) => {
        const builtin = getConnectionIconDefinition(key);
        if (builtin) {
          const validated = validateIconMetadata({
            ...metadata,
            label: metadata.label.trim() || builtin.label,
          });
          if (validated.label === builtin.label && !validated.notes)
            delete data.builtInOverrides[key];
          else data.builtInOverrides[key] = validated;
        } else {
          const icon = data.customIcons.find((icon) => icon.key === key);
          if (!icon) throw new Error("Custom icon no longer exists.");
          Object.assign(icon, validateIconMetadata(metadata));
        }
        return data;
      }),
    deleteCustom: (keys: string[]) =>
      mutate(snapshot.revision, (data) => {
        if (
          !keys.length ||
          new Set(keys).size !== keys.length ||
          keys.some((key) => !data.customIcons.some((icon) => icon.key === key))
        )
          throw new Error("Only existing custom icons can be deleted.");
        data.customIcons = data.customIcons.filter(
          (icon) => !keys.includes(icon.key),
        );
        return data;
      }),
    previewImport: previewIconImport,
    applyImport: applyIconImport,
    discardImport: discardIconImport,
    exportPack: exportIconPack,
    exportSvg: exportLibrarySvg,
  };
}
