/* eslint-disable react-refresh/only-export-components, react/only-export-components */
import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useScriptManager } from "../../hooks/recording/useScriptManager";
import FilterToolbar from "./scriptManager/FilterToolbar";
import ScriptList from "./scriptManager/ScriptList";
import DetailPane from "./scriptManager/DetailPane";
import WebsiteUserScriptsPanel from "./scriptManager/WebsiteUserScriptsPanel";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
import { Select } from "../ui/forms";
import type { WebsiteUserScriptsLibraryBinding } from "../../hooks/recording/useWebsiteUserScripts";
import type { AutomationFamily } from "../../types/recording/automationLibrary";
const RepositoryCatalogPanel = lazy(
  () => import("./scriptManager/RepositoryCatalogPanel"),
);
const DefaultScriptCatalog = lazy(() =>
  import("./scriptManager/DefaultScriptCatalog").then((module) => ({
    default: module.DefaultScriptCatalog,
  })),
);

// Re-export shared types and constants for backward compatibility
export type {
  ManagedScript,
  ScriptLanguage,
  OSTag,
} from "./scriptManager/shared";
export {
  SCRIPTS_STORAGE_KEY,
  getDefaultScripts,
  OS_TAG_LABELS,
  OS_TAG_ICONS,
  languageLabels,
  languageIcons,
} from "./scriptManager/shared";

