import { useEffect, useRef, useState } from "react";
import React from "react";
import { CloudOff, Check, X, AlertTriangle, RefreshCw } from "lucide-react";
import {
  GlobalSettings,
  CloudSyncConfig,
  CloudSyncProvider,
  ConflictResolutionStrategy,
  CloudSyncTarget,
  defaultCloudSyncConfig,
  defaultProviderConfigFor,
  generateCloudSyncTargetId,
  ProviderSyncStatus,
} from "../../types/settings/settings";
import {
  cloudSyncStatusUpdate,
  cloudSyncProviderStatus,
  syncCloudTargets,
  testCloudSyncTarget,
  reviewCloudSyncTarget,
  resolveCloudSyncTarget,
  type CloudSyncOperationResult,
} from "../../utils/services/cloudSyncService";
import type {
  CloudSyncConflictReview,
  CloudSyncReviewChoice,
  CloudSyncReviewChoices,
} from "../../utils/services/cloudSyncConflictReview";
import { useCloudSyncActivity } from "../sync/useCloudSyncActivity";
import { CloudSyncProviderIcon } from "../../components/sync/CloudSyncProviderIcon";
import {
  cloudSyncTargetIdentity,
  getCloudSyncActivity,
  invalidateCloudSyncTarget,
  type CloudSyncActivity,
} from "../../utils/services/cloudSyncActivity";

function sameDestination(a: CloudSyncTarget, b: CloudSyncTarget): boolean {
  if (a.provider !== b.provider) return false;
  if (a.provider === "none" || b.provider === "none") return true;
  const before = a[a.provider];
  const after = b[b.provider];
  // Compare in place: never put credentials into an identity or activity record.
  return Object.keys({ ...before, ...after }).every(
    (key) => Reflect.get(before ?? {}, key) === Reflect.get(after ?? {}, key),
  );
}

// Compare configuration in memory, without serializing credentials into a key.
function sameReviewValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) =>
      sameReviewValue(Reflect.get(a, key), Reflect.get(b, key)),
    )
  );
}

const reviewStatusKeys = new Set([
  "syncTargets",
  "enabledProviders",
  "targetStatus",
  "providerStatus",
  "lastSyncTime",
  "lastSyncStatus",
  "lastSyncError",
]);

function sameReviewConfig(a: CloudSyncConfig, b: CloudSyncConfig): boolean {
  return Object.keys({ ...a, ...b }).every(
    (key) =>
      reviewStatusKeys.has(key) ||
      sameReviewValue(Reflect.get(a, key), Reflect.get(b, key)),
  );
}

interface ReviewContext {
  target: CloudSyncTarget;
  config: CloudSyncConfig;
  identity: symbol;
}

interface ConflictReviewState {
  targetId: string;
  phase: "loading" | "ready" | "verifying" | "applying" | "error" | "complete";
  review?: CloudSyncConflictReview;
  choices: CloudSyncReviewChoices;
  message?: string;
}

function currentReviewContext(
  context: ReviewContext,
  config: CloudSyncConfig,
): boolean {
  const latest = config.syncTargets?.find(
    (target) => target.id === context.target.id,
  );
  return Boolean(
    config.enabled &&
    latest?.enabled &&
    context.identity === cloudSyncTargetIdentity(context.target.id) &&
    sameDestination(context.target, latest) &&
    sameReviewConfig(context.config, config),
  );
}

const refreshReviewMessage =
  "This review is no longer current. Refresh review and choose again before applying.";

function reviewErrorMessage(error: unknown): string {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "";
  if (/unlock|locked/i.test(message))
    return "Open and unlock the selected data, then refresh review. No reviewed choices were retried.";
  if (/stale|changed|no longer|refresh/i.test(message))
    return refreshReviewMessage;
  return "Conflict review could not complete. Check the target configuration and access to the selected data, then refresh review.";
}

function selectionError(config: CloudSyncConfig): string | undefined {
  if (!config.enabled)
    return "Enable cloud sync before syncing or testing a target.";
  if (
    !(config.syncTargets ?? []).some((t) => t.enabled && t.provider !== "none")
  )
    return "Enable at least one sync target.";
  if (!config.selectedItems?.length)
    return "Select at least one available item in What to Sync.";
}

function targetError(target: CloudSyncTarget): string | undefined {
  if (
    target.provider === "sftp" &&
    !/^SHA256:[A-Za-z0-9+/]{43}$/.test(target.sftp?.hostKeyFingerprint ?? "")
  )
    return "SFTP requires a trusted SHA256 host key fingerprint. Obtain it from your server administrator before connecting.";
}

