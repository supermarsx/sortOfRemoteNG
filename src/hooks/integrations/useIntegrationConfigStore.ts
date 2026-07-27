// useIntegrationConfigStore — persisted CRUD for per-integration instance config
// (t42 Wave 0, Risk R1).
//
// R1 disposition:
//   - The NON-SECRET part of an instance (name, host, credentialRefId, extra
//     non-secret fields) is persisted as one JSON blob under a namespaced
//     app-data key in sorng-storage. Mutations use the backend's atomic
//     `compare_and_swap_app_data` command, re-reading and rebasing on a
//     conflict so concurrent panels/processes cannot silently lose updates.
//   - The SECRET (API key / password / token) is NEVER written to that blob.
//     It is stored through the existing encrypted OS vault (`sorng-vault`,
//     `SecureStorage.vaultStoreSecret`) keyed by (service, account), where
//     `account` is the instance's `credentialRefId` or one of its named
//     `credentialRefIds`. The instance record holds only reference ids, never
//     secret values.
//
// So downstream panels persist host+creds encrypted for free, referencing the
// secret by id. If the OS vault is unavailable (web build / locked), writes
// fail closed: the instance is not persisted with a missing secret reference,
// and any newly created vault references are rolled back.

import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SecureStorage } from "../../utils/storage/storage";
import { generateId } from "../../utils/core/id";
import { sanitizeIntegrationStringFields } from "../../utils/integrations/providerFieldSanitizer";

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
  /** Optional named vault references for integrations that need multiple secrets. */
  credentialRefIds?: Record<string, string>;
  /** Extra NON-SECRET config fields (ports, usernames, paths, flags, ...). */
  fields?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

/** Input shape for creating/updating an instance. `secret` is handled out-of-band
 *  (written to the vault, never persisted in the config blob). */
export interface IntegrationInstanceInput {
  id?: string;
  integrationKey: string;
  name: string;
  host?: string;
  fields?: Record<string, string>;
  /** Adopt an existing OS-vault reference without reading its plaintext. */
  credentialRefId?: string;
  /** Adopt existing named OS-vault references without reading plaintext. */
  credentialRefIds?: Record<string, string>;
  /** Plaintext secret to store in the OS vault. Omit to leave unchanged (update)
   *  or unset (create). */
  secret?: string;
  /** Plaintext named secrets to store in the OS vault. Empty strings are
   *  ignored. On update, a deliberately present `undefined` value retires that
   *  named secret after the config CAS commits. */
  secrets?: Record<string, string | undefined>;
}

const normalizeError = (error: unknown): string =>
  typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : String(error);

const isStringRecord = (value: unknown): value is Record<string, string> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === "string");

function parseInstances(raw: string): IntegrationInstance[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Integration configuration is corrupted: ${normalizeError(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "Integration configuration is corrupted: expected an array of instances",
    );
  }

  return parsed.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `Integration configuration is corrupted: instance ${index + 1} is not an object`,
      );
    }
    const record = value as Record<string, unknown>;
    for (const field of [
      "id",
      "integrationKey",
      "name",
      "createdAt",
      "updatedAt",
    ] as const) {
      if (typeof record[field] !== "string" || record[field].length === 0) {
        throw new Error(
          `Integration configuration is corrupted: instance ${index + 1} has an invalid ${field}`,
        );
      }
    }
    if (record.host !== undefined && typeof record.host !== "string") {
      throw new Error(
        `Integration configuration is corrupted: instance ${index + 1} has an invalid host`,
      );
    }
    if (
      record.credentialRefId !== undefined &&
      typeof record.credentialRefId !== "string"
    ) {
      throw new Error(
        `Integration configuration is corrupted: instance ${index + 1} has an invalid credential reference`,
      );
    }
    if (
      record.credentialRefIds !== undefined &&
      !isStringRecord(record.credentialRefIds)
    ) {
      throw new Error(
        `Integration configuration is corrupted: instance ${index + 1} has invalid named credential references`,
      );
    }
    if (record.fields !== undefined && !isStringRecord(record.fields)) {
      throw new Error(
        `Integration configuration is corrupted: instance ${index + 1} has invalid fields`,
      );
    }

    // Rebuild from the allow-list so accidentally persisted plaintext secret
    // properties can never flow back through the frontend store.
    return {
      id: record.id as string,
      integrationKey: record.integrationKey as string,
      name: record.name as string,
      ...(typeof record.host === "string" ? { host: record.host } : {}),
      ...(typeof record.credentialRefId === "string"
        ? { credentialRefId: record.credentialRefId }
        : {}),
      ...(isStringRecord(record.credentialRefIds)
        ? { credentialRefIds: { ...record.credentialRefIds } }
        : {}),
      ...(isStringRecord(record.fields)
        ? { fields: sanitizeIntegrationStringFields(record.fields) }
        : {}),
      createdAt: record.createdAt as string,
      updatedAt: record.updatedAt as string,
    };
  });
}