interface ScriptManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ScriptManager: React.FC<ScriptManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const mgr = useScriptManager(onClose, isOpen);
  const [view, setView] = useState<"terminal" | "website" | "browse">(
    "terminal",
  );
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogSource, setCatalogSource] = useState<"bundled" | "repository">(
    "bundled",
  );
  const [catalogFamily, setCatalogFamily] =
    useState<AutomationFamily>("terminal-script");
  const [websiteDirty, setWebsiteDirty] = useState(false);
  const [websiteBusy, setWebsiteBusy] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<{
    key: string;
    id: string;
    action: () => void;
  } | null>(null);
  const leaveRef = useRef<typeof pendingLeave>(null);
  const latestKey = useRef(mgr.accessKey);
  latestKey.current = mgr.accessKey;
  const clearLeave = () => {
    leaveRef.current = null;
    setPendingLeave(null);
  };
  useEffect(() => {
    clearLeave();
    setWebsiteDirty(false);
    setWebsiteBusy(false);
    setCatalogBusy(false);
  }, [mgr.accessKey]);
  const requestLeave = (action: () => void) => {
    if (
      (view === "terminal" && mgr.isEditing) ||
      (view === "website" && websiteDirty)
    ) {
      const next = { key: mgr.accessKey, id: crypto.randomUUID(), action };
      leaveRef.current = next;
      setPendingLeave(next);
    } else action();
  };
  const switchView = (next: typeof view) => {
    if (next === view || websiteBusy || catalogBusy || mgr.busy) return;
    requestLeave(() => {
      mgr.discardEdit();
      setView(next);
    });
  };

  if (!isOpen) return null;
  const library: WebsiteUserScriptsLibraryBinding = {
    api: mgr.api,
    scope: mgr.scope,
    accessKey: mgr.accessKey,
    enabled: mgr.available,
    settingsReady: Boolean(mgr.settingsReady),
    diagnostic: mgr.diagnostic,
    retry: mgr.retry,
    databaseRevision: mgr.databaseRevision,
  };

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <div
        className="flex shrink-0 flex-wrap gap-2 border-b border-[var(--color-border)] p-3"
        role="tablist"
        aria-label="Script library kind"
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === "terminal"}
          disabled={websiteBusy || catalogBusy || mgr.busy}
          className={`sor-tab-trigger ${view === "terminal" ? "sor-tab-trigger-active" : ""}`}
          onClick={() => switchView("terminal")}
        >
          Terminal scripts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "website"}
          disabled={websiteBusy || catalogBusy || mgr.busy}
          className={`sor-tab-trigger ${view === "website" ? "sor-tab-trigger-active" : ""}`}
          onClick={() => switchView("website")}
        >
          Website userscripts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "browse"}
          disabled={websiteBusy || catalogBusy || mgr.busy}
          className={`sor-tab-trigger ${view === "browse" ? "sor-tab-trigger-active" : ""}`}
          onClick={() => switchView("browse")}
        >
          Browse scripts
        </button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs">
        <label className="flex items-center gap-2">
          Library scope
          <Select
            label="Script library scope"
            variant="form-sm"
            className="w-auto max-w-xs"
            disabled={websiteBusy || catalogBusy || mgr.busy}
            value={mgr.scope.kind === "app" ? "app" : mgr.scope.databaseId}
            onChange={(value) => {
              if (websiteBusy || catalogBusy || mgr.busy) return;
              requestLeave(() => {
                mgr.discardEdit();
                mgr.changeScope(
                  value === "app"
                    ? { kind: "app" }
                    : { kind: "database", databaseId: value },
                );
              });
            }}
            options={[
              { value: "app", label: "App-wide" },
              ...(mgr.databaseScope
                ? [
                    {
                      value: mgr.databaseScope.databaseId,
                      label: "Current database",
                    },
                  ]
                : []),
              ...(mgr.scope.kind === "database" &&
              mgr.databaseScope?.databaseId !== mgr.scope.databaseId
                ? [
                    {
                      value: mgr.scope.databaseId,
                      label: "Owning database (unavailable)",
                    },
                  ]
                : []),
            ]}
          />
        </label>
        <span className="min-w-0 break-all text-[var(--color-textSecondary)]">
          {mgr.scope.kind === "app"
            ? "Shared across connections; separate from the current database."
            : `Database: ${mgr.scope.databaseId}. No app-wide fallback.`}
        </span>
        {view === "terminal" && (
          <button
            type="button"
            className="sor-btn sor-btn-secondary ml-auto"
            disabled={!mgr.available || mgr.busy || mgr.loading}
            onClick={() => void mgr.refresh()}
          >
            Reload library
          </button>
        )}
      </div>
      {view !== "website" && (!mgr.available || mgr.storageError) && (
        <div role="alert" className="shrink-0 px-4 py-3 text-sm text-warning">
          {mgr.storageError ??
            mgr.diagnostic?.message ??
            (!mgr.settingsReady
              ? "Waiting for app settings to initialize."
              : mgr.scope.kind === "database"
                ? "Open and unlock this library's owning database, or explicitly select App-wide."
                : "Checking the desktop library access listener. An open database is not required.")}
          {mgr.diagnostic?.retryable && (
            <button
              type="button"
              className="sor-btn sor-btn-secondary ml-2"
              onClick={mgr.retry}
            >
              Retry library access
            </button>
          )}
        </div>
      )}
      {view === "website" ? (
        <WebsiteUserScriptsPanel
          key={mgr.accessKey}
          library={library}
          onDirtyChange={setWebsiteDirty}
          onBusyChange={setWebsiteBusy}
        />
      ) : view === "browse" ? (
        <>
          <div
            className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] p-3"
            role="tablist"
            aria-label="Script catalog source"
          >
            <button
              type="button"
              role="tab"
              aria-selected={catalogSource === "bundled"}
              className={`sor-tab-trigger ${catalogSource === "bundled" ? "sor-tab-trigger-active" : ""}`}
              disabled={catalogBusy}
              onClick={() => setCatalogSource("bundled")}
            >
              Bundled scripts
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={catalogSource === "repository"}
              className={`sor-tab-trigger ${catalogSource === "repository" ? "sor-tab-trigger-active" : ""}`}
              disabled={catalogBusy}
              onClick={() => setCatalogSource("repository")}
            >
              Repositories / packages
            </button>
            {catalogSource === "repository" && (
              <label className="flex items-center gap-2 text-xs">
                Script kind
                <Select
                  label="Script kind"
                  variant="form-sm"
                  className="w-auto"
                  disabled={catalogBusy}
                  value={catalogFamily}
                  onChange={(value) => {
                    if (!catalogBusy)
                      setCatalogFamily(value as AutomationFamily);
                  }}
                  options={[
                    { value: "terminal-script", label: "Terminal scripts" },
                    { value: "website-script", label: "Website userscripts" },
                  ]}
                />
              </label>
            )}
          </div>
          <Suspense
            fallback={
              <p role="status" className="p-4">
                Loading bundled scripts…
              </p>
            }
          >
            {catalogSource === "bundled" ? (
              <DefaultScriptCatalog
                key={mgr.accessKey}
                library={library}
                onApplied={mgr.handleCatalogApplied}
                onBusyChange={setCatalogBusy}
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <RepositoryCatalogPanel
                  key={`${mgr.accessKey}:${catalogFamily}`}
                  api={mgr.api}
                  scope={mgr.scope}
                  family={catalogFamily}
                  accessKey={mgr.accessKey}
                  enabled={mgr.available}
                  onApplied={mgr.handleCatalogApplied}
                  onBusyChange={setCatalogBusy}
                />
              </div>
            )}
          </Suspense>
        </>
      ) : (
        <>
          <FilterToolbar mgr={mgr} />
          <fieldset
            disabled={mgr.busy || !mgr.ready}
            className="flex-1 flex min-h-0 overflow-hidden border-0 p-0"
          >
            <legend className="sr-only">Terminal script library</legend>
            <ScriptList mgr={mgr} />
            <DetailPane mgr={mgr} />
          </fieldset>
        </>
      )}
      <ConfirmDialog
        isOpen={pendingLeave !== null && pendingLeave.key === mgr.accessKey}
        title="Discard script draft?"
        message="This unsaved draft will be discarded. Your saved library will not change."
        confirmText="Discard draft"
        cancelText="Keep editing"
        variant="warning"
        confirmOnEnter={false}
        onCancel={clearLeave}
        onConfirm={() => {
          const current = pendingLeave;
          if (
            !current ||
            leaveRef.current?.id !== current.id ||
            latestKey.current !== current.key
          )
            return;
          clearLeave();
          current.action();
        }}
      />
      <ConfirmDialog
        isOpen={!!mgr.review}
        title={mgr.review?.title}
        message={mgr.review?.message ?? ""}
        confirmText={mgr.review?.destructive ? "Delete" : "Discard draft"}
        variant={mgr.review?.destructive ? "danger" : "warning"}
        confirmOnEnter={false}
        onConfirm={mgr.confirmReview}
        onCancel={mgr.cancelReview}
      />
    </div>
  );
};
