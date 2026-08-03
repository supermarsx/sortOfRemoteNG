import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  BmcOverview,
  BmcOverviewSectionId,
  BmcRuntimeAdapter,
} from "../../utils/session/bmcRuntimeAdapters";
import { toSafeManagementError } from "../../utils/security/managementInvoke";
import {
  claimBuiltInManagementRuntime,
  teardownBuiltInManagementRuntime,
} from "../../utils/session/builtInManagementRuntimeRegistry";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

export interface BmcSessionPanelProps {
  adapter: BmcRuntimeAdapter;
  session: ConnectionSession;
  onClose?: () => void;
}

type PanelPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disconnecting";

function getErrorMessage(error: unknown): string {
  return toSafeManagementError(error, "The management operation failed.");
}

const MAX_OVERVIEW_SECTIONS = 24;
const MAX_OVERVIEW_ITEMS_PER_SECTION = 64;
const MAX_OVERVIEW_TEXT_LENGTH = 1024;

function boundedOverviewText(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_OVERVIEW_TEXT_LENGTH
  ) {
    throw new Error(`The management provider returned an invalid ${field}.`);
  }
  return value;
}

function boundedOverviewSectionId(value: unknown): BmcOverviewSectionId {
  const id = boundedOverviewText(value, "section ID");
  if (
    id !== "system" &&
    id !== "health" &&
    id !== "power" &&
    id !== "thermal" &&
    id !== "storage" &&
    id !== "firmware"
  ) {
    throw new Error("The management provider returned an invalid section ID.");
  }
  return id;
}

function normalizeOverview(nextOverview: BmcOverview): BmcOverview {
  if (
    !Array.isArray(nextOverview.sections) ||
    nextOverview.sections.length > MAX_OVERVIEW_SECTIONS
  ) {
    throw new Error("The management overview exceeded the section limit.");
  }
  if (Number.isNaN(Date.parse(nextOverview.refreshedAt))) {
    throw new Error("The management overview returned an invalid timestamp.");
  }

  return {
    ...nextOverview,
    sections: nextOverview.sections.map((section) => {
      if (
        !Array.isArray(section.items) ||
        section.items.length > MAX_OVERVIEW_ITEMS_PER_SECTION
      ) {
        throw new Error(
          "The management overview exceeded the per-section item limit.",
        );
      }
      return {
        ...section,
        id: boundedOverviewSectionId(section.id),
        title: boundedOverviewText(section.title, "section title"),
        status:
          section.status === undefined
            ? undefined
            : boundedOverviewText(section.status, "section status"),
        error:
          section.error === undefined
            ? undefined
            : toSafeManagementError(
                section.error,
                "This management section could not be loaded.",
              ),
        items: section.items.map((item) => ({
          label: boundedOverviewText(item.label, "item label"),
          value: boundedOverviewText(item.value, "item value"),
        })),
      };
    }),
  };
}

function validateConnection(
  adapter: BmcRuntimeAdapter,
  connection: Connection | undefined,
): string | null {
  if (!connection) {
    return `Saved ${adapter.displayName} connection is unavailable.`;
  }
  if (connection.protocol !== adapter.protocol) {
    return `Saved connection protocol does not match ${adapter.displayName}.`;
  }
  if (!connection.hostname?.trim()) {
    return `${adapter.displayName} requires a host.`;
  }
  if (!connection.username?.trim()) {
    return `${adapter.displayName} requires a username.`;
  }
  return null;
}

