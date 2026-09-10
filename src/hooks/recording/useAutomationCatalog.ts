import { useEffect, useRef, useState } from "react";
import type {
  AutomationFamily,
  AutomationLibraryApi,
  AutomationLibrarySnapshot,
  AutomationScope,
} from "../../types/recording/automationLibrary";
import type {
  AutomationCatalogDocument,
  AutomationCatalogPreview,
  AutomationCatalogResolution,
} from "../../types/recording/automationCatalog";
import {
  applyAutomationCatalogPreview,
  catalogFromFile,
  discardAutomationCatalogPreview,
  exportAutomationCatalog,
  fetchAutomationCatalog,
  MAX_AUTOMATION_CATALOG_BYTES,
  previewAutomationCatalog,
} from "../../utils/recording/automationCatalog";

export interface AutomationCatalogOptions {
  api: AutomationLibraryApi;
  scope: AutomationScope;
  family: AutomationFamily;
  enabled: boolean;
  /** Owner/access epoch, including database generation; changes revoke pending reviews. */
  accessKey: string | number;
}
export function useAutomationCatalog(options: AutomationCatalogOptions) {
  const [document, setDocument] = useState<AutomationCatalogDocument | null>(
    null,
  );
  const [preview, setPreview] = useState<AutomationCatalogPreview | null>(null);
  const [destination, setDestination] =
    useState<AutomationLibrarySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const latest = useRef(options);
  latest.current = options;
  const identity = JSON.stringify([
    options.scope,
    options.family,
    options.enabled,
    options.accessKey,
  ]);
  const previous = useRef({ identity, api: options.api });
  const generation = useRef(0),
    mounted = useRef(true);
  const active = useRef<"read" | "write" | null>(null);
  const reviewed = useRef<{
    value: AutomationCatalogPreview;
    identity: string;
  } | null>(null);
  const source = useRef<AutomationCatalogDocument | null>(null);
  const sourceStale = useRef(false);
  const sourceIdentity = useRef<string | null>(null);
  const destinationIdentity = useRef<string | null>(null);
  if (
    previous.current.identity !== identity ||
    previous.current.api !== options.api
  ) {
    previous.current = { identity, api: options.api };
    generation.current++;
  }
  const discard = () => {
    if (reviewed.current)
      discardAutomationCatalogPreview(reviewed.current.value);
    reviewed.current = null;
    setPreview(null);
  };
  useEffect(() => {
    if (reviewed.current)
      discardAutomationCatalogPreview(reviewed.current.value);
    reviewed.current = null;
    active.current = null;
    source.current = null;
    sourceIdentity.current = null;
    sourceStale.current = false;
    setDocument(null);
    setStale(false);
    destinationIdentity.current = null;
    setDestination(null);
    setPreview(null);
    setBusy(false);
    setError(null);
    setMessage(null);
  }, [identity, options.api]);
  useEffect(() => {
    const operations = generation;
    const review = reviewed;
    mounted.current = true;
    return () => {
      mounted.current = false;
      operations.current++;
      if (review.current) discardAutomationCatalogPreview(review.current.value);
      review.current = null;
    };
  }, []);
  const current = (token: number) =>
    mounted.current && latest.current.enabled && token === generation.current;
  const assertCurrent = (token: number) => {
    if (!current(token))
      throw new Error(
        "Catalog access changed. Review the source and destination again.",
      );
  };
  const run = async (
    kind: "read" | "write",
    operation: (token: number) => Promise<void>,
  ) => {
    if (
      !latest.current.enabled ||
      !mounted.current ||
      previous.current.identity !== identity ||
      latest.current.api !== options.api ||
      active.current === "write"
    )
      return false;
    const token = ++generation.current;
    active.current = kind;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await operation(token);
      return current(token);
    } catch (failure) {
      if (current(token))
        setError(
          failure instanceof Error
            ? failure.message
            : "Catalog operation failed. No unreviewed import was applied.",
        );
      return false;
    } finally {
      if (current(token)) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  const accept = (next: AutomationCatalogDocument, token: number) => {
    assertCurrent(token);
    source.current = next;
    sourceIdentity.current = identity;
    sourceStale.current = false;
    setDocument(next);
    setStale(false);
    setMessage("Source loaded for review. Nothing was imported or executed.");
  };
  const refresh = (url: string) =>
    run("read", async (token) => {
      discard();
      sourceStale.current = true;
      setStale(true);
      const next = await fetchAutomationCatalog(url);
      accept(next, token);
    });
  const importFile = () =>
    run("read", async (token) => {
      discard();
      const { open } = await import("@tauri-apps/plugin-dialog");
      assertCurrent(token);
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Automation JSON manifest", extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      assertCurrent(token);
      const { stat, readTextFile } = await import("@tauri-apps/plugin-fs");
      assertCurrent(token);
      const info = await stat(path);
      assertCurrent(token);
      if (!info.isFile || info.size > MAX_AUTOMATION_CATALOG_BYTES)
        throw new Error("Choose a JSON manifest no larger than 2 MiB.");
      const body = await readTextFile(path);
      assertCurrent(token);
      // Recheck bytes after reading: the selected file can change after stat.
      if (new TextEncoder().encode(body).length > MAX_AUTOMATION_CATALOG_BYTES)
        throw new Error("The selected manifest exceeds 2 MiB.");
      const next = await catalogFromFile(body);
      accept(next, token);
    });
  const review = (ids: string[]) =>
    run("read", async (token) => {
      discard();
      if (!source.current || sourceStale.current)
        throw new Error(
          "Refresh or import a valid source before reviewing entries.",
        );
      const captured = structuredClone(source.current);
      const { api, scope, family } = latest.current;
      const snapshot = await api.read(structuredClone(scope), family);
      assertCurrent(token);
      const next = previewAutomationCatalog(captured, ids, snapshot);
      destinationIdentity.current = identity;
      setDestination(snapshot);
      reviewed.current = { value: next, identity: previous.current.identity };
      setPreview(next);
    });
  const apply = (resolutions: Record<string, AutomationCatalogResolution>) =>
    run("write", async (token) => {
      const review = reviewed.current;
      if (!review || review.identity !== previous.current.identity)
        throw new Error("Import review expired. Review again before applying.");
      assertCurrent(token);
      const next = await applyAutomationCatalogPreview(
        latest.current.api,
        review.value,
        { ...resolutions },
      );
      assertCurrent(token);
      discard();
      destinationIdentity.current = identity;
      setDestination(next);
      setMessage(
        `Reviewed import saved to ${next.scope.kind === "app" ? "the app library" : "the selected database library"}. Nothing was executed.`,
      );
    });
  const loadDestination = () =>
    run("read", async (token) => {
      const { api, scope, family } = latest.current;
      const snapshot = await api.read(structuredClone(scope), family);
      assertCurrent(token);
      destinationIdentity.current = identity;
      setDestination(snapshot);
    });
  const exportSelected = (
    ids: string[],
    expected?: AutomationLibrarySnapshot,
  ) =>
    run("write", async (token) => {
      const { api, scope, family } = latest.current;
      const snapshot = await api.read(structuredClone(scope), family);
      assertCurrent(token);
      if (
        expected &&
        (JSON.stringify(expected.scope) !== JSON.stringify(scope) ||
          expected.family !== family ||
          JSON.stringify(expected.entries) !== JSON.stringify(snapshot.entries))
      ) {
        throw new Error(
          "The library changed since review. Reload the destination before exporting.",
        );
      }
      const selected = [...new Set(ids)];
      const entries = selected.map((id) => {
        const entry = snapshot.entries.find((entry) => entry.payload.id === id);
        if (!entry)
          throw new Error(
            "The selected library entry changed. Review it again before exporting.",
          );
        return entry;
      });
      const body = exportAutomationCatalog({
        name: `${family} export`,
        entries,
      });
      const { save } = await import("@tauri-apps/plugin-dialog");
      assertCurrent(token);
      const path = await save({
        defaultPath: `${family}.json`,
        filters: [{ name: "Automation JSON manifest", extensions: ["json"] }],
      });
      if (!path) return;
      assertCurrent(token);
      // Re-read through the authority after the native dialog, not a cached flag.
      const checked = await api.read(structuredClone(scope), family);
      assertCurrent(token);
      if (JSON.stringify(checked.entries) !== JSON.stringify(snapshot.entries))
        throw new Error(
          "The library changed while the save dialog was open. Review the export again.",
        );
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      assertCurrent(token);
      await writeTextFile(path, body);
      assertCurrent(token);
      setMessage(
        `Exported ${entries.length} reviewed ${family} entries. Source code may contain sensitive information; keep the file private.`,
      );
    });
  const cancel = () => {
    // A started durable apply/write cannot be cancelled by hiding its UI.
    if (active.current === "write") return;
    generation.current++;
    active.current = null;
    discard();
    setBusy(false);
    setMessage(null);
  };
  return {
    document:
      options.enabled && sourceIdentity.current === identity ? document : null,
    destination:
      options.enabled && destinationIdentity.current === identity
        ? destination
        : null,
    preview:
      options.enabled && reviewed.current?.identity === identity
        ? preview
        : null,
    busy,
    error,
    message,
    stale,
    refresh,
    importFile,
    review,
    apply,
    exportSelected,
    loadDestination,
    cancel,
    discardPreview: discard,
  };
}
