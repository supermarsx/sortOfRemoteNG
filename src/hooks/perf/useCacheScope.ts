import { useEffect } from "react";
import { setCacheScope } from "../../utils/perf/cachedInvoke";
import { useConnectionsSelector } from "../../contexts/useConnectionsSelector";

/**
 * Keys the app-wide query cache to the active database so one database's cached
 * reads never serve another; a change clears the cache (see setCacheScope).
 */
export function useCacheScope(): void {
  const databaseId = useConnectionsSelector(
    (ctx) => ctx.databaseAvailability?.databaseId ?? "",
  );
  useEffect(() => {
    setCacheScope(databaseId);
  }, [databaseId]);
}
