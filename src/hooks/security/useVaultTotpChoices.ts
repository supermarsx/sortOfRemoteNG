import { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import type { Connection } from "../../types/connection/connection";
import type { RuntimeVaultTotpEntry } from "./useRuntimeVaultTotp";

/** Editor disclosure is transient: retain labels/parameters, never seed values. */
export function useVaultTotpChoices(connection: Partial<Connection>) {
  const api = useContext(ConnectionContext)?.credentialVault;
  const source = connection.credentialSource;
  const credentialId = source?.kind === "vault" ? source.credentialId : "";
  const owner = useRef(api?.scope ? JSON.stringify(api.scope) : null);
  if (!owner.current && api?.scope) owner.current = JSON.stringify(api.scope);
  const key = JSON.stringify([api?.scope, api?.changeRevision, credentialId]);
  const current = useRef(key);
  current.current = key;
  const [result, setResult] = useState<{
    key: string;
    entries: RuntimeVaultTotpEntry[];
    error: string;
    loading: boolean;
  }>({ key: "", entries: [], error: "", loading: false });
  const [retry, setRetry] = useState(0);
  const available =
    !!api?.scope &&
    JSON.stringify(api.scope) === owner.current &&
    !!credentialId;
  useEffect(() => {
    let alive = true;
    if (!available || !api?.scope) return;
    const assertCurrent = () => {
      if (!alive || current.current !== key) throw new Error();
    };
    setResult({ key, entries: [], error: "", loading: true });
    void (async () => {
      const snapshot = await api.list({ ...api.scope! });
      assertCurrent();
      const metadata = snapshot.entries.filter(
        (entry) => entry.id === credentialId,
      );
      if (metadata.length !== 1) throw new Error();
      if (!metadata[0].availableFacets.includes("totp")) return [];
      const facets = await api.resolve(snapshot, credentialId, ["totp"]);
      try {
        assertCurrent();
        return (facets.totp ?? []).map(
          ({ secret: _secret, ...entry }) => entry,
        );
      } finally {
        delete facets.totp;
      }
    })()
      .then((entries) => {
        assertCurrent();
        setResult({ key, entries, error: "", loading: false });
      })
      .catch(() => {
        if (alive && current.current === key)
          setResult({
            key,
            entries: [],
            error:
              "Vault authenticators could not be read. Unlock the owning database and reload.",
            loading: false,
          });
      });
    return () => {
      alive = false;
    };
  }, [api, available, key, credentialId, retry]);
  return {
    entries: available && result.key === key ? result.entries : [],
    loading: available && (result.key !== key || result.loading),
    error: available && result.key === key ? result.error : "",
    available,
    reload: () => setRetry((value) => value + 1),
  };
}
