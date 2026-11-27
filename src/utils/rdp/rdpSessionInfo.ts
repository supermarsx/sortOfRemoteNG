import type { RDPSessionInfo } from "../../hooks/rdp/useRdpSessionPanel";

/** Native RdpSession is camelCase. Normalize once at the IPC boundary while
 * accepting older snake_case fixtures/backends; never invent a resolution. */
export function normalizeRdpSessionInfo(value: RDPSessionInfo): RDPSessionInfo {
  const row = value as RDPSessionInfo & Record<string, unknown>;
  const size = (value: unknown) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 65535
      ? value
      : 0;
  const target = (row.targetIdentity ?? row.target_identity) as
    { host?: unknown; port?: unknown } | undefined;
  const identity =
    target && typeof target.host === "string" && typeof target.port === "number"
      ? { host: target.host, port: target.port }
      : undefined;
  return {
    ...row,
    connection_id: (row.connectionId ?? row.connection_id) as
      string | undefined,
    frontend_session_id: (row.frontendSessionId ?? row.frontend_session_id) as
      string | undefined,
    desktop_width: size(row.desktopWidth ?? row.desktop_width),
    desktop_height: size(row.desktopHeight ?? row.desktop_height),
    viewer_attached: (row.viewerAttached ?? row.viewer_attached) as
      boolean | undefined,
    server_cert_fingerprint: (row.serverCertFingerprint ??
      row.server_cert_fingerprint) as string | undefined,
    target_identity: identity,
    tunneled:
      !!identity &&
      (identity.host.toLowerCase() !== row.host.toLowerCase() ||
        identity.port !== row.port),
  };
}

export function rdpResolutionLabel(
  session: RDPSessionInfo | undefined,
): string {
  const width = session?.desktop_width,
    height = session?.desktop_height;
  return Number.isInteger(width) &&
    Number.isInteger(height) &&
    width! > 0 &&
    height! > 0
    ? `${width}×${height}`
    : session?.connected
      ? "Resolution pending"
      : "Resolution unavailable";
}