/** The engine supplies safe diagnostics; additionally remove known local secrets. */
function safeResult(
  result: CloudSyncOperationResult,
  target: CloudSyncTarget,
  config: CloudSyncConfig,
): CloudSyncOperationResult {
  let message = result.message;
  const provider =
    target.provider === "none" ? undefined : target[target.provider];
  const secrets = Object.entries(provider ?? {})
    .filter(([key]) => /password|token|secret|privateKey|passphrase/i.test(key))
    .map(([, value]) => value);
  secrets.push(config.syncEncryptionPassword);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret) {
      message = message
        .split(secret)
        .join("[redacted]")
        .split(encodeURIComponent(secret))
        .join("[redacted]");
    }
  }
  return {
    provider: target.provider,
    targetId: target.id,
    status: result.status,
    message,
    requestIdentity: result.requestIdentity,
    latencyMs: result.latencyMs,
    canRead: result.canRead,
    canWrite: result.canWrite,
  };
}

// ─── Static data ───────────────────────────────────────────────────

export const providerLabels: Record<CloudSyncProvider, string> = {
  none: "None (Disabled)",
  googleDrive: "Google Drive",
  oneDrive: "Microsoft OneDrive",
  nextcloud: "Nextcloud",
  webdav: "WebDAV Server",
  sftp: "SFTP Server",
};

export const providerDescriptions: Record<CloudSyncProvider, string> = {
  none: "Cloud sync is disabled",
  googleDrive: "Sync to your Google Drive account",
  oneDrive: "Sync to your Microsoft OneDrive account",
  nextcloud: "Sync to your self-hosted Nextcloud server",
  webdav: "Sync to any WebDAV-compatible server",
  sftp: "Sync via SFTP to any SSH server",
};

export const providerIcons: Record<CloudSyncProvider, React.ReactNode> = {
  none: React.createElement(CloudSyncProviderIcon, { provider: "none" }),
  googleDrive: React.createElement(CloudSyncProviderIcon, {
    provider: "googleDrive",
  }),
  oneDrive: React.createElement(CloudSyncProviderIcon, {
    provider: "oneDrive",
  }),
  nextcloud: React.createElement(CloudSyncProviderIcon, {
    provider: "nextcloud",
  }),
  webdav: React.createElement(CloudSyncProviderIcon, { provider: "webdav" }),
  sftp: React.createElement(CloudSyncProviderIcon, { provider: "sftp" }),
};

export { cloudSyncFrequencyLabels as frequencyLabels } from "../../types/settings/cloudSyncSettings";

export const conflictLabels: Record<ConflictResolutionStrategy, string> = {
  askEveryTime: "Ask Every Time",
  keepLocal: "Always Keep Local",
  keepRemote: "Always Keep Remote",
  keepNewer: "Newer when unambiguous",
  merge: "Attempt to Merge",
  smartMerge: "Smart Merge",
};

export const conflictDescriptions: Record<ConflictResolutionStrategy, string> =
  {
    askEveryTime:
      "Choose Review conflicts in the target status or below, review each artifact, then apply your explicit choices. The strategy stays unchanged.",
    keepLocal: "Local changes always override remote",
    keepRemote: "Remote changes always override local",
    keepNewer:
      "One-sided changes sync automatically. If both copies changed, review is required; clock timestamps never choose a winner.",
    merge:
      "Combine independent whole artifacts; conflicting changes within the same artifact require review. Records inside an archive are not merged.",
    smartMerge:
      "Requires a successful shared sync baseline. Merges disjoint record edits in supported artifacts; overlapping edits require explicit review. Clocks never choose a winner.",
  };

// ─── Hook ──────────────────────────────────────────────────────────