interface LoadedInstances {
  raw: string | null;
  instances: IntegrationInstance[];
}

async function loadInstances(): Promise<LoadedInstances> {
  const raw = await invoke<string | null>("read_app_data", {
    key: INTEGRATION_CONFIG_KEY,
  });
  return {
    raw,
    instances: raw ? parseInstances(raw) : [],
  };
}

async function compareAndSwapInstances(
  expected: string | null,
  instances: IntegrationInstance[],
): Promise<boolean> {
  return invoke<boolean>("compare_and_swap_app_data", {
    key: INTEGRATION_CONFIG_KEY,
    expected,
    replacement: JSON.stringify(instances),
  });
}

type StoreListener = () => void;

interface SharedStoreSnapshot {
  instances: IntegrationInstance[];
  isLoading: boolean;
  error: string | null;
}

let sharedSnapshot: SharedStoreSnapshot = {
  instances: [],
  isLoading: true,
  error: null,
};
let sharedLoadPromise: Promise<void> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();
const listeners = new Set<StoreListener>();

const publish = (patch: Partial<SharedStoreSnapshot>): void => {
  sharedSnapshot = { ...sharedSnapshot, ...patch };
  for (const listener of listeners) listener();
};

const subscribe = (listener: StoreListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const ensureLoaded = (): Promise<void> => {
  if (sharedLoadPromise) return sharedLoadPromise;
  publish({ isLoading: true, error: null });
  sharedLoadPromise = loadInstances()
    .then(({ instances }) => {
      publish({ instances, isLoading: false, error: null });
    })
    .catch((error) => {
      publish({
        instances: [],
        isLoading: false,
        error: normalizeError(error),
      });
      throw error;
    });
  return sharedLoadPromise;
};

interface MutationPlan<T> {
  next: IntegrationInstance[];
  result: T;
  rollback?: () => Promise<void>;
  afterCommit?: () => Promise<void>;
}

/**
 * Serialize every mutation across hook instances and re-read the durable value
 * immediately before applying it. This prevents two mounted panels (or two
 * detached windows sharing the same storage backend) from committing snapshots
 * based on stale React closures.
 */
function enqueueMutation<T>(
  buildPlan: (current: IntegrationInstance[]) => Promise<MutationPlan<T>>,
): Promise<T> {
  const run = async (): Promise<T> => {
    await ensureLoaded();
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let durable: LoadedInstances;
      try {
        durable = await loadInstances();
      } catch (error) {
        publish({ error: normalizeError(error) });
        throw error;
      }

      let plan: MutationPlan<T> | undefined;
      try {
        plan = await buildPlan(durable.instances);
        const swapped = await compareAndSwapInstances(durable.raw, plan.next);
        if (!swapped) {
          await plan.rollback?.().catch(() => undefined);
          plan = undefined;
          if (attempt < maxAttempts) continue;
          throw new Error(
            "Integration configuration changed concurrently; retry the operation",
          );
        }
        publish({ instances: plan.next, error: null });
        await plan.afterCommit?.();
        return plan.result;
      } catch (error) {
        await plan?.rollback?.().catch(() => undefined);
        // Persistence-first publication means this is also the rollback path:
        // all mounted hooks see the last value that was actually durable.
        publish({
          instances: durable.instances,
          error: normalizeError(error),
        });
        throw error;
      }
    }
    throw new Error("Integration configuration mutation retry exhausted");
  };

  const result = mutationQueue.then(run, run);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function deleteVaultRefs(refs: Iterable<string>): Promise<void> {
  for (const credentialRefId of refs) {
    try {
      await SecureStorage.vaultDeleteSecret(
        INTEGRATION_VAULT_SERVICE,
        credentialRefId,
      );
    } catch {
      // Best effort. The durable config is authoritative and no longer points
      // at this reference.
    }
  }
}

/**
 * CRUD store for integration instance config. All hook instances subscribe to
 * one shared snapshot; writes are serialized and rebased on the durable value.
 */
export function useIntegrationConfigStore() {
  const [snapshot, setSnapshot] = useState(sharedSnapshot);

  useEffect(() => {
    const unsubscribe = subscribe(() => setSnapshot(sharedSnapshot));
    setSnapshot(sharedSnapshot);
    void ensureLoaded().catch(() => undefined);
    return unsubscribe;
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    sharedLoadPromise = null;
    await ensureLoaded();
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

  /** Read a named vault secret, or null if the integration has no such secret. */
  const readNamedSecret = useCallback(
    async (
      instance: IntegrationInstance,
      name: string,
    ): Promise<string | null> => {
      const credentialRefId = instance.credentialRefIds?.[name];
      if (!credentialRefId) return null;
      try {
        return await SecureStorage.vaultReadSecret(
          INTEGRATION_VAULT_SERVICE,
          credentialRefId,
        );
      } catch {
        return null;
      }
    },
    [],
  );

  const writeNamedSecrets = useCallback(
    async (
      secrets: Record<string, string | undefined> | undefined,
    ): Promise<Record<string, string>> => {
      const nextRefs: Record<string, string> = {};
      if (!secrets) return nextRefs;
      try {
        for (const [name, secret] of Object.entries(secrets)) {
          if (!secret) continue;
          const credentialRefId = generateId();
          await writeSecret(credentialRefId, secret);
          nextRefs[name] = credentialRefId;
        }
      } catch (error) {
        await deleteVaultRefs(Object.values(nextRefs));
        throw error;
      }
      return nextRefs;
    },
    [writeSecret],
  );

  /** Create a new instance. If `input.secret` is given, it is stored in the OS
   *  vault and only the reference id is persisted. */
  const createInstance = useCallback(
    async (input: IntegrationInstanceInput): Promise<IntegrationInstance> => {
      return enqueueMutation(async (current) => {
        const now = new Date().toISOString();
        const createdRefs: string[] = [];
        const instance: IntegrationInstance = {
          id: input.id ?? generateId(),
          integrationKey: input.integrationKey,
          name: input.name,
          host: input.host,
          fields: sanitizeIntegrationStringFields(input.fields),
          credentialRefId: input.credentialRefId,
          credentialRefIds: input.credentialRefIds,
          createdAt: now,
          updatedAt: now,
        };
        if (current.some((candidate) => candidate.id === instance.id)) {
          throw new Error(
            `Integration instance "${instance.id}" already exists`,
          );
        }
        try {
          if (input.secret) {
            const credentialRefId = generateId();
            await writeSecret(credentialRefId, input.secret);
            createdRefs.push(credentialRefId);
            instance.credentialRefId = credentialRefId;
          }
          const namedRefs = await writeNamedSecrets(input.secrets);
          createdRefs.push(...Object.values(namedRefs));
          if (Object.keys(namedRefs).length > 0) {
            instance.credentialRefIds = {
              ...(instance.credentialRefIds ?? {}),
              ...namedRefs,
            };
          }
        } catch (error) {
          await deleteVaultRefs(createdRefs);
          throw error;
        }
        return {
          next: [...current, instance],
          result: instance,
          rollback: () => deleteVaultRefs(createdRefs),
        };
      });
    },
    [writeSecret, writeNamedSecrets],
  );

  /** Update an instance's non-secret fields, and optionally rotate its secret. */
  const updateInstance = useCallback(
    async (
      id: string,
      patch: Partial<IntegrationInstanceInput>,
    ): Promise<IntegrationInstance> => {
      return enqueueMutation(async (current) => {
        const existing = current.find((instance) => instance.id === id);
        if (!existing) {
          throw new Error(`Integration instance "${id}" no longer exists`);
        }
        const createdRefs: string[] = [];
        const retiredRefs: string[] = [];
        const updated: IntegrationInstance = {
          ...existing,
          name: patch.name ?? existing.name,
          host: patch.host !== undefined ? patch.host : existing.host,
          fields:
            patch.fields !== undefined
              ? sanitizeIntegrationStringFields(patch.fields)
              : existing.fields,
          credentialRefId:
            patch.credentialRefId !== undefined
              ? patch.credentialRefId
              : existing.credentialRefId,
          credentialRefIds:
            patch.credentialRefIds !== undefined
              ? patch.credentialRefIds
              : existing.credentialRefIds,
          updatedAt: new Date().toISOString(),
        };
        try {
          if (patch.secret !== undefined) {
            const credentialRefId = generateId();
            await writeSecret(credentialRefId, patch.secret);
            createdRefs.push(credentialRefId);
            if (existing.credentialRefId) {
              retiredRefs.push(existing.credentialRefId);
            }
            updated.credentialRefId = credentialRefId;
          }
          const namedRefs = await writeNamedSecrets(patch.secrets);
          const namedSecretRemovals = Object.entries(patch.secrets ?? {})
            .filter(([, secret]) => secret === undefined)
            .map(([name]) => name);
          if (
            Object.keys(namedRefs).length > 0 ||
            namedSecretRemovals.length > 0
          ) {
            const merged = { ...(updated.credentialRefIds ?? {}) };
            for (const name of namedSecretRemovals) {
              if (merged[name]) retiredRefs.push(merged[name]);
              delete merged[name];
            }
            for (const [name, credentialRefId] of Object.entries(namedRefs)) {
              if (merged[name]) retiredRefs.push(merged[name]);
              merged[name] = credentialRefId;
              createdRefs.push(credentialRefId);
            }
            if (Object.keys(merged).length > 0) {
              updated.credentialRefIds = merged;
            } else {
              delete updated.credentialRefIds;
            }
          }
        } catch (error) {
          await deleteVaultRefs(createdRefs);
          throw error;
        }
        return {
          next: current.map((instance) =>
            instance.id === id ? updated : instance,
          ),
          result: updated,
          rollback: () => deleteVaultRefs(createdRefs),
          afterCommit: () => deleteVaultRefs(retiredRefs),
        };
      });
    },
    [writeSecret, writeNamedSecrets],
  );

  /** Remove an instance and its vault secret (best-effort). */
  const deleteInstance = useCallback(async (id: string): Promise<void> => {
    await enqueueMutation(async (current) => {
      const existing = current.find((instance) => instance.id === id);
      if (!existing) return { next: current, result: undefined };
      const refs = [
        ...(existing.credentialRefId ? [existing.credentialRefId] : []),
        ...Object.values(existing.credentialRefIds ?? {}),
      ];
      return {
        next: current.filter((instance) => instance.id !== id),
        result: undefined,
        afterCommit: () => deleteVaultRefs(refs),
      };
    });
  }, []);

  /** All instances for a given integration key. */
  const instancesFor = useCallback(
    (integrationKey: string): IntegrationInstance[] =>
      snapshot.instances.filter((i) => i.integrationKey === integrationKey),
    [snapshot.instances],
  );

  return {
    instances: snapshot.instances,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    reload,
    instancesFor,
    createInstance,
    updateInstance,
    deleteInstance,
    readSecret,
    readNamedSecret,
  };
}

export type IntegrationConfigStore = ReturnType<
  typeof useIntegrationConfigStore
>;

/** Test-only reset for the module-level external store. */
export function resetIntegrationConfigStoreForTests(): void {
  sharedSnapshot = { instances: [], isLoading: true, error: null };
  sharedLoadPromise = null;
  mutationQueue = Promise.resolve();
  for (const listener of listeners) listener();
}
