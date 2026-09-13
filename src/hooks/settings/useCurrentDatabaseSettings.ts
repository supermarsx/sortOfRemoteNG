import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import type {
  DatabaseSettings,
  DatabaseSettingsScope,
} from "../../types/settings/databaseSettings";
import { normalizeDatabaseSettings } from "../../utils/documents/documentTypePolicy";

/** Native-verified preferences for the same owner epoch as its document store. */
export function useCurrentDatabaseSettings() {
  const context = useContext(ConnectionContext);
  const api = context?.databaseSettings;
  const latest = useRef(api);
  latest.current = api;
  const key = JSON.stringify(api?.scope ?? null);
  const currentKey = useRef(key),
    epoch = useRef(0),
    mounted = useRef(true),
    read = useRef(0),
    busy = useRef(false);
  if (currentKey.current !== key) {
    currentKey.current = key;
    epoch.current++;
  }
  const [value, setValue] = useState<{
    key: string;
    epoch: number;
    scope: DatabaseSettingsScope;
    settings: DatabaseSettings;
  } | null>(null);
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  const isCurrent = useCallback(
    (captured: number, source: string) =>
      mounted.current &&
      epoch.current === captured &&
      currentKey.current === source,
    [],
  );
  const invalidate = useCallback(() => {
    epoch.current++;
  }, []);
  const reload = useCallback(async () => {
    const source = latest.current,
      scope = source?.scope;
    const captured = epoch.current,
      sourceKey = currentKey.current,
      request = ++read.current;
    if (!source || !scope) {
      setValue(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const settings = normalizeDatabaseSettings(
        await source.read({ ...scope }),
      );
      if (isCurrent(captured, sourceKey) && request === read.current)
        setValue({
          key: sourceKey,
          epoch: captured,
          scope: { ...scope },
          settings,
        });
    } catch {
      if (isCurrent(captured, sourceKey) && request === read.current) {
        setValue(null);
        setError(
          "Current database settings could not be verified. Unlock and reload the owning database, then retry. Existing content and preferences were not reset.",
        );
      }
    } finally {
      if (isCurrent(captured, sourceKey) && request === read.current)
        setLoading(false);
    }
  }, [isCurrent]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidate();
    };
  }, [invalidate]);
  useEffect(() => {
    void reload();
  }, [key, api?.changeRevision, reload]);
  const save = useCallback(
    async (replacement: DatabaseSettings): Promise<boolean> => {
      if (busy.current) return false;
      const source = latest.current,
        scope = source?.scope;
      const captured = epoch.current,
        sourceKey = currentKey.current;
      if (
        !source ||
        !scope ||
        !value ||
        value.key !== sourceKey ||
        value.epoch !== captured
      )
        return false;
      busy.current = true;
      setSaving(true);
      setError(null);
      try {
        const proposed = normalizeDatabaseSettings(replacement);
        await source.compareAndSwap({ ...scope }, value.settings, proposed);
        if (!isCurrent(captured, sourceKey)) return false;
        const verified = normalizeDatabaseSettings(
          await latest.current!.read({ ...scope }),
        );
        if (!isCurrent(captured, sourceKey)) return false;
        if (JSON.stringify(verified) !== JSON.stringify(proposed))
          throw new Error("Settings changed after save");
        setValue({
          key: sourceKey,
          epoch: captured,
          scope: { ...scope },
          settings: verified,
        });
        return true;
      } catch {
        if (isCurrent(captured, sourceKey))
          setError(
            "Database settings could not be saved and verified. Reload and review before retrying; a pending write may already have completed.",
          );
        return false;
      } finally {
        busy.current = false;
        if (mounted.current) setSaving(false);
      }
    },
    [isCurrent, value],
  );
  const current =
    value?.key === key && value.epoch === epoch.current && api?.scope
      ? value
      : null;
  return {
    settings: current?.settings ?? null,
    scope: current?.scope ?? null,
    loading,
    saving,
    error,
    reload,
    save,
  };
}
