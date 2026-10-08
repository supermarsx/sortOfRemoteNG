"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type { OriginBrowserQuickConnect } from "../../types/protocols/originBrowser";
import { getQuickConnectConnection } from "../../utils/session/runtimeConnectionRegistry";
import type { OriginBrowserOwnerProof } from "./useOriginBrowserOwner";

interface QuickConnection {
  connection: Connection;
  quickConnect: OriginBrowserQuickConnect;
  proof: OriginBrowserOwnerProof;
  scope: string;
}

function temporaryDefinition(
  connection: Connection,
): OriginBrowserQuickConnect | null {
  if (
    connection.isGroup ||
    (connection.protocol !== "http" && connection.protocol !== "https") ||
    !connection.hostname ||
    !Number.isInteger(connection.port) ||
    connection.port < 1 ||
    connection.port > 65535 ||
    (connection.httpVerifySsl !== undefined &&
      typeof connection.httpVerifySsl !== "boolean") ||
    (connection.basicAuthUsername !== undefined &&
      typeof connection.basicAuthUsername !== "string") ||
    (connection.basicAuthPassword !== undefined &&
      typeof connection.basicAuthPassword !== "string")
  )
    return null;
  // Explicit allowlist. Never spread a connection, consult a vault, or put
  // credentials into the session, an owner key, or persisted preferences.
  return Object.freeze({
    protocol: connection.protocol,
    hostname: connection.hostname,
    port: connection.port,
    httpVerifySsl: connection.httpVerifySsl !== false,
    ...(connection.basicAuthUsername !== undefined && {
      basicAuthUsername: connection.basicAuthUsername,
    }),
    ...(connection.basicAuthPassword !== undefined && {
      basicAuthPassword: connection.basicAuthPassword,
    }),
  });
}

function matchesDefinition(
  connection: Connection,
  definition: OriginBrowserQuickConnect,
) {
  return (
    !connection.isGroup &&
    connection.protocol === definition.protocol &&
    connection.hostname === definition.hostname &&
    connection.port === definition.port &&
    (connection.httpVerifySsl !== false) === definition.httpVerifySsl &&
    connection.basicAuthUsername === definition.basicAuthUsername &&
    connection.basicAuthPassword === definition.basicAuthPassword
  );
}

/** A renderer-local lease for an explicitly registered temporary definition.
 * Saved owners (including missing or ambiguous records) never fall back here. */
export function useOriginQuickConnection(
  session: ConnectionSession,
  savedConnections: readonly Connection[],
  closeRef: RefObject<(() => Promise<void>) | null>,
) {
  const connection =
    !session.ownerDatabaseId &&
    !session.reattachOnly &&
    !savedConnections.some((row) => row.id === session.connectionId)
      ? getQuickConnectConnection(session.connectionId)
      : undefined;
  // Only public session identity belongs in this key; credentials stay in the
  // temporary definition and the native create request.
  const scope = JSON.stringify([
    session.id,
    session.connectionId,
    session.ownerDatabaseId,
    session.protocol,
    session.hostname,
    session.reattachOnly,
  ]);
  const current = useRef({ connection, scope });
  useLayoutEffect(() => {
    current.current = { connection, scope };
  });
  const [captured, setCaptured] = useState<QuickConnection | null>(null);

  useLayoutEffect(() => {
    setCaptured(null);
    if (
      !connection ||
      connection.protocol !== session.protocol ||
      connection.hostname !== session.hostname
    )
      return;
    const quickConnect = temporaryDefinition(connection);
    if (!quickConnect) return;
    let live = true;
    let closeRequested = false;
    const assertCurrent = () => {
      if (
        !live ||
        current.current.scope !== scope ||
        current.current.connection !== connection ||
        connection.id !== session.connectionId ||
        getQuickConnectConnection(session.connectionId) !== connection ||
        !matchesDefinition(connection, quickConnect)
      ) {
        live = false;
        throw new Error(
          "The temporary Quick Connect session is no longer available.",
        );
      }
    };
    const revoke = () => {
      live = false;
      if (closeRequested) return;
      closeRequested = true;
      void closeRef.current?.();
    };
    const proof: OriginBrowserOwnerProof = Object.freeze({
      ownerDatabaseId: `quick-connect:${session.id}`,
      expectedSecurityRevision: "quick-connect",
      sourceSessionId: session.id,
      assertCurrent,
    });
    setCaptured({ connection, quickConnect, proof, scope });

    // The volatile registry has no subscription API. Check removals even when
    // the parent does not render; every native action also checks the lease
    // synchronously, so this timer never grants a stale action.
    const timer = window.setInterval(() => {
      try {
        assertCurrent();
      } catch {
        window.clearInterval(timer);
        revoke();
        setCaptured(null);
      }
    }, 250);
    return () => {
      window.clearInterval(timer);
      revoke();
    };
  }, [
    connection,
    scope,
    session.id,
    session.connectionId,
    session.protocol,
    session.hostname,
    closeRef,
  ]);

  const result =
    captured?.connection === connection && captured?.scope === scope
      ? captured
      : null;
  try {
    result?.proof.assertCurrent();
  } catch {
    return null;
  }
  return result;
}
