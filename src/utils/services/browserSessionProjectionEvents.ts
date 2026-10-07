/** Renderer-internal notification, published only after an owner-bound refresh.
 * No cookies, unlock tokens, credentials or storage snapshots belong here.
 * This is not native authorization: consumers must recheck the captured fence.
 */
export interface BrowserSessionProjectionChange {
  readonly databaseId: string;
  readonly changeId: string;
  readonly assertCurrent: () => void;
}

const listeners = new Set<(change: BrowserSessionProjectionChange) => void>();

export function subscribeBrowserSessionProjectionChanges(
  listener: (change: BrowserSessionProjectionChange) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Call for durable semantic changes only, never activity-only checkpoints. */
export function notifyBrowserSessionProjectionChange(
  change: BrowserSessionProjectionChange,
): void {
  try {
    change.assertCurrent();
  } catch {
    return;
  }
  const notification = Object.freeze({
    databaseId: change.databaseId,
    changeId: change.changeId,
    assertCurrent: change.assertCurrent,
  });
  for (const listener of listeners) listener(notification);
}
