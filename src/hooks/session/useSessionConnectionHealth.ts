import { useLayoutEffect, useRef, useState } from "react";
import type { ConnectionSession } from "../../types/connection/connection";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { captureSessionDatabaseAccess } from "../../utils/session/sessionDatabaseOwnership";
import { getInvoke } from "../../utils/tauri/invoke";
import {
  deriveSessionConnectionHealth,
  type SessionConnectionHealthInput,
} from "../../utils/protocol/sessionConnectionHealth";

export function useSessionConnectionHealth(
  options: Omit<SessionConnectionHealthInput, "accessible" | "alive"> & {
    session: ConnectionSession;
    enabled?: boolean;
  },
) {
  const { isActive } = useSessionRenderActivity();
  const [ownerEpoch, setOwnerEpoch] = useState(0);
  const enabled = isActive && options.enabled !== false;
  const actor = options.backendSessionId;
  const owner = options.session.ownerDatabaseId;
  const session = useRef(options.session);
  const inFlight = useRef<Promise<unknown> | null>(null);
  const accessLease = useRef<(() => void) | null>(null);
  session.current = options.session;
  const key = JSON.stringify([
    options.session.id,
    options.session.connectionId,
    owner,
    actor,
    options.session.lifecycleActorGeneration,
    options.session.lifecycleWriterId,
    options.protocol,
    options.status,
    enabled,
    ownerEpoch,
  ]);
  const [observation, setObservation] = useState<{
    key: string;
    accessible: boolean;
    alive: boolean | null;
  }>({ key, accessible: false, alive: null });
  const received = useRef({
    stats: options.stats,
    lifecycle: options.lifecycle,
  });
  const [sampleKey, setSampleKey] = useState<string | null>(null);
  useLayoutEffect(() => {
    const statsChanged = received.current.stats !== options.stats;
    const lifecycleChanged = received.current.lifecycle !== options.lifecycle;
    received.current = { stats: options.stats, lifecycle: options.lifecycle };
    setSampleKey(null);
    if (
      options.protocol !== "rdp" ||
      (!statsChanged && !lifecycleChanged) ||
      !enabled ||
      !actor
    )
      return;
    if (
      !(statsChanged && options.stats?.session_id === actor) &&
      !(lifecycleChanged && options.lifecycle?.sessionId === actor)
    )
      return;
    try {
      if (!accessLease.current) return;
      accessLease.current();
    } catch {
      setObservation({ key, accessible: false, alive: null });
      return;
    }
    setSampleKey(key);
    const timeout = setTimeout(
      () => setSampleKey((value) => (value === key ? null : value)),
      15000,
    );
    return () => clearTimeout(timeout);
  }, [options.protocol, options.stats, options.lifecycle, key, enabled, actor]);
  useLayoutEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    setObservation({ key, accessible: false, alive: null });
    if (!enabled || !owner) return;
    const manager = DatabaseManager.getInstance();
    const refresh = () => {
      if (active) setOwnerEpoch((value) => value + 1);
    };
    const offCurrent = manager.onCurrentDatabaseChange((event) => {
      if (event.databaseId === owner || event.previousDatabaseId === owner)
        refresh();
    });
    const offAccess = manager.onDatabaseAccessChange((event) => {
      if (event.databaseId === owner) refresh();
    });
    let check: (() => void) | undefined;
    try {
      check = captureSessionDatabaseAccess(session.current);
      check();
      accessLease.current = check;
      setObservation({ key, accessible: true, alive: null });
    } catch {
      /* Unavailable owners stay unknown. */
    }
    const poll = async () => {
      if (!active || !check) return;
      let expired = false;
      let request: Promise<unknown> | undefined;
      try {
        if (inFlight.current) await inFlight.current.catch(() => undefined);
        if (!active) return;
        check();
        const invoke = await getInvoke();
        if (!active) return;
        check();
        if (!invoke) return;
        deadline = setTimeout(() => {
          expired = true;
          if (active) setObservation({ key, accessible: true, alive: null });
        }, 5000);
        request = invoke("is_session_alive", {
          sessionId: actor,
        });
        inFlight.current = request;
        const alive: unknown = await request;
        if (!active) return;
        check();
        if (!expired)
          setObservation({
            key,
            accessible: true,
            alive: typeof alive === "boolean" ? alive : null,
          });
      } catch {
        if (active) setObservation({ key, accessible: false, alive: null });
      } finally {
        if (request && inFlight.current === request) inFlight.current = null;
        clearTimeout(deadline);
        if (active) timer = setTimeout(poll, 10000);
      }
    };
    if (
      check &&
      options.protocol === "ssh" &&
      options.status === "connected" &&
      actor
    )
      void poll();
    return () => {
      active = false;
      if (accessLease.current === check) accessLease.current = null;
      clearTimeout(timer);
      clearTimeout(deadline);
      offCurrent();
      offAccess();
    };
  }, [key, enabled, owner, actor, options.protocol, options.status]);
  const current = observation.key === key ? observation : null;
  return deriveSessionConnectionHealth({
    ...options,
    accessible: enabled && current?.accessible === true,
    alive: current?.alive ?? null,
    stats:
      options.protocol === "rdp" && sampleKey !== key ? null : options.stats,
    lifecycle:
      options.protocol === "rdp" && sampleKey !== key
        ? null
        : options.lifecycle,
  });
}
