import React, { useCallback, useContext, useEffect, useState } from "react";
import { AlertTriangle, RotateCcw, ShieldCheck, X } from "lucide-react";
import { ConnectionContext } from "../../../../contexts/ConnectionContextTypes";
import { defaultBulkScripts } from "../../../../data/defaultBulkScripts";
import { useAutomationLibraryApi } from "../../../../hooks/recording/useAutomationLibraryApi";
import { useScriptRunTrust } from "../../../../hooks/recording/useScriptRunTrust";
import { bulkScriptsStore } from "../../../../hooks/ssh/bulkScriptLibrary";
import type { AutomationScope } from "../../../../types/recording/automationLibrary";
import { nativeManagedScriptsStore } from "../../../../utils/recording/managedScriptPersistence";
import {
  bulkScriptRunContent,
  digestRunContent,
  scriptTrustEntryKey,
  scriptTrustSubjectKey,
  sshMacroRunContent,
  sshScriptCommand,
  sshScriptRunContent,
  type ScriptTrustEntry,
  type ScriptTrustKind,
  type ScriptTrustLibrary,
} from "../../../../utils/recording/scriptRunTrust";
import { resolveSavedConnectionTrustBinding } from "../../../../utils/recording/scriptRunTrustBinding";
import { TERMINAL_MACROS_STORE_KEY } from "../../../../utils/recording/terminalMacroPersistence";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../../../utils/storage/appDataJsonStore";
import { ConfirmDialog } from "../../../ui/dialogs/ConfirmDialog";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
} from "../../../ui/settings/SettingsPrimitives";

/**
 * Settings, Macros, "Trusted scripts": every script and macro the user chose
 * to run without being asked, with Revoke per entry and Revoke all. Names
 * are looked up in the libraries by id; the list never shows script text, a
 * step, a host or a user name. What it shows is a picture of the record: a
 * run always consults the record itself.
 */

const APP: AutomationScope = { kind: "app" };

const KIND_LABELS: Record<ScriptTrustKind, string> = {
  "ssh-script": "SSH script",
  "ssh-macro": "Terminal macro",
  "bulk-script": "Bulk script",
};

const STATE_LABELS = {
  trusted: "Runs without asking",
  changed: "Changed since it was trusted: asks again",
  missing: "Not in the library: nothing to run",
  unknown: "Cannot be checked here",
} as const;

type RowState = keyof typeof STATE_LABELS;

interface LibrarySubject {
  name: string;
  /** What a run would send now; only ever digested, never shown. */
  content: string;
}

interface Libraries {
  subjects: ReadonlyMap<string, LibrarySubject>;
  /** The kinds and libraries that were read, as `libraryKey`. */
  read: ReadonlySet<string>;
}

const NO_LIBRARIES: Libraries = { subjects: new Map(), read: new Set() };

const libraryKey = (kind: ScriptTrustKind, library: ScriptTrustLibrary) =>
  JSON.stringify([
    kind,
    library.kind === "database" ? library.databaseId : null,
  ]);

const LIBRARY_KEYS: ReadonlySet<string> = new Set([
  nativeManagedScriptsStore.key,
  TERMINAL_MACROS_STORE_KEY,
  bulkScriptsStore.key,
]);

