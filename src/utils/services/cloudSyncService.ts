import type {
  CloudSyncConfig,
  CloudSyncProvider,
  CloudSyncTarget,
} from "../../types/settings/settings";
import { getInvoke } from "../tauri/invoke";
import { defaultCloudSyncConfig } from "../../types/settings/cloudSyncSettings";
import {
  CloudSyncConflict,
  cloudSyncTransportOptions,
  runCloudSync,
  serializeCloudSync,
} from "./cloudSyncEngine";
import {
  beginCloudSyncActivity,
  cloudSyncTargetIdentity,
} from "./cloudSyncActivity";

export type CloudSyncResultStatus =
  "success" | "failed" | "partial" | "conflict";

export interface CloudSyncOperationResult {
  provider: CloudSyncProvider;
  targetId?: string;
  targetLabel?: string;
  /** Transient revision; excluded from persisted target/provider status. */
  requestIdentity?: symbol;
  status: CloudSyncResultStatus;
  message: string;
  latencyMs?: number;
  canRead?: boolean;
  canWrite?: boolean;
}

type CloudSyncTargetLike = CloudSyncTarget;

const PROVIDER_LABELS: Record<CloudSyncProvider, string> = {
  none: "None",
  googleDrive: "Google Drive",
  oneDrive: "OneDrive",
  nextcloud: "Nextcloud",
  webdav: "WebDAV",
  sftp: "SFTP",
};

function errorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return error instanceof Error ? error.message : String(error);
}

function failed(
  provider: CloudSyncProvider,
  message: string,
  options: Partial<CloudSyncOperationResult> = {},
): CloudSyncOperationResult {
  return {
    provider,
    status: "failed",
    message,
    ...options,
  };
}

export function providersFromCloudSyncConfig(config?: {
  enabledProviders?: CloudSyncProvider[];
  syncTargets?: Array<Pick<CloudSyncTarget, "provider" | "enabled">>;
}): CloudSyncProvider[] {
  const targets = config?.syncTargets ?? [];
  if (targets.length > 0) {
    return Array.from(
      new Set(
        targets
          .filter((target) => target.enabled && target.provider !== "none")
          .map((target) => target.provider),
      ),
    );
  }
  return Array.from(
    new Set(
      (config?.enabledProviders ?? []).filter(
        (provider) => provider !== "none",
      ),
    ),
  );
}

export function syncTargetsFromCloudSyncConfig(
  config: {
    enabledProviders?: CloudSyncProvider[];
    syncTargets?: CloudSyncTarget[];
  } & Partial<CloudSyncConfig>,
  provider?: CloudSyncProvider,
): CloudSyncTargetLike[] {
  const targets = config.syncTargets ?? [];
  if (targets.length > 0) {
    return targets.filter(
      (target) =>
        target.enabled &&
        target.provider !== "none" &&
        (!provider || target.provider === provider),
    );
  }

  return (config.enabledProviders ?? [])
    .filter(
      (candidate) =>
        candidate !== "none" && (!provider || candidate === provider),
    )
    .map((candidate) => ({
      id: `legacy-${candidate}`,
      label: PROVIDER_LABELS[candidate],
      provider: candidate,
      enabled: true,
      ...(candidate !== "none" && config[candidate]
        ? { [candidate]: config[candidate] }
        : {}),
    }));
}

export function aggregateCloudSyncResults(
  results: CloudSyncOperationResult[],
): {
  status: CloudSyncResultStatus;
  message?: string;
} {
  if (results.length === 0) {
    return { status: "failed", message: "No enabled cloud sync targets." };
  }
  if (results.every((result) => result.status === "success")) {
    return { status: "success" };
  }
  if (results.some((result) => result.status === "conflict")) {
    return {
      status: "conflict",
      message: results
        .filter((result) => result.status !== "success")
        .map((result) => result.message)
        .join("; "),
    };
  }
  if (
    results.some(
      (result) => result.status === "success" || result.status === "partial",
    )
  ) {
    return {
      status: "partial",
      message: results
        .filter((result) => result.status !== "success")
        .map((result) => result.message)
        .join("; "),
    };
  }
  return {
    status: "failed",
    message: results.map((result) => result.message).join("; "),
  };
}