export function BmcSessionPanel({
  adapter,
  session,
  onClose,
}: BmcSessionPanelProps) {
  const { state, dispatch } = useConnections();
  const connection = useMemo(
    () => resolveRuntimeConnection(state.connections, session.connectionId),
    [session.connectionId, state.connections],
  );
  const validationError = useMemo(
    () => validateConnection(adapter, connection),
    [adapter, connection],
  );
  const [phase, setPhase] = useState<PanelPhase>(
    validationError ? "error" : "idle",
  );
  const [runtimeError, setRuntimeError] = useState<string | null>(
    validationError,
  );
  const [overview, setOverview] = useState<BmcOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const ownsLeaseRef = useRef(false);
  const mountedRef = useRef(true);
  const connectPromiseRef = useRef<Promise<void> | null>(null);
  const overviewRequestRef = useRef(0);

  const updateSession = useCallback(
    (status: ConnectionSession["status"], sessionError?: string) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: {
          id: session.id,
          status,
          errorMessage: sessionError,
        },
      });
    },
    [dispatch, session.id],
  );

  const refreshOverview = useCallback(async () => {
    const requestId = overviewRequestRef.current + 1;
    overviewRequestRef.current = requestId;
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const nextOverview = normalizeOverview(await adapter.loadOverview());
      if (mountedRef.current && overviewRequestRef.current === requestId) {
        setOverview(nextOverview);
      }
    } catch (error) {
      if (mountedRef.current && overviewRequestRef.current === requestId) {
        setOverviewError(getErrorMessage(error));
      }
    } finally {
      if (mountedRef.current && overviewRequestRef.current === requestId) {
        setOverviewLoading(false);
      }
    }
  }, [adapter]);

  const teardown = useCallback(() => {
    if (!ownsLeaseRef.current) return Promise.resolve();
    return teardownBuiltInManagementRuntime(
      adapter.protocol,
      session.id,
      async () => {
        try {
          await connectPromiseRef.current;
        } catch {
          // Failed connection attempts still require backend cleanup.
        }
        await adapter.disconnect();
      },
    );
  }, [adapter, session.id]);

  useEffect(() => {
    mountedRef.current = true;
    overviewRequestRef.current += 1;
    setOverview(null);
    setOverviewError(null);
    setOverviewLoading(false);
    if (validationError || !connection) {
      if (validationError) updateSession("error", validationError);
      return () => {
        mountedRef.current = false;
      };
    }

    if (!claimBuiltInManagementRuntime(adapter.protocol, session.id)) {
      const message =
        `Another ${adapter.displayName} session is active. ` +
        "Close it before opening this connection.";
      setRuntimeError(message);
      setPhase("error");
      updateSession("error", message);
      return () => {
        mountedRef.current = false;
      };
    }

    ownsLeaseRef.current = true;
    setRuntimeError(null);
    setPhase("connecting");
    updateSession("connecting");

    const connectPromise = adapter.connect(connection);
    connectPromiseRef.current = connectPromise;
    void connectPromise.then(
      () => {
        if (!mountedRef.current) return;
        setPhase("connected");
        updateSession("connected");
        void refreshOverview();
      },
      (error) => {
        if (!mountedRef.current) return;
        const message = getErrorMessage(error);
        setRuntimeError(message);
        setPhase("error");
        updateSession("error", message);
        void teardown().catch(() => undefined);
      },
    );

    return () => {
      mountedRef.current = false;
      overviewRequestRef.current += 1;
      void teardown().catch(() => undefined);
    };
  }, [
    adapter,
    connection,
    refreshOverview,
    session.id,
    teardown,
    updateSession,
    validationError,
  ]);

  const handleClose = useCallback(() => {
    setPhase("disconnecting");
    overviewRequestRef.current += 1;
    void teardown().then(
      () => {
        updateSession("disconnected");
        onClose?.();
      },
      (error) => {
        const message = getErrorMessage(error);
        setRuntimeError(message);
        setPhase("error");
        updateSession("error", message);
      },
    );
  }, [onClose, teardown, updateSession]);

  const visibleError = validationError ?? runtimeError;

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100"
      data-testid={`${adapter.protocol}-session-panel`}
    >
      <header className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            {adapter.displayName}
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            {connection?.name ?? session.name}
          </h2>
          <p className="text-sm text-slate-400">
            {connection?.hostname ?? "Connection unavailable"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-slate-600 px-3 py-2 text-sm hover:border-cyan-400 disabled:opacity-50"
            disabled={phase !== "connected" || overviewLoading}
            onClick={() => void refreshOverview()}
          >
            {overviewLoading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-3 py-2 text-sm hover:border-cyan-400 disabled:opacity-50"
            disabled={phase === "disconnecting"}
            onClick={handleClose}
          >
            Close
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-6xl space-y-4">
          <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-slate-400">Runtime status</span>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-sm font-medium capitalize text-cyan-200">
                {phase}
              </span>
            </div>
            {visibleError ? (
              <div
                className="mt-5 rounded-lg border border-red-500/60 bg-red-950/50 p-4 text-sm text-red-100"
                role="alert"
              >
                {visibleError}
              </div>
            ) : (
              <p className="mt-5 text-sm leading-6 text-slate-300">
                This saved connection owns the provider runtime until disconnect
                completes. Credentials are sent only to the registered backend.
              </p>
            )}
          </div>

          {overviewError && (
            <div
              className="rounded-lg border border-red-500/60 bg-red-950/50 p-4 text-sm text-red-100"
              role="alert"
            >
              Refresh failed: {overviewError}
            </div>
          )}

          {phase === "connected" && overviewLoading && !overview && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-5 text-sm text-slate-300">
              Loading read-only management overview...
            </div>
          )}

          {phase === "connected" && overview && (
            <>
              <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                <span>Read-only management overview</span>
                <time dateTime={overview.refreshedAt}>
                  Refreshed {new Date(overview.refreshedAt).toLocaleString()}
                </time>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {overview.sections.map((section) => (
                  <article
                    key={section.id}
                    data-testid={`${adapter.protocol}-overview-${section.id}`}
                    className="min-w-0 rounded-xl border border-slate-700 bg-slate-900/80 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-100">
                        {section.title}
                      </h3>
                      {section.status && (
                        <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-cyan-200">
                          {section.status}
                        </span>
                      )}
                    </div>

                    {section.items.length > 0 ? (
                      <dl className="mt-3 space-y-2">
                        {section.items.map((entry, index) => (
                          <div
                            key={`${entry.label}-${index}`}
                            className="flex items-start justify-between gap-4 text-sm"
                          >
                            <dt className="text-slate-400">{entry.label}</dt>
                            <dd className="min-w-0 break-words text-right text-slate-100">
                              {entry.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      !section.error && (
                        <p className="mt-3 text-sm text-slate-400">
                          No data reported by this provider.
                        </p>
                      )
                    )}

                    {section.error && (
                      <p className="mt-3 text-sm text-amber-200">
                        {section.error}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
