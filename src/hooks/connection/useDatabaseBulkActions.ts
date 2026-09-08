import { useEffect, useRef, useState } from "react";
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

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

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
        try {
          if (action === "export") {
            const ctx = latestContext.current;
            const snapshot = await withDatabaseMutation(
              ctx.manager,
              async () => {
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
            const outcome = await performDatabaseAction(
              target.id,
              request,
              latestContext.current,
            );
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
        setResults([...outcomes]);
      }
      if (action === "export" && snapshots.length > 0 && options.export) {
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
      setResults([...outcomes]);
      await refresh();
    } catch (cause) {
      setError(actionError(cause, sensitive));
    } finally {
      for (const id of Object.keys(passwords)) delete passwords[id];
      transitionGuard.current = false;
      inFlight.current = false;
      setRunning(false);
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
    },
  };
}
