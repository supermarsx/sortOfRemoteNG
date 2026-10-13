import { useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { selectSavedCredentialPair } from "../../utils/auth/httpCredentials";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { normalizeConnectionCredentialSource } from "../../utils/security/databaseCredentialVault";
import { runtimeCredentialTargetKey } from "../../utils/security/runtimeCredentialVault";
import { useSessionObservationActivity } from "../session/useSessionObservationActivity";
import { useRuntimeCredentialVault } from "./useRuntimeCredentialVault";
import {
  assertCredentialText,
  typingUnavailable,
  type CredentialTypingTarget,
} from "../../utils/security/credentialTyping";
import { prepareCredentialClipboard } from "../../utils/security/credentialClipboard";
import {
  CredentialFailure,
  failedOutcome,
  settleWithin,
  toCredentialFailure,
  type CredentialFailureCode,
  type CredentialOutcome,
} from "../../utils/security/credentialFailure";
import {
  generateTotpCode,
  type TotpCodeParameters,
} from "../../utils/security/totpCode";

export type CredentialCopyField = "username" | "password";
export type CredentialCodeSelection =
  { localIndex: number } | { vaultId: string };

// Reading a credential is local work: a step still unanswered by then is hung.
const resolveTimeoutMs = 15_000;
// Above every target's own limit; native website typing allows 32 seconds.
const typingTimeoutMs = 45_000;

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

  /** Rejects with a `CredentialFailure` naming the cause; never with native
   * text. The same sentence is shown as this hook's `message`. */
  const disclose = async (
    field: CredentialCopyField | CredentialCodeSelection,
    action: "copy" | "type",
  ): Promise<void> => {
    if (!alive.current) throw new CredentialFailure("session-changed");
    if (pending.current) throw new CredentialFailure("busy");
    if (!available) throw new CredentialFailure("database-unavailable");
    const lease = lifetime.current;
    const live = () =>
      alive.current &&
      lifetime.current === lease &&
      version.current.epoch === epoch;
    // Set when the attempt is given up, so a step or a native callback that
    // answers later finds it closed.
    let stopped: CredentialFailure | null = null;
    const assertAttempt = () => {
      if (stopped) throw stopped;
      if (!live()) throw new CredentialFailure("session-changed");
      if (document.hidden) throw new CredentialFailure("app-hidden");
      if (action === "type") {
        if (
          !typingTarget ||
          typingRef.current !== typingTarget ||
          typingTarget.sessionId !== session.id ||
          session.status !== "connected"
        )
          throw new CredentialFailure("typing-target-lost");
        try {
          typingTarget.assertCurrent();
        } catch (error) {
          throw toCredentialFailure(error, "typing-target-lost");
        }
      }
    };
    // One deadline for the whole read. Each awaited step races it, so a step
    // that never answers ends the attempt instead of holding the controls.
    let expire: ((failure: CredentialFailure) => void) | null = null;
    const deadline = setTimeout(() => {
      stopped = new CredentialFailure("resolution-timed-out");
      expire?.(stopped);
    }, resolveTimeoutMs);
    const step = <T>(work: Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        expire = reject;
        work.then(resolve, reject);
      });
    pending.current = true;
    setStatus({ epoch, busy: true, message: "" });
    let value: string | undefined;
    let vaultRead: ReturnType<typeof resolveVault> | undefined;
    let resolved: Awaited<ReturnType<typeof resolveVault>> = null;
    let expires = Infinity;
    let starts = -Infinity;
    let dispatched = false;
    const isCode = typeof field === "object";
    try {
      if (!isCode && field !== "username" && field !== "password")
        throw new CredentialFailure("connection-changed");
      assertAttempt();
      const writeClipboard =
        action === "copy" ? await step(prepareCredentialClipboard()) : null;
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
        throw new CredentialFailure("database-unavailable");
      const check = () => {
        assertAttempt();
        let currentRows: Connection[];
        try {
          if (manager.getCurrentDatabase()?.id !== session.ownerDatabaseId)
            throw new Error();
          target.assertAccessible!();
          // Includes provider updates waiting for React to commit, and its owner lease.
          currentRows = getCurrentConnections!({
            databaseId: session.ownerDatabaseId!,
            generation: databaseAvailability!.generation,
          }).filter((item) => item.id === session.connectionId);
        } catch {
          throw new CredentialFailure("database-unavailable");
        }
        if (currentRows.length !== 1 || currentRows[0] !== saved)
          throw new CredentialFailure("connection-changed");
      };
      // A step that is not ours failed. A lost owner explains that better
      // than the step does, so ask the gates first.
      const because =
        (code: CredentialFailureCode) =>
        (error: unknown): never => {
          if (error instanceof CredentialFailure) throw error;
          check();
          throw new CredentialFailure(code);
        };
      const assertVault = () => {
        try {
          resolved?.assertCurrent();
        } catch (error) {
          because("vault-unavailable")(error);
        }
      };
      check();
      const key = runtimeCredentialTargetKey(connection!);
      if (
        session.connectionId !== connection!.id ||
        session.hostname !== connection!.hostname ||
        session.protocol !== connection!.protocol ||
        runtimeCredentialTargetKey(saved!) !== key
      )
        throw new CredentialFailure("connection-changed");
      await step(target.verifyCurrent()).catch(because("database-unavailable"));
      check();
      const source = normalizeConnectionCredentialSource(
        connection!.credentialSource,
      );
      let codeConfig: TotpCodeParameters | undefined;
      if (source?.kind === "vault") {
        vaultRead = resolveVault(
          check,
          false,
          isCode ? "totp" : `manual-${action}-${field}`,
        );
        resolved = await step(vaultRead).catch(because("vault-unavailable"));
        check();
        if (!resolved) throw new CredentialFailure("vault-unavailable");
        assertVault();
        if (isCode) {
          if (!("vaultId" in field))
            throw new CredentialFailure("authenticator-unavailable");
          const entries = resolved.facets.totp?.filter(
            (entry) => entry.id === field.vaultId,
          );
          if (entries?.length !== 1)
            throw new CredentialFailure("authenticator-unavailable");
          codeConfig = entries[0];
        } else value = resolved.facets[field];
      } else {
        const snapshot = await step(target.readCurrent()).catch(
          because("database-unavailable"),
        );
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
          throw new CredentialFailure("connection-changed");
        if (isCode) {
          if (
            !("localIndex" in field) ||
            !Number.isSafeInteger(field.localIndex) ||
            field.localIndex < 0
          )
            throw new CredentialFailure("authenticator-unavailable");
          codeConfig = persisted.totpConfigs?.[field.localIndex];
          // Index must still describe the exact authenticator selected in the UI.
          if (
            !codeConfig ||
            JSON.stringify(codeConfig) !==
              JSON.stringify(connection!.totpConfigs?.[field.localIndex])
          )
            throw new CredentialFailure("authenticator-unavailable");
        } else
          // HTTP's dedicated pair wins as a pair; never mix in a generic fallback.
          // Manual disclosure does not depend on an automation/login mode.
          value = selectSavedCredentialPair(
            persisted,
            ["http", "https"].includes(persisted.protocol),
          )?.[field];
      }
      if (isCode) {
        if (!codeConfig)
          throw new CredentialFailure("authenticator-unavailable");
        const generated = await step(generateTotpCode(codeConfig));
        check();
        ({ starts, expires } = generated);
        value = generated.code;
        codeConfig = undefined;
      } else if (typeof value !== "string" || value.length === 0)
        throw new CredentialFailure(`${field}-empty`);
      await step(target.verifyCurrent()).catch(because("database-unavailable"));
      check();
      assertVault();
      const assertDisclosure = () => {
        check();
        assertVault();
        if (Date.now() < starts || Date.now() >= expires)
          throw new CredentialFailure("code-expired");
      };
      assertDisclosure();
      // No asynchronous boundary between the final gates and the only disclosure.
      if (action === "type") assertCredentialText(value!);
      clearTimeout(deadline);
      dispatched = true;
      const writing =
        action === "copy"
          ? writeClipboard!(
              value!,
              isCode ? "totpCode" : field,
              assertDisclosure,
              {
                connectionId: connection!.id,
                ...(isCode ? { expires } : {}),
              },
            )
          : typingTarget!.type(
              value!,
              assertDisclosure,
              isCode ? { starts, expires } : undefined,
            );
      value = undefined;
      // The clipboard writer bounds itself. A typing target may not.
      if (action === "copy") await writing;
      else
        await settleWithin(writing, typingTimeoutMs, () => {
          stopped = new CredentialFailure("typing-not-confirmed", true);
          typingTarget!.dispose();
          return stopped;
        });
      if (live())
        setStatus({
          epoch,
          busy: false,
          message: `${isCode ? "Code" : field === "username" ? "Username" : "Password"} ${action === "copy" ? "copied" : typingTarget!.confirmation === "sent" ? "sent to the session" : "typed"}.`,
        });
    } catch (error) {
      const failure =
        error instanceof CredentialFailure
          ? error
          : !dispatched
            ? new CredentialFailure("database-unavailable")
            : action === "copy"
              ? new CredentialFailure("clipboard-unavailable")
              : error instanceof Error && error.message === typingUnavailable
                ? new CredentialFailure("typing-target-lost")
                : // An unknown stop after typing began may have left characters.
                  new CredentialFailure("typing-not-confirmed", true);
      if (live()) setStatus({ epoch, busy: false, message: failure.message });
      throw failure;
    } finally {
      clearTimeout(deadline);
      value = undefined;
      if (resolved) resolved.facets = {};
      // A vault read abandoned at the deadline may still answer: drop it.
      else
        void vaultRead?.then(
          (late) => {
            if (late) late.facets = {};
          },
          () => {},
        );
      pending.current = false;
    }
  };
  const settle = (work: Promise<void>): Promise<CredentialOutcome> =>
    work.then(
      (): CredentialOutcome => ({ ok: true }),
      (error: unknown) =>
        failedOutcome(toCredentialFailure(error, "database-unavailable")),
    );
  return {
    // These three never reject: the outcome and `message` carry any failure.
    copy: (field: CredentialCopyField) => settle(disclose(field, "copy")),
    type: (field: CredentialCopyField) => settle(disclose(field, "type")),
    typeCode: (selection: CredentialCodeSelection) =>
      settle(disclose(selection, "type")),
    /** Rejecting forms, for a caller that reports the failure itself. */
    typeOrThrow: (field: CredentialCopyField) => disclose(field, "type"),
    typeCodeOrThrow: (selection: CredentialCodeSelection) =>
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
