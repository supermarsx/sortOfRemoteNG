import { useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "../../contexts/SettingsContext";
import type { DatabaseDocumentStore } from "../../types/documents/document";
import {
  ENCRYPTION_EVENT_LOCKED,
  ENCRYPTION_EVENT_UNLOCKED,
  type EncryptionStatus,
} from "../../types/encryption/encryption";
import {
  APP_DOCUMENTS_STORE_KEY,
  createAppDocumentsStore,
} from "../../utils/documents/appDocumentsStore";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../utils/storage/appDataJsonStore";
import { getInvoke } from "../../utils/tauri/invoke";

// A remount must not resurrect a receipt from an earlier workspace instance.
let nextAccessEpoch = 0;

/** App ownership is independent of the active connection database. */
export function useAppDocumentsStore(): DatabaseDocumentStore | undefined {
  const { settingsReady } = useSettings();
  const latestReady = useRef(settingsReady === true);
  latestReady.current = settingsReady === true;
  const live = useRef(false);
  const listenerReady = useRef(false);
  const locked = useRef(false);
  const lease = useRef<AbortController | null>(null);
  const [accessRevision, setAccessRevision] = useState(0);
  const [changeRevision, setChangeRevision] = useState(0);
  const [store, setStore] = useState<DatabaseDocumentStore>();

  useEffect(() => {
    live.current = true;
    listenerReady.current = false;
    let disposed = false;
    let eventRevision = 0;
    const unlisteners: Array<() => void> = [];
    const revoke = () => {
      lease.current?.abort();
      lease.current = null;
      setStore(undefined);
      setAccessRevision((value) => value + 1);
    };
    const changed = (event: Event) => {
      if (
        (event as CustomEvent<{ key?: string }>).detail?.key ===
        APP_DOCUMENTS_STORE_KEY
      )
        setChangeRevision((value) => value + 1);
    };
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    void (async () => {
      const invoke = await getInvoke();
      if (disposed || !invoke) return;
      const { listen } = await import("@tauri-apps/api/event");
      for (const event of [
        ENCRYPTION_EVENT_LOCKED,
        ENCRYPTION_EVENT_UNLOCKED,
      ]) {
        const off = await listen(event, () => {
          if (disposed) return;
          eventRevision += 1;
          locked.current = event === ENCRYPTION_EVENT_LOCKED;
          revoke();
        });
        if (disposed) {
          off();
          return;
        }
        unlisteners.push(off);
      }
      // Cover an already locked desktop, including profiles with plaintext
      // settings. Native events observed during the status read take precedence.
      const beforeStatus = eventRevision;
      const status = await invoke<EncryptionStatus>("encryption_status");
      if (disposed) return;
      if (eventRevision === beforeStatus && eventRevision === 0)
        locked.current =
          status.criticalKeyFailure === true ||
          status.recoveryRequired === true ||
          (!status.unlocked &&
            (status.schemaVersion === 2 ||
              status.vaultHasMasterDek ||
              status.passwordWrapPresent ||
              status.settingsEncryptedOnDisk));
      listenerReady.current = true;
      setAccessRevision((value) => value + 1);
    })().catch(() => {
      if (disposed) return;
      listenerReady.current = false;
      revoke();
    });
    return () => {
      disposed = true;
      live.current = false;
      listenerReady.current = false;
      lease.current?.abort();
      lease.current = null;
      unlisteners.forEach((off) => off());
      window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    };
  }, []);

  useEffect(() => {
    if (!settingsReady || !listenerReady.current || locked.current) {
      setStore(undefined);
      return;
    }
    const controller = new AbortController();
    lease.current = controller;
    setStore(
      createAppDocumentsStore({
        generation: ++nextAccessEpoch,
        signal: controller.signal,
        assertCurrent() {
          if (
            !live.current ||
            !latestReady.current ||
            !listenerReady.current ||
            locked.current ||
            lease.current !== controller
          )
            throw new Error(
              "App-wide document access changed. Reload before continuing.",
            );
        },
      }),
    );
    return () => {
      controller.abort();
      if (lease.current === controller) lease.current = null;
    };
  }, [settingsReady, accessRevision]);

  return useMemo(() => {
    if (!settingsReady || !store) return undefined;
    return {
      get scope() {
        return store.scope;
      },
      changeRevision,
      read: store.read,
      compareAndSwap: store.compareAndSwap,
    };
  }, [settingsReady, store, changeRevision]);
}
