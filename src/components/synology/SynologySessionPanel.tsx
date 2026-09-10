import React, { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import {
  normalizeSynologySettings,
  assertSynologyNativeRoute,
} from "../../types/protocols/synology";
import { captureSessionDatabaseAccess } from "../../utils/session/sessionDatabaseOwnership";
import {
  DatabaseManager,
  onDatabaseAccessChange,
} from "../../utils/connection/databaseManager";
import { ENCRYPTION_EVENT_LOCKED } from "../../types/encryption/encryption";
import { getInvoke } from "../../utils/tauri/invoke";
import { useSynologyFileConnection } from "../../hooks/synology/useSynologyFileConnection";
import { registerSynologySession } from "../../utils/session/synologySessionLifecycle";
import {
  getRuntimeProtocolUnavailableMessage,
  loadRuntimeCapabilities,
} from "../../utils/runtime/runtimeCapabilities";
import { SynologySessionContent } from "./SynologyPanel";

const unavailable =
  "Open and unlock this session's owning database, then reopen the Synology connection.";

function BoundSynologySession({
  session,
  saved,
  connections,
}: {
  session: ConnectionSession;
  saved: Connection;
  connections: Connection[];
}) {
  const { dispatch, databaseAvailability } = useConnections();
  const [revoked, setRevoked] = useState(false);
  const revokedRef = useRef(false);
  const latest = useRef({ saved, connections, databaseAvailability });
  latest.current = { saved, connections, databaseAvailability };
  const access = useMemo(() => {
    try {
      const check = captureSessionDatabaseAccess(session);
      const original = saved;
      const generation = databaseAvailability?.generation;
      return () => {
        check();
        if (
          revokedRef.current ||
          latest.current.saved !== original ||
          latest.current.databaseAvailability?.status !== "ready" ||
          latest.current.databaseAvailability?.generation !== generation
        )
          throw new Error(unavailable);
        // Fail closed on the saved target and every ancestor's explicit route/trust.
        let candidate: Connection | undefined = original;
        const visited = new Set<string>();
        while (candidate) {
          if (visited.has(candidate.id))
            throw new Error("Invalid connection ancestry.");
          visited.add(candidate.id);
          assertSynologyNativeRoute(candidate);
          const parent: string | undefined = candidate.parentId;
          candidate = parent
            ? latest.current.connections.find((entry) => entry.id === parent)
            : undefined;
          if (parent && !candidate)
            throw new Error("The connection's parent is unavailable.");
        }
      };
    } catch {
      return null;
    }
    // A mounted session never adopts a different saved connection or access lease.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  let issue: string | null = null;
  try {
    if (!access || revoked) throw new Error(unavailable);
    access();
  } catch (error) {
    issue = error instanceof Error ? error.message : unavailable;
  }
  const settings = normalizeSynologySettings(saved.synologySettings);
  const connection = useSynologyFileConnection(!issue, {
    instanceId: session.id,
    initialConfig: {
      host: saved.hostname,
      port: saved.port,
      username: saved.username ?? "",
      password: saved.password ?? "",
      useHttps: settings.useHttps,
    },
    assertCurrent: access ?? undefined,
  });
  const runtime = useRef(connection);
  runtime.current = connection;
  useEffect(
    () =>
      registerSynologySession(session.id, () => runtime.current.disconnect()),
    [session.id],
  );
  useEffect(() => {
    let disposed = false;
    let offNative: (() => void) | undefined;
    const revoke = () => {
      if (disposed) return;
      revokedRef.current = true;
      setRevoked(true);
      void runtime.current.disconnect().catch(() => undefined);
    };
    const offAccess = onDatabaseAccessChange((event) => {
      if (
        event.databaseId === session.ownerDatabaseId &&
        event.status === "suspended"
      )
        revoke();
    });
    const offCurrent = DatabaseManager.getInstance().onCurrentDatabaseChange(
      () => {
        try {
          if (!access) throw new Error();
          access();
        } catch {
          revoke();
        }
      },
    );
    void getInvoke()
      .then(async (invoke) => {
        if (!invoke || disposed) return;
        const off = await listen(ENCRYPTION_EVENT_LOCKED, revoke);
        if (disposed) off();
        else offNative = off;
      })
      .catch(revoke);
    return () => {
      disposed = true;
      offAccess();
      offCurrent();
      offNative?.();
    };
  }, [access, session.ownerDatabaseId]);
  useEffect(() => {
    dispatch({
      type: "UPDATE_SESSION",
      payload: {
        id: session.id,
        status: issue ? "disconnected" : connection.connectionStatus,
        errorMessage: issue ?? connection.connectionError ?? undefined,
      },
    });
  }, [
    dispatch,
    session.id,
    connection.connectionStatus,
    connection.connectionError,
    issue,
  ]);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [capabilityReady, setCapabilityReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    void loadRuntimeCapabilities().then((caps) => {
      if (disposed) return;
      const error = getRuntimeProtocolUnavailableMessage("synology", caps);
      setCapabilityError(error);
      setCapabilityReady(true);
      if (!error && !issue && saved.username && saved.password)
        void runtime.current.connect();
    });
    return () => {
      disposed = true;
    };
    // Initial connection only; no automatic retries after auth or network failures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (issue || capabilityError)
    return (
      <div
        role="alert"
        className="p-4 text-sm text-[var(--color-textSecondary)]"
      >
        {issue ?? capabilityError}
      </div>
    );
  if (!capabilityReady)
    return (
      <div role="status" className="p-4 text-sm">
        Checking Synology runtime availability…
      </div>
    );
  return <SynologySessionContent connection={connection} />;
}

export default function SynologySessionPanel({
  session,
}: {
  session: ConnectionSession;
  onClose?: () => void;
}) {
  const { state, databaseAvailability: availability } = useConnections();
  const saved = state.connections.find(
    (entry) =>
      entry.id === session.connectionId &&
      !entry.isGroup &&
      entry.protocol === "synology",
  );
  if (
    !session.ownerDatabaseId ||
    availability?.status !== "ready" ||
    availability.databaseId !== session.ownerDatabaseId ||
    !saved
  )
    return (
      <div
        role="alert"
        className="p-4 text-sm text-[var(--color-textSecondary)]"
      >
        {unavailable}
      </div>
    );
  return (
    <BoundSynologySession
      key={`${session.id}:${session.ownerDatabaseId}:${availability.generation}`}
      session={session}
      saved={saved}
      connections={state.connections}
    />
  );
}
