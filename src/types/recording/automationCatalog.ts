import type {
  AutomationEntry,
  AutomationFamily,
  AutomationLibrarySnapshot,
  AutomationPayloads,
  AutomationProvenance,
} from "./automationLibrary";

export type AutomationCatalogItem = {
  [K in AutomationFamily]: {
    id: string;
    kind: K;
    description: string;
    platforms: string[];
    tags?: string[];
    license?: string;
    /** Exported history is informational and never an official-source grant. */
    provenance?: AutomationProvenance;
    payload: AutomationPayloads[K];
  };
}[AutomationFamily];
export interface AutomationCatalogManifest {
  format: "sorng-automation-index";
  version: 1;
  id: string;
  name: string;
  description: string;
  publisher?: { name: string; homepage?: string };
  repository?: { url: string; ref: string; path: string };
  entries: AutomationCatalogItem[];
}
export interface AutomationCatalogSource {
  kind: "remote" | "file";
  /** Only generated locally from the fetched/file bytes. Not manifest input. */
  sha256: string;
  fetchedAt: string;
  url?: string;
}
export interface AutomationCatalogDocument {
  manifest: AutomationCatalogManifest;
  source: AutomationCatalogSource;
}
export interface AutomationCatalogPreview {
  snapshot: AutomationLibrarySnapshot;
  source: AutomationCatalogSource;
  rows: { id: string; name: string; conflict: boolean; canReplace: boolean }[];
}
export type AutomationCatalogResolution = "skip" | "copy" | "replace";
export interface AutomationCatalogExport {
  name: string;
  entries: readonly AutomationEntry[];
}
