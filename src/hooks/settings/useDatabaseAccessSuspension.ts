import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  DatabaseManager,
  onDatabaseAccessChange,
} from "../../utils/connection/databaseManager";
import type {
  DatabaseAccessState,
  DatabaseProtectionStatus,
} from "../../types/encryption/databaseProtection";

interface SuspendedDatabase {
  databaseId: string;
  name: string;
  access: DatabaseAccessState;
}

/** Access loss masks the existing editor tree; it never closes or reloads it. */
export function useDatabaseAccessSuspension() {
  const manager = DatabaseManager.getInstance();
  const read = useCallback((): SuspendedDatabase | null => {
    const current = manager.getCurrentDatabase();
    if (!current) return null;
    const access = manager.getDatabaseAccessState(current.id);
    return access?.status === "suspended"
      ? { databaseId: current.id, name: current.name, access }
      : null;
  }, [manager]);
  const [suspended, setSuspended] = useState(read);
  const [status, setStatus] = useState<DatabaseProtectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(suspended);
  const request = useRef(0);
  const mounted = useRef(true);
  const identity = (value: SuspendedDatabase | null) =>
    value
      ? `${value.databaseId}\u0000${value.access.securityRevision}\u0000${value.access.accessEpoch}`
      : "";

  useLayoutEffect(() => {
    mounted.current = true;
    const changed = () => {
      const next = read();
      if (identity(next) !== identity(latest.current)) {
        request.current += 1;
        setStatus(null);
        setError(null);
      }
      latest.current = next;
      setSuspended(next);
    };
    const accessOff = onDatabaseAccessChange(changed);
    const currentOff = manager.onCurrentDatabaseChange(changed);
    changed();
    return () => {
      mounted.current = false;
      request.current += 1;
      accessOff();
      currentOff();
    };
  }, [manager, read]);

  const inspect = useCallback(async () => {
    const target = latest.current;
    if (!target) return;
    const key = identity(target);
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const next = await manager.getDatabaseProtectionStatus(target.databaseId);
      if (
        !mounted.current ||
        request.current !== id ||
        identity(latest.current) !== key
      )
        return;
      if (next.kind !== "managed")
        throw new Error(
          "The database protection format changed. Access remains blocked; preserve unsaved edits and inspect the database before continuing.",
        );
      setStatus(next);
    } catch (failure) {
      if (
        mounted.current &&
        request.current === id &&
        identity(latest.current) === key
      )
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mounted.current && request.current === id) setLoading(false);
    }
  }, [manager]);
  const key = identity(suspended);
  useLayoutEffect(() => {
    if (key) void inspect();
  }, [key, inspect]);

  return {
    suspended,
    status,
    loading,
    error,
    inspect,
    blocked: suspended !== null,
  };
}

export type DatabaseAccessSuspension = ReturnType<
  typeof useDatabaseAccessSuspension
>;
