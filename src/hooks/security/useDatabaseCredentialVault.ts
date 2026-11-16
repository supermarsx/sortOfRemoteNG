import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DatabaseCredentialEntry,
  DatabaseCredentialFacet,
  DatabaseCredentialMetadata,
  DatabaseCredentialSnapshot,
  DatabaseCredentialVaultApi,
} from "../../types/security/databaseCredentialVault";
import { normalizeDatabaseCredentialEntry } from "../../utils/security/databaseCredentialVault";
import { perfMark, perfMeasure } from "../../utils/preload/perf";
import {
  cachedVaultEntry,
  cachedVaultSnapshot,
  isVaultCacheFresh,
  loadVaultSnapshot,
  purgeVaultCache,
} from "./credentialVaultCache";

export const credentialVaultScopeKey = (
  api: DatabaseCredentialVaultApi | undefined,
): string =>
  api?.scope
    ? JSON.stringify([api.scope.databaseId, api.scope.generation])
    : "unavailable";
export const FACET_LABELS: Record<DatabaseCredentialFacet, string> = {
  username: "Username",
  password: "Password",
  domain: "Domain",
  privateKey: "Private key",
  passphrase: "Key passphrase",
  totp: "TOTP authenticators",
  social: "Social sign-in bindings",
  passkey: "Passkey bindings",
  deviceTrust: "Trusted NAS devices",
};

const failureMessage =
  "The credential vault could not be read or saved. Keep your draft, unlock and reload the owning database, then retry. Protect the current database or enable unlocked app-wide encryption for connection data in Security settings. No fallback store was used.";

/** One owner-keyed editor lifetime. Secret values are never included in list rows. */
export function useDatabaseCredentialVault(api: DatabaseCredentialVaultApi) {
  const key = credentialVaultScopeKey(api);
  const latest = useRef({ api, key });
  latest.current = { api, key };
  const alive = useRef(true),
    busyRef = useRef(false),
    readVersion = useRef(0);
  // Stale-while-revalidate: a warm cache renders on the very first paint.
  const [snapshot, setSnapshot] = useState<DatabaseCredentialSnapshot | null>(
    () => {
      perfMark("vault:mount");
      return cachedVaultSnapshot(api);
    },
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [draft, setDraft] = useState<{
    entry: DatabaseCredentialEntry;
    snapshot: DatabaseCredentialSnapshot;
    original: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(() => cachedVaultSnapshot(api) === null),
    [error, setError] = useState<string | null>(null);
  const current = useCallback(() => {
    if (
      !alive.current ||
      latest.current.key !== key ||
      !latest.current.api.scope
    )
      throw new Error("Credential vault access changed.");
    return latest.current.api;
  }, [key]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      readVersion.current += 1;
    };
  }, []);
  const reload = useCallback(
    async (options: { background?: boolean; fresh?: boolean } = {}) => {
      const version = ++readVersion.current;
      // Background revalidation keeps the cached rows on screen (no spinner).
      if (!(options.background && snapshotRef.current)) setLoading(true);
      setError(null);
      try {
        const selected = current();
        const next = await loadVaultSnapshot(selected, {
          fresh: options.fresh ?? true,
        });
        current();
        if (version !== readVersion.current) return false;
        // Swapped in place (no loading toggle), so a background refresh is flicker-free.
        setSnapshot(next);
        perfMark("vault:data");
        perfMeasure("vault:mount-to-data", "vault:mount", "vault:data");
        return true;
      } catch {
        if (
          alive.current &&
          latest.current.key === key &&
          version === readVersion.current
        ) {
          setSnapshot(null);
          setError(failureMessage);
        }
        return false;
      } finally {
        if (
          alive.current &&
          latest.current.key === key &&
          version === readVersion.current
        )
          setLoading(false);
      }
    },
    [current, key],
  );
  useEffect(() => {
    // Forget cache entries of any other owner (lock, database switch).
    purgeVaultCache(latest.current.api);
    const entry = cachedVaultEntry(latest.current.api);
    // Fresh and unchanged: no native round trip at all on tab switch.
    if (isVaultCacheFresh(latest.current.api) && snapshotRef.current) {
      setLoading(false);
      return;
    }
    // Join an in-flight preload unless the vault changed since it started.
    void reload({ background: !!entry, fresh: !!entry });
  }, [reload, api.changeRevision]);
  const perform = async (action: () => Promise<void>): Promise<boolean> => {
    if (busyRef.current) return false;
    try {
      current();
    } catch {
      return false;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      current();
      return true;
    } catch {
      if (alive.current && latest.current.key === key) setError(failureMessage);
      return false;
    } finally {
      busyRef.current = false;
      if (alive.current && latest.current.key === key) setBusy(false);
    }
  };
  return {
    snapshot,
    draft: draft?.entry ?? null,
    busy,
    loading,
    error,
    dirty: !!draft && JSON.stringify(draft.entry) !== draft.original,
    reload,
    create: () => {
      if (!snapshot || busyRef.current || loading) return;
      current();
      const now = new Date().toISOString();
      const entry: DatabaseCredentialEntry = {
        id: crypto.randomUUID(),
        name: "",
        createdAt: now,
        updatedAt: now,
        facets: {},
      };
      setDraft({ entry, snapshot, original: JSON.stringify(entry) });
      setError(null);
    },
    edit: (row: DatabaseCredentialMetadata) =>
      perform(async () => {
        if (
          !snapshot ||
          loading ||
          !snapshot.entries.some((item) => item.id === row.id)
        )
          throw new Error("Review unavailable");
        const review = snapshot;
        const facets = await current().resolve(
          review,
          row.id,
          row.availableFacets,
        );
        current();
        const entry: DatabaseCredentialEntry = {
          id: row.id,
          name: row.name,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          facets,
          ...(row.tags ? { tags: [...row.tags] } : {}),
        };
        setDraft({ entry, snapshot: review, original: JSON.stringify(entry) });
      }),
    update: (entry: DatabaseCredentialEntry) => {
      if (busyRef.current) return;
      current();
      setDraft((previous) =>
        previous && previous.entry.id === entry.id
          ? { ...previous, entry }
          : previous,
      );
    },
    discard: () => {
      if (!busyRef.current) {
        current();
        setDraft(null);
        setError(null);
      }
    },
    save: () =>
      perform(async () => {
        if (!draft) throw new Error("Draft unavailable");
        const entry = normalizeDatabaseCredentialEntry({
          ...draft.entry,
          updatedAt: new Date().toISOString(),
        });
        await current().compareAndSwap(draft.snapshot, [
          { operation: "put", entry },
        ]);
        current();
        setDraft(null);
        await reload();
      }),
    /** One whole-vault CAS and one durable save for the entire batch. */
    removeMany: (review: DatabaseCredentialSnapshot, ids: readonly string[]) =>
      perform(async () => {
        const known = new Set(review.entries.map((row) => row.id));
        const unique = [...new Set(ids)];
        if (!unique.length || unique.some((id) => !known.has(id)))
          throw new Error("Review unavailable");
        await current().compareAndSwap(
          review,
          unique.map((id) => ({ operation: "delete" as const, id })),
        );
        current();
        await reload();
      }),
    remove: (review: DatabaseCredentialSnapshot, id: string) =>
      perform(async () => {
        if (!review.entries.some((row) => row.id === id))
          throw new Error("Review unavailable");
        await current().compareAndSwap(review, [{ operation: "delete", id }]);
        current();
        await reload();
      }),
  };
}
