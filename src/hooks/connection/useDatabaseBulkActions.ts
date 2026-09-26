import { useContext, useEffect, useRef, useState } from "react";
import { ToastContext } from "../../contexts/ToastContext";
import type { ConnectionDatabase } from "../../types/connection/connection";
import {
  flushDatabaseIfCurrent,
  performDatabaseAction,
  withDatabaseMutation,
  type DatabaseActionContext,
} from "../../utils/connection/databaseActions";
import {
  saveDatabaseBulkExport,
  validateDatabaseBulkExport,
  type DatabaseBulkExportOptions,
} from "../../utils/connection/databaseBulkExport";
import type { DatabaseExportSnapshot } from "../../utils/connection/databaseManager";

export type DatabaseBulkAction =
  "clone" | "export" | "delete" | "lock" | "unlock" | "metadata";
export interface DatabaseBulkResult {
  id: string;
  name: string;
  status: "success" | "failed" | "skipped" | "cancelled" | "prepared";
  message: string;
}
export interface DatabaseBulkOptions {
  passwords?: Record<string, string>;
  namePattern?: string;
  description?: string;
  export?: DatabaseBulkExportOptions;
}

function actionError(error: unknown, passwords: string[]): string {
  let message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "The operation failed.";
  for (const password of passwords) {
    if (password) message = message.split(password).join("[redacted]");
  }
  return message;
}

