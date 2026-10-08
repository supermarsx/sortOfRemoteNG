import { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../../../contexts/ConnectionContextTypes";
import type { Connection } from "../../../types/connection/connection";
import type { CredentialEditorRequest } from "../../../types/security/credentialEditor";
import type {
  DatabaseCredentialEntry,
  DatabaseCredentialSnapshot,
} from "../../../types/security/databaseCredentialVault";
import { localCredentialFacets } from "../../../utils/security/connectionCredentialConversion";
import { normalizeDatabaseCredentialEntry } from "../../../utils/security/databaseCredentialVault";
import { canMigrateConnectionCredential } from "../../../utils/security/credentialVaultUsage";
import { migrateConnectionCredential } from "../../../utils/security/migrateConnectionCredential";

export function useCredentialEditor(request: CredentialEditorRequest) {
  const context = useContext(ConnectionContext);
  const latest = useRef(context);
  latest.current = context;
  const owner = useRef({
    request,
    availabilityGeneration: context?.databaseAvailability?.generation,
  }).current;
  const alive = useRef(false),
    version = useRef(0),
    saving = useRef(false);
  const [entry, setEntry] = useState<DatabaseCredentialEntry | null>(null);
  const baseline = useRef(""),
    snapshot = useRef<DatabaseCredentialSnapshot | null>(null),
    connection = useRef<Connection | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const access = () => {
    const current = latest.current;
    const scope = current?.credentialVault?.scope;
    if (
      !alive.current ||
      !current ||
      !scope ||
      scope.databaseId !== owner.request.scope.databaseId ||
      scope.generation !== owner.request.scope.generation ||
      current.databaseAvailability?.status !== "ready" ||
      current.databaseAvailability.databaseId !== scope.databaseId ||
      current.databaseAvailability.generation !== owner.availabilityGeneration
    )
      throw new Error("Editor owner changed");
    return current;
  };
  useEffect(() => {
    alive.current = true;
    const run = ++version.current;
    const check = () => {
      if (version.current !== run) throw new Error("Expired editor read");
      return access();
    };
    void (async () => {
      try {
        const api = check().credentialVault!;
        const review = await api.list({ ...owner.request.scope });
        check();
        if (
          review.scope.databaseId !== owner.request.scope.databaseId ||
          review.scope.generation !== owner.request.scope.generation
        )
          throw new Error("Changed review");
        const now = new Date().toISOString();
        let draft: DatabaseCredentialEntry;
        const requested = owner.request;
        if (requested.mode === "edit") {
          const row = review.entries.find(
            (item) => item.id === requested.credentialId,
          );
          if (!row) throw new Error("Missing credential");
          const facets = await check().credentialVault!.resolve(
            review,
            row.id,
            row.availableFacets,
          );
          check();
          draft = {
            id: row.id,
            name: row.name,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            facets,
          };
        } else if (requested.mode === "migrate") {
          const current = check();
          const rows = current
            .getCurrentConnections?.({
              databaseId: owner.request.scope.databaseId,
              generation: owner.availabilityGeneration!,
            })
            .filter((row) => row.id === requested.connectionId);
          if (rows?.length !== 1 || !canMigrateConnectionCredential(rows[0]))
            throw new Error("Connection unavailable");
          connection.current = structuredClone(rows[0]);
          draft = normalizeDatabaseCredentialEntry({
            id: crypto.randomUUID(),
            name: rows[0].name,
            createdAt: now,
            updatedAt: now,
            facets: localCredentialFacets(rows[0]),
          });
        } else {
          draft = {
            id: crypto.randomUUID(),
            name: "",
            createdAt: now,
            updatedAt: now,
            facets: {},
          };
        }
        check();
        snapshot.current = review;
        baseline.current = JSON.stringify(draft);
        setEntry(draft);
      } catch {
        if (alive.current && version.current === run)
          setError(
            owner.request.mode === "migrate"
              ? "This connection could not be prepared for migration. Unlock its owning database and review the connection. Separate HTTP accounts and authenticator recovery codes must be handled in the connection editor first. Nothing was saved."
              : "The credential could not be opened. Unlock its owning database and reopen this tab. Nothing was saved.",
          );
      } finally {
        if (alive.current && version.current === run) setLoading(false);
      }
    })();
    return () => {
      alive.current = false;
      version.current = run + 1;
      connection.current = null;
      snapshot.current = null;
      baseline.current = "";
    };
    // One immutable request per tab; the outer component retires changed owners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {
    entry,
    loading,
    busy,
    error,
    connectionName: connection.current?.name,
    dirty: !!entry && JSON.stringify(entry) !== baseline.current,
    update: (value: DatabaseCredentialEntry) => {
      if (saving.current) return;
      access();
      if (value.id === entry?.id) setEntry(value);
    },
    save: async () => {
      if (saving.current || !entry || !snapshot.current) return false;
      saving.current = true;
      setBusy(true);
      setError(null);
      try {
        access();
        const next = normalizeDatabaseCredentialEntry({
          ...entry,
          updatedAt: new Date().toISOString(),
        });
        if (owner.request.mode === "migrate") {
          if (!connection.current) throw new Error("Missing connection");
          await migrateConnectionCredential({
            access,
            scope: owner.request.scope,
            original: connection.current,
            entry: next,
          });
        } else {
          await access().credentialVault!.compareAndSwap(snapshot.current, [
            { operation: "put", entry: next },
          ]);
        }
        access();
        baseline.current = JSON.stringify(next);
        setEntry(next);
        return true;
      } catch {
        if (alive.current)
          setError(
            owner.request.mode === "migrate"
              ? "Migration could not be confirmed. Local values are not cleared until the vault and connection link are verified. A vault entry or link may already be saved; retry in this tab to reuse it, or review the owning database. No vault entry was deleted."
              : "The credential could not be saved. Your draft is kept. Unlock and review the owning database before retrying; no fallback store was used.",
          );
        return false;
      } finally {
        saving.current = false;
        if (alive.current) setBusy(false);
      }
    },
  };
}
