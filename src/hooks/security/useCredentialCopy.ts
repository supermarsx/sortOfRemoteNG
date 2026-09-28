import { useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { normalizeConnectionCredentialSource } from "../../utils/security/databaseCredentialVault";
import { runtimeCredentialTargetKey } from "../../utils/security/runtimeCredentialVault";
import { useSessionObservationActivity } from "../session/useSessionObservationActivity";
import { useRuntimeCredentialVault } from "./useRuntimeCredentialVault";

export type CredentialCopyField = "username" | "password";
const failure =
  "Could not copy the selected credential. Check owning database access and try again.";

/** Secrets exist only in the explicit click's stack, never in React state. */
export function useCredentialCopy(
  session: ConnectionSession,
  connection?: Connection,
) {
  const {
    state,
    databaseAvailability,
    credentialVault,
    getCurrentConnections,
  } = useConnections();
  const resolveVault = useRuntimeCredentialVault(session, connection);
  const active = useSessionObservationActivity(
    useSessionRenderActivity().isActive,
  );
  const matches = state.connections.filter(
    (item) => item.id === session.connectionId,
  );
  const saved = matches.length === 1 ? matches[0] : undefined;
  const identity = JSON.stringify([
    session.id,
    session.connectionId,
    session.ownerDatabaseId,
    session.hostname,
    session.protocol,
    databaseAvailability,
    credentialVault?.scope,
    credentialVault?.changeRevision,
    connection ? runtimeCredentialTargetKey(connection) : null,
    active,
  ]);
  const version = useRef({ identity, saved, connection, epoch: 0 });
  if (
    version.current.identity !== identity ||
    version.current.saved !== saved ||
    version.current.connection !== connection
  )
    version.current = {
      identity,
      saved,
      connection,
      epoch: version.current.epoch + 1,
    };
  const epoch = version.current.epoch;
  const lifetime = useRef(0);
  const alive = useRef(false);
  const pending = useRef(false);
  const [status, setStatus] = useState({ epoch, busy: false, message: "" });
  useEffect(() => {
    const lifetimeRef = lifetime;
    alive.current = true;
    return () => {
      alive.current = false;
      lifetimeRef.current++;
    };
  }, []);
  const available =
    active &&
    !!connection &&
    !!saved &&
    !!getCurrentConnections &&
    !!session.ownerDatabaseId &&
    databaseAvailability?.status === "ready" &&
    databaseAvailability.databaseId === session.ownerDatabaseId;

  const copy = async (field: CredentialCopyField) => {
    if (pending.current || !alive.current || !available) return;
    const lease = lifetime.current;
    const current = () =>
      alive.current &&
      lifetime.current === lease &&
      version.current.epoch === epoch;
    const assertAttempt = () => {
      if (!current() || document.hidden) throw new Error(failure);
    };
    pending.current = true;
    setStatus({ epoch, busy: true, message: "" });
    let value: string | undefined;
    let resolved: Awaited<ReturnType<typeof resolveVault>> = null;
    try {
      if (field !== "username" && field !== "password")
        throw new Error(failure);
      assertAttempt();
      const manager = DatabaseManager.getInstance();
      const target = manager.captureCurrentDatabaseDataTarget();
      if (
        !target ||
        target.databaseId !== session.ownerDatabaseId ||
        !target.assertAccessible ||
        !target.readCurrent ||
        !target.verifyCurrent
      )
        throw new Error(failure);
      const check = () => {
        assertAttempt();
        if (manager.getCurrentDatabase()?.id !== session.ownerDatabaseId)
          throw new Error(failure);
        target.assertAccessible!();
        // Includes provider updates waiting for React to commit, and its owner lease.
        const currentRows = getCurrentConnections!({
          databaseId: session.ownerDatabaseId!,
          generation: databaseAvailability!.generation,
        }).filter((item) => item.id === session.connectionId);
        if (currentRows.length !== 1 || currentRows[0] !== saved)
          throw new Error(failure);
      };
      check();
      const key = runtimeCredentialTargetKey(connection!);
      if (
        session.connectionId !== connection!.id ||
        session.hostname !== connection!.hostname ||
        session.protocol !== connection!.protocol ||
        runtimeCredentialTargetKey(saved!) !== key
      )
        throw new Error(failure);
      await target.verifyCurrent();
      check();
      const source = normalizeConnectionCredentialSource(
        connection!.credentialSource,
      );
      if (source?.kind === "vault") {
        resolved = await resolveVault(check, false, `manual-copy-${field}`);
        check();
        if (!resolved) throw new Error(failure);
        resolved.assertCurrent();
        value = resolved.facets[field];
      } else {
        const snapshot = await target.readCurrent();
        check();
        const rows = snapshot?.connections.filter(
          (item) => item.id === session.connectionId,
        );
        const persisted = rows?.length === 1 ? rows[0] : undefined;
        if (
          !persisted ||
          runtimeCredentialTargetKey(persisted) !== key ||
          normalizeConnectionCredentialSource(persisted.credentialSource)
            ?.kind === "vault"
        )
          throw new Error(failure);
        // HTTP's dedicated pair wins as a pair; never mix in a generic fallback.
        // Manual disclosure does not depend on an automation/login mode.
        const dedicated =
          ["http", "https"].includes(persisted.protocol) &&
          ((persisted.basicAuthUsername?.length ?? 0) > 0 ||
            (persisted.basicAuthPassword?.length ?? 0) > 0);
        value = dedicated
          ? persisted[
              field === "username" ? "basicAuthUsername" : "basicAuthPassword"
            ]
          : persisted[field];
      }
      if (typeof value !== "string" || value.length === 0)
        throw new Error(failure);
      await target.verifyCurrent();
      check();
      resolved?.assertCurrent();
      // No asynchronous boundary between the final gates and the only disclosure.
      const writing = navigator.clipboard.writeText(value);
      value = undefined;
      if (resolved) resolved.facets = {};
      await writing;
      if (current())
        setStatus({
          epoch,
          busy: false,
          message:
            field === "username" ? "Username copied." : "Password copied.",
        });
    } catch {
      if (current()) setStatus({ epoch, busy: false, message: failure });
    } finally {
      value = undefined;
      if (resolved) resolved.facets = {};
      pending.current = false;
    }
  };
  return {
    copy,
    available,
    busy: status.epoch === epoch && status.busy,
    message: status.epoch === epoch ? status.message : "",
  };
}
