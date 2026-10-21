import { useLayoutEffect, useRef, useState } from "react";
import type { ConnectionSession } from "../../types/connection/connection";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { captureSessionDatabaseAccess } from "../../utils/session/sessionDatabaseOwnership";
import { getInvoke } from "../../utils/tauri/invoke";
import {
  parseSessionRouteHealth,
  parseVpnLeaseObservations,
  type VpnLeaseObservation,
  type SessionRouteHealth,
} from "../../types/network/sessionRouteHealth";
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
  const vpnOwners = [
    ...new Set(
      (options.session.vpnLeaseBindings ?? [])
        .filter(
          (binding) =>
            binding.status === "active" &&
            binding.backendSessionId === actor &&
            binding.protocol === options.protocol,
        )
        .map((binding) => binding.ownerId),
    ),
  ].slice(0, 32);
  const vpnKey = JSON.stringify(vpnOwners);
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
    vpnKey,
  ]);
  const [observation, setObservation] = useState<{
    key: string;
    accessible: boolean;
    alive: boolean | null;
  }>({ key, accessible: false, alive: null });
  const [route, setRoute] = useState<{
    key: string;
    value: SessionRouteHealth | null;
  }>({ key, value: null });
  const [vpn, setVpn] = useState<{
    key: string;
    value: VpnLeaseObservation[] | null;
  }>({ key, value: null });
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
    const vpnOwners = JSON.parse(vpnKey) as string[];
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let vpnDeadline: ReturnType<typeof setTimeout> | undefined;
    let vpnExpiry: ReturnType<typeof setTimeout> | undefined;
    let sampleExpiry: ReturnType<typeof setTimeout> | undefined;
    setObservation({ key, accessible: false, alive: null });
    setRoute({ key, value: null });
    setVpn({ key, value: null });
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
          if (active) {
            setObservation({ key, accessible: true, alive: null });
            setRoute({ key, value: null });
            setVpn({ key, value: null });
          }
        }, 5000);
        if (options.protocol === "ssh" && options.status === "connected") {
          request = invoke("is_session_alive", { sessionId: actor });
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
        }
        if (!active || expired) return;
        check();
        let report: SessionRouteHealth | null = null;
        try {
          request = invoke(
            options.protocol === "ssh"
              ? "get_ssh_route_health"
              : "get_rdp_route_health",
            { sessionId: actor },
          );
          inFlight.current = request;
          report = parseSessionRouteHealth(await request, actor!);
        } catch {
          /* Missing or malformed native observations stay unknown. */
        }
        if (!active) return;
        check();
        if (!expired) {
          setRoute({ key, value: report });
          clearTimeout(deadline);
          clearTimeout(sampleExpiry);
          sampleExpiry = setTimeout(() => {
            if (active) {
              setObservation({ key, accessible: true, alive: null });
              setRoute({ key, value: null });
            }
          }, 15000);
        }
        if (!expired && vpnOwners.length) {
          let leases: VpnLeaseObservation[] | null = null;
          let vpnExpired = false;
          vpnDeadline = setTimeout(() => {
            vpnExpired = true;
            if (active) setVpn({ key, value: null });
          }, 6000);
          try {
            request = invoke("get_vpn_owner_lease_observations", {
              ownerIds: vpnOwners,
            });
            inFlight.current = request;
            leases = parseVpnLeaseObservations(await request, vpnOwners);
          } catch {
            /* Unavailable ownership is not provider health. */
          }
          if (!active) return;
          check();
          if (!expired && !vpnExpired) {
            setVpn({ key, value: leases });
            clearTimeout(vpnExpiry);
            vpnExpiry = setTimeout(() => {
              if (active) setVpn({ key, value: null });
            }, 15000);
          }
        }
      } catch {
        if (active) {
          setObservation({ key, accessible: false, alive: null });
          setRoute({ key, value: null });
          setVpn({ key, value: null });
        }
      } finally {
        if (request && inFlight.current === request) inFlight.current = null;
        clearTimeout(deadline);
        clearTimeout(vpnDeadline);
        if (active) timer = setTimeout(poll, 10000);
      }
    };
    if (
      check &&
      ["connected", "connecting", "reconnecting"].includes(options.status) &&
      actor
    )
      void poll();
    return () => {
      active = false;
      if (accessLease.current === check) accessLease.current = null;
      clearTimeout(timer);
      clearTimeout(deadline);
      clearTimeout(vpnDeadline);
      clearTimeout(sampleExpiry);
      clearTimeout(vpnExpiry);
      offCurrent();
      offAccess();
    };
  }, [key, enabled, owner, actor, options.protocol, options.status, vpnKey]);
  const current = observation.key === key ? observation : null;
  return deriveSessionConnectionHealth({
    ...options,
    sourceName: options.session.name,
    accessible: enabled && current?.accessible === true,
    alive: current?.alive ?? null,
    routeHealth: route.key === key ? route.value : null,
    vpnLeases: vpn.key === key ? vpn.value : null,
    stats:
      options.protocol === "rdp" && sampleKey !== key ? null : options.stats,
    lifecycle:
      options.protocol === "rdp" && sampleKey !== key
        ? null
        : options.lifecycle,
  });
}
