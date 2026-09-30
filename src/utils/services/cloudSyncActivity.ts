import type { CloudSyncProvider } from "../../types/settings/cloudSyncSettings";

export interface CloudSyncActivity {
  id: string;
  provider: CloudSyncProvider;
  requestIdentity?: symbol;
}

// Opaque revisions, never a serialized destination or credential fingerprint.
const identities = new Map<string, symbol>();
export function cloudSyncTargetIdentity(id: string): symbol {
  let identity = identities.get(id);
  if (!identity) {
    identity = Symbol();
    identities.set(id, identity);
  }
  return identity;
}

export function invalidateCloudSyncTarget(id: string): void {
  identities.delete(id);
}

const listeners = new Set<() => void>();
const running = new Map<symbol, CloudSyncActivity>();
const empty: readonly CloudSyncActivity[] = Object.freeze([]);
let snapshot = empty;

export function getCloudSyncActivity(): readonly CloudSyncActivity[] {
  return snapshot;
}

export function getServerCloudSyncActivity(): readonly CloudSyncActivity[] {
  return empty;
}

export function subscribeCloudSyncActivity(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish() {
  snapshot = running.size ? [...running.values()] : empty;
  listeners.forEach((listener) => listener());
}

/** Transient activity only: never persist a stuck 'syncing' flag or credentials. */
export function beginCloudSyncActivity(target: CloudSyncActivity): () => void {
  const token = Symbol();
  running.set(token, {
    id: target.id,
    provider: target.provider,
    ...(target.requestIdentity
      ? { requestIdentity: target.requestIdentity }
      : {}),
  });
  publish();
  return () => {
    if (running.delete(token)) publish();
  };
}
