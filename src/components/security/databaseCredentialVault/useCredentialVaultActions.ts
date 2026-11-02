import { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../../../contexts/ConnectionContextTypes";
import type { Connection } from "../../../types/connection/connection";
import type {
  DatabaseCredentialFacets,
  DatabaseCredentialSnapshot,
  DatabaseCredentialVaultApi,
} from "../../../types/security/databaseCredentialVault";
import {
  DatabaseManager,
  type DatabaseDataTarget,
} from "../../../utils/connection/databaseManager";
import { selectSavedCredentialPair } from "../../../utils/auth/httpCredentials";
import { credentialVaultScopeKey } from "../../../hooks/security/useDatabaseCredentialVault";
import { prepareCredentialClipboard } from "../../../utils/security/credentialClipboard";
import {
  CredentialFailure,
  settleWithin,
  toCredentialFailure,
} from "../../../utils/security/credentialFailure";
import {
  generateTotpCode,
  type TotpCodeParameters,
} from "../../../utils/security/totpCode";
import { runtimeCredentialTargetKey } from "../../../utils/security/runtimeCredentialVault";
import type { CredentialAssignment } from "../../../utils/security/credentialVaultUsage";

export interface VaultActionTarget {
  source: "vault" | "connection";
  id: string;
  name: string;
  /** Presence-only metadata; never a resolved value. */
  fields: readonly ("username" | "password" | "totp")[];
  credentialId?: string;
  connections: readonly CredentialAssignment[];
}
type Choice = {
  key: string;
  target: VaultActionTarget;
  action: "totp" | "go" | "open";
  items: { id: string; label: string }[];
};

/** Action-local disclosure only. Neither saved values nor authenticator seeds
 * enter React state; choice lists contain labels and stable references only. */
export function useCredentialVaultActions(
  api: DatabaseCredentialVaultApi,
  snapshot: DatabaseCredentialSnapshot | null,
  onOpenConnection?: (connection: Connection) => void,
) {
  const context = useContext(ConnectionContext);
  const key = JSON.stringify([
    credentialVaultScopeKey(api),
    api.changeRevision,
    snapshot?.receipt,
    snapshot?.revision,
    context?.databaseAvailability,
  ]);
  const latest = useRef({ key, api, snapshot, context, onOpenConnection });
  latest.current = { key, api, snapshot, context, onOpenConnection };
  const alive = useRef(true),
    pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false),
    [choice, setChoice] = useState<Choice | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const perform = async (
    action: (access: {
      check: () => void;
      step: <T>(work: Promise<T>) => Promise<T>;
      currentConnection: (id: string) => Connection;
      review: DatabaseCredentialSnapshot;
      readConnections: () => Promise<readonly Connection[]>;
      verifyCurrent: () => Promise<void>;
    }) => Promise<void>,
  ) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    setChoice(null);
    let closed = false;
    const end = Date.now() + 15000;
    const manager = DatabaseManager.getInstance();
    let target: DatabaseDataTarget | null = null;
    const check = () => {
      if (
        closed ||
        !alive.current ||
        latest.current.key !== key ||
        latest.current.api !== api ||
        latest.current.snapshot !== snapshot ||
        !api.scope ||
        !snapshot
      )
        throw new CredentialFailure("session-changed");
      if (document.hidden) throw new CredentialFailure("app-hidden");
      if (Date.now() >= end)
        throw new CredentialFailure("resolution-timed-out");
      const availability = latest.current.context?.databaseAvailability;
      if (
        !target?.assertAccessible ||
        !target.verifyCurrent ||
        !target.readCurrent ||
        target.databaseId !== api.scope.databaseId ||
        manager.getCurrentDatabase()?.id !== api.scope.databaseId ||
        availability?.status !== "ready" ||
        availability.databaseId !== api.scope.databaseId
      )
        throw new CredentialFailure("database-unavailable");
      target.assertAccessible();
    };
    const step = async <T>(work: Promise<T>): Promise<T> => {
      const result = await settleWithin(
        work,
        Math.max(1, end - Date.now()),
        () => new CredentialFailure("resolution-timed-out"),
      );
      check();
      return result;
    };
    const currentConnection = (id: string) => {
      check();
      const availability = latest.current.context!.databaseAvailability!;
      const rows = latest.current.context
        ?.getCurrentConnections?.({
          databaseId: api.scope!.databaseId,
          generation: availability.generation,
        })
        .filter((row) => row.id === id && !row.isGroup);
      if (rows?.length !== 1) throw new CredentialFailure("connection-changed");
      return rows[0];
    };
    try {
      target = manager.captureCurrentDatabaseDataTarget();
      check();
      await step(target!.verifyCurrent!());
      const review = await step(api.list({ ...api.scope! }));
      if (
        review.scope.databaseId !== snapshot!.scope.databaseId ||
        review.scope.generation !== snapshot!.scope.generation ||
        review.revision !== snapshot!.revision
      )
        throw new CredentialFailure("vault-unavailable");
      await action({
        check,
        step,
        currentConnection,
        review,
        verifyCurrent: () => step(target!.verifyCurrent!()),
        readConnections: async () => {
          const data = await step(target!.readCurrent!());
          if (!data) throw new CredentialFailure("database-unavailable");
          return data.connections;
        },
      });
    } catch (error) {
      if (alive.current && latest.current.key === key) {
        setFailed(true);
        setMessage(toCredentialFailure(error, "vault-unavailable").message);
      }
    } finally {
      closed = true;
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const copy = (
    selected: VaultActionTarget,
    field: "username" | "password" | "totp",
    authenticator?: string,
  ) =>
    perform(
      async ({
        check,
        step,
        currentConnection,
        review,
        readConnections,
        verifyCurrent,
      }) => {
        if (!selected.fields.includes(field))
          throw new CredentialFailure(
            field === "totp" ? "authenticator-unavailable" : `${field}-empty`,
          );
        // Prepare the native-first policy transport before resolving a secret.
        const write = await step(prepareCredentialClipboard());
        let facets: DatabaseCredentialFacets = {};
        let value: string | undefined, expires: number | undefined;
        let assertCode = () => {};
        const credentialId =
          selected.source === "vault" ? selected.id : selected.credentialId;
        let saved: Connection | undefined,
          config: TotpCodeParameters | undefined;
        let choices: {
          id: string;
          label: string;
          config: TotpCodeParameters;
        }[] = [];
        const assertSelection = () => {
          check();
          if (saved && currentConnection(selected.id) !== saved)
            throw new CredentialFailure("connection-changed");
          assertCode();
        };
        try {
          if (selected.source === "connection") {
            saved = currentConnection(selected.id);
            const rows = (await readConnections()).filter(
              (row) => row.id === selected.id,
            );
            assertSelection();
            if (
              rows.length !== 1 ||
              runtimeCredentialTargetKey(rows[0]) !==
                runtimeCredentialTargetKey(saved)
            )
              throw new CredentialFailure("connection-changed");
            const persisted = rows[0],
              source = persisted.credentialSource;
            if (source?.kind === "vault") {
              if (source.credentialId !== credentialId)
                throw new CredentialFailure("connection-changed");
              if (field === "totp" && !authenticator)
                authenticator = source.totpId;
            } else {
              if (credentialId)
                throw new CredentialFailure("connection-changed");
              const pair = selectSavedCredentialPair(
                persisted,
                ["http", "https"].includes(persisted.protocol),
              );
              if (field !== "totp") value = pair?.[field];
              else if (persisted.totpConfigs?.length)
                choices = persisted.totpConfigs.map((item, index) => ({
                  id: item.id ?? `local:${index}`,
                  label: item.issuer || `Authenticator ${index + 1}`,
                  config: item,
                }));
              else if (persisted.totpSecret)
                choices = [
                  {
                    id: "legacy",
                    label: "Authenticator",
                    config: {
                      secret: persisted.totpSecret,
                      algorithm: "sha1",
                      digits: 6,
                      period: 30,
                    },
                  },
                ];
            }
          }
          if (credentialId) {
            const row = review.entries.find((item) => item.id === credentialId);
            if (!row?.availableFacets.includes(field))
              throw new CredentialFailure("vault-unavailable");
            facets = await step(api.resolve(review, credentialId, [field]));
            assertSelection();
            if (field === "totp")
              choices = (facets.totp ?? []).map((item) => ({
                id: item.id,
                label: item.label,
                config: item,
              }));
            else value = facets[field];
          }
          if (field === "totp") {
            if (!choices.length)
              throw new CredentialFailure("authenticator-unavailable");
            if (!authenticator && choices.length > 1) {
              setChoice({
                key,
                target: selected,
                action: "totp",
                items: choices.map(({ id, label }) => ({ id, label })),
              });
              return;
            }
            const matches = choices.filter((item) =>
              authenticator ? item.id === authenticator : true,
            );
            if (matches.length !== 1)
              throw new CredentialFailure("authenticator-unavailable");
            config = matches[0].config;
            const generated = await step(generateTotpCode(config));
            assertSelection();
            value = generated.code;
            expires = generated.expires;
            assertCode = generated.assertCurrent;
          }
          if (!value)
            throw new CredentialFailure(
              field === "totp" ? "authenticator-unavailable" : `${field}-empty`,
            );
          await verifyCurrent();
          assertSelection();
          await write(
            value,
            field === "totp" ? "totpCode" : field,
            assertSelection,
            {
              ...(selected.source === "connection"
                ? { connectionId: selected.id }
                : {}),
              ...(expires ? { expires } : {}),
            },
          );
          if (alive.current && latest.current.key === key)
            setMessage(
              field === "totp"
                ? "2FA code copied."
                : `${field === "username" ? "Username" : "Password"} copied.`,
            );
        } finally {
          value = undefined;
          facets = {};
          choices = [];
          config = undefined;
        }
      },
    );

  const navigate = (
    selected: VaultActionTarget,
    action: "go" | "open",
    connectionId?: string,
  ) => {
    if (!connectionId && selected.connections.length > 1) {
      setChoice({
        key,
        target: selected,
        action,
        items: selected.connections.map((row) => ({
          id: row.connectionId,
          label: `${row.name} · ${row.protocol}`,
        })),
      });
      return Promise.resolve();
    }
    return perform(
      async ({ check, step, currentConnection, review, verifyCurrent }) => {
        const id = connectionId ?? selected.connections[0]?.connectionId;
        if (!id || !selected.connections.some((row) => row.connectionId === id))
          throw new CredentialFailure("connection-changed");
        const current = currentConnection(id);
        const credentialId =
          selected.source === "vault" ? selected.id : selected.credentialId;
        if (
          credentialId &&
          (!review.entries.some((row) => row.id === credentialId) ||
            current.credentialSource?.kind !== "vault" ||
            current.credentialSource.credentialId !== credentialId)
        )
          throw new CredentialFailure("connection-changed");
        await verifyCurrent();
        check();
        if (currentConnection(id) !== current)
          throw new CredentialFailure("connection-changed");
        if (action === "open") {
          if (!latest.current.onOpenConnection)
            throw new CredentialFailure("connection-changed");
          latest.current.onOpenConnection(current);
        } else {
          let delivered = false;
          let ready!: () => void;
          const reveal = new Promise<void>((resolve, reject) => {
            ready = () => {
              if (delivered) return;
              delivered = true;
              try {
                check();
                if (currentConnection(id) !== current)
                  throw new CredentialFailure("connection-changed");
                window.dispatchEvent(
                  new CustomEvent("reveal-connection", {
                    detail: { connectionId: id },
                  }),
                );
                resolve();
              } catch (error) {
                reject(error);
              }
            };
            window.addEventListener("connection-tree-ready", ready);
          });
          try {
            // Explicit navigation must reveal the row even if current tree filters
            // hide it; retain the user's sort and grouping preferences.
            latest.current.context!.dispatch({
              type: "SET_FILTER",
              payload: {
                searchTerm: "",
                protocols: [],
                tags: [],
                colorTags: [],
                showRecent: false,
                showFavorites: false,
                status: undefined,
              },
            });
            latest.current.context!.dispatch({
              type: "SELECT_CONNECTION",
              payload: current,
            });
            latest.current.context!.dispatch({
              type: "SET_SIDEBAR_COLLAPSED",
              payload: false,
            });
            window.dispatchEvent(new Event("connection-tree-reveal-request"));
            await step(reveal); // The original action deadline also owns this wait.
          } finally {
            delivered = true;
            window.removeEventListener("connection-tree-ready", ready);
          }
        }
      },
    );
  };
  return {
    busy,
    message,
    failed,
    choice: choice?.key === key ? choice : null,
    dismiss: () => setChoice(null),
    copy,
    navigate,
    choose: (id: string) => {
      if (!choice || choice.key !== key) return;
      if (choice.action === "totp") void copy(choice.target, "totp", id);
      else void navigate(choice.target, choice.action, id);
    },
  };
}
