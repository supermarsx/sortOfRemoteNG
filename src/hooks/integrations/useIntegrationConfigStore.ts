// useIntegrationConfigStore — persisted CRUD for per-integration instance config
// (t42 Wave 0, Risk R1).
//
// R1 disposition (NO backend work needed):
//   - The NON-SECRET part of an instance (name, host, credentialRefId, extra
//     non-secret fields) is persisted as one JSON blob under a namespaced
//     app-data key via `write_app_data`/`read_app_data` (sorng-storage). This
//     is the same generic KV store the proxy collection manager uses.
//   - The SECRET (API key / password / token) is NEVER written to that blob.
//     It is stored through the existing encrypted OS vault (`sorng-vault`,
//     `SecureStorage.vaultStoreSecret`) keyed by (service, account), where
//     `account` is the instance's `credentialRefId`. The instance record holds
//     only the reference id, never the secret value.
//
// So downstream panels persist host+creds encrypted for free, referencing the
// secret by id. If the OS vault is unavailable (web build / locked), secret
// writes throw and callers degrade to reference-only (the instance still saves
// and the panel can prompt for the secret at connect time).

import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SecureStorage } from "../../utils/storage/storage";
import { generateId } from "../../utils/core/id";

/** OS-vault service namespace for all integration secrets. `account` within
 *  this service is the instance's `credentialRefId`. */
export const INTEGRATION_VAULT_SERVICE = "com.sortofremoteng.integrations";

/** App-data KV key holding the JSON array of non-secret instance records. */
export const INTEGRATION_CONFIG_KEY = "integrations.instances";

/** A persisted integration instance — the non-secret config only. The secret
 *  lives in the OS vault under `credentialRefId`; it is never stored here. */
export interface IntegrationInstance {
  /** Stable unique id for this instance. */
  id: string;
  /** Which integration this is an instance of (matches `IntegrationDescriptor.key`). */
  integrationKey: string;
  /** User-facing label for the instance. */
  name: string;
  /** Primary host/endpoint, when the integration has one (keepass, gdrive don't). */
  host?: string;
  /** Reference id (= OS vault `account`) for this instance's secret, if stored. */
  credentialRefId?: string;
  /** Extra NON-SECRET config fields (ports, usernames, paths, flags, ...). */
  fields?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

/** Input shape for creating/updating an instance. `secret` is handled out-of-band
 *  (written to the vault, never persisted in the config blob). */
export interface IntegrationInstanceInput {
  integrationKey: string;
  name: string;
  host?: string;
  fields?: Record<string, string>;
  /** Plaintext secret to store in the OS vault. Omit to leave unchanged (update)
   *  or unset (create). */
  secret?: string;
}

async function loadInstances(): Promise<IntegrationInstance[]> {
  try {
    const raw = await invoke<string | null>("read_app_data", {
      key: INTEGRATION_CONFIG_KEY,
    });
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IntegrationInstance[]) : [];
  } catch {
    return [];
  }
}

async function saveInstances(instances: IntegrationInstance[]): Promise<void> {
  await invoke("write_app_data", {
    key: INTEGRATION_CONFIG_KEY,
    value: JSON.stringify(instances),
  });
}

/**
 * CRUD store for integration instance config. Loads once on mount, keeps an
 * in-memory mirror, and persists the non-secret blob + vault secret on writes.
 */
export function useIntegrationConfigStore() {
  const [instances, setInstances] = useState<IntegrationInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const loaded = await loadInstances();
        if (mounted.current) setInstances(loaded);
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        if (mounted.current) setError(msg);
      } finally {
        if (mounted.current) setIsLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  const persist = useCallback(async (next: IntegrationInstance[]) => {
    setInstances(next);
    await saveInstances(next);
  }, []);

  /** Store (or replace) an instance's secret in the OS vault by reference id.
   *  Returns the reference id used. Throws if the vault is unavailable. */
  const writeSecret = useCallback(
    async (credentialRefId: string, secret: string): Promise<void> => {
      await SecureStorage.vaultStoreSecret(
        INTEGRATION_VAULT_SERVICE,
        credentialRefId,
        secret,
      );
    },
    [],
  );

  /** Read an instance's secret back from the OS vault, or null if none/unavailable. */
  const readSecret = useCallback(
    async (instance: IntegrationInstance): Promise<string | null> => {
      if (!instance.credentialRefId) return null;
      try {
        return await SecureStorage.vaultReadSecret(
          INTEGRATION_VAULT_SERVICE,
          instance.credentialRefId,
        );
      } catch {
        return null;
      }
    },
    [],
  );

  /** Create a new instance. If `input.secret` is given, it is stored in the OS
   *  vault and only the reference id is persisted. */
  const createInstance = useCallback(
    async (input: IntegrationInstanceInput): Promise<IntegrationInstance> => {
      const now = new Date().toISOString();
      const instance: IntegrationInstance = {
        id: generateId(),
        integrationKey: input.integrationKey,
        name: input.name,
        host: input.host,
        fields: input.fields,
        createdAt: now,
        updatedAt: now,
      };
      if (input.secret) {
        const credentialRefId = generateId();
        await writeSecret(credentialRefId, input.secret);
        instance.credentialRefId = credentialRefId;
      }
      await persist([...instances, instance]);
      return instance;
    },
    [instances, persist, writeSecret],
  );

  /** Update an instance's non-secret fields, and optionally rotate its secret. */
  const updateInstance = useCallback(
    async (
      id: string,
      patch: Partial<IntegrationInstanceInput>,
    ): Promise<void> => {
      const existing = instances.find((i) => i.id === id);
      if (!existing) return;
      const updated: IntegrationInstance = {
        ...existing,
        name: patch.name ?? existing.name,
        host: patch.host !== undefined ? patch.host : existing.host,
        fields: patch.fields !== undefined ? patch.fields : existing.fields,
        updatedAt: new Date().toISOString(),
      };
      if (patch.secret !== undefined) {
        const credentialRefId = existing.credentialRefId ?? generateId();
        await writeSecret(credentialRefId, patch.secret);
        updated.credentialRefId = credentialRefId;
      }
      await persist(instances.map((i) => (i.id === id ? updated : i)));
    },
    [instances, persist, writeSecret],
  );

  /** Remove an instance and its vault secret (best-effort). */
  const deleteInstance = useCallback(
    async (id: string): Promise<void> => {
      const existing = instances.find((i) => i.id === id);
      if (existing?.credentialRefId) {
        try {
          await SecureStorage.vaultDeleteSecret(
            INTEGRATION_VAULT_SERVICE,
            existing.credentialRefId,
          );
        } catch {
          // Secret already gone / vault unavailable — drop the reference anyway.
        }
      }
      await persist(instances.filter((i) => i.id !== id));
    },
    [instances, persist],
  );

  /** All instances for a given integration key. */
  const instancesFor = useCallback(
    (integrationKey: string): IntegrationInstance[] =>
      instances.filter((i) => i.integrationKey === integrationKey),
    [instances],
  );

  return {
    instances,
    isLoading,
    error,
    instancesFor,
    createInstance,
    updateInstance,
    deleteInstance,
    readSecret,
  };
}

export type IntegrationConfigStore = ReturnType<
  typeof useIntegrationConfigStore
>;
