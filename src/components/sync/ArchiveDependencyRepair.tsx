import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnections } from "../../contexts/useConnections";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { createAutomationLibraryApi } from "../../utils/recording/automationLibrary";
import { normalizeDatabaseAutomationLibrary } from "../../utils/recording/automationLibraryValidation";
import {
  prepareArchiveDependencyRepair,
  applyArchiveDependencyRepair,
  type ArchiveDependencyRepairReview,
} from "../../utils/connection/archiveDependencyResolution";
import type { AutomationEntry } from "../../types/recording/automationLibrary";
import type { StorageData } from "../../utils/storage/storage";

const buttons =
  "rounded border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-surfaceHover)] disabled:opacity-50";
/** Explicit review only; an error message never triggers private database reads. */
export function ArchiveDependencyRepair({
  databaseId,
  onRepaired,
}: {
  databaseId: string;
  onRepaired?: () => void;
}) {
  const { t } = useTranslation();
  const context = useConnections();
  const manager = DatabaseManager.getInstance();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ArchiveDependencyRepairReview>();
  const [original, setOriginal] = useState<StorageData>();
  const [undo, setUndo] = useState<{
    databaseId: string;
    expected: StorageData;
    before: StorageData;
  }>();
  const [message, setMessage] = useState("");
  const translated = (key: string, fallback: string) =>
    t(`archiveRepair.${key}`, fallback);
  async function exclusive(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch {
      setMessage(
        translated(
          "failed",
          "The operation did not finish. Review the current database before retrying; saved repairs may be retained.",
        ),
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const flush = async () => {
    if (manager.getCurrentDatabase()?.id === databaseId)
      await context.flushPendingSave();
  };
  const refresh = async () => {
    if (manager.getCurrentDatabase()?.id === databaseId)
      await context.loadData(databaseId);
  };
  const load = () =>
    exclusive(async () => {
      await flush();
      const data = await manager.loadDatabaseData(databaseId);
      if (!data) throw new Error("Unavailable database");
      const app = createAutomationLibraryApi();
      const next = await prepareArchiveDependencyRepair(
        databaseId,
        data,
        async (scope, family, id) => {
          if (scope.kind === "app")
            return (await app.read(scope, family)).entries.find(
              (entry) => entry.payload.id === id,
            );
          const foreign = await manager.loadDatabaseData(scope.databaseId);
          if (!foreign) return;
          const library = normalizeDatabaseAutomationLibrary(
            foreign.automationLibrary,
          );
          const payloads =
            family === "terminal-script"
              ? [
                  ...library.terminalScripts.customScripts,
                  ...library.terminalScripts.modifiedDefaults,
                ]
              : family === "terminal-macro"
                ? library.terminalMacros
                : family === "website-script"
                  ? library.website.scripts
                  : library.website.macros;
          const payload = payloads.find((item) => item.id === id);
          return payload ? ({ family, payload } as AutomationEntry) : undefined;
        },
      );
      setOriginal(data);
      setReview(next);
    });
  const apply = (ids: string[]) =>
    exclusive(async () => {
      if (!review || !original || review.databaseId !== databaseId)
        throw new Error("Expired review");
      await flush();
      const result = applyArchiveDependencyRepair(review, ids);
      await manager.commitArchiveDependencyRepair(
        databaseId,
        original,
        result.data,
      );
      // saveDatabaseData pins the committed representation to this exact object.
      // A later read could include someone else's edit and must never bless undo.
      setUndo({ databaseId, expected: result.data, before: original });
      await refresh();
      setReview(undefined);
      setOriginal(undefined);
      setMessage(
        result.remaining.totalIssues
          ? translated(
              "remaining",
              "Fixes saved. Review the remaining dependencies before retrying.",
            )
          : translated(
              "ready",
              "Dependencies repaired. Retry the export or sync to continue.",
            ),
      );
      onRepaired?.();
    });
  const undoFix = () =>
    exclusive(async () => {
      if (!undo || undo.databaseId !== databaseId)
        throw new Error("Expired undo");
      await flush();
      await manager.commitArchiveDependencyRepair(
        databaseId,
        undo.expected,
        undo.before,
      );
      await refresh();
      setUndo(undefined);
      setReview(undefined);
      setOriginal(undefined);
      setMessage(translated("undone", "Dependency repairs undone."));
    });
  return (
    <section
      className="mt-2 space-y-2 text-[var(--color-text)]"
      aria-label={translated("label", "Repair archive dependencies")}
    >
      <button
        type="button"
        disabled={busy}
        className={buttons}
        onClick={() => void load()}
      >
        {translated("review", "Review dependency fixes")}
      </button>
      {review?.databaseId === databaseId && (
        <>
          {review.issues.length === 0 ? (
            <p>{translated("none", "No unresolved dependencies remain.")}</p>
          ) : (
            <>
              <p>
                {translated(
                  "preview",
                  "Review each change. Copies receive no new execution trust; unavailable dependencies remain unchanged unless you remove them.",
                )}
              </p>
              <ul className="space-y-2">
                {review.issues.map((row) => (
                  <li key={row.id}>
                    <span className="break-all">{row.issue.path}</span>
                    {" · "}
                    {row.action === "manual" ? (
                      <span>
                        {translated(
                          "manual",
                          "Open the owning connection or document and choose an available database-owned target.",
                        )}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        className={buttons}
                        onClick={() => void apply([row.id])}
                      >
                        {row.recycled
                          ? translated("restore", "Restore and fix")
                          : row.action === "copy-and-rebind"
                            ? translated(
                                "copy",
                                "Copy into this database and reselect",
                              )
                            : row.action === "remove-reference"
                              ? translated("remove", "Remove this reference")
                              : row.action === "move-to-root"
                                ? translated("root", "Move to database root")
                                : translated(
                                    "resetGroup",
                                    "Reset default tab group",
                                  )}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy || !review.issues.some((row) => row.safe)}
                className={buttons}
                onClick={() =>
                  void apply(
                    review.issues
                      .filter((row) => row.safe)
                      .map((row) => row.id),
                  )
                }
              >
                {translated("all", "Fix all safe issues")}
              </button>
            </>
          )}
        </>
      )}
      {undo?.databaseId === databaseId && (
        <button
          type="button"
          disabled={busy}
          className={buttons}
          onClick={() => void undoFix()}
        >
          {translated("undo", "Undo dependency repairs")}
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
