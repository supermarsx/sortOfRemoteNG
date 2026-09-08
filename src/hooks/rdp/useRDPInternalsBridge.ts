import { useCallback, useEffect, useMemo, useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import {
  createRdpInternalsSession,
  RDP_INTERNALS_PROTOCOL,
} from "../../components/app/toolSession";
import type { ConnectionSession } from "../../types/connection/connection";
import {
  internalsDisplaySettings,
  rdpInternalsStore,
  type RdpInternalsSnapshot,
} from "../../utils/rdp/rdpInternalsStore";
import type { RDPClientMgr } from "./useRDPClient";

/** Bridges the existing client, never creates or attaches a second native viewer. */
export function useRDPInternalsBridge(
  session: ConnectionSession,
  mgr: Pick<RDPClientMgr, Exclude<keyof RdpInternalsSnapshot, "renderActive">>,
  onActivateSession?: (sessionId: string) => void,
) {
  const { state, dispatch } = useConnections();
  const { isActive } = useSessionRenderActivity();
  const owner = useRef(Symbol("rdp-internals-source"));
  const sessionsRef = useRef(state.sessions);
  sessionsRef.current = state.sessions;
  const safeSettings = useMemo(
    () => internalsDisplaySettings(mgr.rdpSettings),
    [mgr.rdpSettings],
  );
  const {
    connectionStatus,
    desktopSize,
    colorDepth,
    audioEnabled,
    clipboardEnabled,
    perfLabel,
    certFingerprint,
    stats,
    lifecycle,
    connectTiming,
    activeRenderBackend,
    activeFrontendRenderer,
    framePressureState,
    frameBackpressureTelemetry,
  } = mgr;
  const snapshot = useMemo<RdpInternalsSnapshot>(
    () => ({
      connectionStatus,
      desktopSize,
      renderActive: isActive,
      rdpSettings: safeSettings,
      colorDepth,
      audioEnabled,
      clipboardEnabled,
      perfLabel,
      certFingerprint,
      stats,
      lifecycle,
      connectTiming,
      activeRenderBackend,
      activeFrontendRenderer,
      framePressureState,
      frameBackpressureTelemetry,
    }),
    [
      connectionStatus,
      desktopSize,
      isActive,
      safeSettings,
      colorDepth,
      audioEnabled,
      clipboardEnabled,
      perfLabel,
      certFingerprint,
      stats,
      lifecycle,
      connectTiming,
      activeRenderBackend,
      activeFrontendRenderer,
      framePressureState,
      frameBackpressureTelemetry,
    ],
  );

  useEffect(() => {
    rdpInternalsStore.publish(session.id, owner.current, snapshot);
  }, [session.id, snapshot]);
  useEffect(() => {
    const token = owner.current;
    return () => rdpInternalsStore.remove(session.id, token);
  }, [session.id]);

  return useCallback(
    (section: "diagnostics" | "settings") => {
      const existing = sessionsRef.current.find(
        (candidate) =>
          candidate.protocol === RDP_INTERNALS_PROTOCOL &&
          candidate.rdpInternals?.sessionId === session.id,
      );
      const tab = existing ?? createRdpInternalsSession(session, section);
      if (existing) {
        dispatch({
          type: "UPDATE_SESSION",
          payload: {
            id: tab.id,
            rdpInternals: { sessionId: session.id, section },
          },
        });
      } else {
        // Also reserve locally so two clicks before React commits cannot add twice.
        sessionsRef.current = [...sessionsRef.current, tab];
        dispatch({ type: "ADD_SESSION", payload: tab });
      }
      onActivateSession?.(tab.id);
    },
    [session, dispatch, onActivateSession],
  );
}