export function useCloudSyncSettings(
  settings: GlobalSettings,
  updateSettings: (updates: Partial<GlobalSettings>) => void,
) {
  const [expandedTargetId, setExpandedTargetId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [reviewingTargetId, setReviewingTargetId] = useState<string | null>(
    null,
  );
  const operationBusy = useRef(false);
  const mounted = useRef(true);
  const reviewContext = useRef<ReviewContext | null>(null);
  const reviewStateRef = useRef<ConflictReviewState | null>(null);
  const [conflictReview, setConflictReview] =
    useState<ConflictReviewState | null>(null);
  const [reviewRequestSequence, setReviewRequestSequence] = useState(0);
  const publishReview = (next: ConflictReviewState | null) => {
    reviewStateRef.current = next;
    if (mounted.current) setConflictReview(next);
  };
  const cancelConflictReview = () => {
    reviewContext.current = null;
    publishReview(null);
  };
  const [testingTargetId, setTestingTargetId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, CloudSyncOperationResult>
  >({});
  const testedTargets = useRef(new Map<string, CloudSyncTarget>());
  const activity = useCloudSyncActivity();
  const startedTargets = useRef<CloudSyncActivity[]>([]);
  const [syncingTargetId, setSyncingTargetId] = useState<string | null>(null);
  const [authTargetId, setAuthTargetId] = useState<string | null>(null);
  const [authForm, setAuthForm] = useState({
    accessToken: "",
    refreshToken: "",
    accountEmail: "",
    tokenExpiry: "",
  });

  // Derived / backward-compat
  const cloudSync = settings.cloudSync ?? defaultCloudSyncConfig;
  const cloudSyncRef = useRef(cloudSync);
  cloudSyncRef.current = cloudSync;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reviewContext.current = null;
      reviewStateRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (
      reviewContext.current &&
      !currentReviewContext(reviewContext.current, cloudSync)
    ) {
      // Revoke pending service work as well as hiding its stale preview.
      if (
        reviewContext.current.identity ===
        cloudSyncTargetIdentity(reviewContext.current.target.id)
      ) {
        invalidateCloudSyncTarget(reviewContext.current.target.id);
      }
      reviewContext.current = null;
      reviewStateRef.current = null;
      setConflictReview(null);
    }
  }, [cloudSync, activity]);
  const providerStatus = cloudSync.providerStatus ?? {};
  // Legacy callers (sync status badges, etc.) still ask which
  // providers are "active". Derive from the new per-target list:
  // a provider is active when at least one enabled target points
  // at it.
  const enabledProviders: CloudSyncProvider[] = Array.from(
    new Set(
      (cloudSync.syncTargets ?? [])
        .filter((t) => t.enabled)
        .map((t) => t.provider),
    ),
  );

  const updateCloudSync = (updates: Partial<CloudSyncConfig>) => {
    const current = cloudSyncRef.current;
    const changedList = (key: "selectedItems" | "excludePatterns") =>
      Object.prototype.hasOwnProperty.call(updates, key) &&
      ((updates[key] ?? []).length !== (current[key] ?? []).length ||
        (updates[key] ?? []).some(
          (value, index) => value !== current[key]?.[index],
        ));
    // Revoke already queued/in-flight work before publishing changed consent.
    // Status-only persistence must not revoke the operation that produced it.
    if (
      (current.enabled && updates.enabled === false) ||
      changedList("selectedItems") ||
      changedList("excludePatterns") ||
      (Object.prototype.hasOwnProperty.call(
        updates,
        "autoUnlockOsVaultDatabases",
      ) &&
        updates.autoUnlockOsVaultDatabases !==
          current.autoUnlockOsVaultDatabases) ||
      (Object.prototype.hasOwnProperty.call(updates, "encryptBeforeSync") &&
        updates.encryptBeforeSync !== current.encryptBeforeSync) ||
      (Object.prototype.hasOwnProperty.call(
        updates,
        "syncEncryptionPassword",
      ) &&
        updates.syncEncryptionPassword !== current.syncEncryptionPassword)
    ) {
      for (const target of current.syncTargets ?? []) {
        invalidateCloudSyncTarget(target.id);
        testedTargets.current.delete(target.id);
      }
      setTestResults({});
    }
    cloudSyncRef.current = { ...current, ...updates };
    if (
      reviewContext.current &&
      !currentReviewContext(reviewContext.current, cloudSyncRef.current)
    ) {
      if (
        reviewContext.current.identity ===
        cloudSyncTargetIdentity(reviewContext.current.target.id)
      ) {
        invalidateCloudSyncTarget(reviewContext.current.target.id);
      }
      cancelConflictReview();
    }
    updateSettings({
      cloudSync: cloudSyncRef.current,
    });
  };

  // ── Token dialog (scoped to a single target) ──

  const openTokenDialog = (targetId: string) => {
    const target = (cloudSync.syncTargets ?? []).find((t) => t.id === targetId);
    if (!target) return;
    if (target.provider === "googleDrive") {
      const gd = target.googleDrive;
      setAuthForm({
        accessToken: gd?.accessToken ?? "",
        refreshToken: gd?.refreshToken ?? "",
        accountEmail: gd?.accountEmail ?? "",
        tokenExpiry: gd?.tokenExpiry ? String(gd.tokenExpiry) : "",
      });
    } else if (target.provider === "oneDrive") {
      const od = target.oneDrive;
      setAuthForm({
        accessToken: od?.accessToken ?? "",
        refreshToken: od?.refreshToken ?? "",
        accountEmail: od?.accountEmail ?? "",
        tokenExpiry: od?.tokenExpiry ? String(od.tokenExpiry) : "",
      });
    } else {
      return;
    }
    setAuthTargetId(targetId);
  };

  const saveTokenDialog = () => {
    if (!authTargetId) return;
    const target = (cloudSync.syncTargets ?? []).find(
      (t) => t.id === authTargetId,
    );
    if (!target) {
      setAuthTargetId(null);
      return;
    }
    const tokenExpiry = authForm.tokenExpiry.trim();
    const parsedExpiry = tokenExpiry ? Number(tokenExpiry) : undefined;
    const expiryValue = Number.isFinite(parsedExpiry)
      ? parsedExpiry
      : undefined;

    if (target.provider === "googleDrive") {
      updateSyncTarget(authTargetId, {
        googleDrive: {
          folderPath: target.googleDrive?.folderPath ?? "/sortOfRemoteNG",
          ...target.googleDrive,
          accessToken: authForm.accessToken || undefined,
          refreshToken: authForm.refreshToken || undefined,
          accountEmail: authForm.accountEmail || undefined,
          tokenExpiry: expiryValue,
        },
      });
    } else if (target.provider === "oneDrive") {
      updateSyncTarget(authTargetId, {
        oneDrive: {
          folderPath: target.oneDrive?.folderPath ?? "/sortOfRemoteNG",
          ...target.oneDrive,
          accessToken: authForm.accessToken || undefined,
          refreshToken: authForm.refreshToken || undefined,
          accountEmail: authForm.accountEmail || undefined,
          tokenExpiry: expiryValue,
        },
      });
    }

    setAuthTargetId(null);
  };

  const closeTokenDialog = () => {
    setAuthTargetId(null);
  };

  const getProviderStatus = (
    provider: CloudSyncProvider,
  ): ProviderSyncStatus | undefined => {
    return providerStatus[provider];
  };

  const getSyncTimestampMs = (timestamp?: number): number | undefined => {
    if (!timestamp) return undefined;
    return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  };

  const applySyncStatusUpdate = async (
    targetsToRun: CloudSyncTarget[],
    config: CloudSyncConfig,
  ) => {
    const identities = new Map(
      targetsToRun.map((target) => [
        target.id,
        cloudSyncTargetIdentity(target.id),
      ]),
    );
    const valid = targetsToRun.filter((target) => !targetError(target));
    let results: CloudSyncOperationResult[] = targetsToRun
      .filter((target) => targetError(target))
      .map((target) => ({
        provider: target.provider,
        targetId: target.id,
        status: "failed",
        message: targetError(target)!,
      }));
    if (valid.length) {
      try {
        results = results.concat(await syncCloudTargets(valid, config));
      } catch {
        results = results.concat(
          valid.map((target) => ({
            provider: target.provider,
            targetId: target.id,
            status: "failed" as const,
            message:
              "Cloud sync could not complete. Check the target configuration and try again.",
          })),
        );
      }
    }
    const current = cloudSyncRef.current;
    const applicable = results
      .filter((result) => {
        const original = targetsToRun.find(
          (target) => target.id === result.targetId,
        );
        const latest = current.syncTargets?.find(
          (target) => target.id === result.targetId,
        );
        return (
          current.enabled &&
          original &&
          latest?.enabled &&
          result.provider === latest.provider &&
          sameDestination(original, latest)
        );
      })
      .map((result) => ({
        ...safeResult(
          result,
          targetsToRun.find((target) => target.id === result.targetId)!,
          config,
        ),
        requestIdentity:
          result.requestIdentity ?? identities.get(result.targetId ?? ""),
      }));
    updateCloudSync(cloudSyncStatusUpdate(current, applicable));
  };

  /* ═══════════════════════════════════════════════════════════════
     Multi-target list management — mirrors useBackupSettings
     ═══════════════════════════════════════════════════════════════ */

  const syncTargets: CloudSyncTarget[] = cloudSync.syncTargets ?? [];
  const validationError = selectionError(cloudSync);
  const getTargetTestResult = (id: string) => {
    const target = syncTargets.find((item) => item.id === id);
    const tested = testedTargets.current.get(id);
    const result = testResults[id];
    return cloudSync.enabled &&
      target?.enabled &&
      tested &&
      sameDestination(tested, target) &&
      result?.requestIdentity === cloudSyncTargetIdentity(id)
      ? result
      : undefined;
  };

  const getTargetStatus = (id: string) => {
    const target = syncTargets.find((item) => item.id === id);
    const status = cloudSync.targetStatus?.[id];
    return status?.provider === target?.provider ? status : undefined;
  };
  const isTargetSyncing = (id: string) => {
    const target = syncTargets.find((item) => item.id === id);
    if (!target?.enabled) return false;
    const matches = (item: CloudSyncActivity) =>
      item.id === id &&
      item.provider === target.provider &&
      (!item.requestIdentity ||
        item.requestIdentity === cloudSyncTargetIdentity(id));
    return (
      activity.some(matches) ||
      (isSyncing && startedTargets.current.some(matches))
    );
  };
  const anySyncing = isSyncing || activity.length > 0;
  const isBusy =
    anySyncing || testingTargetId !== null || reviewingTargetId !== null;

  const writeSyncTargets = (next: CloudSyncTarget[]) => {
    const current = cloudSyncRef.current;
    const invalidated = new Set<string>();
    for (const old of current.syncTargets ?? []) {
      const target = next.find((item) => item.id === old.id);
      if (!target || !sameDestination(old, target)) {
        invalidated.add(old.id);
        invalidateCloudSyncTarget(old.id);
      } else if (old.enabled !== target.enabled) {
        invalidateCloudSyncTarget(old.id);
      }
      if (
        !target ||
        !sameDestination(old, target) ||
        old.enabled !== target.enabled
      ) {
        testedTargets.current.delete(old.id);
        setTestResults((previous) => {
          const nextResults = { ...previous };
          delete nextResults[old.id];
          return nextResults;
        });
      }
    }
    const targetStatus = Object.fromEntries(
      Object.entries(current.targetStatus ?? {}).filter(
        ([id, status]) =>
          !invalidated.has(id) &&
          next.some(
            (target) => target.id === id && target.provider === status.provider,
          ),
      ),
    );
    const nextProviderStatus = cloudSyncProviderStatus(next, targetStatus);
    updateCloudSync({
      syncTargets: next,
      targetStatus,
      providerStatus: nextProviderStatus,
      enabledProviders: Object.keys(nextProviderStatus) as CloudSyncProvider[],
    });
  };

  /** Append a new sync target row pointing at the chosen provider. */
  const addSyncTarget = (
    provider: CloudSyncProvider = "googleDrive",
  ): string => {
    const id = generateCloudSyncTargetId();
    const providerLabel = providerLabels[provider] ?? "Sync Target";
    const next: CloudSyncTarget = {
      id,
      label: `${providerLabel} ${syncTargets.length + 1}`,
      provider,
      enabled: true,
      ...defaultProviderConfigFor(provider),
    };
    writeSyncTargets([...syncTargets, next]);
    return id;
  };

  /** Remove a sync target by id. No-op when the id isn't present. */
  const removeSyncTarget = (id: string) => {
    writeSyncTargets(syncTargets.filter((t) => t.id !== id));
  };

  /** Patch one sync target by id with the provided updates. */
  const updateSyncTarget = (id: string, updates: Partial<CloudSyncTarget>) => {
    const normalized =
      updates.sftp?.hostKeyFingerprint === undefined
        ? updates
        : {
            ...updates,
            sftp: {
              ...updates.sftp,
              hostKeyFingerprint: updates.sftp.hostKeyFingerprint.trim(),
            },
          };
    writeSyncTargets(
      syncTargets.map((t) => (t.id === id ? { ...t, ...normalized } : t)),
    );
  };

  /** Toggle the per-row `enabled` flag for a target. */
  const toggleSyncTarget = (id: string) => {
    const target = syncTargets.find((t) => t.id === id);
    if (!target) return;
    updateSyncTarget(id, { enabled: !target.enabled });
  };

  /** Reorder targets by index. Out-of-range calls become no-ops. */
  const reorderSyncTargets = (from: number, to: number) => {
    if (
      from === to ||
      from < 0 ||
      from >= syncTargets.length ||
      to < 0 ||
      to >= syncTargets.length
    ) {
      return;
    }
    const next = [...syncTargets];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    writeSyncTargets(next);
  };

  // ── Sync (target-scoped) ──

  const handleReviewConflicts = async (targetId: string) => {
    const config = cloudSyncRef.current;
    if (
      !mounted.current ||
      selectionError(config) ||
      operationBusy.current ||
      getCloudSyncActivity().length
    )
      return;
    const target = config.syncTargets?.find(
      (item) =>
        item.id === targetId && item.enabled && item.provider !== "none",
    );
    if (!target) return;
    const context: ReviewContext = {
      target: structuredClone(target),
      config: structuredClone(config),
      identity: cloudSyncTargetIdentity(targetId),
    };
    reviewContext.current = context;
    setReviewRequestSequence((sequence) => sequence + 1);
    setReviewingTargetId(targetId);
    publishReview({ targetId, phase: "loading", choices: {} });
    operationBusy.current = true;
    try {
      const error = targetError(target);
      if (error) {
        publishReview({
          targetId,
          phase: "error",
          choices: {},
          message: error,
        });
        return;
      }
      const review = await reviewCloudSyncTarget(target, config);
      if (
        !mounted.current ||
        reviewContext.current !== context ||
        !currentReviewContext(context, cloudSyncRef.current)
      )
        return;
      if (
        review.targetId !== targetId ||
        review.requestIdentity !== context.identity
      ) {
        publishReview({
          targetId,
          phase: "error",
          choices: {},
          message: refreshReviewMessage,
        });
        return;
      }
      const allSame =
        review.items.length > 0 &&
        review.items.every((item) => item.state === "same");
      const previousStatus = config.targetStatus?.[targetId];
      const samePreviousStatus = () =>
        sameReviewValue(
          previousStatus,
          cloudSyncRef.current.targetStatus?.[targetId],
        );
      if (allSame && previousStatus?.lastSyncStatus === "conflict") {
        if (!samePreviousStatus()) {
          publishReview({
            targetId,
            phase: "error",
            choices: {},
            message: refreshReviewMessage,
          });
          return;
        }
        // A preview alone must not manufacture sync success. Reuse the normal
        // receipt/freshness guards to verify this is still an all-identical no-op
        // and establish its checkpoint. Empty choices never resolve a conflict.
        publishReview({
          targetId,
          phase: "verifying",
          review,
          choices: {},
          message:
            "All reviewed copies match. Verifying before clearing the previous conflict…",
        });
        const result = await resolveCloudSyncTarget(target, config, review, {});
        if (
          !mounted.current ||
          reviewContext.current !== context ||
          !currentReviewContext(context, cloudSyncRef.current)
        )
          return;
        if (
          !samePreviousStatus() ||
          result.targetId !== targetId ||
          result.provider !== target.provider ||
          (result.requestIdentity &&
            result.requestIdentity !== context.identity)
        ) {
          publishReview({
            targetId,
            phase: "error",
            choices: {},
            message: refreshReviewMessage,
          });
          return;
        }
        const safe = safeResult(result, target, config);
        updateCloudSync(
          cloudSyncStatusUpdate(cloudSyncRef.current, [
            { ...safe, requestIdentity: context.identity },
          ]),
        );
        publishReview(
          result.status === "success"
            ? {
                targetId,
                phase: "complete",
                review,
                choices: {},
                message:
                  "All reviewed copies are already identical. The previous conflict is cleared.",
              }
            : {
                targetId,
                phase: "error",
                choices: {},
                message: `${safe.message} Refresh review before continuing.`,
              },
        );
        return;
      }
      publishReview({
        targetId,
        phase: "ready",
        review,
        choices: {},
        message: !review.items.length
          ? "No artifacts were reviewed; the previous sync status was retained."
          : !review.items.some((item) => item.state === "conflict")
            ? allSame
              ? "No conflicts found. All reviewed copies are identical."
              : "No conflicts found in this review. One-sided changes still need syncing."
            : undefined,
      });
    } catch (error) {
      if (
        mounted.current &&
        reviewContext.current === context &&
        currentReviewContext(context, cloudSyncRef.current)
      ) {
        publishReview({
          targetId,
          phase: "error",
          choices: {},
          message: reviewErrorMessage(error),
        });
      }
    } finally {
      operationBusy.current = false;
      if (mounted.current) setReviewingTargetId(null);
      if (
        mounted.current &&
        reviewContext.current === context &&
        !currentReviewContext(context, cloudSyncRef.current)
      )
        cancelConflictReview();
    }
  };

  const setConflictReviewChoice = (
    id: string,
    choice: CloudSyncReviewChoice,
  ) => {
    const state = reviewStateRef.current;
    const context = reviewContext.current;
    if (
      !state?.review ||
      state.phase !== "ready" ||
      !context ||
      !currentReviewContext(context, cloudSyncRef.current) ||
      operationBusy.current ||
      getCloudSyncActivity().length
    )
      return;
    const item = state.review.items.find(
      (item) => item.id === id && item.state === "conflict",
    );
    if (
      !item ||
      !(
        choice === "keepLocal" ||
        choice === "keepRemote" ||
        (choice === "smartMerge" && item.smartMergeAvailable)
      )
    )
      return;
    publishReview({ ...state, choices: { ...state.choices, [id]: choice } });
  };

  const handleApplyReviewedChoices = async () => {
    const state = reviewStateRef.current;
    const context = reviewContext.current;
    const config = cloudSyncRef.current;
    if (
      !mounted.current ||
      !context ||
      !state?.review ||
      state.phase !== "ready" ||
      operationBusy.current ||
      getCloudSyncActivity().length
    )
      return;
    if (
      !currentReviewContext(context, config) ||
      state.review.requestIdentity !== context.identity
    ) {
      publishReview({
        targetId: state.targetId,
        phase: "error",
        choices: {},
        message: refreshReviewMessage,
      });
      return;
    }
    const conflicts = state.review.items.filter(
      (item) => item.state === "conflict",
    );
    if (
      !conflicts.every(
        (item) =>
          state.choices[item.id] === "keepLocal" ||
          state.choices[item.id] === "keepRemote" ||
          (state.choices[item.id] === "smartMerge" && item.smartMergeAvailable),
      )
    )
      return;
    const target = config.syncTargets!.find(
      (item) => item.id === state.targetId,
    )!;
    const choices = Object.fromEntries(
      conflicts.map((item) => [item.id, state.choices[item.id]]),
    );
    operationBusy.current = true;
    setIsSyncing(true);
    setSyncingTargetId(target.id);
    startedTargets.current = [
      {
        id: target.id,
        provider: target.provider,
        requestIdentity: context.identity,
      },
    ];
    publishReview({ ...state, phase: "applying" });
    try {
      const result = await resolveCloudSyncTarget(
        target,
        config,
        state.review,
        choices,
      );
      if (
        !mounted.current ||
        reviewContext.current !== context ||
        !currentReviewContext(context, cloudSyncRef.current)
      )
        return;
      if (
        result.targetId !== target.id ||
        result.provider !== target.provider ||
        (result.requestIdentity && result.requestIdentity !== context.identity)
      ) {
        publishReview({
          targetId: target.id,
          phase: "error",
          choices: {},
          message: refreshReviewMessage,
        });
        return;
      }
      const safe = safeResult(result, target, config);
      // Persist only this target's result against the latest status map.
      updateCloudSync(
        cloudSyncStatusUpdate(cloudSyncRef.current, [
          { ...safe, requestIdentity: context.identity },
        ]),
      );
      publishReview({
        targetId: target.id,
        choices: {},
        phase: result.status === "success" ? "complete" : "error",
        message:
          result.status === "success"
            ? "Reviewed choices applied."
            : `${safe.message} Refresh review and choose again before applying.`,
      });
    } catch (error) {
      if (
        mounted.current &&
        reviewContext.current === context &&
        currentReviewContext(context, cloudSyncRef.current)
      ) {
        publishReview({
          targetId: target.id,
          phase: "error",
          choices: {},
          message: reviewErrorMessage(error),
        });
      }
    } finally {
      operationBusy.current = false;
      startedTargets.current = [];
      if (mounted.current) {
        setIsSyncing(false);
        setSyncingTargetId(null);
        if (
          reviewContext.current === context &&
          !currentReviewContext(context, cloudSyncRef.current)
        )
          cancelConflictReview();
      }
    }
  };

  const handleSyncNow = async (
    targetId?: string,
    resolution?: "keepLocal" | "keepRemote",
  ) => {
    // Legacy one-click callers may open a review, never override its choices.
    if (resolution) {
      if (targetId) await handleReviewConflicts(targetId);
      return;
    }
    const current = cloudSyncRef.current;
    if (
      !mounted.current ||
      selectionError(current) ||
      operationBusy.current ||
      isBusy ||
      getCloudSyncActivity().length
    )
      return;
    const currentTargets = current.syncTargets ?? [];

    const targetsToRun = targetId
      ? currentTargets.filter(
          (t) => t.id === targetId && t.enabled && t.provider !== "none",
        )
      : currentTargets.filter((t) => t.enabled && t.provider !== "none");

    if (targetsToRun.length === 0) return;

    cancelConflictReview();
    operationBusy.current = true;
    setIsSyncing(true);
    startedTargets.current = targetsToRun.map((target) => ({
      id: target.id,
      provider: target.provider,
      requestIdentity: cloudSyncTargetIdentity(target.id),
    }));
    setSyncingTargetId(targetId ?? null);
    try {
      await applySyncStatusUpdate(targetsToRun, current);
    } finally {
      operationBusy.current = false;
      setIsSyncing(false);
      startedTargets.current = [];
      setSyncingTargetId(null);
    }
  };

  const handleSyncTarget = async (targetId: string) => {
    await handleSyncNow(targetId);
  };

  const handleResolveConflict = async (
    targetId: string,
    resolution: "keepLocal" | "keepRemote",
  ) => {
    await handleSyncNow(targetId, resolution);
  };

  const handleTestTarget = async (targetId: string) => {
    const config = cloudSyncRef.current;
    if (!config.enabled || operationBusy.current || isBusy) return;
    const target = config.syncTargets?.find(
      (t) => t.id === targetId && t.enabled && t.provider !== "none",
    );
    if (!target) return;
    operationBusy.current = true;
    setTestingTargetId(targetId);
    const identity = cloudSyncTargetIdentity(targetId);
    testedTargets.current.delete(targetId);
    try {
      const error = targetError(target);
      let result: CloudSyncOperationResult;
      try {
        result = error
          ? { provider: target.provider, status: "failed", message: error }
          : await testCloudSyncTarget(target, config);
      } catch {
        result = {
          provider: target.provider,
          status: "failed",
          message:
            "Connection test could not complete. Check the target configuration and try again.",
        };
      }
      const latest = cloudSyncRef.current.syncTargets?.find(
        (t) => t.id === targetId,
      );
      if (
        cloudSyncRef.current.enabled &&
        latest?.enabled &&
        sameDestination(target, latest) &&
        identity === cloudSyncTargetIdentity(targetId) &&
        result.provider === target.provider
      ) {
        testedTargets.current.set(targetId, target);
        setTestResults((previous) => ({
          ...previous,
          [targetId]: {
            ...safeResult(result, target, config),
            requestIdentity: identity,
          },
        }));
      }
    } finally {
      operationBusy.current = false;
      setTestingTargetId(null);
    }
  };

  // ── Sync status icon helpers ──

  const getSyncStatusIcon = () => {
    if (!cloudSync.enabled || syncTargets.length === 0) {
      return React.createElement(CloudOff, {
        className: "w-5 h-5 text-[var(--color-textSecondary)]",
      });
    }
    switch (cloudSync.lastSyncStatus) {
      case "success":
        return React.createElement(Check, {
          className: "w-5 h-5 text-green-400",
        });
      case "failed":
        return React.createElement(X, {
          className: "w-5 h-5 text-red-400",
        });
      case "partial":
        return React.createElement(AlertTriangle, {
          className: "w-5 h-5 text-yellow-400",
        });
      case "conflict":
        return React.createElement(AlertTriangle, {
          className: "w-5 h-5 text-orange-400",
        });
      default:
        return React.createElement(RefreshCw, {
          className: "w-5 h-5 text-blue-400",
        });
    }
  };

  return {
    // State
    expandedTargetId,
    setExpandedTargetId,
    isSyncing: anySyncing,
    syncingTargetId,
    testingTargetId,
    isBusy,
    conflictReview,
    reviewRequestSequence,
    validationError,
    authTargetId,
    authForm,
    setAuthForm,

    // Derived
    cloudSync,
    enabledProviders,
    providerStatus,
    syncTargets,

    // Actions
    updateCloudSync,
    openTokenDialog,
    saveTokenDialog,
    closeTokenDialog,
    getProviderStatus,
    getTargetStatus,
    isTargetSyncing,
    getSyncTimestampMs,
    handleSyncNow,
    handleSyncTarget,
    handleTestTarget,
    getTargetTestResult,
    handleResolveConflict,
    handleReviewConflicts,
    setConflictReviewChoice,
    handleApplyReviewedChoices,
    cancelConflictReview,
    getSyncStatusIcon,

    // Multi-target list management
    addSyncTarget,
    removeSyncTarget,
    updateSyncTarget,
    toggleSyncTarget,
    reorderSyncTargets,
  };
}
