import { proxyCollectionManager } from "../connection/proxyCollectionManager";
import type { SavedProxyProfile } from "../../types/settings/settings";

export interface ToolkitProxyProfile {
  id: string;
  name: string;
  url: string;
  disabled: boolean;
  reason?: string;
}

/** No credentials are copied into a URL or persisted in diagnostic reports. */
export function toolkitProxyProfile(
  profile: SavedProxyProfile,
): ToolkitProxyProfile {
  const entry: ToolkitProxyProfile = {
    id: profile.id,
    name: profile.name,
    url: "",
    disabled: true,
  };
  const config = profile.config;
  if (!config.enabled)
    return { ...entry, reason: "This proxy profile is disabled." };
  if (!["http", "https", "http-connect"].includes(config.type))
    return {
      ...entry,
      reason:
        "This toolkit route supports HTTP/HTTPS proxy endpoints, not tunnel chains or this proxy type.",
    };
  if (
    config.username ||
    config.password ||
    Object.keys(config.customHeaders ?? {}).length
  )
    return {
      ...entry,
      reason:
        "This profile needs authentication or custom headers that this toolkit route does not forward.",
    };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    return { ...entry, reason: "Invalid proxy port." };
  const host = config.host.trim();
  if (!host || /[\s/@?#\\]/.test(host))
    return { ...entry, reason: "Invalid proxy hostname." };
  try {
    const scheme = config.type === "https" ? "https" : "http";
    const url = new URL(
      `${scheme}://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${config.port}`,
    );
    if (url.username || url.password || url.pathname !== "/")
      return { ...entry, reason: "Invalid proxy endpoint." };
    return { ...entry, url: url.origin, disabled: false };
  } catch {
    return { ...entry, reason: "Invalid proxy endpoint." };
  }
}

export function getToolkitProxyProfiles(): ToolkitProxyProfile[] {
  return proxyCollectionManager.getProfiles().map(toolkitProxyProfile);
}
