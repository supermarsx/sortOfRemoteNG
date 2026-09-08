import { useCallback, useEffect, useRef, useState } from "react";
import { getInvoke } from "../../utils/tauri/invoke";

export interface DatabaseArtifactProtection {
  file: string;
  atRest: "envelope" | "plaintext" | "unreadable" | "missing";
  source: "current" | "backup" | "v0-migration" | null;
  openState:
    | "not-encrypted"
    | "current-key"
    | "retained-key"
    | "no-key"
    | "locked"
    | "unknown";
  detail: string | null;
}
export interface DatabaseEncryptionStatus {
  masterConfigured: boolean;
  unlocked: boolean;
  verified: boolean;
  retainedKeysAvailable: number;
  index: DatabaseArtifactProtection;
  databases: {
    id: string;
    name: string | null;
    passwordProtected: boolean | null;
    data: DatabaseArtifactProtection;
    trust: DatabaseArtifactProtection | null;
  }[];
  summary: {
    total: number;
    encrypted: number;
    plaintext: number;
    unreadable: number;
    stranded: number;
    recoverableWithRetainedKey: number;
  };
  errors: string[];
}

/** Read-only header inspection; never migrates files or claims a decryption audit. */
export function useDatabaseEncryptionStatus(refreshKey: unknown) {
  const [status, setStatus] = useState<DatabaseEncryptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setStatus(null);
    setError(null);
    try {
      const invoke = await getInvoke();
      if (!invoke)
        throw new Error(
          "Native disk protection inspection is available only in the desktop app.",
        );
      const next = await invoke<DatabaseEncryptionStatus>(
        "databases_encryption_status",
        { verify: false },
      );
      if (request === generation.current) setStatus(next);
    } catch (e) {
      if (request === generation.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return invalidate;
  }, [refresh, refreshKey, invalidate]);
  return { status, loading, error, refresh };
}
