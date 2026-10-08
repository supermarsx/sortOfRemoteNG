import type { Connection } from "../../types/connection/connection";
import { getDefaultPort } from "../discovery/defaultPorts";
import { parseCanonicalWebAuthority } from "./sanitizeHostname";

export type BrowserProtocol = "http" | "https";

export const isBrowserProtocol = (
  value: string | undefined,
): value is BrowserProtocol => value === "http" || value === "https";

/** `browser` is a picker-only value. Never persist it as a transport protocol. */
export const connectionTypeValue = (protocol: string | undefined): string =>
  isBrowserProtocol(protocol) ? "browser" : (protocol ?? "");

export const resolveConnectionType = (
  value: string,
  current?: string,
): string =>
  value === "browser"
    ? isBrowserProtocol(current)
      ? current
      : "https"
    : value;

/** Group only the supplied options, leaving runtime capability filtering intact. */
export function browserConnectionTypeOptions<
  T extends { value: string; label: string },
>(options: readonly T[]): T[] {
  let browserAdded = false;
  return options.flatMap((option) => {
    if (!isBrowserProtocol(option.value)) return [option];
    if (browserAdded) return [];
    browserAdded = true;
    return [
      {
        ...option,
        value: "browser",
        label: "Browser",
        labelKey: undefined,
        desc: "Websites and dashboards (HTTP / HTTPS)",
        descKey: undefined,
        description: "Websites and dashboards (HTTP / HTTPS)",
      },
    ];
  });
}

export function browserProtocolPort(
  current: string | undefined,
  port: number | undefined,
  next: BrowserProtocol,
): number {
  return !port || port === getDefaultPort(current ?? "https")
    ? getDefaultPort(next)
    : port;
}

/** An explicit transport change keeps authentication and exact URL suffixes.
 * Opening/reselecting Browser is a no-op for existing HTTP/HTTPS records. */
export function changeBrowserProtocol(
  current: Partial<Connection>,
  protocol: BrowserProtocol,
): Partial<Connection> {
  if (current.protocol === protocol) return current;
  let port = browserProtocolPort(current.protocol, current.port, protocol);
  try {
    // Preserve an explicitly written authority port, even :80 or :443.
    port = parseCanonicalWebAuthority(current.hostname ?? "").port ?? port;
  } catch {
    // Incomplete input remains editable; normal save validation still applies.
  }
  return {
    ...current,
    protocol,
    port,
    hostname: current.hostname?.replace(/^https?:\/\//i, `${protocol}://`),
  };
}
