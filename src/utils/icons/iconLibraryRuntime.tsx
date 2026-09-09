import { createElement, forwardRef, useSyncExternalStore } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
  type ConnectionIconCategory,
  type ConnectionIconKey,
} from "./connectionIconCatalog";
import {
  EMPTY_ICON_LIBRARY,
  validateIconLibrary,
  type IconLibraryData,
  type PassiveSvgNode,
  type CustomIconKey,
} from "./iconLibrary";

export type SelectableConnectionIconKey = ConnectionIconKey | CustomIconKey;
export interface IconLibraryEntry {
  key: SelectableConnectionIconKey;
  kind: "builtin" | "custom";
  label: string;
  originalLabel: string;
  notes: string;
  category: ConnectionIconCategory | "custom";
  keywords: readonly string[];
  icon: LucideIcon;
}
export interface IconLibrarySnapshot {
  revision: number;
  ready: boolean;
  locked: boolean;
  error: string | null;
  data: IconLibraryData;
  entries: IconLibraryEntry[];
}
const listeners = new Set<() => void>();
const names: Record<string, string> = {
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
  "fill-opacity": "fillOpacity",
  "stroke-opacity": "strokeOpacity",
};
function nodeElement(node: PassiveSvgNode, key: string): React.ReactNode {
  const props = Object.fromEntries(
    Object.entries(node.attrs).map(([name, value]) => [
      names[name] ?? name,
      value,
    ]),
  );
  return createElement(
    node.tag,
    { ...props, key },
    ...node.children.map((child, index) =>
      nodeElement(child, `${key}-${index}`),
    ),
  );
}
function customComponent(node: PassiveSvgNode): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(
    ({ size = 24, color = "currentColor", ...props }, ref) => {
      const attrs = Object.fromEntries(
        Object.entries(node.attrs).map(([name, value]) => [
          names[name] ?? name,
          value,
        ]),
      );
      return createElement(
        "svg",
        {
          ...attrs,
          xmlns: "http://www.w3.org/2000/svg",
          width: size,
          height: size,
          color,
          ...props,
          ref,
        },
        ...node.children.map((child, index) =>
          nodeElement(child, String(index)),
        ),
      );
    },
  );
  Icon.displayName = "CustomLibraryIcon";
  return Icon;
}
function buildEntries(data: IconLibraryData): IconLibraryEntry[] {
  return [
    ...CONNECTION_ICON_CATALOG.map((definition) => ({
      key: definition.key,
      kind: "builtin" as const,
      label: data.builtInOverrides[definition.key]?.label ?? definition.label,
      originalLabel: definition.label,
      notes: data.builtInOverrides[definition.key]?.notes ?? "",
      category: definition.category,
      keywords: definition.keywords,
      icon: definition.icon,
    })),
    ...data.customIcons.map((icon) => ({
      key: icon.key,
      kind: "custom" as const,
      label: icon.label,
      originalLabel: icon.label,
      notes: icon.notes,
      category: "custom" as const,
      keywords: ["custom", "imported"],
      icon: customComponent(icon.svg),
    })),
  ];
}
let snapshot: IconLibrarySnapshot = {
  revision: 0,
  ready: false,
  locked: false,
  error: null,
  data: EMPTY_ICON_LIBRARY,
  entries: buildEntries(EMPTY_ICON_LIBRARY),
};
let byKey = new Map(
  snapshot.entries.map((entry) => [entry.key as string, entry]),
);
export const getIconLibrarySnapshot = () => snapshot;
export function subscribeIconLibrary(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}
export function useIconLibraryRevision(): number {
  return useSyncExternalStore(
    subscribeIconLibrary,
    () => snapshot.revision,
    () => 0,
  );
}
export function getRuntimeIconEntry(
  key: string | undefined,
): IconLibraryEntry | undefined {
  return key ? byKey.get(key.trim().toLowerCase()) : undefined;
}
/** Called only by authoritative settings load/commit/sync and lock lifecycle. */
export function publishIconLibrary(
  value: unknown,
  state: { ready: boolean; locked?: boolean; error?: string | null },
): void {
  let data = EMPTY_ICON_LIBRARY;
  let error = state.error ?? null;
  try {
    if (state.ready && !state.locked) data = validateIconLibrary(value);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Invalid icon library";
  }
  const ready = state.ready && !state.locked && !error;
  if (
    snapshot.ready === ready &&
    snapshot.locked === !!state.locked &&
    snapshot.error === error &&
    JSON.stringify(snapshot.data) === JSON.stringify(data)
  )
    return;
  snapshot = {
    revision: snapshot.revision + 1,
    ready,
    locked: !!state.locked,
    error,
    data,
    entries: buildEntries(data),
  };
  byKey = new Map(
    snapshot.entries.map((entry) => [entry.key as string, entry]),
  );
  listeners.forEach((listener) => listener());
}
export function assertKnownBuiltInReferences(data: IconLibraryData): void {
  if (
    Object.keys(data.builtInOverrides).some(
      (key) => !getConnectionIconDefinition(key),
    )
  )
    throw new Error(
      "This icon pack references built-in icons unavailable in this version. Update the app or remove those references before import.",
    );
}
export function entryForCustom(
  icon: IconLibraryData["customIcons"][number],
): IconLibraryEntry {
  return {
    key: icon.key,
    kind: "custom",
    label: icon.label,
    originalLabel: icon.label,
    notes: icon.notes,
    category: "custom",
    keywords: ["custom", "imported"],
    icon: customComponent(icon.svg),
  };
}
