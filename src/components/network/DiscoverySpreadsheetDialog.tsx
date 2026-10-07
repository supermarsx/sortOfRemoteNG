"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Database, Folder, Globe, Table2 } from "lucide-react";
import { useConnections } from "../../contexts/useConnections";
import { useAppDocumentsStore } from "../../hooks/documents/useAppDocumentsStore";
import { useDocumentSession } from "../../hooks/documents/useDocumentSession";
import { useCurrentDatabaseSettings } from "../../hooks/settings/useCurrentDatabaseSettings";
import type { DiscoveredHost } from "../../types/connection/connection";
import type { DocumentScope } from "../../types/documents/document";
import type { SavedDiscoveryScan } from "../../utils/discovery/scanHistory";
import {
  createDiscoverySpreadsheet,
  saveDiscoverySpreadsheet,
  sameDiscoveryDocumentScope,
  DISCOVERY_DRAFT_NOTICE,
  DISCOVERY_SPREADSHEET_LIMIT_NOTICE,
} from "../../utils/discovery/discoverySpreadsheet";
import { hasPendingDocumentDraft } from "../../utils/documents/documentDrafts";
import {
  isDocumentTypeEnabled,
  normalizeDatabaseSettings,
} from "../../utils/documents/documentTypePolicy";
import { Select } from "../ui/forms/Select";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../ui/overlays/Modal";

export interface DiscoverySpreadsheetRequest {
  scan: SavedDiscoveryScan;
  filteredHosts?: DiscoveredHost[];
  filterText?: string;
}

