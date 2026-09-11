export interface WebNetworkGuardStatus {
  platform: string;
  frameNavigation: "enforced" | "initializing" | "failed" | "unsupported";
  allNetworkRequestsMediated: false;
}
export function parseWebNetworkGuardStatus(
  value: unknown,
): WebNetworkGuardStatus {
  if (!value || typeof value !== "object")
    throw new Error(
      "Website navigation protection status is unavailable. Reload after the desktop application is ready.",
    );
  const status = value as Record<string, unknown>;
  if (
    typeof status.platform !== "string" ||
    !/^[a-z0-9_-]{1,32}$/.test(status.platform) ||
    !["enforced", "initializing", "failed", "unsupported"].includes(
      String(status.frameNavigation),
    ) ||
    status.allNetworkRequestsMediated !== false ||
    (status.platform === "windows" && status.frameNavigation === "unsupported")
  )
    throw new Error(
      "Website navigation protection status is invalid. Update or restart the desktop application before retrying.",
    );
  return status as unknown as WebNetworkGuardStatus;
}