/** Rebuild summaries from enabled destinations, without retaining removed failures. */
export function cloudSyncProviderStatus(
  targets: CloudSyncTarget[],
  targetStatus: CloudSyncConfig["targetStatus"],
): CloudSyncConfig["providerStatus"] {
  const providerStatus: CloudSyncConfig["providerStatus"] = {};
  for (const provider of new Set(
    targets
      .filter((t) => t.enabled && t.provider !== "none")
      .map((t) => t.provider),
  )) {
    const providerTargets = targets.filter(
      (t) => t.enabled && t.provider === provider,
    );
    const statuses = providerTargets.flatMap((target) => {
      const status = targetStatus?.[target.id];
      return status?.provider === provider ? [status] : [];
    });
    if (!statuses.length) {
      providerStatus[provider] = { enabled: true };
      continue;
    }
    const aggregate = aggregateCloudSyncResults(
      statuses.map((status) => ({
        provider,
        status: status.lastSyncStatus,
        message: status.lastSyncError ?? "",
      })),
    );
    if (
      statuses.length < providerTargets.length &&
      aggregate.status === "success"
    ) {
      aggregate.status = "partial";
      aggregate.message = "Some targets have not synced yet.";
    }
    providerStatus[provider] = {
      enabled: true,
      lastSyncTime: Math.max(...statuses.map((status) => status.lastSyncTime)),
      lastSyncStatus: aggregate.status,
      lastSyncError: aggregate.message,
    };
  }
  return providerStatus;
}

/** Shared by Settings and toolbar runs so they persist the same target results. */
export function cloudSyncStatusUpdate(
  config: CloudSyncConfig,
  results: CloudSyncOperationResult[],
  completedAt = Math.floor(Date.now() / 1000),
): Partial<CloudSyncConfig> {
  const targets = config.syncTargets ?? [];
  const targetStatus = { ...config.targetStatus };
  const applicable = results.filter((result) => {
    if (
      result.requestIdentity &&
      (!result.targetId ||
        result.requestIdentity !== cloudSyncTargetIdentity(result.targetId))
    )
      return false;
    // Do not resurrect a removed target or attach an old provider's result to
    // a destination reconfigured while its request was in flight.
    if (!targets.length && result.targetId?.startsWith("legacy-")) return true;
    return targets.some(
      (target) =>
        target.enabled &&
        target.id === result.targetId &&
        target.provider === result.provider,
    );
  });
  if (!applicable.length) return {};
  for (const result of applicable) {
    if (!result.targetId) continue;
    const previous = targetStatus[result.targetId];
    targetStatus[result.targetId] = {
      provider: result.provider,
      lastSyncTime: completedAt,
      lastSyncStatus: result.status,
      lastSyncError: result.status === "success" ? undefined : result.message,
      lastSuccessTime:
        result.status === "success"
          ? completedAt
          : previous?.provider === result.provider
            ? previous.lastSuccessTime
            : undefined,
    };
  }
  const providerStatus = targets.length
    ? cloudSyncProviderStatus(targets, targetStatus)
    : { ...config.providerStatus };
  for (const provider of targets.length
    ? []
    : new Set(applicable.map((result) => result.provider))) {
    const aggregate = aggregateCloudSyncResults(
      applicable.filter((result) => result.provider === provider),
    );
    providerStatus[provider] = {
      enabled: true,
      lastSyncTime: completedAt,
      lastSyncStatus: aggregate.status,
      lastSyncError: aggregate.message,
    };
  }
  const aggregate = aggregateCloudSyncResults(applicable);
  return {
    enabledProviders: providersFromCloudSyncConfig(config),
    targetStatus,
    providerStatus,
    lastSyncTime: completedAt,
    lastSyncStatus: aggregate.status,
    lastSyncError: aggregate.message,
  };
}

