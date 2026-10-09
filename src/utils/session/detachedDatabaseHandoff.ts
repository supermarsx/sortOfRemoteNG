import type { WindowSessionSync } from "../../types/windowManager";

type Grant = NonNullable<WindowSessionSync["databaseGrant"]>;
type LocalOwner = NonNullable<WindowSessionSync["localDatabaseOwner"]>;
type Owner = Grant | LocalOwner;
interface HandoffDependencies {
  adopt: (
    databaseId: string,
    grant: Grant,
    options: { isCurrent: () => boolean },
  ) => Promise<void>;
  adoptPlain?: (
    databaseId: string,
    securityRevision: string,
    options: { isCurrent: () => boolean },
  ) => Promise<void>;
  load: (databaseId: string) => Promise<boolean>;
  release: (databaseId: string) => Promise<void>;
  onError: (refresh: boolean) => void;
  onLoaded?: () => void;
}

/** Serializes local grant adoption/release without ever selecting another owner. */
export function createDetachedDatabaseHandoff(deps: HandoffDependencies) {
  let desired: Owner | null = null;
  let desiredKey = "";
  let loadedKey = "";
  let activeDatabaseId: string | null = null;
  let pending: Promise<void> = Promise.resolve();
  let generation = 0;
  let desiredContentRevision = 0;
  let loadedContentRevision = -1;
  let scheduledWork = "";
  let disposed = false;
  const keyOf = (grant: Owner | null) =>
    grant
      ? JSON.stringify([
          grant.databaseId,
          "sessionId" in grant ? grant.sessionId : grant.kind,
          grant.securityRevision,
          "sessionId" in grant ? grant.sessionExpiresAt : null,
        ])
      : "";
  const revoke = () => {
    const previous = activeDatabaseId;
    activeDatabaseId = null;
    loadedKey = "";
    loadedContentRevision = -1;
    if (!previous) return;
    // release masks the local owner synchronously, before native cleanup. Do
    // not wait for an older load: its provider generation must be revoked now.
    const released = deps.release(previous).catch(() => {
      if (!disposed) deps.onError(false);
    });
    pending = Promise.all([pending, released]).then(() => undefined);
  };

  const schedule = () => {
    const key = desiredKey;
    const grant = desired;
    const revision = generation;
    const contentRevision = desiredContentRevision;
    const work = JSON.stringify([revision, contentRevision]);
    if (!grant || scheduledWork === work) return pending;
    if (loadedKey === key && loadedContentRevision >= contentRevision)
      return pending;
    scheduledWork = work;
    const isCurrent = () => !disposed && generation === revision;
    pending = pending.then(async () => {
      if (generation !== revision) return;
      const refresh = loadedKey === key;
      try {
        if (!grant || !isCurrent()) return;
        // Include in-flight adoption in later cleanup, even if it loses the race.
        if (!refresh) {
          activeDatabaseId = grant.databaseId;
          if ("sessionId" in grant) {
            await deps.adopt(grant.databaseId, grant, { isCurrent });
          } else if (grant.kind === "plain" && deps.adoptPlain) {
            await deps.adoptPlain(grant.databaseId, grant.securityRevision, {
              isCurrent,
            });
          } else throw new Error("This database needs a local unlock");
        }
        if (!isCurrent()) return;
        if (!(await deps.load(grant.databaseId)))
          throw new Error("Owner load failed");
        if (isCurrent()) {
          loadedKey = key;
          loadedContentRevision = contentRevision;
          deps.onLoaded?.();
        }
      } catch {
        // Revocation and disposal deliberately cancel an older handoff.
        if (isCurrent()) {
          // A failed refresh (including pending-edit conflicts) must retain
          // the loaded owner and its unsaved changes. Only failed adoption
          // releases authority; a refresh never re-adopts the same grant.
          if (!refresh && activeDatabaseId) {
            const previous = activeDatabaseId;
            activeDatabaseId = null;
            loadedKey = "";
            await deps.release(previous).catch(() => undefined);
          }
          if (isCurrent()) deps.onError(refresh);
        }
      } finally {
        if (scheduledWork === work) scheduledWork = "";
      }
    });
    return pending;
  };

  return {
    update(
      grant: Grant | null | undefined,
      localOwner?: LocalOwner | null,
      content?: WindowSessionSync["databaseContentRevision"],
    ) {
      if (disposed) return pending;
      desired = grant ?? (localOwner?.kind === "plain" ? localOwner : null);
      if (keyOf(desired) !== desiredKey) {
        generation++;
        revoke();
        desiredContentRevision = 0;
      }
      desiredKey = keyOf(desired);
      // A notification is only a hint to reread the exact native owner. It
      // cannot order another database or revive older content on this grant.
      if (
        content &&
        content.databaseId === desired?.databaseId &&
        Number.isSafeInteger(content.revision) &&
        content.revision >= 0
      ) {
        desiredContentRevision = Math.max(
          desiredContentRevision,
          content.revision,
        );
      }
      return schedule();
    },
    dispose() {
      disposed = true;
      generation++;
      desired = null;
      desiredKey = "";
      revoke();
      return schedule();
    },
  };
}
