import { SecureStorage } from "./storage";

export const CONNECTION_NOTES_VAULT_SERVICE = "sortofremoteng.connection-notes";
export const MAX_CONNECTION_NOTES_UTF8_BYTES = 2_048;
export const MAX_CONNECTION_NOTES_CODE_UNITS = Math.floor(
  MAX_CONNECTION_NOTES_UTF8_BYTES / 3,
);

const MAX_PENDING_NOTE_OPERATIONS = 256;
const MAX_NOTE_LIFECYCLE_ENTRIES = 4_096;
const TOMBSTONE_RETENTION_MS = 5 * 60 * 1_000;

interface NoteLifecycle {
  generation: number;
  tombstoned: boolean;
  touchedAt: number;
}

const lifecycles = new Map<string, NoteLifecycle>();
let operationTail: Promise<void> = Promise.resolve();
let pendingOperations = 0;

function validateConnectionId(connectionId: string): void {
  if (!connectionId || connectionId.length > 256) {
    throw new Error("Connection ID is invalid.");
  }
}

function pruneSafeTombstones(now = Date.now()): void {
  if (pendingOperations !== 0) return;
  for (const [connectionId, lifecycle] of lifecycles) {
    if (
      lifecycle.tombstoned &&
      now - lifecycle.touchedAt >= TOMBSTONE_RETENTION_MS
    ) {
      lifecycles.delete(connectionId);
    }
  }
}

function lifecycleFor(connectionId: string): NoteLifecycle {
  validateConnectionId(connectionId);
  const existing = lifecycles.get(connectionId);
  if (existing) return existing;
  pruneSafeTombstones();
  if (lifecycles.size >= MAX_NOTE_LIFECYCLE_ENTRIES) {
    throw new Error("Secure note lifecycle capacity is exhausted.");
  }
  const created: NoteLifecycle = {
    generation: 0,
    tombstoned: false,
    touchedAt: Date.now(),
  };
  lifecycles.set(connectionId, created);
  return created;
}

function enqueueNoteOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (pendingOperations >= MAX_PENDING_NOTE_OPERATIONS) {
    return Promise.reject(
      new Error("Secure note operation queue is at capacity."),
    );
  }
  pendingOperations += 1;
  const result = operationTail.then(operation, operation);
  operationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result.finally(() => {
    pendingOperations -= 1;
    pruneSafeTombstones();
  });
}

function assertSecretSize(secret: string): void {
  if (secret.length > MAX_CONNECTION_NOTES_CODE_UNITS) {
    throw new Error("Secure note payload exceeds the conservative size limit.");
  }
  if (
    new TextEncoder().encode(secret).byteLength >
    MAX_CONNECTION_NOTES_UTF8_BYTES
  ) {
    throw new Error("Secure note payload exceeds the UTF-8 byte limit.");
  }
}

export function activateConnectionNotes(connectionId: string): void {
  validateConnectionId(connectionId);
  lifecycles.delete(connectionId);
}

export async function readConnectionNotesSecret(
  connectionId: string,
): Promise<string> {
  const lifecycle = lifecycleFor(connectionId);
  if (lifecycle.tombstoned) {
    throw new Error("Connection notes were deleted.");
  }
  return enqueueNoteOperation(async () => {
    const current = lifecycles.get(connectionId);
    if (!current || current.tombstoned) {
      throw new Error("Connection notes were deleted.");
    }
    const secret = await SecureStorage.vaultReadSecret(
      CONNECTION_NOTES_VAULT_SERVICE,
      connectionId,
    );
    assertSecretSize(secret);
    if (lifecycles.get(connectionId) === current && !current.tombstoned) {
      lifecycles.delete(connectionId);
    }
    return secret;
  });
}

export async function saveConnectionNotesSecret(
  connectionId: string,
  secret: string,
): Promise<void> {
  assertSecretSize(secret);
  const lifecycle = lifecycleFor(connectionId);
  if (lifecycle.tombstoned) {
    throw new Error("Connection notes were deleted.");
  }
  lifecycle.generation += 1;
  lifecycle.touchedAt = Date.now();
  const generation = lifecycle.generation;
  await enqueueNoteOperation(async () => {
    const current = lifecycles.get(connectionId);
    if (!current || current.tombstoned || current.generation !== generation) {
      return;
    }
    await SecureStorage.vaultStoreSecret(
      CONNECTION_NOTES_VAULT_SERVICE,
      connectionId,
      secret,
    );
    if (
      lifecycles.get(connectionId) === current &&
      !current.tombstoned &&
      current.generation === generation
    ) {
      lifecycles.delete(connectionId);
    }
  });
}

export async function deleteConnectionNotesSecrets(
  connectionIds: readonly string[],
): Promise<number> {
  const uniqueIds = [...new Set(connectionIds)];
  if (uniqueIds.length > MAX_NOTE_LIFECYCLE_ENTRIES) {
    throw new Error("Secure note deletion batch exceeds the safety limit.");
  }
  for (const connectionId of uniqueIds) {
    const lifecycle = lifecycleFor(connectionId);
    lifecycle.generation += 1;
    lifecycle.tombstoned = true;
    lifecycle.touchedAt = Date.now();
  }

  return enqueueNoteOperation(async () => {
    let failures = 0;
    for (const connectionId of uniqueIds) {
      try {
        await SecureStorage.vaultDeleteSecret(
          CONNECTION_NOTES_VAULT_SERVICE,
          connectionId,
        );
      } catch {
        failures += 1;
      }
    }
    return failures;
  });
}

export async function deleteConnectionNotesSecret(
  connectionId: string,
): Promise<void> {
  const failures = await deleteConnectionNotesSecrets([connectionId]);
  if (failures !== 0) {
    throw new Error("The secure note entry could not be deleted.");
  }
}