export function useDatabaseBulkActions({
  collections,
  context,
  refresh,
  transitionGuard,
  blocked,
}: {
  collections: ConnectionDatabase[];
  context: DatabaseActionContext;
  refresh: () => Promise<void>;
  transitionGuard: { current: boolean };
  blocked: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [results, setResults] = useState<DatabaseBulkResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  const notifications = useContext(ToastContext)?.toast;
  const activeNotification = useRef<{
    id: string;
    toast: NonNullable<typeof notifications>;
  } | null>(null);
  const inFlight = useRef(false);
  const latestContext = useRef(context);
  latestContext.current = context;

  useEffect(() => {
    const existing = new Set(collections.map(({ id }) => id));
    setSelectedIds((previous) => {
      if ([...previous].every((id) => existing.has(id))) return previous;
      return new Set([...previous].filter((id) => existing.has(id)));
    });
  }, [collections]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelled.current = true;
      const active = activeNotification.current;
      active?.toast.update(active.id, {
        message: "Stopping database operations after the current operation…",
        etaAt: null,
      });
    };
  }, []);

  const select = (
    mode: "all" | "none" | "filtered" | "invert",
    visibleIds: string[] = [],
  ) => {
    if (inFlight.current || blocked) return;
    setSelectedIds((previous) => {
      if (mode === "none") return new Set();
      if (mode === "all") return new Set(collections.map(({ id }) => id));
      if (mode === "filtered") return new Set([...previous, ...visibleIds]);
      const next = new Set(previous);
      for (const id of visibleIds) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const toggle = (id: string, selected: boolean) => {
    if (inFlight.current || blocked) return;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const run = async (
    action: DatabaseBulkAction,
    options: DatabaseBulkOptions = {},
    targetIds: readonly string[] = [...selectedIds],
  ) => {
    if (inFlight.current || transitionGuard.current || blocked) return;
    const requested = new Set(targetIds);
    const targets = [...requested].map((id) => ({
      id,
      name: collections.find((item) => item.id === id)?.name ?? id,
    }));
    if (targets.length === 0) return;
    const passwords = { ...options.passwords };
    const sensitive = [
      ...Object.values(passwords),
      options.export?.password ?? "",
    ];
    if (action === "export") {
      try {
        if (!options.export)
          throw new Error("Choose export security options first.");
        validateDatabaseBulkExport(options.export);
      } catch (cause) {
        setError(actionError(cause, sensitive));
        return;
      }
    }
    inFlight.current = true;
    transitionGuard.current = true;
    cancelled.current = false;
    setCancelRequested(false);
    setRunning(true);
    setError("");
    setResults([]);
    const outcomes: DatabaseBulkResult[] = [];
    const snapshots: DatabaseExportSnapshot[] = [];
    const label = {
      clone: "Clone",
      export: "Export",
      delete: "Delete",
      lock: "Lock",
      unlock: "Unlock",
      metadata: "Update",
    }[action];
    const notificationId = notifications?.loading(
      `${label} databases — preparing ${targets.length} operations…`,
    );
    if (notificationId && notifications)
      activeNotification.current = { id: notificationId, toast: notifications };
    let measuredWorkMs = 0;
    let measuredOperations = 0;
    let etaAt: number | null | undefined;
    const notifyProgress = (message: string, description?: string) => {
      if (notificationId)
        notifications?.update(notificationId, {
          message,
          // Reserve the final unit for package save, refresh and cleanup.
          progress: { completed: outcomes.length, total: targets.length + 1 },
          progressLabel: `${outcomes.length} of ${targets.length} databases processed`,
          description,
          etaAt: cancelled.current ? null : etaAt,
        });
    };
    let finalError = "";
    try {
      for (const [index, target] of targets.entries()) {
        if (cancelled.current) {
          outcomes.push({
            ...target,
            status: "cancelled",
            message: "Not started",
          });
          continue;
        }
        const operationMessage = `${label}: ${target.name} — ${index + 1} of ${targets.length}`;
        // An estimate is possible only after a completed operation in THIS batch.
        // Include a rough finalization allowance, but never show 0s while busy.
        etaAt =
          measuredOperations > 0
            ? Date.now() +
              (measuredWorkMs / measuredOperations) *
                (targets.length - index + 1)
            : targets.length > 1
              ? undefined
              : null;
        notifyProgress(
          operationMessage,
          "Waiting for pending database operations…",
        );
        const operationStartedAt = Date.now();
        try {
          if (action === "export") {
            const ctx = latestContext.current;
            const snapshot = await withDatabaseMutation(
              ctx.manager,
              async () => {
                notifyProgress(
                  operationMessage,
                  "Reading the database for export…",
                );
                await flushDatabaseIfCurrent(target.id, ctx);
                return ctx.manager.readExportableDatabaseSnapshot(
                  target.id,
                  false,
                  { collectionPassword: passwords[target.id] },
                );
              },
            );
            snapshots.push(snapshot);
            outcomes.push({
              ...target,
              status: "prepared",
              message: "Prepared; not saved yet",
            });
          } else {
            const request =
              action === "metadata"
                ? ({
                    type: action,
                    namePattern: options.namePattern,
                    description: options.description,
                    index: index + 1,
                  } as const)
                : ({ type: action, password: passwords[target.id] } as const);
            const outcome = await performDatabaseAction(target.id, request, {
              ...latestContext.current,
              onProgress: (phase) => notifyProgress(operationMessage, phase),
            });
            outcomes.push({
              ...target,
              status: outcome.status,
              message: outcome.message,
            });
          }
        } catch (cause) {
          outcomes.push({
            ...target,
            status: "failed",
            message: actionError(cause, sensitive),
          });
        }
        if (
          ["success", "prepared"].includes(
            outcomes[outcomes.length - 1]?.status,
          )
        ) {
          measuredWorkMs += Math.max(1, Date.now() - operationStartedAt);
          measuredOperations++;
        }
        if (mounted.current) setResults([...outcomes]);
      }
      if (action === "export" && snapshots.length > 0 && options.export) {
        etaAt = null;
        notifyProgress(
          `Export — saving the database package (${snapshots.length} prepared; not saved yet)…`,
        );
        try {
          const result = await saveDatabaseBulkExport(
            snapshots,
            options.export,
            () => cancelled.current,
          );
          for (const outcome of outcomes)
            if (outcome.status === "prepared") {
              outcome.status = result === "saved" ? "success" : "cancelled";
              outcome.message =
                result === "saved"
                  ? "Saved in database package"
                  : "Export not saved";
            }
        } catch (cause) {
          for (const outcome of outcomes)
            if (outcome.status === "prepared") {
              outcome.status = "failed";
              outcome.message = actionError(cause, sensitive);
            }
        }
      }
      if (mounted.current) {
        etaAt = null;
        setResults([...outcomes]);
        notifyProgress(`${label} — refreshing the database list…`);
        await refresh();
      }
    } catch (cause) {
      finalError = actionError(cause, sensitive);
      if (mounted.current) setError(finalError);
    } finally {
      for (const id of Object.keys(passwords)) delete passwords[id];
      transitionGuard.current = false;
      inFlight.current = false;
      if (mounted.current) setRunning(false);
      const count = (status: DatabaseBulkResult["status"]) =>
        outcomes.filter((item) => item.status === status).length;
      const details = outcomes
        .filter((item) => item.status === "failed" || item.status === "skipped")
        .map((item) => `${item.name}: ${item.status} — ${item.message}`);
      if (finalError) details.push(`Finalization: ${finalError}`);
      if (notificationId)
        notifications?.update(notificationId, {
          type:
            count("failed") || finalError
              ? "error"
              : count("cancelled") || count("skipped")
                ? "warning"
                : "success",
          message: `${label} finished — ${count("success")} succeeded, ${count("failed")} failed, ${count("skipped")} skipped, ${count("cancelled")} cancelled${finalError ? "; finalization needs attention" : ""}.`,
          details,
          description: undefined,
          progressLabel: `${targets.length} of ${targets.length} databases processed`,
          duration: details.length ? 0 : 6000,
          progress: {
            completed: targets.length + 1,
            total: targets.length + 1,
          },
        });
      activeNotification.current = null;
    }
  };

  return {
    selectedIds,
    select,
    toggle,
    results,
    running,
    error,
    run,
    cancelRequested,
    cancel: () => {
      cancelled.current = true;
      setCancelRequested(true);
      const active = activeNotification.current;
      active?.toast.update(active.id, {
        message: "Stopping after the current database operation…",
        description:
          "The current database operation will finish safely; remaining databases will not be started.",
        etaAt: null,
      });
    },
  };
}
