interface GlobalLockViews {
  clearDialogs: () => void;
  closeSessions: () => Promise<void>;
  clearRows: () => void;
  closeDatabase: () => unknown | Promise<unknown>;
  clearSessions: () => void;
}

/** Cleanup belongs to the lock that started it, never a later unlocked view. */
export async function clearGlobalLockViews(
  isCurrent: () => boolean,
  views: GlobalLockViews,
): Promise<void> {
  if (!isCurrent()) return;
  views.clearDialogs();
  const closing = views.closeSessions();
  views.clearRows();
  // Observe both failures even if one operation rejects before the other settles.
  await Promise.all([views.closeDatabase(), closing]);
  if (!isCurrent()) return;
  views.clearSessions();
  views.clearRows();
}
