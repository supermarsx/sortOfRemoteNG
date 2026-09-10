import React, { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../../ui/dialogs/ConfirmDialog";
import {
  useWebsiteUserScripts,
  type WebsiteUserScriptsLibraryBinding,
} from "../../../hooks/recording/useWebsiteUserScripts";
import type { BrowserScript } from "../../../types/recording/webAutomation";
import ScriptCodeEditor from "../../ui/editor/ScriptCodeEditor";
import { MAX_WEB_SCRIPT_BYTES } from "../../../utils/recording/webAutomationLibrary";
import type { AutomationAccessFailure } from "../../../types/recording/automationLibrary";

const RECOVERY: Record<
  AutomationAccessFailure,
  { title: string; steps: string[] }
> = {
  initializing: {
    title: "Waiting for app settings",
    steps: [
      "Allow app settings to finish loading. The library will load automatically afterwards.",
      "No library has been reset or replaced.",
    ],
  },
  "desktop-required": {
    title: "Desktop app required",
    steps: [
      "Open the installed desktop app; this protected library is not available in a browser preview.",
      "Return to Website userscripts and retry. No plaintext fallback is created.",
    ],
  },
  "backend-unavailable": {
    title: "Desktop library backend unavailable",
    steps: [
      "Finish updating the desktop app, then close and reopen that app when your work is saved.",
      "Retry this library after restarting. Refreshing only the web interface does not update the native backend.",
    ],
  },
  locked: {
    title: "App-wide library encryption is locked",
    steps: [
      "Open Settings → Security and unlock global app encryption with your configured method.",
      "Return here and select Retry library. Opening a connection database does not unlock this separate app-wide library.",
    ],
  },
  "recovery-required": {
    title: "Storage recovery needs review",
    steps: [
      "Preserve the existing library and any recovery copies. Do not delete, overwrite or reset them.",
      "Review the recovery status in Settings → Security before making changes; retry only after recovery has been verified.",
    ],
  },
  "invalid-library": {
    title: "Library validation failed",
    steps: [
      "Preserve the original library or import file, and any export or backup you already have. Do not reset it to an empty library.",
      "Review its supported format, size and credential-free source, or seek storage recovery help; retry after correcting the cause.",
    ],
  },
  "database-unavailable": {
    title: "Selected database is unavailable",
    steps: [
      "Reopen and unlock the explicitly selected database before accessing its library.",
      "An app-wide library is separate; do not treat a different open database as the missing library.",
    ],
  },
  "access-changed": {
    title: "Library access changed",
    steps: [
      "Restore the expected app encryption access before continuing.",
      "Retry and review the current library before making another change.",
    ],
  },
  conflict: {
    title: "Library changed during the operation",
    steps: [
      "Retry to load the current library, then review its entries. A previous write may already have completed.",
      "Keep your draft and do not repeat an import or replacement blindly.",
    ],
  },
  "storage-unavailable": {
    title: "Protected storage unavailable",
    steps: [
      "Check that the desktop app can access its configured data directory and that app encryption is unlocked.",
      "Retry after resolving the access problem. Existing library data has not been reset.",
    ],
  },
};

function LibraryRecovery({ mgr }: { mgr: Manager }) {
  const [retrying, setRetrying] = useState(false);
  const pending = useRef(false);
  const code =
    mgr.diagnostic?.code ??
    (mgr.settingsReady === false ? "initializing" : null);
  const guidance =
    mgr.scope.kind === "database" &&
    (code === "locked" || code === "access-changed")
      ? {
          title: "Selected database library access changed",
          steps: [
            "Reopen and unlock the explicitly selected database, and unlock app encryption if it is locked.",
            "Retry and review this database library. No app-wide fallback or empty reset is performed.",
          ],
        }
      : code
        ? RECOVERY[code]
        : null;
  if (!guidance)
    return mgr.ready ? null : (
      <p role="status" className="text-sm">
        Loading the selected protected library…
      </p>
    );
  return (
    <div
      className="space-y-2 rounded border border-[var(--color-border)] p-3"
      aria-label="Library recovery guidance"
    >
      <p
        role={code === "initializing" ? "status" : "alert"}
        className="text-sm font-medium"
      >
        {guidance.title}
      </p>
      <p className="text-xs text-[var(--color-textMuted)]">
        Diagnostic: <code>{code}</code>
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {guidance.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {mgr.diagnostic?.retryable && (
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={mgr.busy || retrying || mgr.settingsReady === false}
          onClick={async () => {
            if (pending.current || mgr.busy || mgr.settingsReady === false)
              return;
            pending.current = true;
            setRetrying(true);
            try {
              await mgr.reload();
            } finally {
              pending.current = false;
              setRetrying(false);
            }
          }}
        >
          {retrying ? "Retrying…" : "Retry library"}
        </button>
      )}
    </div>
  );
}

type Manager = ReturnType<typeof useWebsiteUserScripts>;
interface Callbacks {
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  library?: WebsiteUserScriptsLibraryBinding;
}
function AccessibleScripts({
  mgr,
  onDirtyChange,
}: { mgr: Manager } & Callbacks) {
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<{
    item: BrowserScript;
    expected?: BrowserScript;
  } | null>(null);
  const [deleting, setDeleting] = useState<BrowserScript | null>(null);
  const [selected, setSelected] = useState<BrowserScript | null>(null);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  useEffect(() => {
    onDirtyChange?.(edit !== null);
  }, [edit, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const requestLeave = (action: () => void) => {
    if (edit) setPendingLeave(() => action);
    else action();
  };
  const current = selected
    ? mgr.scripts.find((item) => item.id === selected.id)
    : undefined;
  const stale =
    selected !== null && JSON.stringify(current) !== JSON.stringify(selected);
  const create = (source?: BrowserScript) =>
    requestLeave(() => {
      const now = new Date().toISOString();
      setDeleting(null);
      setSelected(null);
      setEdit({
        item: {
          id: crypto.randomUUID(),
          kind: "script",
          name: source ? `${source.name.slice(0, 93)} (Copy)` : "",
          description: source?.description ?? "",
          code: source?.code ?? "",
          createdAt: now,
          updatedAt: now,
        },
      });
    });
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="sor-form-input min-w-0 flex-1"
          aria-label="Search website userscripts"
          placeholder="Search website userscripts"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button
          type="button"
          className="sor-btn sor-btn-primary"
          disabled={mgr.busy}
          onClick={() => create()}
        >
          New website script
        </button>
      </div>
      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
        <div className="space-y-2">
          {mgr.scripts
            .filter((item) =>
              `${item.name} ${item.description}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((item) => (
              <button
                type="button"
                key={item.id}
                className={`w-full rounded border p-3 text-left ${selected?.id === item.id ? "border-primary" : "border-[var(--color-border)]"}`}
                disabled={mgr.busy}
                onClick={() => {
                  requestLeave(() => {
                    setEdit(null);
                    setDeleting(null);
                    setSelected(item);
                  });
                }}
              >
                <span className="block truncate font-medium">{item.name}</span>
                <span className="block truncate text-xs text-[var(--color-textMuted)]">
                  {item.description ||
                    `Manual website ${item.language === "typescript" ? "TypeScript" : "JavaScript"}`}
                </span>
              </button>
            ))}
          {!mgr.scripts.length && (
            <p className="text-sm">No website userscripts saved.</p>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          {edit ? (
            <>
              <label className="block text-sm">
                Script name
                <input
                  className="sor-form-input mt-1 w-full"
                  maxLength={100}
                  disabled={mgr.busy}
                  value={edit.item.name}
                  onChange={(event) =>
                    setEdit({
                      ...edit,
                      item: { ...edit.item, name: event.target.value },
                    })
                  }
                />
              </label>
              <label className="block text-sm">
                Description
                <input
                  className="sor-form-input mt-1 w-full"
                  maxLength={1000}
                  disabled={mgr.busy}
                  value={edit.item.description}
                  onChange={(event) =>
                    setEdit({
                      ...edit,
                      item: { ...edit.item, description: event.target.value },
                    })
                  }
                />
              </label>
              <label className="block text-sm">
                Website script language
                <select
                  className="sor-form-select mt-1"
                  value={edit.item.language ?? "javascript"}
                  disabled={mgr.busy}
                  onChange={(event) =>
                    setEdit({
                      ...edit,
                      item: {
                        ...edit.item,
                        language:
                          event.target.value === "typescript"
                            ? "typescript"
                            : "javascript",
                      },
                    })
                  }
                >
                  <option value="javascript">JavaScript</option>
                  <option value="typescript">TypeScript (standalone)</option>
                </select>
              </label>
              <div className="block text-sm">
                Website{" "}
                {edit.item.language === "typescript"
                  ? "TypeScript"
                  : "JavaScript"}
                <ScriptCodeEditor
                  ariaLabel={`Website ${edit.item.language === "typescript" ? "TypeScript" : "JavaScript"}`}
                  language={edit.item.language ?? "javascript"}
                  documentKey={edit.item.id}
                  minHeight={256}
                  readOnly={mgr.busy}
                  code={edit.item.code}
                  onChange={(code) =>
                    setEdit({
                      ...edit,
                      item: { ...edit.item, code },
                    })
                  }
                />
              </div>
              <p className="text-xs text-[var(--color-textMuted)]">
                Maximum 64 KiB of credential-free source. This is page
                JavaScript, not a browser-extension userscript engine; @grant,
                @require and automatic URL matching are not supported.
                TypeScript is compiled locally before manual execution; imports,
                exports, TSX and top-level await are unsupported. Syntax checks
                are not semantic type checking or a safety review.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={mgr.busy}
                  onClick={() => {
                    requestLeave(() => setEdit(null));
                  }}
                >
                  Cancel edit
                </button>
                <button
                  type="button"
                  className="sor-btn sor-btn-primary"
                  disabled={
                    mgr.busy ||
                    !edit.item.name.trim() ||
                    !edit.item.code.trim() ||
                    new TextEncoder().encode(edit.item.code).length >
                      MAX_WEB_SCRIPT_BYTES
                  }
                  onClick={async () => {
                    const item = {
                      ...edit.item,
                      name: edit.item.name.trim(),
                      updatedAt: new Date().toISOString(),
                    };
                    if (await mgr.save(item, edit.expected)) {
                      setEdit(null);
                      setSelected(item);
                    }
                  }}
                >
                  Save website script
                </button>
              </div>
            </>
          ) : selected && stale ? (
            <div className="space-y-2">
              <p role="status">
                This script was {current ? "changed" : "deleted"} in another
                library view. Review its current version before using inspection
                actions.
              </p>
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                onClick={() => {
                  setDeleting(null);
                  setSelected(current ?? null);
                }}
              >
                {current ? "Review current version" : "Clear selection"}
              </button>
            </div>
          ) : selected ? (
            <>
              <h3 className="font-medium">{selected.name}</h3>
              <p className="text-sm">{selected.description}</p>
              <ScriptCodeEditor
                code={selected.code}
                language={selected.language ?? "javascript"}
                onChange={() => {}}
                readOnly
                ariaLabel="Website script source"
                documentKey={`${selected.id}:${selected.updatedAt}`}
                minHeight={200}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={mgr.busy}
                  onClick={() =>
                    setEdit({
                      item: structuredClone(selected),
                      expected: structuredClone(selected),
                    })
                  }
                >
                  Edit website script
                </button>
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={mgr.busy}
                  onClick={() => create(selected)}
                >
                  Duplicate website script
                </button>
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={mgr.busy}
                  onClick={() => setDeleting(structuredClone(selected))}
                >
                  Delete website script
                </button>
              </div>
              {deleting && (
                <div className="rounded border border-warning p-3 space-y-2">
                  <p className="text-sm">
                    Delete “{deleting.name}” from the protected library?
                    Existing connection favorite references will remain
                    unresolved until removed or replaced.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="sor-btn sor-btn-secondary"
                      disabled={mgr.busy}
                      onClick={() => setDeleting(null)}
                    >
                      Cancel deletion
                    </button>
                    <button
                      type="button"
                      className="sor-btn sor-btn-danger"
                      disabled={mgr.busy}
                      onClick={async () => {
                        if (await mgr.remove(deleting)) {
                          setDeleting(null);
                          setSelected(null);
                        }
                      }}
                    >
                      Confirm deletion
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-[var(--color-textMuted)]">
              Select a website script to review its source, or create one. This
              manager never executes scripts.
            </p>
          )}
        </div>
      </div>
      <ConfirmDialog
        isOpen={pendingLeave !== null}
        title="Discard website script draft?"
        message="Your unsaved website script changes will be discarded. Saved scripts and favorites are unchanged."
        confirmText="Discard draft"
        cancelText="Keep editing"
        variant="warning"
        confirmOnEnter={false}
        onCancel={() => setPendingLeave(null)}
        onConfirm={() => {
          const action = pendingLeave;
          setPendingLeave(null);
          action?.();
        }}
      />
    </div>
  );
}
export default function WebsiteUserScriptsPanel({
  onDirtyChange,
  onBusyChange,
  library,
}: Callbacks = {}) {
  const mgr = useWebsiteUserScripts(library);
  useEffect(() => {
    onBusyChange?.(mgr.busy);
    return () => onBusyChange?.(false);
  }, [mgr.busy, onBusyChange]);
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label="Website userscript library"
    >
      <div className="border-b border-[var(--color-border)] p-4 space-y-2">
        <h2 className="font-medium">
          Website userscripts · JavaScript / TypeScript
        </h2>
        <p className="text-sm">
          {mgr.scope.kind === "app"
            ? "An app-wide protected library, independent of the currently open connection database."
            : "A protected library belonging only to the explicitly selected database."}{" "}
          Pin saved scripts from the website action bar; running still requires
          global availability, explicit per-connection script permission and
          normal confirmation. Editing here grants none of those permissions.
        </p>
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-textMuted)]">
          <div>
            <dt className="inline font-medium">Scope: </dt>
            <dd
              className="inline"
              title={
                mgr.scope.kind === "database" ? mgr.scope.databaseId : undefined
              }
            >
              {mgr.scope.kind === "app"
                ? "App-wide"
                : `Selected database (${mgr.scope.databaseId.slice(0, 8)}…)`}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Settings: </dt>
            <dd className="inline">
              {mgr.settingsReady === false
                ? "Loading"
                : mgr.settingsReady
                  ? "Ready"
                  : "Checking"}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Desktop bridge: </dt>
            <dd className="inline">
              {mgr.desktopAvailable === null ||
              mgr.desktopAvailable === undefined
                ? "Checking"
                : mgr.desktopAvailable
                  ? "Available"
                  : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Library: </dt>
            <dd className="inline">
              {mgr.ready ? "Ready" : "Unavailable / loading"}
            </dd>
          </div>
        </dl>
        <LibraryRecovery mgr={mgr} />
      </div>
      {mgr.ready ? (
        <AccessibleScripts
          key={mgr.epoch}
          mgr={mgr}
          onDirtyChange={onDirtyChange}
        />
      ) : null}
    </section>
  );
}