/** Names and current content of the scripts the list may name, by subject. */
function useTrustedScriptLibraries(): Libraries {
  const bridge = useAutomationLibraryApi();
  const [libraries, setLibraries] = useState<Libraries>(NO_LIBRARIES);
  const [changes, setChanges] = useState(0);
  const databaseId = bridge.databaseScope?.databaseId ?? null;

  useEffect(() => {
    const onChange = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (typeof key === "string" && LIBRARY_KEYS.has(key))
        setChanges((value) => value + 1);
    };
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, onChange);
    return () =>
      window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, onChange);
  }, []);

  const { api, ready, accessEpoch, databaseRevision } = bridge;
  useEffect(() => {
    let live = true;
    const subjects = new Map<string, LibrarySubject>();
    const read = new Set<string>();
    const add = (
      kind: ScriptTrustKind,
      library: ScriptTrustLibrary,
      subjectId: string,
      name: string,
      content: string,
    ) =>
      subjects.set(scriptTrustSubjectKey({ kind, library, subjectId }), {
        name,
        content,
      });
    const readTerminal = async (library: AutomationScope) => {
      const [scripts, macros] = await Promise.all([
        api.read(library, "terminal-script"),
        api.read(library, "terminal-macro"),
      ]);
      for (const { payload } of scripts.entries)
        add(
          "ssh-script",
          library,
          payload.id,
          payload.name,
          sshScriptRunContent(
            payload.language,
            sshScriptCommand(payload.script),
          ),
        );
      for (const { payload } of macros.entries)
        add(
          "ssh-macro",
          library,
          payload.id,
          payload.name,
          sshMacroRunContent(payload.steps),
        );
      read.add(libraryKey("ssh-script", library));
      read.add(libraryKey("ssh-macro", library));
    };
    const readBulk = async () => {
      const result = await bulkScriptsStore.load();
      for (const script of [
        ...defaultBulkScripts,
        ...(result.value?.active ?? []),
      ])
        add(
          "bulk-script",
          APP,
          script.id,
          script.name,
          bulkScriptRunContent(script.script),
        );
      read.add(libraryKey("bulk-script", APP));
    };
    const tasks: Promise<void>[] = [readBulk().catch(() => undefined)];
    if (ready) {
      tasks.push(readTerminal(APP).catch(() => undefined));
      if (databaseId)
        tasks.push(
          readTerminal({ kind: "database", databaseId }).catch(() => undefined),
        );
    }
    void Promise.all(tasks).then(() => {
      if (live) setLibraries({ subjects, read });
    });
    return () => {
      live = false;
    };
  }, [api, ready, accessEpoch, databaseRevision, databaseId, changes]);

  return libraries;
}

interface RowView {
  key: string;
  entry: ScriptTrustEntry;
  /** Null when the script is not in its library, or the library is not open here. */
  name: string | null;
  libraryRead: boolean;
  scopeLabel: string;
  state: RowState;
}

const displayName = (row: RowView): string =>
  row.name ??
  (row.libraryRead ? "Not in the library" : "Library not open here");

const formatDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
};

