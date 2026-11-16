/**
 * Safety policy for the perf core.
 *
 * - Caches are module memory only (never browser storage or disk).
 * - Every cache registers here so lock/logout/DB switch wipes them all.
 * - Secrets, writes and real-time I/O are refused by cachedInvoke.
 * - The core never calls an unlock/prompt path.
 */
import {
  ENCRYPTION_EVENT_LOCKED,
  ENCRYPTION_EVENT_UNLOCKED,
} from "../../types/encryption/encryption";
import { isRealtimeCommand } from "./laneRegistry";
import { registerCacheSizer } from "./metrics";

export function isDevLike(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Tokens (split on _ - :) that mark a command as secret-bearing. */
export const SECRET_COMMAND_TOKENS: readonly string[] = [
  "vault",
  "password",
  "passwords",
  "passphrase",
  "secret",
  "secrets",
  "totp",
  "dek",
  "credential",
  "credentials",
  "keychain",
  "token",
  "tokens",
  "privatekey",
  "unlock",
  "decrypt",
  "encrypt",
  "login",
  "logout",
  "authenticate",
  "auth",
  "otp",
  "mnemonic",
];

/** Verb tokens that mean the command is not a pure read. */
export const WRITE_COMMAND_TOKENS: readonly string[] = [
  "set",
  "save",
  "delete",
  "remove",
  "create",
  "update",
  "connect",
  "disconnect",
  "send",
  "write",
  "start",
  "stop",
  "restart",
  "close",
  "open",
  "kill",
  "reset",
  "add",
  "import",
  "export",
  "apply",
  "execute",
  "exec",
  "run",
  "upload",
  "download",
  "put",
  "post",
  "push",
  "toggle",
  "enable",
  "disable",
  "clear",
  "rename",
  "move",
  "copy",
  "paste",
  "install",
  "uninstall",
  "lock",
  "wipe",
  "generate",
  "reboot",
  "shutdown",
  "launch",
  "register",
  "unregister",
  "mutate",
];

const SECRET_FIELD =
  /^(password|passphrase|secret|dek|privatekey|private_key|token|accesstoken|access_token|refreshtoken|refresh_token|apikey|api_key|totpsecret|totp_secret|clientsecret)$/i;

function tokens(cmd: string): string[] {
  return cmd
    .toLowerCase()
    .split(/[_\-:./]+/)
    .filter(Boolean);
}

/**
 * Returns the reason a command must not be cached, or null when it is a
 * cacheable background read.
 */
export function cacheRefusalReason(cmd: string): string | null {
  const parts = tokens(cmd);
  if (isRealtimeCommand(cmd.toLowerCase())) return "real-time command";
  const secret = parts.find((t) => SECRET_COMMAND_TOKENS.includes(t));
  if (secret) return `secret-bearing command (${secret})`;
  const write = parts.find((t) => WRITE_COMMAND_TOKENS.includes(t));
  if (write) return `non-read command (${write})`;
  return null;
}

/** Dev/test assertion that a cached value carries no secret-named fields. */
export function assertNoSecretFields(value: unknown, where = "cache"): void {
  if (!isDevLike()) return;
  let budget = 400;
  const walk = (v: unknown, depth: number): void => {
    if (budget-- <= 0 || depth > 4 || v === null || typeof v !== "object")
      return;
    if (Array.isArray(v)) {
      for (const item of v.slice(0, 20)) walk(item, depth + 1);
      return;
    }
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_FIELD.test(k) && child !== undefined && child !== null) {
        throw new Error(
          `[perf] ${where}: refusing to cache a value with secret field "${k}"`,
        );
      }
      walk(child, depth + 1);
    }
  };
  walk(value, 0);
}

// ── cache registry ────────────────────────────────────────────────────────

interface RegisteredCache {
  clear: () => void;
  size?: () => number;
}
const caches = new Map<string, RegisteredCache>();

/**
 * Register any memory cache (query store, t-preload stores) so lock/DB-switch
 * clears it and metrics can see its size. Returns an unregister function.
 */
export function registerCache(
  name: string,
  cache: RegisteredCache,
): () => void {
  caches.set(name, cache);
  if (cache.size) registerCacheSizer(name, cache.size);
  return () => {
    if (caches.get(name) === cache) caches.delete(name);
    registerCacheSizer(name, () => 0);
  };
}

/** Wipe every registered cache. Synchronous. */
export function clearAllCaches(): void {
  for (const cache of [...caches.values()]) {
    try {
      cache.clear();
    } catch {
      /* clearing must never throw into the lock path */
    }
  }
  for (const fn of [...clearListeners]) fn();
}

const clearListeners = new Set<() => void>();
/** Extra hook run after clearAllCaches (e.g. scheduler drops unlocked tasks). */
export function onCachesCleared(fn: () => void): () => void {
  clearListeners.add(fn);
  return () => clearListeners.delete(fn);
}

// ── lock state ────────────────────────────────────────────────────────────

export type LockState = "unknown" | "locked" | "unlocked";
let lockState: LockState = "unknown";
const lockListeners = new Set<(s: LockState) => void>();

export function getLockState(): LockState {
  return lockState;
}

/** Only an explicit "unlocked" lets unlock-requiring preloads run. */
export function isUnlockedForPreload(): boolean {
  return lockState === "unlocked";
}

/**
 * Record the lock state (the app shell calls this from the encryption state it
 * already has; the core never asks the backend or prompts). Locking clears
 * every cache synchronously.
 */
export function setLockState(next: LockState): void {
  if (next === lockState) return;
  lockState = next;
  if (next === "locked") clearAllCaches();
  for (const fn of [...lockListeners]) fn(next);
}

export function onLockStateChange(fn: (s: LockState) => void): () => void {
  lockListeners.add(fn);
  return () => lockListeners.delete(fn);
}

/**
 * Database/profile switch: wipes every cache. Callable from anywhere
 * (databaseManager owns the single transition-guard slot, so it is not hooked
 * here).
 */
export function notifyDatabaseTransition(): void {
  clearAllCaches();
}

let lockWired: Promise<void> | undefined;
/**
 * Subscribe once to encryption:locked / encryption:unlocked via the shared
 * event bus. Idempotent. The App/provider calls this at startup.
 */
export function wireLockEvents(
  listen: (
    event: string,
    handler: () => void,
  ) => Promise<() => void> | (() => void),
): Promise<void> {
  if (!lockWired) {
    lockWired = (async () => {
      await listen(ENCRYPTION_EVENT_LOCKED, () => setLockState("locked"));
      await listen(ENCRYPTION_EVENT_UNLOCKED, () => setLockState("unlocked"));
    })();
  }
  return lockWired;
}

/** Test helper. */
export function __resetSafetyForTests(): void {
  lockState = "unknown";
  caches.clear();
  clearListeners.clear();
  lockListeners.clear();
  lockWired = undefined;
}
