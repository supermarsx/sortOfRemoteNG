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
import {
  assertCredentialText,
  type CredentialTypingTarget,
} from "../../utils/security/credentialTyping";
import { totpApi } from "../totp/useTOTP";
import type { TotpAlgorithm } from "../../types/totp";
import {
  CredentialClipboardError,
  prepareCredentialClipboard,
} from "../../utils/security/credentialClipboard";

export type CredentialCopyField = "username" | "password";
export type CredentialCodeSelection =
  { localIndex: number } | { vaultId: string };
const failure =
  "Could not copy the selected credential. Check owning database access and try again.";

/** Secrets exist only in the explicit click's stack, never in React state. */
export function useCredentialCopy(
  session: ConnectionSession,
  connection?: Connection,
  typingTarget?: CredentialTypingTarget | null,
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
    session.status,
    session.backendSessionId,
    session.shellId,
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
  const typingRef = useRef(typingTarget);
  typingRef.current = typingTarget;
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

  const disclose = async (
    field: CredentialCopyField | CredentialCodeSelection,
    action: "copy" | "type",
  ) => {
    if (pending.current || !alive.current || !available) return;
    const lease = lifetime.current;
    const current = () =>
      alive.current &&
      lifetime.current === lease &&
      version.current.epoch === epoch;
    const assertAttempt = () => {
      if (!current() || document.hidden) throw new Error(failure);
      if (action === "type") {
        if (
          !typingTarget ||
          typingRef.current !== typingTarget ||
          typingTarget.sessionId !== session.id ||
          session.status !== "connected"
        )
          throw new Error(failure);
        typingTarget.assertCurrent();
      }
    };
    pending.current = true;
    setStatus({ epoch, busy: true, message: "" });
    let value: string | undefined;
    let resolved: Awaited<ReturnType<typeof resolveVault>> = null;
    let expires = Infinity;
    let starts = -Infinity;
    const isCode = typeof field === "object";
    try {
      if (!isCode && field !== "username" && field !== "password")
        throw new Error(failure);
      assertAttempt();
      const writeClipboard =
        action === "copy" ? await prepareCredentialClipboard() : null;
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
      let codeConfig:
        | { secret: string; algorithm: string; digits: number; period: number }
        | undefined;
      if (source?.kind === "vault") {
        resolved = await resolveVault(
          check,
          false,
          isCode ? "totp" : `manual-${action}-${field}`,
        );
        check();
        if (!resolved) throw new Error(failure);
        resolved.assertCurrent();
        if (isCode) {
          if (!("vaultId" in field)) throw new Error(failure);
          const entries = resolved.facets.totp?.filter(
            (entry) => entry.id === field.vaultId,
          );
          if (entries?.length !== 1) throw new Error(failure);
          codeConfig = entries[0];
        } else value = resolved.facets[field];
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
        if (isCode) {
          if (
            !("localIndex" in field) ||
            !Number.isSafeInteger(field.localIndex) ||
            field.localIndex < 0
          )
            throw new Error(failure);
          codeConfig = persisted.totpConfigs?.[field.localIndex];
          // Index must still describe the exact authenticator selected in the UI.
          if (
            !codeConfig ||
            JSON.stringify(codeConfig) !==
              JSON.stringify(connection!.totpConfigs?.[field.localIndex])
          )
            throw new Error(failure);
        } else
          value = dedicated
            ? persisted[
                field === "username" ? "basicAuthUsername" : "basicAuthPassword"
              ]
            : persisted[field];
      }
      if (isCode) {
        if (
          !codeConfig ||
          !codeConfig.secret ||
          codeConfig.secret.length > 4096 ||
          !["sha1", "sha256", "sha512"].includes(
            codeConfig.algorithm.toLowerCase(),
          ) ||
          ![6, 7, 8].includes(codeConfig.digits) ||
          !Number.isInteger(codeConfig.period) ||
          codeConfig.period < 1 ||
          codeConfig.period > 3600
        )
          throw new Error(failure);
        starts =
          Math.floor(Date.now() / (codeConfig.period * 1000)) *
          codeConfig.period *
          1000;
        expires = starts + codeConfig.period * 1000;
        if (expires - Date.now() < 1000) throw new Error(failure);
        value = await totpApi.computeCode(
          codeConfig.secret,
          codeConfig.algorithm.toUpperCase() as TotpAlgorithm,
          codeConfig.digits,
          codeConfig.period,
        );
        check();
        if (!new RegExp(`^\\d{${codeConfig.digits}}$`).test(value))
          throw new Error(failure);
        codeConfig = undefined;
      }
      if (typeof value !== "string" || value.length === 0)
        throw new Error(failure);
      await target.verifyCurrent();
      check();
      resolved?.assertCurrent();
      const assertDisclosure = () => {
        check();
        resolved?.assertCurrent();
        if (Date.now() < starts || Date.now() >= expires)
          throw new Error(failure);
      };
      assertDisclosure();
      // No asynchronous boundary between the final gates and the only disclosure.
      if (action === "type") assertCredentialText(value);
      const writing =
        action === "copy"
          ? writeClipboard!(
              value,
              isCode ? "totpCode" : field,
              assertDisclosure,
              {
                connectionId: connection!.id,
                ...(isCode ? { expires } : {}),
              },
            )
          : typingTarget!.type(
              value,
              assertDisclosure,
              isCode ? { starts, expires } : undefined,
            );
      value = undefined;
      await writing;
      if (current())
        setStatus({
          epoch,
          busy: false,
          message: `${isCode ? "Code" : field === "username" ? "Username" : "Password"} ${action === "copy" ? "copied" : "typed"}.`,
        });
    } catch (error) {
      if (current())
        setStatus({
          epoch,
          busy: false,
          message:
            action === "copy"
              ? error instanceof CredentialClipboardError
                ? "Could not copy the selected credential. Check the secure clipboard settings and try again."
                : failure
              : "Could not type the selected value. Check database access, focus the session field and reopen Credentials & 2FA.",
        });
    } finally {
      value = undefined;
      if (resolved) resolved.facets = {};
      pending.current = false;
    }
  };
  return {
    copy: (field: CredentialCopyField) => disclose(field, "copy"),
    type: (field: CredentialCopyField) => disclose(field, "type"),
    typeCode: (selection: CredentialCodeSelection) =>
      disclose(selection, "type"),
    typingAvailable:
      available &&
      !!typingTarget &&
      typingTarget.sessionId === session.id &&
      session.status === "connected",
    available,
    busy: status.epoch === epoch && status.busy,
    message: status.epoch === epoch ? status.message : "",
  };
}
