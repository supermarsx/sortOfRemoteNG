import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession } from "../../types/connection/connection";
import type { CloudRuntimeAdapter } from "../../utils/session/cloudRuntimeAdapters";
import { toSafeManagementError } from "../../utils/security/managementInvoke";
import {
  claimBuiltInCloudRuntime,
  connectBuiltInCloudRuntime,
  teardownBuiltInCloudRuntime,
  type BuiltInCloudRuntimeHandle,
} from "../../utils/session/builtInCloudRuntimeRegistry";
import {
  cloudInventoryLabel,
  loadCloudRuntimeInventory,
  type CloudInventoryItem,
} from "../../utils/session/cloudRuntimeInventoryAdapters";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

export interface CloudSessionPanelProps {
  adapter: CloudRuntimeAdapter;
  session: ConnectionSession;
  onClose?: () => void;
}

type CloudPanelPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disconnecting";

type InventoryPhase = "unverified" | "loading" | "verified" | "error";

const errorMessage = (error: unknown): string =>
  toSafeManagementError(error, "The provider operation failed.");

export function CloudSessionPanel({
  adapter,
  session,
  onClose,
}: CloudSessionPanelProps) {
  const { state, dispatch } = useConnections();
  const connection = useMemo(
    () => resolveRuntimeConnection(state.connections, session.connectionId),
    [session.connectionId, state.connections],
  );
  const validationError = useMemo(() => {
    if (!connection) {
      return `Saved ${adapter.displayName} connection is unavailable.`;
    }
    if (connection.protocol !== adapter.protocol) {
      return `Saved connection protocol does not match ${adapter.displayName}.`;
    }
    return adapter.validate(connection);
  }, [adapter, connection]);
  const [phase, setPhase] = useState<CloudPanelPhase>(
    validationError ? "error" : "idle",
  );
  const [runtimeError, setRuntimeError] = useState<string | null>(
    validationError,
  );
  const ownsLeaseRef = useRef(false);
  const mountedRef = useRef(true);
  const runtimeHandleRef = useRef<BuiltInCloudRuntimeHandle | undefined>(
    undefined,
  );
  const inventoryRequestRef = useRef(0);
  const [inventoryPhase, setInventoryPhase] =
    useState<InventoryPhase>("unverified");
  const [inventoryItems, setInventoryItems] = useState<CloudInventoryItem[]>(
    [],
  );
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryVerifiedAt, setInventoryVerifiedAt] = useState<Date | null>(
    null,
  );

  const updateSession = useCallback(
    (
      status: ConnectionSession["status"],
      sessionError?: string,
      backendSessionId?: string,
    ) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: {
          id: session.id,
          status,
          errorMessage: sessionError,
          backendSessionId,
        },
      });
    },
    [dispatch, session.id],
  );

  const teardown = useCallback(() => {
    if (!ownsLeaseRef.current) return Promise.resolve();
    return teardownBuiltInCloudRuntime(
      adapter.protocol,
      session.id,
      adapter.disconnect,
    );
  }, [adapter, session.id]);

  useEffect(() => {
    mountedRef.current = true;
    runtimeHandleRef.current = undefined;
    inventoryRequestRef.current += 1;
    setInventoryPhase("unverified");
    setInventoryItems([]);
    setInventoryError(null);
    setInventoryVerifiedAt(null);
    if (validationError || !connection) {
      if (validationError) updateSession("error", validationError);
      return () => {
        mountedRef.current = false;
      };
    }

    if (!claimBuiltInCloudRuntime(adapter.protocol, session.id)) {
      const message =
        `Another ${adapter.displayName} runtime owns this lifecycle. ` +
        "Wait for its disconnect to finish.";
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

    const connectPromise = connectBuiltInCloudRuntime(
      adapter.protocol,
      session.id,
      () => adapter.connect(connection),
    );
    void connectPromise.then(
      (handle) => {
        if (!mountedRef.current) return;
        runtimeHandleRef.current = handle;
        setPhase("connected");
        updateSession("connected", undefined, handle.backendSessionId);
      },
      (error) => {
        if (!mountedRef.current) return;
        runtimeHandleRef.current = undefined;
        const message = errorMessage(error);
        setRuntimeError(message);
        setPhase("error");
        updateSession("error", message);
        void teardown().catch(() => undefined);
      },
    );

    return () => {
      mountedRef.current = false;
      runtimeHandleRef.current = undefined;
      inventoryRequestRef.current += 1;
      void teardown().catch(() => undefined);
    };
  }, [
    adapter,
    connection,
    session.id,
    teardown,
    updateSession,
    validationError,
  ]);

  const handleClose = useCallback(() => {
    setPhase("disconnecting");
    runtimeHandleRef.current = undefined;
    inventoryRequestRef.current += 1;
    void teardown().then(
      () => {
        updateSession("disconnected");
        onClose?.();
      },
      (error) => {
        const message = errorMessage(error);
        setRuntimeError(message);
        setPhase("error");
        updateSession("error", message);
      },
    );
  }, [onClose, teardown, updateSession]);

  const handleInventoryRefresh = useCallback(async () => {
    const handle = runtimeHandleRef.current;
    if (!connection || phase !== "connected" || !handle) return;

    const requestId = inventoryRequestRef.current + 1;
    inventoryRequestRef.current = requestId;
    setInventoryPhase("loading");
    setInventoryError(null);

    try {
      const items = await loadCloudRuntimeInventory(
        adapter.protocol,
        connection,
        handle,
      );
      if (!mountedRef.current || inventoryRequestRef.current !== requestId) {
        return;
      }
      setInventoryItems(items);
      setInventoryVerifiedAt(new Date());
      setInventoryPhase("verified");
    } catch (error) {
      if (!mountedRef.current || inventoryRequestRef.current !== requestId) {
        return;
      }
      setInventoryError(errorMessage(error));
      setInventoryPhase("error");
    }
  }, [adapter.protocol, connection, phase]);

  const visibleError = validationError ?? runtimeError;
  const summary = connection ? adapter.summary(connection) : "";
  const inventoryLabel = cloudInventoryLabel(adapter.protocol);
  let inventoryStatus =
    "Local runtime initialization must complete before provider inventory can be verified.";
  if (phase === "connected") {
    if (inventoryPhase === "unverified") {
      inventoryStatus =
        "Runtime initialized locally. Refresh to verify inventory with the provider.";
    } else if (inventoryPhase === "loading") {
      inventoryStatus = "Querying the registered provider inventory command...";
    } else if (inventoryPhase === "verified") {
      inventoryStatus = `Provider inventory verified${
        inventoryVerifiedAt
          ? ` at ${inventoryVerifiedAt.toLocaleTimeString()}`
          : ""
      }.`;
    } else {
      inventoryStatus = "The last provider inventory request failed.";
    }
  }
  let inventoryActionLabel = "Refresh";
  if (inventoryPhase === "loading") {
    inventoryActionLabel = "Refreshing...";
  } else if (inventoryPhase === "error") {
    inventoryActionLabel = "Retry";
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-sky-950 text-sky-50"
      data-testid={`${adapter.protocol}-session-panel`}
    >
      <header className="flex items-center justify-between border-b border-sky-800 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">
            {adapter.displayName}
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            {connection?.name ?? session.name}
          </h2>
          <p className="text-sm text-sky-200/70">{summary}</p>
        </div>
        <button
          type="button"
          className="rounded border border-sky-700 px-3 py-2 text-sm hover:border-amber-300 disabled:opacity-50"
          disabled={phase === "disconnecting"}
          onClick={handleClose}
        >
          Close
        </button>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <div className="rounded-xl border border-sky-800 bg-sky-900/70 p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-sky-200/70">Provider runtime</span>
              <span className="rounded-full bg-sky-950 px-3 py-1 text-sm font-medium capitalize text-amber-200">
                {phase}
              </span>
            </div>
            {visibleError ? (
              <div
                className="mt-5 rounded-lg border border-red-400/60 bg-red-950/50 p-4 text-sm text-red-100"
                role="alert"
              >
                {visibleError}
              </div>
            ) : (
              <p className="mt-5 text-sm leading-6 text-sky-100/80">
                Provider credentials are sent only to the registered backend
                command and are never copied into frontend session state.
              </p>
            )}
          </div>

          <section className="rounded-xl border border-sky-800 bg-sky-900/70 p-6 shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200/70">
                  Provider inventory
                </p>
                <h3 className="mt-1 text-base font-semibold text-sky-50">
                  {inventoryLabel}
                </h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-sky-100/80">
                  {inventoryStatus}
                </p>
              </div>
              <button
                type="button"
                className="rounded border border-sky-700 px-3 py-2 text-sm hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={phase !== "connected" || inventoryPhase === "loading"}
                onClick={() => void handleInventoryRefresh()}
              >
                {inventoryActionLabel}
              </button>
            </div>

            {inventoryError ? (
              <div
                className="mt-4 rounded-lg border border-red-400/60 bg-red-950/50 p-4 text-sm text-red-100"
                role="alert"
              >
                {inventoryError}
              </div>
            ) : null}

            {inventoryPhase === "verified" && inventoryItems.length === 0 ? (
              <p className="mt-5 text-sm text-sky-100/70">
                The provider returned no {inventoryLabel}.
              </p>
            ) : null}

            {inventoryItems.length > 0 ? (
              <ul className="mt-5 divide-y divide-sky-800">
                {inventoryItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sky-50">
                        {item.name}
                      </p>
                      <p className="mt-0.5 text-xs text-sky-200/60">
                        {item.id}
                      </p>
                      {item.location || item.type ? (
                        <p className="mt-1 text-sm text-sky-100/70">
                          {[item.location, item.type]
                            .filter(Boolean)
                            .join(" / ")}
                        </p>
                      ) : null}
                    </div>
                    <span className="rounded-full bg-sky-950 px-2.5 py-1 text-xs font-medium text-amber-200">
                      {item.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      </div>
    </section>
  );
}