export function DiscoverySpreadsheetDialog({
  request,
  onClose,
  onActivateSession,
}: {
  request: DiscoverySpreadsheetRequest;
  onClose: () => void;
  onActivateSession?: (id: string) => void;
}) {
  const context = useConnections();
  const id = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const appStore = useAppDocumentsStore();
  const policy = useCurrentDatabaseSettings();
  const openDocument = useDocumentSession(onActivateSession);
  const [storage, setStorage] = useState<"database" | "app">("database");
  const [name, setName] = useState(
    `Network scan · ${request.scan.name || new Date(request.scan.startedAt).toLocaleString()}`,
  );
  const [folder, setFolder] = useState("");
  const [selection, setSelection] = useState(
    request.filterText ? "filtered" : "all",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{
    id: string;
    scope: DocumentScope;
  } | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const mounted = useRef(false);
  const saving = useRef(false);
  const databaseKey = JSON.stringify(context.databaseAvailability ?? null);
  const [initialDatabaseKey] = useState(databaseKey);
  const owners = useRef<Partial<Record<"app" | "database", DocumentScope>>>({});
  const revoked = useRef(false);
  const store = storage === "app" ? appStore : context.documents;
  // Available stores retain their original leases for this dialog's lifetime.
  for (const [kind, source] of [
    ["app", appStore],
    ["database", context.documents],
  ] as const) {
    const scope = source?.scope;
    if (!owners.current[kind] && scope) owners.current[kind] = { ...scope };
    if (
      owners.current[kind] &&
      !sameDiscoveryDocumentScope(owners.current[kind], scope)
    )
      revoked.current = true;
  }
  if (databaseKey !== initialDatabaseKey) revoked.current = true;
  const scope = owners.current[storage];
  const invalidated = revoked.current;
  const ready =
    !!scope &&
    !!store?.scope &&
    (scope.kind ?? "database") === storage &&
    !invalidated &&
    (storage === "app" ||
      (context.databaseAvailability?.status === "ready" &&
        context.databaseAvailability.databaseId === scope.databaseId));
  const policyReady =
    storage === "app" ||
    (!policy.loading &&
      !!policy.settings &&
      !!scope &&
      policy.scope?.databaseId === scope.databaseId &&
      policy.scope?.generation === scope.generation);
  const enabled =
    policyReady &&
    (storage === "app" ||
      isDocumentTypeEnabled(policy.settings!, "spreadsheet"));
  const pendingDraft =
    !!scope && hasPendingDocumentDraft(scope.databaseId, storage);
  const folders =
    storage === "app"
      ? []
      : context.state.connections.filter((entry) => entry.isGroup);
  const folderById = new Map(folders.map((entry) => [entry.id, entry]));
  const folderOptions = folders
    .map((entry) => {
      const parts = [entry.name];
      const visited = new Set([entry.id]);
      let parent = entry.parentId;
      while (parent && !visited.has(parent)) {
        visited.add(parent);
        const ancestor = folderById.get(parent);
        if (!ancestor) break;
        parts.unshift(ancestor.name);
        parent = ancestor.parentId;
      }
      return { value: entry.id, label: parts.join(" / "), icon: Folder };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const latest = useRef({ context, store, storage, folder, ready });
  latest.current = { context, store, storage, folder, ready };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const assertCurrent = () => {
    if (
      !mounted.current ||
      revoked.current ||
      !latest.current.ready ||
      !sameDiscoveryDocumentScope(latest.current.store?.scope, scope)
    )
      throw Error(
        "Storage changed or locked. Close this export and reopen it to choose the current storage.",
      );
    const {
      storage: kind,
      folder: selected,
      context: current,
    } = latest.current;
    if (kind === "database") {
      // This API uses the availability epoch, not the document store's epoch.
      // Calling it even for the root catches native revocation before React renders.
      const available = current.databaseAvailability!;
      const connections =
        current.getCurrentConnections?.({
          databaseId: available.databaseId!,
          generation: available.generation,
        }) ?? current.state.connections;
      if (
        selected &&
        !connections.some((entry) => entry.id === selected && entry.isGroup)
      )
        throw Error(
          "The selected folder no longer exists. Choose another folder.",
        );
    }
  };
  const save = async () => {
    if (saving.current || saved || !scope) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      assertCurrent();
      const document = createDiscoverySpreadsheet({
        scan: request.scan,
        name,
        parentFolderId: storage === "app" ? null : folder || null,
        filtered: selection === "filtered",
        filterText: request.filterText,
        hosts:
          selection === "filtered" ? request.filteredHosts : request.scan.hosts,
      });
      await saveDiscoverySpreadsheet({
        document,
        scope,
        getStore: () => latest.current.store,
        assertCurrent,
        verifyPolicy: async () => {
          if (storage === "app") return;
          const api = latest.current.context.databaseSettings;
          if (
            !api?.scope ||
            api.scope.databaseId !== scope.databaseId ||
            api.scope.generation !== scope.generation
          )
            throw Error(
              "Current database document types could not be verified. Unlock and reload the database.",
            );
          const settings = normalizeDatabaseSettings(await api.read(scope));
          if (!isDocumentTypeEnabled(settings, "spreadsheet"))
            throw Error(
              "Spreadsheets are disabled. Enable them in Settings → Current Database → Document types.",
            );
        },
      });
      if (mounted.current && !revoked.current)
        setSaved({ id: document.id, scope: { ...scope } });
    } catch (cause) {
      if (mounted.current)
        setError(
          `${cause instanceof Error ? cause.message : "Export failed."} If a save was interrupted, check Documents before retrying.`,
        );
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const navigate = (documentId?: string) => {
    try {
      assertCurrent();
      if (
        documentId &&
        scope &&
        hasPendingDocumentDraft(scope.databaseId, storage)
      )
        throw Error(DISCOVERY_DRAFT_NOTICE);
      // Omitting documentId focuses the workspace without replacing its draft selection.
      openDocument({ scope: storage, ...(documentId ? { documentId } : {}) });
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Cannot open Documents.",
      );
    }
  };
  const locked = busy || !!saved || invalidated;
  return (
    <Modal
      isOpen
      ariaLabel="Export scan to Documents"
      onClose={busy ? undefined : onClose}
      closeOnEscape={!busy}
      closeOnBackdrop={!busy}
      initialFocusRef={nameInput}
      panelClassName="max-w-xl mx-4"
    >
      <ModalHeader
        className="px-4 py-3"
        titleClassName="text-sm"
        title={
          <span className="flex items-center gap-2">
            <Table2 size={18} aria-hidden="true" />
            Export scan to Documents
          </span>
        }
        showCloseButton={false}
      />
      <form
        className="flex min-h-0 flex-1 flex-col"
        aria-label="Scan spreadsheet details"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && enabled && !pendingDraft && name.trim()) void save();
        }}
      >
        <ModalBody className="px-4 py-3">
          <div ref={setPanel} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <p className="text-xs text-[var(--color-textSecondary)] sm:col-span-2">
              Four sheets: Scan, Hosts, Services and Probes.
            </p>
            {invalidated ? (
              <p role="alert" className="text-sm sm:col-span-2">
                Storage changed or locked. Close this export and reopen it.
              </p>
            ) : (
              <>
                <div className="space-y-1 sm:col-span-2">
                  <label
                    htmlFor={`${id}-name`}
                    className="block text-xs font-medium"
                  >
                    Document name
                  </label>
                  <input
                    ref={nameInput}
                    id={`${id}-name`}
                    className="sor-form-input w-full text-sm"
                    value={name}
                    maxLength={256}
                    required
                    autoComplete="off"
                    disabled={locked}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor={`${id}-results`}
                    className="block text-xs font-medium"
                  >
                    Results to export
                  </label>
                  <Select
                    id={`${id}-results`}
                    label="Results to export"
                    variant="form-sm"
                    className="w-full"
                    value={selection}
                    onChange={setSelection}
                    disabled={locked}
                    portalContainer={panel}
                    options={[
                      {
                        value: "all",
                        label: `All hosts (${request.scan.hosts.length})`,
                      },
                      ...(request.filteredHosts
                        ? [
                            {
                              value: "filtered",
                              label: `Filtered hosts (${request.filteredHosts.length})`,
                            },
                          ]
                        : []),
                    ]}
                  />
                  {selection === "filtered" && (
                    <p className="text-xs">
                      Filter: {request.filterText || "(empty)"}. Includes all
                      services of each matching host across all pages.
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor={`${id}-storage`}
                    className="block text-xs font-medium"
                  >
                    Document storage
                  </label>
                  <Select
                    id={`${id}-storage`}
                    label="Document storage"
                    variant="form-sm"
                    className="w-full"
                    searchable
                    value={storage}
                    disabled={locked}
                    portalContainer={panel}
                    onChange={(value) => {
                      setStorage(value as "app" | "database");
                      setFolder("");
                      setError("");
                    }}
                    options={[
                      {
                        value: "database",
                        label: "Current database (default)",
                        icon: Database,
                      },
                      {
                        value: "app",
                        label: "App-wide",
                        icon: Globe,
                        disabled: !appStore?.scope,
                      },
                    ]}
                  />
                  {storage === "app" && (
                    <p className="text-xs">
                      App-wide documents use application storage and are not
                      protected by the current database password.
                    </p>
                  )}
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label
                    htmlFor={`${id}-folder`}
                    className="block text-xs font-medium"
                  >
                    Document folder
                  </label>
                  <Select
                    id={`${id}-folder`}
                    label="Document folder"
                    variant="form-sm"
                    className="w-full"
                    searchable
                    searchPlaceholder="Search folders…"
                    value={folder}
                    onChange={setFolder}
                    disabled={locked || storage === "app"}
                    portalContainer={panel}
                    options={[
                      {
                        value: "",
                        label:
                          storage === "app" ? "App-wide root" : "Database root",
                        icon: Folder,
                      },
                      ...folderOptions,
                    ]}
                  />
                </div>
                {!ready && (
                  <p role="status" className="text-sm sm:col-span-2">
                    Open and unlock a protected database, or choose available
                    app-wide storage.
                  </p>
                )}
                {ready && !policyReady && (
                  <p role="status" className="text-sm sm:col-span-2">
                    {policy.error || "Checking document types…"}
                  </p>
                )}
                {ready && policyReady && !enabled && (
                  <p role="alert" className="text-sm sm:col-span-2">
                    Spreadsheets are disabled. Enable them in Settings → Current
                    Database → Document types.
                  </p>
                )}
              </>
            )}
            <details className="text-xs text-[var(--color-textSecondary)] sm:col-span-2">
              <summary className="cursor-pointer">Export limits</summary>
              <p className="mt-1">{DISCOVERY_SPREADSHEET_LIMIT_NOTICE}</p>
            </details>
            {pendingDraft && !invalidated && (
              <p role="alert" className="text-sm sm:col-span-2">
                {DISCOVERY_DRAFT_NOTICE}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-error sm:col-span-2">
                {error}
              </p>
            )}
            {saved && !invalidated && (
              <p role="status" className="text-sm sm:col-span-2">
                Spreadsheet saved to{" "}
                {storage === "app" ? "app-wide storage" : "the database"}.
              </p>
            )}
          </div>
        </ModalBody>
        <ModalFooter className="flex-wrap gap-2 px-4 py-3">
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
          {pendingDraft && ready && (
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              disabled={busy}
              onClick={() => navigate()}
            >
              Open Documents to resolve draft
            </button>
          )}
          {saved ? (
            <button
              type="button"
              className="sor-btn sor-btn-primary"
              disabled={!ready || pendingDraft}
              onClick={() => navigate(saved.id)}
            >
              Open document
            </button>
          ) : (
            <button
              type="submit"
              className="sor-btn sor-btn-primary"
              disabled={
                busy || !ready || !enabled || pendingDraft || !name.trim()
              }
            >
              {busy ? "Saving spreadsheet…" : "Save spreadsheet"}
            </button>
          )}
        </ModalFooter>
      </form>
    </Modal>
  );
}
