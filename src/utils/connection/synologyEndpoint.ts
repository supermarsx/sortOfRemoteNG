/** Accept DNS subdomains, IP literals, host:port and root HTTP(S) URLs. */
export function normalizeSynologyEndpoint(
  host: string,
  port: number,
  useHttps: boolean,
) {
  const input = host.trim();
  if (!input || /[\s\\%\u007f]/.test(input))
    throw new Error("The NAS address is empty or contains invalid characters.");
  const explicitUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
  const ipv6 =
    !explicitUrl &&
    !input.startsWith("[") &&
    (input.match(/:/g)?.length ?? 0) > 1;
  let url: URL;
  try {
    url = new URL(
      explicitUrl
        ? input
        : `${useHttps ? "https" : "http"}://${ipv6 ? `[${input}]` : input}`,
    );
  } catch {
    throw new Error(
      "The NAS address is invalid. Use a hostname, subdomain, IP address or HTTP(S) address.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "The NAS address must identify the server, without embedded credentials, query parameters or an application path.",
    );
  // URL default ports are normalized to empty by URL; a URL still means 80/443,
  // while a plain host uses the separately configured DSM port.
  const explicitAuthorityPort = /:\d+$/.test(
    input.replace(/\/$/, "").replace(/^https?:\/\//i, ""),
  );
  const resolvedPort = url.port
    ? Number(url.port)
    : explicitUrl || (!ipv6 && explicitAuthorityPort)
      ? url.protocol === "https:"
        ? 443
        : 80
      : port;
  if (
    !Number.isInteger(resolvedPort) ||
    resolvedPort < 1 ||
    resolvedPort > 65535
  )
    throw new Error("The NAS port must be between 1 and 65535.");
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: resolvedPort,
    useHttps: url.protocol === "https:",
  };
}