export async function testCloudSyncProvider(
  provider: CloudSyncProvider,
  config?: CloudSyncConfig,
): Promise<CloudSyncOperationResult> {
  if (config?.enabled) {
    const targets = syncTargetsFromCloudSyncConfig(config, provider);
    if (targets.length) {
      const results = await Promise.all(
        targets.map((target) => testCloudSyncTarget(target, config)),
      );
      const aggregate = aggregateCloudSyncResults(results);
      return {
        provider,
        status: aggregate.status,
        message:
          aggregate.message ||
          "All configured destinations passed their read/write test.",
        canRead: results.every((result) => result.canRead === true),
        canWrite: results.every((result) => result.canWrite === true),
      };
    }
  }
  // A provider alone has no account, folder or credentials. Do not report a
  // globally registered service as proof that a particular target can sync.
  return failed(
    provider,
    "Select a configured destination and test that target.",
    { canRead: false, canWrite: false },
  );
}

export async function testCloudSyncTarget(
  target: CloudSyncTarget,
  config: CloudSyncConfig = defaultCloudSyncConfig,
): Promise<CloudSyncOperationResult> {
  const started = Date.now();
  const invoke = await getInvoke();
  const identity = cloudSyncTargetIdentity(target.id);
  try {
    if (!invoke)
      throw new Error(
        "Cloud sync connection tests require the desktop backend.",
      );
    await invoke("cloud_sync_test", {
      target,
      options: cloudSyncTransportOptions(config),
    });
    return {
      provider: target.provider,
      targetId: target.id,
      requestIdentity: identity,
      status: "success",
      message: "Created, read back and removed a temporary test file.",
      latencyMs: Date.now() - started,
      canRead: true,
      canWrite: true,
    };
  } catch (error) {
    return failed(target.provider, errorMessage(error), {
      targetId: target.id,
      requestIdentity: identity,
      latencyMs: Date.now() - started,
      canRead: false,
      canWrite: false,
    });
  }
}

export async function syncCloudTarget(
  target: CloudSyncTargetLike,
  config: CloudSyncConfig = defaultCloudSyncConfig,
): Promise<CloudSyncOperationResult> {
  const started = Date.now();
  const common = {
    targetId: target.id,
    targetLabel: target.label,
    requestIdentity: cloudSyncTargetIdentity(target.id),
  };
  try {
    const message = await serializeCloudSync(() => {
      if (common.requestIdentity !== cloudSyncTargetIdentity(target.id))
        throw new Error(
          "Sync target or selection changed while queued. Retry with the current settings.",
        );
      return runCloudSync(target, config);
    });
    return {
      ...common,
      provider: target.provider,
      status: "success",
      message,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    const conflict =
      error instanceof CloudSyncConflict ||
      (error &&
        typeof error === "object" &&
        "kind" in error &&
        error.kind === "conflict");
    const partial =
      error &&
      typeof error === "object" &&
      "kind" in error &&
      error.kind === "partial";
    return failed(target.provider, errorMessage(error), {
      ...common,
      status: partial ? "partial" : conflict ? "conflict" : "failed",
      latencyMs: Date.now() - started,
    });
  }
}

export async function syncCloudTargets(
  targets: CloudSyncTargetLike[],
  config: CloudSyncConfig = defaultCloudSyncConfig,
): Promise<CloudSyncOperationResult[]> {
  return Promise.all(
    targets
      .filter((target) => target.enabled && target.provider !== "none")
      .map(async (target) => {
        const requestIdentity = cloudSyncTargetIdentity(target.id);
        const finish = beginCloudSyncActivity({ ...target, requestIdentity });
        try {
          return {
            ...(await syncCloudTarget(
              structuredClone(target),
              structuredClone(config),
            )),
            requestIdentity,
          };
        } catch (error) {
          return failed(target.provider, errorMessage(error), {
            targetId: target.id,
            targetLabel: target.label,
            requestIdentity,
          });
        } finally {
          finish();
        }
      }),
  );
}
