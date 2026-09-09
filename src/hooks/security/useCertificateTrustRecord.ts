import { useEffect, useState } from "react";
import {
  getEffectiveStoredIdentity,
  type TrustRecord,
  type TrustRecordType,
} from "../../utils/auth/trustStore";

/** Read display state afresh; cached record presence never grants trust. */
export function useCertificateTrustRecord(
  enabled: boolean,
  host: string,
  port: number,
  type: TrustRecordType,
  connectionId?: string,
) {
  const key = JSON.stringify([host, port, type, connectionId]);
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    error?: string;
    record?: TrustRecord;
    connectionId?: string;
  }>({ key, loading: enabled });
  useEffect(() => {
    let generation = 0;
    let disposed = false;
    let inFlight = false;
    let queued = false;
    const refresh = async () => {
      if (inFlight) {
        generation++;
        queued = true;
        setState({ key, loading: true });
        return;
      }
      inFlight = true;
      const current = ++generation;
      setState({ key, loading: true });
      try {
        const result = await getEffectiveStoredIdentity(
          host,
          port,
          type,
          connectionId,
        );
        if (!disposed && generation === current)
          setState({ key, loading: false, ...result });
      } catch {
        // A failed native read may itself publish an unavailable event. Do not
        // retry that event recursively; retain an actionable error until retry.
        queued = false;
        if (!disposed)
          setState({
            key,
            loading: false,
            error:
              "The database Trust Center could not be inspected. Open or unlock the correct database and retry.",
          });
      } finally {
        inFlight = false;
        if (queued && !disposed) {
          queued = false;
          void refresh();
        }
      }
    };
    if (enabled) {
      window.addEventListener("trustStoreChanged", refresh);
      void refresh();
    }
    return () => {
      disposed = true;
      generation++;
      window.removeEventListener("trustStoreChanged", refresh);
    };
  }, [enabled, key, host, port, type, connectionId]);
  return state.key === key && enabled ? state : { key, loading: enabled };
}
