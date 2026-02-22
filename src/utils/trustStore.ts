/**
 * Trust Store — TOFU (Trust On First Use) management for TLS certificates
 * and SSH host key fingerprints.
 *
 * On first connection the identity (cert fingerprint / host key) is stored.
 * On subsequent connections the stored identity is compared with the one
 * presented by the server.  A mismatch triggers a warning that lets the
 * user decide whether to continue (and optionally update the stored
 * identity).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** How to handle first-time identity encounters. */
export type TrustPolicy =
  | 'tofu'            // Trust On First Use — accept + memorize silently
  | 'always-ask'      // Always ask the user before trusting
  | 'always-trust'    // Accept anything without checking
  | 'strict';         // Reject if not pre-approved (manual pinning)

export interface CertIdentity {
  /** SHA-256 fingerprint of the DER-encoded certificate */
  fingerprint: string;
  /** Subject CN / SAN — informational */
  subject?: string;
  /** Issuer CN — informational */
  issuer?: string;
  /** ISO date string — when the cert was first seen */
  firstSeen: string;
  /** ISO date string — most recent time the cert was seen */
  lastSeen: string;
  /** Cert not-before (ISO) */
  validFrom?: string;
  /** Cert not-after  (ISO) */
  validTo?: string;
  /** PEM-encoded certificate (for display) */
  pem?: string;
  /** Serial number */
  serial?: string;
  /** Signature algorithm */
  signatureAlgorithm?: string;
  /** Subject Alternative Names */
  san?: string[];
}

export interface SshHostKeyIdentity {
  /** The host key fingerprint (SHA-256 base64, e.g. "SHA256:...") */
  fingerprint: string;
  /** Key type (e.g. "ssh-ed25519", "ecdsa-sha2-nistp256") */
  keyType?: string;
  /** Number of bits (e.g. 256, 4096) */
  keyBits?: number;
  /** ISO date string — when first seen */
  firstSeen: string;
  /** ISO date string — most recent time seen */
  lastSeen: string;
  /** Raw base64 public key */
  publicKey?: string;
}

export interface TrustRecord {
  /** Target host identifier: "hostname:port" */
  host: string;
  /** Protocol family */
  type: 'tls' | 'ssh';
  /** The memorized identity */
  identity: CertIdentity | SshHostKeyIdentity;
  /** User explicitly approved this identity */
  userApproved: boolean;
  /** Optional user-assigned nickname / label */
  nickname?: string;
  /** Previous identities (when user chose to update) */
  history?: Array<CertIdentity | SshHostKeyIdentity>;
}

export type TrustVerifyResult =
  | { status: 'trusted' }
  | { status: 'first-use'; identity: CertIdentity | SshHostKeyIdentity }
  | { status: 'mismatch'; stored: CertIdentity | SshHostKeyIdentity; received: CertIdentity | SshHostKeyIdentity }
  | { status: 'expired'; identity: CertIdentity };

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------
const TRUST_STORE_KEY = 'trustStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hostKey(host: string, port: number, type: 'tls' | 'ssh'): string {
  return `${type}:${host}:${port}`;
}

function connectionStoreKey(connectionId: string): string {
  return `trustStore:${connectionId}`;
}

function loadStore(connectionId?: string): Record<string, TrustRecord> {
  try {
    const key = connectionId ? connectionStoreKey(connectionId) : TRUST_STORE_KEY;
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {
    // corrupted — reset
  }
  return {};
}

function saveStore(store: Record<string, TrustRecord>, connectionId?: string): void {
  const key = connectionId ? connectionStoreKey(connectionId) : TRUST_STORE_KEY;
  localStorage.setItem(key, JSON.stringify(store));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Notify listeners that the trust store changed. */
function notifyTrustStoreChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('trustStoreChanged'));
  }
}

/**
 * Check a received identity against the trust store.
 *
 * @param connectionId  When provided the identity is looked up in the
 *                      per-connection store instead of the global one.
 * @returns A `TrustVerifyResult` indicating whether the identity is trusted,
 *          seen for the first time, or differs from what was stored.
 */
