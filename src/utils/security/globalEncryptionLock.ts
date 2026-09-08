import type { LockReason } from "../../hooks/settings/useEncryption";

export const GLOBAL_LOCK_REQUEST = "encryption-ui-lock-request";
export const GLOBAL_LOCK_RESPONSE = "encryption-ui-lock-response";
type LockExecutor = (lock: () => Promise<void>) => Promise<void>;
let executor: LockExecutor | null = null;

/** Main-window ownership; the wrapper holds the database mutation queue through native lock. */
export function registerGlobalLockExecutor(next: LockExecutor): () => void {
  executor = next;
  return () => {
    if (executor === next) executor = null;
  };
}

export async function executeMainGlobalLock(
  lock: () => Promise<void>,
): Promise<void> {
  if (!executor)
    throw new Error(
      "The primary window is not ready to safely lock storage. Retry from the primary window.",
    );
  await executor(lock);
}

export async function executeGlobalLock(
  reason: LockReason | undefined,
  lock: () => Promise<void>,
): Promise<void> {
  if (executor) return executeMainGlobalLock(lock);
  const [{ getCurrentWindow }, { listen, emitTo }] = await Promise.all([
    import("@tauri-apps/api/window"),
    import("@tauri-apps/api/event"),
  ]);
  const windowLabel = getCurrentWindow().label;
  if (windowLabel === "main") return executeMainGlobalLock(lock);
  const requestId = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    let unlisten: (() => void) | undefined;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unlisten?.();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "The primary window did not confirm the lock. Check its save errors and storage status before retrying.",
          ),
        ),
      60_000,
    );
    void listen<{ requestId: string; error?: string }>(
      GLOBAL_LOCK_RESPONSE,
      ({ payload }) => {
        if (payload.requestId === requestId)
          finish(payload.error ? new Error(payload.error) : undefined);
      },
    )
      .then((off) => {
        unlisten = off;
        if (settled) {
          off();
          return;
        }
        return emitTo("main", GLOBAL_LOCK_REQUEST, {
          requestId,
          windowLabel,
          reason: reason ?? "manual",
        });
      })
      .catch((error: unknown) =>
        finish(error instanceof Error ? error : new Error(String(error))),
      );
  });
}
