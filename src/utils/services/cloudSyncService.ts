import type {
  CloudSyncProvider,
  CloudSyncTarget,
} from "../../types/settings/settings";
import { getInvoke } from "../tauri/invoke";

export type CloudSyncResultStatus =
  | "success"
  | "failed"
  | "partial"
  | "conflict";

export interface CloudSyncOperationResult {
  provider: CloudSyncProvider;
  targetId?: string;
  targetLabel?: string;
  status: CloudSyncResultStatus;
  message: string;
  latencyMs?: number;
  canRead?: boolean;
  canWrite?: boolean;
}

type CloudSyncTargetLike = Pick<
  CloudSyncTarget,
  "id" | "label" | "provider" | "enabled"
>;

const PROVIDER_LABELS: Record<CloudSyncProvider, string> = {
  none: "None",
  googleDrive: "Google Drive",
  oneDrive: "OneDrive",
  nextcloud: "Nextcloud",
  webdav: "WebDAV",
  sftp: "SFTP",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unsupportedProvider(provider: CloudSyncProvider): string {
  return `${PROVIDER_LABELS[provider]} cloud sync does not have a registered sync backend in this build.`;
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
  },
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
  if (results.some((result) => result.status === "success")) {
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

export async function testCloudSyncProvider(
  provider: CloudSyncProvider,
): Promise<CloudSyncOperationResult> {
  const started = Date.now();
  const invoke = await getInvoke();
  const latencyMs = Date.now() - started;

  if (!invoke) {
    return failed(
      provider,
      "Cloud sync connection tests require the Tauri backend.",
      { latencyMs, canRead: false, canWrite: false },
    );
  }

  if (provider === "nextcloud") {
    try {
      await invoke("nextcloud_sync_list");
      return failed(
        provider,
        "Nextcloud sync backend is reachable, but this settings surface has no read/write validation command.",
        {
          latencyMs: Date.now() - started,
          canRead: false,
          canWrite: false,
        },
      );
    } catch (error) {
      return failed(
        provider,
        `Nextcloud sync backend is unavailable: ${errorMessage(error)}`,
        {
          latencyMs: Date.now() - started,
          canRead: false,
          canWrite: false,
        },
      );
    }
  }

  return failed(provider, unsupportedProvider(provider), {
    latencyMs,
    canRead: false,
    canWrite: false,
  });
}

export async function syncCloudTarget(
  target: CloudSyncTargetLike,
): Promise<CloudSyncOperationResult> {
  return failed(target.provider, unsupportedProvider(target.provider), {
    targetId: target.id,
    targetLabel: target.label,
  });
}

export async function syncCloudTargets(
  targets: CloudSyncTargetLike[],
): Promise<CloudSyncOperationResult[]> {
  return Promise.all(targets.map((target) => syncCloudTarget(target)));
}