export function verifyIdentity(
  host: string,
  port: number,
  type: 'tls' | 'ssh',
  received: CertIdentity | SshHostKeyIdentity,
  connectionId?: string,
): TrustVerifyResult {
  const store = loadStore(connectionId);
  const key = hostKey(host, port, type);
  const record = store[key];

  if (!record) {
    return { status: 'first-use', identity: received };
  }

  if (record.identity.fingerprint === received.fingerprint) {
    // Fingerprint matches — update lastSeen and return trusted
    record.identity.lastSeen = new Date().toISOString();
    saveStore(store, connectionId);
    return { status: 'trusted' };
  }

  // Fingerprint mismatch!
  return {
    status: 'mismatch',
    stored: record.identity,
    received,
  };
}

/**
 * Store (memorize) an identity as trusted.
 * If a previous identity existed it is moved to history.
 *
 * @param connectionId  When provided the identity is stored in the
 *                      per-connection store instead of the global one.
 */
export function trustIdentity(
  host: string,
  port: number,
  type: 'tls' | 'ssh',
  identity: CertIdentity | SshHostKeyIdentity,
  userApproved = true,
  connectionId?: string,
): void {
  const store = loadStore(connectionId);
  const key = hostKey(host, port, type);
  const existing = store[key];
  const now = new Date().toISOString();

  identity.lastSeen = now;
  if (!identity.firstSeen) identity.firstSeen = now;

  const history: Array<CertIdentity | SshHostKeyIdentity> = existing?.history ? [...existing.history] : [];
  if (existing && existing.identity.fingerprint !== identity.fingerprint) {
    history.push(existing.identity);
  }

  store[key] = {
    host: `${host}:${port}`,
    type,
    identity,
    userApproved,
    history: history.length > 0 ? history : undefined,
  };
  saveStore(store, connectionId);
  notifyTrustStoreChanged();
}

/**
 * Remove a stored trust record.
 */
export function removeIdentity(host: string, port: number, type: 'tls' | 'ssh', connectionId?: string): void {
  const store = loadStore(connectionId);
  const key = hostKey(host, port, type);
  delete store[key];
  saveStore(store, connectionId);
  notifyTrustStoreChanged();
}

/**
 * Get the stored trust record for a host (or undefined).
 */
export function getStoredIdentity(
  host: string,
  port: number,
  type: 'tls' | 'ssh',
  connectionId?: string,
): TrustRecord | undefined {
  const store = loadStore(connectionId);
  return store[hostKey(host, port, type)];
}

/**
 * Get all trust records.  When connectionId is provided, returns only
 * that connection's records.
 */
export function getAllTrustRecords(connectionId?: string): TrustRecord[] {
  const store = loadStore(connectionId);
  return Object.values(store);
}

/**
 * Clear every trust record.  When connectionId is provided, only the
 * per-connection store is cleared.
 */
export function clearAllTrustRecords(connectionId?: string): void {
  if (connectionId) {
    localStorage.removeItem(connectionStoreKey(connectionId));
  } else {
    localStorage.removeItem(TRUST_STORE_KEY);
  }
  notifyTrustStoreChanged();
}

/**
 * Update the nickname of a stored trust record.
 */
export function updateTrustRecordNickname(
  host: string,
  port: number,
  type: 'tls' | 'ssh',
  nickname: string,
  connectionId?: string,
): void {
  const store = loadStore(connectionId);
  const key = hostKey(host, port, type);
  const record = store[key];
  if (!record) return;
  record.nickname = nickname || undefined;
  saveStore(store, connectionId);
  notifyTrustStoreChanged();
}

/**
 * Format a fingerprint for display (colon-separated hex).
 */
export function formatFingerprint(fp: string): string {
  // Already formatted or is a SHA256:base64 string
  if (fp.includes(':') || fp.startsWith('SHA256:')) return fp;
  // Hex string — insert colons every 2 chars
  return fp.match(/.{1,2}/g)?.join(':') ?? fp;
}

/**
 * Determine effective trust policy for a connection, falling back to global.
 */
export function getEffectiveTrustPolicy(
  connectionPolicy: TrustPolicy | undefined,
  globalPolicy: TrustPolicy,
): TrustPolicy {
  return connectionPolicy ?? globalPolicy;
}