export const TrustedScriptsSection: React.FC = () => {
  const trust = useScriptRunTrust();
  const libraries = useTrustedScriptLibraries();
  const context = useContext(ConnectionContext);
  const [rows, setRows] = useState<readonly RowView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const availability = context?.databaseAvailability;
  const connections = context?.state.connections;
  const getCurrentConnections = context?.getCurrentConnections;
  const { entries } = trust;

  useEffect(() => {
    let live = true;
    const bindingContext = {
      state: { connections: connections ?? [] },
      databaseAvailability: availability,
      getCurrentConnections,
    };
    const rowsOf = async () =>
      Promise.all(
        entries.map(async (entry): Promise<RowView> => {
          const libraryRead = libraries.read.has(
            libraryKey(entry.kind, entry.library),
          );
          const subject = libraries.subjects.get(scriptTrustSubjectKey(entry));
          let scopeLabel = "Everywhere";
          let state: RowState = !libraryRead
            ? "unknown"
            : !subject
              ? "missing"
              : (await digestRunContent(entry.kind, subject.content)) ===
                  entry.contentDigest
                ? "trusted"
                : "changed";
          if (entry.scope === "connection" && entry.connection) {
            const bound = entry.connection;
            const here =
              availability?.status === "ready" &&
              availability.databaseId === bound.databaseId;
            if (!here) {
              scopeLabel = "A connection in another database";
              if (state === "trusted") state = "unknown";
            } else {
              const saved = (
                getCurrentConnections && availability
                  ? getCurrentConnections({
                      databaseId: bound.databaseId,
                      generation: availability.generation,
                    })
                  : (connections ?? [])
              ).find((row) => row.id === bound.connectionId);
              scopeLabel = saved?.name
                ? `On ${saved.name}`
                : "A connection that is no longer saved";
              const now = await resolveSavedConnectionTrustBinding(
                bindingContext,
                bound,
              );
              if (state === "trusted")
                state = !now
                  ? "unknown"
                  : now.endpointDigest === bound.endpointDigest
                    ? "trusted"
                    : "changed";
            }
          }
          return {
            key: scriptTrustEntryKey(entry),
            entry,
            name: subject?.name ?? null,
            libraryRead,
            scopeLabel,
            state,
          };
        }),
      );
    rowsOf()
      .then((next) => {
        if (live) setRows(next);
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [entries, libraries, availability, connections, getCurrentConnections]);

  const revoke = useCallback(
    async (row: RowView) => {
      setError(null);
      const result = await trust.revoke(row.entry);
      if (!result.ok)
        setError("The trust could not be revoked. Nothing was changed.");
    },
    [trust],
  );

  const revokeAll = useCallback(async () => {
    setConfirmAll(false);
    setError(null);
    setBusy(true);
    try {
      const result = await trust.revokeAll();
      if (!result.ok)
        setError("The list could not be cleared. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }, [trust]);

  // Rows lag the record by one digest round; show only those still in it.
  const listed = trust.status === "ready" ? rows : [];

  return (
    <div
      className="space-y-4"
      data-testid="trusted-scripts"
      data-setting-key="macros.trustedScripts"
    >
      <SectionHeader
        icon={<ShieldCheck className="w-4 h-4 text-primary" />}
        title="Trusted scripts"
      />
      <Card>
        <p className="text-xs text-[var(--color-textMuted)]">
          Scripts and macros you chose to run without being asked. Each one
          covers only the exact text that was trusted: after a change it asks
          again.
        </p>

        {trust.status === "loading" && (
          <p className="text-sm text-[var(--color-textSecondary)]">
            Loading trusted scripts...
          </p>
        )}

        {trust.status === "unavailable" && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-sm text-[var(--color-text)]"
          >
            <AlertTriangle size={14} aria-hidden="true" />
            <span>
              The list of trusted scripts could not be read. Nothing is trusted.
            </span>
            {trust.reason === "unreadable" ? (
              <button
                type="button"
                data-testid="trusted-scripts-reset"
                className="sor-btn-secondary-sm inline-flex items-center gap-1"
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (!busy) void revokeAll();
                }}
              >
                <RotateCcw size={12} aria-hidden="true" />
                Reset the list
              </button>
            ) : (
              <button
                type="button"
                data-testid="trusted-scripts-retry"
                className="sor-btn-secondary-sm"
                onClick={() => void trust.refresh()}
              >
                Try again
              </button>
            )}
          </div>
        )}

        {trust.status === "ready" && trust.entries.length === 0 && (
          <p
            className="text-sm text-[var(--color-textSecondary)]"
            data-testid="trusted-scripts-empty"
          >
            No script is trusted. You are asked before each run.
          </p>
        )}

        {trust.status === "ready" && trust.entries.length > 0 && (
          <>
            <div className="flex justify-end">
              <button
                type="button"
                data-testid="trusted-scripts-revoke-all"
                className="sor-btn-danger-sm"
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (!busy) setConfirmAll(true);
                }}
              >
                Revoke all
              </button>
            </div>
            <ul
              data-testid="trusted-scripts-list"
              aria-label="Trusted scripts"
              className="divide-y divide-[var(--color-border)]"
            >
              {listed.map((row) => {
                const name = displayName(row);
                return (
                  <li
                    key={row.key}
                    data-testid="trusted-scripts-row"
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                  >
                    <span
                      data-testid="trusted-scripts-name"
                      className={
                        row.name
                          ? "font-medium text-[var(--color-text)]"
                          : "italic text-[var(--color-textMuted)]"
                      }
                    >
                      {name}
                    </span>
                    <span className="text-xs text-[var(--color-textSecondary)]">
                      {KIND_LABELS[row.entry.kind]}
                    </span>
                    <span
                      data-testid="trusted-scripts-scope"
                      className="text-xs text-[var(--color-textSecondary)]"
                    >
                      {row.scopeLabel}
                    </span>
                    {row.entry.risk === "destructive" && (
                      <span
                        data-testid="trusted-scripts-destructive"
                        className="inline-flex items-center gap-1 text-xs text-error"
                      >
                        <AlertTriangle size={12} aria-hidden="true" />
                        Destructive
                      </span>
                    )}
                    <span
                      data-testid="trusted-scripts-state"
                      data-state={row.state}
                      className="text-xs text-[var(--color-textMuted)]"
                    >
                      {STATE_LABELS[row.state]}
                    </span>
                    <time
                      dateTime={row.entry.grantedAt}
                      className="text-xs text-[var(--color-textMuted)]"
                    >
                      {formatDate(row.entry.grantedAt)}
                    </time>
                    <button
                      type="button"
                      data-testid="trusted-scripts-revoke"
                      className="sor-btn-secondary-sm ml-auto inline-flex items-center gap-1"
                      aria-label={`Revoke trust for ${name}`}
                      onClick={() => void revoke(row)}
                    >
                      <X size={12} aria-hidden="true" />
                      <span aria-hidden="true">Revoke</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </Card>
      <ConfirmDialog
        isOpen={confirmAll}
        title="Revoke all trusted scripts"
        message="Every trusted script and macro will ask again before it runs."
        confirmText="Revoke all"
        variant="danger"
        onConfirm={() => void revokeAll()}
        onCancel={() => setConfirmAll(false)}
      />
    </div>
  );
};

export default TrustedScriptsSection;
